//! Phase B e2e: a real host-agent served over Iroh (direct QUIC, NO relay), driven
//! by `RemoteDrive::connect_iroh`. Exercises the whole-file path, the multi-chunk
//! chunked RPC (the streamed transfer, first time over Iroh), and remote MOVE.

#![cfg(feature = "iroh")]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use client_core::{decrypt_file, encrypt_file, RemoteDrive};
use core_crypto::{open_chunk, seal_chunk, AccountRootKey, DeviceKeypair, SymKey};
use core_net::iroh::{bind_endpoint, secret_from_device, serve_iroh, Endpoint, EndpointAddr};
use host_agent::{HostAgent, HostConfig};

const CHUNK: usize = 4 * 1024 * 1024;

async fn host_addr(ep: &Endpoint) -> EndpointAddr {
    for _ in 0..50 {
        let a = ep.addr();
        if a.ip_addrs().next().is_some() {
            return a;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    ep.addr()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn remote_drive_over_iroh() {
    let client_kp = DeviceKeypair::generate();
    let ark = AccountRootKey::generate();

    // Host agent (ARK is client-side; the host only ever stores ciphertext). The
    // session is sealed to the HostAgent's OWN agreement key (from its identity).
    let data = std::env::temp_dir().join(format!("pc-iroh-e2e-{}", std::process::id()));
    let mut host = HostAgent::init(HostConfig { data_dir: data, quota_bytes: 100 * 1024 * 1024 }).unwrap();
    host.authorize_client(client_kp.id);
    let host_pub = host.agreement_public();
    let host = Arc::new(Mutex::new(host));

    // Serve the host over a direct-QUIC endpoint (offline: no relay). The endpoint
    // key is independent of the session auth (the client seals to `host_pub`).
    let host_ep = bind_endpoint(secret_from_device(&DeviceKeypair::generate()), true).await.unwrap();
    let host_eid = host_ep.id().to_string();
    let addr = host_addr(&host_ep).await;
    let direct: Vec<String> = addr.ip_addrs().map(|a| a.to_string()).collect();
    {
        let (h1, h2, h3) = (host.clone(), host.clone(), host.clone());
        tokio::spawn(async move {
            let _ = serve_iroh(
                host_ep,
                host_agreement_pub,
                move |b| h1.lock().unwrap().open_sealed(b),
                move |id| h2.lock().unwrap().is_authorized(id),
                move |req| h3.lock().unwrap().handle(req),
            )
            .await;
        });
    }

    // Client connects DIRECTLY over QUIC — no relay in the loop. Reconstruct the
    // host's EndpointAddr from control-plane-style discovery strings (id + direct
    // addrs), then connect_auto (prefers iroh; the dummy relay URL is never used).
    let client_ep = bind_endpoint(secret_from_device(&client_kp), true).await.unwrap();
    let dial = core_net::iroh::endpoint_addr(&host_eid, &direct, None).unwrap();
    let mut drive = RemoteDrive::connect_auto(
        Some((&client_ep, dial)),
        "ws://127.0.0.1:1",
        "acct",
        &client_kp,
        &host_pub,
        None,
    )
    .await
    .unwrap();

    // whole-file round-trip
    drive.mkdir("/", "Docs").await.unwrap();
    let plaintext = b"hello over iroh direct QUIC".to_vec();
    drive.put("/Docs", "hello.txt", encrypt_file(&ark, &plaintext)).await.unwrap();
    let got = drive.read("/Docs/hello.txt").await.unwrap();
    assert_eq!(decrypt_file(&ark, &got).unwrap(), plaintext);

    // multi-chunk (9 MB -> 3 chunks) via the chunked RPC over Iroh
    let big: Vec<u8> = (0..9_000_000u32).map(|i| (i % 251) as u8).collect();
    let ck = SymKey::generate();
    let upload_id =
        drive.upload_begin("/Docs", "big.bin", big.len() as u64, ark.wrap_content_key(&ck)).await.unwrap();
    let mut seq = 0u32;
    for chunk in big.chunks(CHUNK) {
        drive.upload_chunk(&upload_id, seal_chunk(&ck, seq, chunk)).await.unwrap();
        seq += 1;
    }
    drive.upload_commit(&upload_id).await.unwrap();

    let info = drive.read_begin("/Docs/big.bin").await.unwrap().unwrap();
    let ck2 = ark.unwrap_content_key(&info.wrapped_ck).unwrap();
    let mut reassembled = Vec::new();
    for s in 0..info.chunk_count as u32 {
        let ct = drive.read_chunk("/Docs/big.bin", s as u64).await.unwrap();
        reassembled.extend_from_slice(&open_chunk(&ck2, s, &ct).unwrap());
    }
    assert_eq!(reassembled.len(), big.len());
    assert!(reassembled == big, "multi-chunk mismatch over iroh");

    // remote MOVE (Rename RPC) + quota
    drive.rename("/Docs/big.bin", "/Docs", "moved.bin").await.unwrap();
    assert!(drive.stat("/Docs/big.bin").await.unwrap().is_none());
    assert!(drive.stat("/Docs/moved.bin").await.unwrap().is_some());
    let q = drive.quota().await.unwrap();
    assert_eq!(q.used_bytes, (plaintext.len() + big.len()) as u64);

    drive.close().await.unwrap();
}
