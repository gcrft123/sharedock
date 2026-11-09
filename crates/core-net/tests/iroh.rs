//! Phase A: direct-QUIC (Iroh) transport — two endpoints on loopback, no relay.
//! Proves the encrypted RPC round-trips over a direct connection and that an
//! unauthorized device is rejected by the session handshake.

#![cfg(feature = "iroh")]

use std::time::Duration;

use core_crypto::DeviceKeypair;
use core_net::iroh::{
    bind_endpoint, secret_from_device, serve_iroh, settled_path_type, Endpoint, EndpointAddr,
    IrohClient, PathType,
};
use core_proto::{Quota, Request, Response};

fn handler(req: Request) -> Response {
    match req {
        Request::GetQuota => {
            Response::Quota(Quota { used_bytes: 42, quota_bytes: 1000, file_count: 3 })
        }
        // The binary upload-chunk frame carries a session-sealed upload id + RAW content
        // ciphertext; echo Ok only if the host reconstructed both correctly.
        Request::UploadChunk { upload_id, ciphertext } => {
            if upload_id == "up-42" && ciphertext == b"raw-content-ciphertext" {
                Response::Ok
            } else {
                Response::Error { message: format!("bad chunk: id={upload_id} len={}", ciphertext.len()) }
            }
        }
        _ => Response::Error { message: "unsupported".into() },
    }
}

/// Wait until the endpoint has discovered at least one direct IP address (iroh
/// populates these asynchronously after bind), then return its `EndpointAddr`.
async fn host_direct_addr(ep: &Endpoint) -> EndpointAddr {
    for _ in 0..50 {
        let addr = ep.addr();
        if addr.ip_addrs().next().is_some() {
            return addr;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    ep.addr()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn iroh_direct_rpc_roundtrip_and_auth() {
    let host_kp = DeviceKeypair::generate();
    let client_kp = DeviceKeypair::generate();
    let host_pub = host_kp.agreement_public();

    // Host endpoint (offline: no relay, no discovery — dial by direct addr).
    let host_ep = bind_endpoint(secret_from_device(&host_kp), true).await.unwrap();
    let host_addr = host_direct_addr(&host_ep).await;

    // Authorize ONLY client_kp.
    let authorized_id = client_kp.id;
    let host_bytes = host_kp.to_bytes();
    tokio::spawn(async move {
        let _ = serve_iroh(
            host_ep,
            host_pub,
            move |b| DeviceKeypair::from_bytes(&host_bytes).open_sealed(b),
            move |id| *id == authorized_id,
            handler,
        )
        .await;
    });

    // Authorized client → encrypted RPC round-trips directly (no relay).
    let client_ep = bind_endpoint(secret_from_device(&client_kp), true).await.unwrap();
    let mut client =
        IrohClient::connect(&client_ep, host_addr.clone(), &client_kp, &host_pub).await.unwrap();
    match client.request(&Request::GetQuota).await.unwrap() {
        Response::Quota(q) => {
            assert_eq!(q.used_bytes, 42);
            assert_eq!(q.file_count, 3);
        }
        other => panic!("unexpected response: {other:?}"),
    }

    // Honest path reporting: this connection has no relay configured (offline bind), so its
    // live transport MUST classify as a direct IP path. This is the exact check that stops
    // the console from labeling a DERP-relayed QUIC session as "Direct P2P".
    let pt = settled_path_type(&client_ep, host_addr.id, Duration::from_secs(3)).await;
    assert_eq!(pt, PathType::Direct, "offline loopback connection must be direct, got {pt:?}");

    // Binary upload-chunk fast path: raw content-ciphertext travels un-base64'd (only the upload
    // id is session-sealed). The host must reconstruct both from the TAG_UPLOAD_CHUNK frame.
    match client.upload_chunk("up-42", b"raw-content-ciphertext").await.unwrap() {
        Response::Ok => {}
        other => panic!("upload_chunk: unexpected response: {other:?}"),
    }

    // Unauthorized device → rejected by host_accept (no session established).
    let stranger = DeviceKeypair::generate();
    let stranger_ep = bind_endpoint(secret_from_device(&stranger), true).await.unwrap();
    let rejected = match IrohClient::connect(&stranger_ep, host_addr, &stranger, &host_pub).await {
        Err(_) => true,
        Ok(mut c) => c.request(&Request::GetQuota).await.is_err(),
    };
    assert!(rejected, "unauthorized client must be rejected");
}
