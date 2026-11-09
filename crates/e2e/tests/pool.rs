//! Multi-host POOL over the real remote stack. Two hosts share ONE relay + ONE account
//! but sit in separate per-host rooms (`account:h0` / `account:h1` — the Phase-2 room
//! model), and are presented as ONE pooled drive via `MultiHostDrive`. Proves end-to-end,
//! over `host-agent` → relay (per-host room) → `client_core::RemoteDrive` →
//! `core_webdav::RemoteDrive`:
//!   * a directory replicates to every host,
//!   * distinct files distribute one-per-host (balanced placement uses both),
//!   * listings are the union, and every file reads back byte-exact,
//!   * capacity is the sum of the hosts,
//!   * delete and cross-directory rename route to the owning host.

use std::sync::Arc;
use std::time::Duration;

use core_crypto::{AccountRootKey, AgreementPublic, DeviceId, DeviceKeypair};
use core_webdav::{Drive, Mode, MultiHostDrive, RemoteDrive, Strategy, CHUNK};
use tokio::net::TcpListener;

/// Turn any drive error into an `anyhow::Error` without naming the (unexported) type.
fn de(e: impl std::fmt::Debug) -> anyhow::Error {
    anyhow::anyhow!("drive error: {e:?}")
}

/// A local dev relay (the DO stand-in). Returns its `ws://` base url.
async fn spawn_relay() -> anyhow::Result<String> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    tokio::spawn(async move {
        let _ = core_net::relay::run_server(listener).await;
    });
    Ok(format!("ws://{addr}"))
}

/// Start a host serving `account`'s per-host `room` over `base`, authorizing `client_id`.
/// Runs on its own thread with a single-thread runtime (the `core-fs` store is not
/// `Sync`). Returns the host's agreement pubkey (the client handshake seals to it).
fn spawn_host(base: String, account: String, room: &str, client_id: DeviceId, quota: u64) -> AgreementPublic {
    let data_dir = std::env::temp_dir().join(format!("pc-pool-{}-{room}", std::process::id()));
    let _ = std::fs::remove_dir_all(&data_dir);
    let mut host =
        host_agent::HostAgent::init(host_agent::HostConfig { data_dir, quota_bytes: quota }).unwrap();
    host.authorize_client(client_id);
    let host_pub = host.agreement_public();
    let room = room.to_string();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(async move {
            let _ = core_net::relay::serve(
                &base,
                &account,
                Some(&room), // this host's own room, isolated from the other host
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

/// The shared account key, duplicated so each per-host member drive holds the same ARK.
fn dup(ark: &AccountRootKey) -> AccountRootKey {
    AccountRootKey::from_bytes(ark.to_bytes())
}

async fn put(d: &dyn Drive, parent: &str, name: &str, data: &[u8]) -> anyhow::Result<()> {
    let h = d.write_begin(parent, name, data.len() as u64).await.map_err(de)?;
    for (i, chunk) in data.chunks(CHUNK).enumerate() {
        d.write_chunk(&h, i as u32, chunk).await.map_err(de)?;
    }
    d.write_commit(&h).await.map_err(de)
}

async fn read_all(d: &dyn Drive, path: &str) -> anyhow::Result<Vec<u8>> {
    let h = d
        .read_begin(path)
        .await
        .map_err(de)?
        .ok_or_else(|| anyhow::anyhow!("not found: {path}"))?;
    let mut out = Vec::new();
    for seq in 0..h.chunk_count {
        out.extend_from_slice(&d.read_chunk(&h, seq).await.map_err(de)?);
    }
    Ok(out)
}

async fn sorted_names(d: &dyn Drive, path: &str) -> anyhow::Result<Vec<String>> {
    let mut names: Vec<String> =
        d.list(path).await.map_err(de)?.iter().map(|e| e.name.clone()).collect();
    names.sort();
    Ok(names)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn pool_over_two_remote_hosts() -> anyhow::Result<()> {
    let account = "acct-pool".to_string();
    let dev = DeviceKeypair::generate();
    let ark = AccountRootKey::generate();
    const HOST_QUOTA: u64 = 1 << 30; // 1 GiB each

    // Two hosts on ONE relay + ONE account, isolated in per-host rooms.
    let base = spawn_relay().await?;
    let pub0 = spawn_host(base.clone(), account.clone(), "h0", dev.id, HOST_QUOTA);
    let pub1 = spawn_host(base.clone(), account.clone(), "h1", dev.id, HOST_QUOTA);
    tokio::time::sleep(Duration::from_millis(600)).await;

    // The client opens one connection PER host room and presents them as one pooled drive.
    // `d0`/`d1` are also kept (cloned Arcs) so we can inspect each host's actual contents.
    let c0 = client_core::RemoteDrive::connect(&base, &account, &dev, &pub0, Some("h0"), None).await?;
    let c1 = client_core::RemoteDrive::connect(&base, &account, &dev, &pub1, Some("h1"), None).await?;
    let d0: Arc<dyn Drive> = Arc::new(RemoteDrive::new(c0, dup(&ark)));
    let d1: Arc<dyn Drive> = Arc::new(RemoteDrive::new(c1, dup(&ark)));
    let pool = MultiHostDrive::new(
        vec![("h0".into(), d0.clone()), ("h1".into(), d1.clone())],
        Mode::Pool(Strategy::Balanced),
    );

    // A directory replicates to BOTH hosts.
    pool.mkdir("/", "shared").await.map_err(de)?;
    assert!(d0.stat("/shared").await.map_err(de)?.is_some(), "dir missing on h0");
    assert!(d1.stat("/shared").await.map_err(de)?.is_some(), "dir missing on h1");

    // Distinct files distribute across the two hosts (balanced uses both).
    for i in 0..6u8 {
        put(&pool, "/shared", &format!("f{i}.bin"), &vec![i; 4096]).await?;
    }
    let n0 = d0.list("/shared").await.map_err(de)?.len();
    let n1 = d1.list("/shared").await.map_err(de)?.len();
    assert_eq!(n0 + n1, 6, "every file lands on exactly one host");
    assert!(n0 > 0 && n1 > 0, "balanced placement should use both hosts (got {n0}/{n1})");

    // The pool presents the UNION as one directory; every file reads back intact.
    assert_eq!(
        sorted_names(&pool, "/shared").await?,
        vec!["f0.bin", "f1.bin", "f2.bin", "f3.bin", "f4.bin", "f5.bin"]
    );
    for i in 0..6u8 {
        assert_eq!(read_all(&pool, &format!("/shared/f{i}.bin")).await?, vec![i; 4096]);
    }

    // Capacity is the SUM of the two hosts.
    let u = pool.usage().await.map_err(de)?;
    assert_eq!(u.total, HOST_QUOTA * 2, "pool capacity should be the sum of hosts");
    assert!(u.used > 0);

    // Delete routes to the owning host and leaves the union.
    pool.delete("/shared/f3.bin").await.map_err(de)?;
    assert!(pool.stat("/shared/f3.bin").await.map_err(de)?.is_none());
    assert!(!sorted_names(&pool, "/shared").await?.contains(&"f3.bin".to_string()));

    // Cross-directory rename moves the owning host's file (dst dir exists on all hosts).
    pool.mkdir("/", "archive").await.map_err(de)?;
    pool.rename("/shared/f5.bin", "/archive", "f5.bin").await.map_err(de)?;
    assert!(pool.stat("/shared/f5.bin").await.map_err(de)?.is_none());
    assert_eq!(read_all(&pool, "/archive/f5.bin").await?, vec![5u8; 4096]);

    Ok(())
}
