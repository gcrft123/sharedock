//! Multi-host Phase 3b — host-to-host mirror replication OVER THE WIRE. Host A (local,
//! the "best-connected" host a client wrote to) pushes its objects to host B (served over
//! the relay) using the peer RPC: anti-entropy diffs the manifests (`ListManifest`) and
//! ships each missing/older object (`ImportObject`). B then serves a byte-identical,
//! ARK-decryptable copy — i.e. real mirror redundancy end to end (a client could now read
//! the file from B if A dropped).

use std::time::Duration;

use core_crypto::{AccountRootKey, AgreementPublic, DeviceId, DeviceKeypair};
use core_proto::{Request, Response};
use tokio::net::TcpListener;

async fn spawn_relay() -> anyhow::Result<String> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    tokio::spawn(async move {
        let _ = core_net::relay::run_server(listener).await;
    });
    Ok(format!("ws://{addr}"))
}

/// A host served over the relay (account room), authorizing `peer_id` as a replication
/// peer. Returns its agreement pubkey (the peer handshake seals to it).
fn spawn_host(base: String, account: String, peer_id: DeviceId, quota: u64, tag: &str) -> AgreementPublic {
    let data_dir = std::env::temp_dir().join(format!("pc-mir-{}-{tag}", std::process::id()));
    let _ = std::fs::remove_dir_all(&data_dir);
    let mut host =
        host_agent::HostAgent::init(host_agent::HostConfig { data_dir, quota_bytes: quota }).unwrap();
    host.authorize_client(peer_id); // a peer host authenticates like any authorized device
    let host_pub = host.agreement_public();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(async move {
            let _ = core_net::relay::serve(
                &base,
                &account,
                None,
                None,
                host.agreement_public(),
                |b| host.open_sealed(b),
                |id| host.is_authorized(id),
                |req| host.handle(req),
                tokio::sync::broadcast::channel::<()>(1).1,
            )
            .await;
        });
    });
    host_pub
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn mirror_replicates_host_to_host() -> anyhow::Result<()> {
    let account = "acct-mirror".to_string();
    let ark = AccountRootKey::generate();

    // A = a local host-agent (the host a client wrote to). Give it a dir + file.
    let a_dir = std::env::temp_dir().join(format!("pc-mir-A-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&a_dir);
    let a = host_agent::HostAgent::init(host_agent::HostConfig { data_dir: a_dir, quota_bytes: 1 << 30 })?;
    a.handle(Request::Mkdir { parent: "/".into(), name: "m".into() });
    let plaintext = b"mirror me across hosts".to_vec();
    let payload = client_core::encrypt_file(&ark, &plaintext);
    assert!(matches!(
        a.handle(Request::PutFile { parent: "/m".into(), name: "f.txt".into(), payload }),
        Response::Entry(_)
    ));

    // A's peer identity, authorized by B.
    let a_dev = DeviceKeypair::generate();

    // B = a host served over the relay.
    let base = spawn_relay().await?;
    let b_pub = spawn_host(base.clone(), account.clone(), a_dev.id, 1 << 30, "B");
    tokio::time::sleep(Duration::from_millis(600)).await;

    // A opens a peer connection to B and runs anti-entropy A -> B.
    let mut a_to_b =
        client_core::RemoteDrive::connect(&base, &account, &a_dev, &b_pub, None, None).await?;
    let peer_manifest = a_to_b.list_manifest().await?;
    let ids = host_agent::objects_to_push(&a.manifest()?, &peer_manifest);
    assert!(ids.contains(&"/m/f.txt".to_string()), "the file should need pushing, got {ids:?}");
    for id in ids {
        let export = a.export_object(&id)?.expect("object exists");
        a_to_b.import_object(export).await?;
    }

    // B now serves a byte-identical, ARK-decryptable copy (real redundancy).
    let got = a_to_b.read("/m/f.txt").await?;
    assert_eq!(
        client_core::decrypt_file(&ark, &got)?,
        plaintext,
        "B's replica must decrypt to the original with the same ARK"
    );

    // The manifests have converged — a second anti-entropy pass has nothing to push.
    assert!(
        host_agent::objects_to_push(&a.manifest()?, &a_to_b.list_manifest().await?).is_empty(),
        "after replication the two hosts should agree"
    );

    // Delete on A, re-run anti-entropy: the tombstone propagates and B removes its replica.
    tokio::time::sleep(Duration::from_millis(3)).await;
    assert!(matches!(a.handle(Request::Delete { id: "/m/f.txt".into() }), Response::Ok));
    for id in host_agent::objects_to_push(&a.manifest()?, &a_to_b.list_manifest().await?) {
        if let Some(export) = a.export_object(&id)? {
            a_to_b.import_object(export).await?;
        }
    }
    assert!(
        a_to_b.stat("/m/f.txt").await?.is_none(),
        "the delete should have propagated — B must not still serve the file"
    );

    a_to_b.close().await?;
    Ok(())
}
