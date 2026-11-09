//! End-to-end MVP core loop: a host and a client connected only through the
//! relay (the local stand-in for the Cloudflare Durable Object). Proves:
//!   - a client uploads an E2E-encrypted file and downloads it back byte-for-byte
//!   - the quota ("partition") cap is enforced over the wire
//!   - the plaintext never crosses the wire (content is encrypted client-side)
//!
//! No browser and no Cloudflare needed — the same protocol runs against the DO.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::net::TcpListener;

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    needle.len() <= haystack.len() && haystack.windows(needle.len()).any(|w| w == needle)
}

fn temp_dir(tag: &str) -> std::path::PathBuf {
    static C: AtomicU64 = AtomicU64::new(1);
    std::env::temp_dir().join(format!(
        "pc-e2e-{}-{}-{}",
        tag,
        std::process::id(),
        C.fetch_add(1, Ordering::Relaxed)
    ))
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn upload_download_through_relay() -> anyhow::Result<()> {
    const MARKER: &[u8] = b"TOP-SECRET-MARKER-42";

    // 1. relay on an ephemeral port (dev stand-in for the account Durable Object)
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    tokio::spawn(async move {
        let _ = core_net::relay::run_server(listener).await;
    });
    let base = format!("ws://{addr}");
    let account = "acct-e2e".to_string();

    // 2. host identity + pairing. The ARK is generated on the CLIENT; the host
    //    never sees it (it only ever stores wrapped keys + ciphertext).
    let mut host = host_agent::HostAgent::init(host_agent::HostConfig {
        data_dir: temp_dir("host"),
        quota_bytes: 1_000_000,
    })?;
    let client = core_crypto::DeviceKeypair::generate();
    host.authorize_client(client.id); // pairing approval
    let host_pub = host.agreement_public();
    let ark = core_crypto::AccountRootKey::generate();

    // 3. host serve loop on its own thread (single-thread runtime tolerates the
    //    !Send rusqlite connection; the closures borrow the host directly).
    {
        let base = base.clone();
        let account = account.clone();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            rt.block_on(async move {
                let _ = core_net::relay::serve(
                    &base,
                    &account,
                    None, // host room: the legacy account-only room
                    None, // relay token
                    host.agreement_public(),
                    |b| host.open_sealed(b),
                    |id| host.is_authorized(id),
                    |req| host.handle(req),
                    tokio::sync::broadcast::channel::<()>(1).1,
                )
                .await;
            });
        });
    }

    // let the host connect + register with the relay before the client speaks
    tokio::time::sleep(Duration::from_millis(500)).await;

    // 4. client drives the loop over the relay
    let mut drive =
        client_core::RemoteDrive::connect(&base, &account, &client, &host_pub, None, None).await?;
    drive.mkdir("/", "Docs").await?;

    let plaintext = b"launch is TOP-SECRET-MARKER-42; do not leak this line".to_vec();
    let payload = client_core::encrypt_file(&ark, &plaintext);

    // content E2EE: plaintext appears in NEITHER the ciphertext nor the wire RPC
    assert!(!contains(&payload.ciphertext, MARKER), "ciphertext leaks plaintext");
    let wire = core_proto::encode(&core_proto::Request::PutFile {
        parent: "/Docs".into(),
        name: "secret.txt".into(),
        payload: payload.clone(),
    });
    assert!(!contains(&wire, MARKER), "wire RPC leaks plaintext");

    // upload
    drive.put("/Docs", "secret.txt", payload).await?;

    // it shows up in a listing
    let entries = drive.list("/Docs").await?;
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].name, "secret.txt");

    // download + decrypt == original bytes
    let got = drive.read("/Docs/secret.txt").await?;
    let decrypted = client_core::decrypt_file(&ark, &got)?;
    assert_eq!(decrypted, plaintext, "round-trip mismatch");

    // quota reflects the plaintext size
    let q = drive.quota().await?;
    assert_eq!(q.used_bytes, plaintext.len() as u64);
    assert_eq!(q.file_count, 1);

    // 5. quota enforcement over the wire: an upload past the cap is rejected
    let too_big = client_core::encrypt_file(&ark, &vec![0u8; 1_100_000]);
    let rejected = drive.put("/Docs", "toobig.bin", too_big).await;
    assert!(rejected.is_err(), "over-quota upload must be rejected");

    // deleting frees the partition
    drive.delete("/Docs/secret.txt").await?;
    assert_eq!(drive.quota().await?.used_bytes, 0);

    drive.close().await?;
    Ok(())
}
