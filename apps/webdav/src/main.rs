//! Headless WebDAV server exposing an encrypted drive for Finder/Explorer
//! mounting (P2). Serves a LOCAL store by default, or a REMOTE host over the relay
//! when `PC_RELAY_URL` is set.
//!
//! Common config:
//!   PC_DATA_DIR     data dir (blobs for local; ark.key for both)  (default ./.pc-webdav)
//!   PC_WEBDAV_PORT  listen port                                   (default 4918)
//!   PC_WEBDAV_LOG   set to log each WebDAV request                (off by default)
//!
//! Local mode:
//!   PC_QUOTA_GB     partition cap in GiB                          (default 512)
//!
//! Remote mode (when PC_RELAY_URL is set — ws:// only, no TLS):
//!   PC_ACCOUNT      rendezvous account id                         (default "default")
//!   PC_HOST_PUB     host agreement pubkey, hex (printed by pc-daemon; REQUIRED)
//!   PC_RELAY_TOKEN  relay admission token (production relays)     (optional)
//!   PC_CLIENT_KEY   64-byte hex device key for a stable client id (optional)
//!
//! Iroh direct fast path (only with `--features iroh`; prefers a direct QUIC
//! connection, falls back to the relay above on any failure):
//!   PC_HOST_EID     host Iroh EndpointId (== device id, printed by pc-daemon)
//!   PC_HOST_ADDRS   comma-separated host "ip:port" direct addrs (printed by pc-daemon)
//!   PC_IROH_RELAY   iroh relay URL for NAT traversal              (optional; LAN-only if unset)
//!
//! Multi-host pooling (Phase 1; Iroh-only, so build `--features iroh`):
//!   PC_MODE         single | pool | mirror                        (default single)
//!   PC_STRATEGY     balanced | sequential  (pool fill order)      (default balanced)
//!   PC_HOST_PUBS    ';'-separated host agreement pubkeys (hex), one per host
//!   PC_HOST_EIDS    ';'-separated host Iroh EndpointIds, one per host
//!   PC_HOST_ADDRS   ';'-separated per-host addr lists; each host's addrs are ','-separated
//!                   e.g. "10.0.0.2:5000,10.0.0.2:5001;10.0.0.3:5000"
//!   (mirror is not yet implemented and will error on write.)
//!
//! Mount: Finder ⌘K → http://localhost:4918  (or `mount_webdav`).
//!
//! NOTE: the ARK is persisted BARE at `<data_dir>/ark.key` for LOCAL DEV ONLY; in
//! production the ARK lives wrapped in the OS keychain / behind a passphrase, and
//! for a remote mount it must be the account's ARK (else nothing decrypts).

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Result};
use core_crypto::{AccountRootKey, AgreementPublic, DeviceKeypair};
use core_fs::Store;
use core_webdav::{spawn_server, Drive, LocalDrive, Mode, RemoteDrive, Strategy};

const GIB: u64 = 1024 * 1024 * 1024;

/// Parse `PC_MODE` / `PC_STRATEGY` into a composite [`Mode`] (default: single host).
fn parse_mode() -> Mode {
    let strategy = match std::env::var("PC_STRATEGY").as_deref() {
        Ok("sequential") => Strategy::Sequential,
        _ => Strategy::Balanced,
    };
    match std::env::var("PC_MODE").as_deref() {
        Ok("pool") => Mode::Pool(strategy),
        Ok("mirror") => Mode::Mirror,
        _ => Mode::Single,
    }
}

/// Parse a 32-byte agreement pubkey from hex.
fn parse_host_pub(hex: &str) -> Result<AgreementPublic> {
    let bytes = core_crypto::from_hex(hex).ok_or_else(|| anyhow!("bad host pubkey hex"))?;
    let arr: [u8; 32] =
        bytes.as_slice().try_into().map_err(|_| anyhow!("host pubkey must be 32 bytes"))?;
    Ok(AgreementPublic::from_bytes(arr))
}


/// Load the dev ARK from `path`, or generate + persist a fresh one (0600).
fn load_or_create_ark(path: &Path) -> Result<AccountRootKey> {
    if let Ok(bytes) = std::fs::read(path) {
        if bytes.len() == 32 {
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&bytes);
            return Ok(AccountRootKey::from_bytes(arr));
        }
    }
    let ark = AccountRootKey::generate();
    core_fs::write_private(path, &ark.to_bytes())?;
    Ok(ark)
}

/// Connect a remote drive client. With the `iroh` feature built AND host discovery
/// provided via env (`PC_HOST_EID` + `PC_HOST_ADDRS`, as printed by pc-daemon), it
/// prefers the direct-QUIC fast path and falls back to the relay on any failure;
/// otherwise (or without the feature) it connects over the relay.
async fn connect_remote(
    relay: &str,
    account: &str,
    device: &DeviceKeypair,
    host_pub: &AgreementPublic,
    token: Option<&str>,
) -> Result<client_core::RemoteDrive> {
    #[cfg(feature = "iroh")]
    {
        if let (Ok(eid), Ok(addrs)) =
            (std::env::var("PC_HOST_EID"), std::env::var("PC_HOST_ADDRS"))
        {
            let direct: Vec<String> =
                addrs.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
            let relay_url = std::env::var("PC_IROH_RELAY").ok();
            let host_addr = core_net::iroh::endpoint_addr(&eid, &direct, relay_url.as_deref())?;
            // The endpoint owns the QUIC socket + driver task; it must outlive the
            // connection. This runner holds exactly one for its whole lifetime, so
            // leak it to get a 'static borrow (freed on process exit anyway).
            let secret = core_net::iroh::secret_from_device(device);
            let ep = core_net::iroh::bind_endpoint(secret, relay_url.is_none()).await?;
            let ep: &'static core_net::iroh::Endpoint = Box::leak(Box::new(ep));
            println!("  iroh: dialing host {eid} (direct → relay fallback)");
            return client_core::RemoteDrive::connect_auto(
                Some((ep, host_addr)),
                relay,
                account,
                device,
                host_pub,
                None, // single host → the legacy account room
                token,
            )
            .await;
        }
    }
    client_core::RemoteDrive::connect(relay, account, device, host_pub, None, token).await
}

#[cfg(feature = "iroh")]
fn split_list(s: &str) -> Vec<String> {
    s.split(';').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect()
}

/// Build a pooled/mirrored drive over N hosts (Phase 1: Iroh-only). Every member shares
/// one client Iroh endpoint and the account ARK; hosts come from the parallel
/// `PC_HOST_PUBS` / `PC_HOST_EIDS` / `PC_HOST_ADDRS` lists (';'-separated, one entry per
/// host; a host's direct addrs are ','-separated within its entry).
#[allow(unused_variables)]
async fn build_remote_multi(
    relay: &str,
    account: &str,
    device: &DeviceKeypair,
    token: Option<&str>,
    ark: AccountRootKey,
    mode: Mode,
) -> Result<Arc<dyn Drive>> {
    #[cfg(not(feature = "iroh"))]
    {
        anyhow::bail!(
            "PC_MODE=pool/mirror needs a build with --features iroh (Phase 1 multi-host is Iroh-only)"
        );
    }
    #[cfg(feature = "iroh")]
    {
        let pubs = split_list(
            &std::env::var("PC_HOST_PUBS").map_err(|_| anyhow!("PC_HOST_PUBS is required for multi-host mode"))?,
        );
        let eids = split_list(
            &std::env::var("PC_HOST_EIDS").map_err(|_| anyhow!("PC_HOST_EIDS is required for multi-host mode"))?,
        );
        let addr_groups = split_list(
            &std::env::var("PC_HOST_ADDRS").map_err(|_| anyhow!("PC_HOST_ADDRS is required for multi-host mode"))?,
        );
        if pubs.len() != eids.len() || pubs.len() != addr_groups.len() {
            anyhow::bail!(
                "PC_HOST_PUBS / PC_HOST_EIDS / PC_HOST_ADDRS must list the same number of ';'-separated hosts"
            );
        }
        if pubs.is_empty() {
            anyhow::bail!("no hosts configured (PC_HOST_PUBS is empty)");
        }

        let relay_url = std::env::var("PC_IROH_RELAY").ok();
        let secret = core_net::iroh::secret_from_device(device);
        // One endpoint dials every host; it must outlive all the connections.
        let ep = core_net::iroh::bind_endpoint(secret, relay_url.is_none()).await?;
        let ep: &'static core_net::iroh::Endpoint = Box::leak(Box::new(ep));

        println!(
            "  mode: REMOTE ({mode:?})  ·  relay {relay}  ·  account {account}  ·  {} hosts",
            pubs.len()
        );
        type BoxDrive = std::pin::Pin<
            Box<dyn std::future::Future<Output = anyhow::Result<Arc<dyn Drive>>> + Send>,
        >;
        let mut members: Vec<(String, Arc<dyn Drive>, Option<core_webdav::Reconnector>)> =
            Vec::with_capacity(pubs.len());
        for i in 0..pubs.len() {
            let addrs: Vec<String> = addr_groups[i]
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            println!("    host {i}: eid {}", eids[i]);

            // A re-dialer for THIS host: everything it needs is owned/'static so the
            // supervisor can call it to rebuild a dropped connection (the client Wire is
            // one-shot). Used for the initial connect too.
            let pub_hex = pubs[i].clone();
            let eid = eids[i].clone();
            let relay_s = relay.to_string();
            let account_s = account.to_string();
            let device_bytes = device.to_bytes();
            let token_s = token.map(str::to_string);
            let ark_bytes = ark.to_bytes();
            let relay_url = relay_url.clone();
            let make = move || -> BoxDrive {
                let (pub_hex, eid, relay_s, account_s, token_s, relay_url, addrs) = (
                    pub_hex.clone(),
                    eid.clone(),
                    relay_s.clone(),
                    account_s.clone(),
                    token_s.clone(),
                    relay_url.clone(),
                    addrs.clone(),
                );
                Box::pin(async move {
                    let device = DeviceKeypair::from_bytes(&device_bytes);
                    let host_pub = parse_host_pub(&pub_hex)?;
                    let host_addr =
                        core_net::iroh::endpoint_addr(&eid, &addrs, relay_url.as_deref())?;
                    let client = client_core::RemoteDrive::connect_auto(
                        Some((ep, host_addr)),
                        &relay_s,
                        &account_s,
                        &device,
                        &host_pub,
                        Some(&eid), // relay fallback lands in THIS host's per-host room
                        token_s.as_deref(),
                    )
                    .await?;
                    Ok(Arc::new(RemoteDrive::new(client, AccountRootKey::from_bytes(ark_bytes)))
                        as Arc<dyn Drive>)
                })
            };

            let drive = make().await?; // initial connect
            members.push((eids[i].clone(), drive, Some(Arc::new(make))));
        }
        // Supervise: ping each host every 15s, route around a dead one, reconnect it.
        Ok(Arc::new(core_webdav::MultiHostDrive::new_supervised(
            members,
            mode,
            std::time::Duration::from_secs(15),
        )))
    }
}

/// Build the backing drive: remote (over the relay) when `PC_RELAY_URL` is set,
/// otherwise a local encrypted store.
async fn build_drive(data: &Path, quota_gb: u64) -> Result<Arc<dyn Drive>> {
    let ark = load_or_create_ark(&data.join("ark.key"))?;

    if let Ok(relay) = std::env::var("PC_RELAY_URL") {
        let account = std::env::var("PC_ACCOUNT").unwrap_or_else(|_| "default".to_string());
        let token = std::env::var("PC_RELAY_TOKEN").ok();
        let device = match std::env::var("PC_CLIENT_KEY").ok().and_then(|h| core_crypto::from_hex(&h)) {
            Some(b) if b.len() == 64 => {
                let mut a = [0u8; 64];
                a.copy_from_slice(&b);
                DeviceKeypair::from_bytes(&a)
            }
            _ => DeviceKeypair::generate(),
        };
        println!("  client device id: {}", core_crypto::to_hex(device.id.as_bytes()));
        println!("  (this client id must be an APPROVED device of the account)");
        match parse_mode() {
            Mode::Single => {
                let host_pub_hex = std::env::var("PC_HOST_PUB").map_err(|_| {
                    anyhow!("PC_HOST_PUB (host agreement pubkey, hex) is required for remote mode")
                })?;
                let host_pub = parse_host_pub(&host_pub_hex)?;
                println!("  mode: REMOTE (single)  ·  relay {relay}  ·  account {account}");
                let client =
                    connect_remote(&relay, &account, &device, &host_pub, token.as_deref()).await?;
                Ok(Arc::new(RemoteDrive::new(client, ark)))
            }
            mode => build_remote_multi(&relay, &account, &device, token.as_deref(), ark, mode).await,
        }
    } else {
        let store = Store::open(&data.join("meta.db"), &data.join("blobs"))?;
        store.set_quota(quota_gb.saturating_mul(GIB))?;
        println!("  mode: LOCAL  ·  data {}  ·  quota {quota_gb} GiB", data.display());
        Ok(Arc::new(LocalDrive::new(store, ark)))
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let data_dir = std::env::var("PC_DATA_DIR").unwrap_or_else(|_| "./.pc-webdav".to_string());
    let port: u16 =
        std::env::var("PC_WEBDAV_PORT").ok().and_then(|s| s.parse().ok()).unwrap_or(4918);
    let quota_gb: u64 =
        std::env::var("PC_QUOTA_GB").ok().and_then(|s| s.parse().ok()).unwrap_or(512);

    let data = PathBuf::from(&data_dir);
    std::fs::create_dir_all(&data)?;

    println!("sharedock · WebDAV");
    let drive = build_drive(&data, quota_gb).await?;

    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let (bound, handle) = spawn_server(drive, addr, std::env::var("PC_WEBDAV_LOG").is_ok()).await?;
    println!("  serving on http://{bound}");
    println!("  mount: Finder ⌘K → http://localhost:{}", bound.port());

    handle.await?;
    Ok(())
}
