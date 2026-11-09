//! Tauri desktop shell. Loads the SAME web frontend as the browser SPA, plus
//! native commands: the client identity, and — the P2 headline — mounting the
//! encrypted drive into Finder via an in-process WebDAV server (see `mount.rs`).

mod host_mode;
mod mount;
mod paths;
mod service;
mod sidebar;
mod sys;

use std::path::PathBuf;
use std::sync::Mutex;

use mount::MountState;
use tauri::Manager;

#[derive(Default)]
struct AppState {
    mount: Mutex<Option<MountState>>,
    host: Mutex<Option<host_mode::HostProcess>>,
    /// The dashboard console's live drive connection (direct-QUIC when possible, relay
    /// fallback). Lets the desktop console ride the Iroh fast path instead of the relay.
    drive: tokio::sync::Mutex<Option<DriveConn>>,
}

/// A connected drive for the console. Holds the RemoteDrive plus the bound Iroh endpoint
/// (dropping it closes the QUIC socket), and — when connected over iroh — the host's
/// EndpointId, so the live transport path can be re-queried (see `drive_path`).
struct DriveConn {
    drive: client_core::RemoteDrive,
    endpoint: Option<core_net::iroh::Endpoint>,
    peer: Option<core_net::iroh::EndpointId>,
}

#[derive(serde::Serialize, Clone)]
struct MountInfo {
    mountpoint: String,
    url: String,
    port: u16,
    /// A non-error the owner should see (Windows: the Explorer file-size cap).
    notice: Option<String>,
}

impl MountInfo {
    fn of(s: &MountState) -> Self {
        Self {
            mountpoint: s.mountpoint.display().to_string(),
            url: s.url.clone(),
            port: s.port,
            notice: s.notice.clone(),
        }
    }
}

/// Client-side device identity (short fingerprint) for the pairing UI.
#[tauri::command]
fn client_device_id() -> String {
    client_core::ClientCore::new().device_id().short()
}

/// Inspect a host partition (read-only) from the desktop app's host role. Opens the store
/// WITHOUT setting the quota — the running daemon owns the authoritative quota (the owner's
/// allocation), so this must never overwrite it.
#[tauri::command]
fn host_status(data_dir: String, quota_gb: u64) -> Result<String, String> {
    let _ = quota_gb; // legacy arg, ignored — the store's persisted quota is authoritative
    let cfg = host_agent::HostConfig {
        data_dir: std::path::PathBuf::from(data_dir),
        quota_bytes: 0,
    };
    host_agent::HostAgent::open(cfg).and_then(|a| a.status_line()).map_err(|e| e.to_string())
}

/// The OWNER'S allocated partition size in GB, or `None` until they've set it from their
/// main device. Read from host.json's `quota_bytes` marker (written on SetQuota) — distinct
/// from the daemon's startup placeholder — so the host screen can show "Setting up…" instead
/// of a misleading number before the allocation lands.
#[tauri::command]
fn host_quota_gb(data_dir: Option<String>) -> Option<u64> {
    let dir = data_dir
        .map(std::path::PathBuf::from)
        .unwrap_or_else(host_mode::default_host_data_dir);
    let raw = std::fs::read(dir.join("host.json")).ok()?;
    let v: serde_json::Value = serde_json::from_slice(&raw).ok()?;
    let bytes = v.get("quota_bytes").and_then(|x| x.as_u64())?;
    Some(bytes / (1024 * 1024 * 1024))
}

/// Free disk bytes on the volume that would hold the host partition, for the "This computer"
/// free-space chip on the where-to-host screen. Probes `path` if it exists, else the user's
/// HOME (same volume as the default host data dir), else "/". `0` = unknown.
#[tauri::command]
fn free_disk_bytes(path: Option<String>) -> u64 {
    let probe = path
        .map(PathBuf::from)
        .filter(|p| p.exists())
        .unwrap_or_else(paths::home);
    host_agent::free_bytes(&probe)
}

/// Start the local WebDAV server and mount the drive in Finder.
#[tauri::command]
async fn mount_start(
    state: tauri::State<'_, AppState>,
    data_dir: Option<String>,
    quota_gb: Option<u64>,
) -> Result<MountInfo, String> {
    let already = state.mount.lock().unwrap().is_some();
    if already {
        return Err("already mounted".into());
    }
    let data = data_dir.map(PathBuf::from).unwrap_or_else(mount::default_data_dir);
    let mp = mount::default_mountpoint();
    let quota = quota_gb.unwrap_or(512);

    let st = mount::mount_local(data, mp, quota).await.map_err(|e| e.to_string())?;
    let info = MountInfo::of(&st);
    *state.mount.lock().unwrap() = Some(st);
    Ok(info)
}

/// Arguments for a remote mount (from the Connect panel). Discovery fields
/// (`host_eid` + `host_addrs`, as printed by pc-daemon) enable the direct Iroh
/// fast path; without them the mount uses the relay.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteMountArgs {
    relay_url: String,
    account: String,
    host_pub: String, // host agreement pubkey, hex
    token: Option<String>,
    host_eid: Option<String>,
    host_addrs: Option<Vec<String>>,
    iroh_relay: Option<String>,
    ark_hex: Option<String>,
    data_dir: Option<String>,
}

/// Connect to a remote host (Iroh-first, relay fallback) and mount it in Finder.
#[tauri::command]
async fn mount_remote_start(
    state: tauri::State<'_, AppState>,
    args: RemoteMountArgs,
) -> Result<MountInfo, String> {
    let already = state.mount.lock().unwrap().is_some();
    if already {
        return Err("already mounted".into());
    }

    let host_bytes =
        core_crypto::from_hex(args.host_pub.trim()).ok_or("host pubkey must be hex")?;
    let host_arr: [u8; 32] =
        host_bytes.as_slice().try_into().map_err(|_| "host pubkey must be 32 bytes")?;
    let host_pub = core_crypto::AgreementPublic::from_bytes(host_arr);

    let clean = |o: Option<String>| o.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let host_addrs = args
        .host_addrs
        .unwrap_or_default()
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    let params = mount::RemoteParams {
        relay_url: args.relay_url.trim().to_string(),
        account: args.account.trim().to_string(),
        host_pub,
        token: clean(args.token),
        host_eid: clean(args.host_eid),
        host_addrs,
        iroh_relay: clean(args.iroh_relay),
        ark_hex: clean(args.ark_hex),
    };
    let data = args.data_dir.map(PathBuf::from).unwrap_or_else(mount::default_data_dir);
    let mp = mount::default_mountpoint();

    let st = mount::mount_remote(data, mp, params).await.map_err(|e| e.to_string())?;
    let info = MountInfo::of(&st);
    *state.mount.lock().unwrap() = Some(st);
    Ok(info)
}

/// Unmount the Finder volume and stop the local server.
#[tauri::command]
async fn mount_stop(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let st = state.mount.lock().unwrap().take();
    if let Some(st) = st {
        // Unmount FIRST — while the WebDAV server is still alive to answer the final
        // flush — then stop it. Killing the server first is what made `diskutil` hang.
        mount::unmount(&st.mountpoint).await.map_err(|e| e.to_string())?;
        st.stop_server();
    }
    Ok(())
}

/// Current mount, if any.
#[tauri::command]
fn mount_status(state: tauri::State<'_, AppState>) -> Option<MountInfo> {
    state.mount.lock().unwrap().as_ref().map(MountInfo::of)
}

/// Windows only: raise the WebClient per-file limit (a UAC prompt) and restart the service.
/// The restart drops the current mapping, so this unmounts first; the UI remounts after.
#[tauri::command]
async fn mount_raise_file_limit(state: tauri::State<'_, AppState>) -> Result<(), String> {
    mount_stop(state).await?;
    tokio::task::spawn_blocking(mount::raise_file_limit)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

// --- console drive over native transport (direct-QUIC fast path) ---
//
// The web console can only reach the host over the WebSocket relay (a webview can't open a
// raw QUIC socket), so same-network transfers pay a cloud round-trip. The DESKTOP console
// proxies its transport through these commands instead: the native side speaks the same
// session RPC as the relay, but over a DIRECT Iroh QUIC connection (relay fallback), so
// LAN transfers run at LAN speed. Content E2EE stays entirely in the TS client — the
// request/response carried here already holds content-ciphertext; the native side only
// does the session (Iroh + AEAD seal), never sees plaintext or the ARK.

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveConnectArgs {
    relay_url: String,
    account: String,
    host_pub: String, // host agreement pubkey, hex
    ed_priv: String,  // the console's ed25519 secret (64 bytes) hex — the same identity the
    // relay path uses; DeviceId derives from its seed, so it matches the host's allowlist.
    token: Option<String>,
    host_eid: Option<String>,
    host_addrs: Option<Vec<String>>,
    iroh_relay: Option<String>,
}

/// Opt-in connection diagnostics (set PC_DRIVE_DEBUG=1) — off in production. The desktop
/// console's connect path is otherwise invisible (a GUI app's stderr is detached), so this
/// file log is the way to see whether it went direct-QUIC or relay and why.
fn dbg_drive(msg: &str) {
    if std::env::var_os("PC_DRIVE_DEBUG").is_none() {
        return;
    }
    use std::io::Write;
    let path = std::env::temp_dir().join("pc-drive-debug.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{msg}");
    }
}

#[tauri::command]
async fn drive_connect(state: tauri::State<'_, AppState>, args: DriveConnectArgs) -> Result<String, String> {
    let ed = core_crypto::from_hex(args.ed_priv.trim()).ok_or("ed_priv must be hex")?;
    let ed: [u8; 64] = ed.as_slice().try_into().map_err(|_| "ed_priv must be 64 bytes")?;
    let device = core_crypto::DeviceKeypair::from_bytes(&ed);
    dbg_drive(&format!(
        "drive_connect: device_id={} host_pub={} host_eid={:?} addrs={:?} iroh_relay={:?} relay={}",
        core_crypto::to_hex(device.id.as_bytes()),
        &args.host_pub,
        args.host_eid,
        args.host_addrs,
        args.iroh_relay,
        args.relay_url,
    ));

    let hp = core_crypto::from_hex(args.host_pub.trim()).ok_or("host_pub must be hex")?;
    let hp: [u8; 32] = hp.as_slice().try_into().map_err(|_| "host_pub must be 32 bytes")?;
    let host_pub = core_crypto::AgreementPublic::from_bytes(hp);

    let addrs: Vec<String> = args
        .host_addrs
        .unwrap_or_default()
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let iroh_relay = args.iroh_relay.as_deref().map(str::trim).filter(|s| !s.is_empty());

    // Try direct QUIC first (so we can report which path won), then fall back to the relay.
    let mut endpoint: Option<core_net::iroh::Endpoint> = None;
    let mut peer: Option<core_net::iroh::EndpointId> = None;
    let mut path = "relay";
    let mut drive: Option<client_core::RemoteDrive> = None;
    if let Some(eid) = args.host_eid.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if !addrs.is_empty() {
            dbg_drive("iroh: attempting direct dial");
            match core_net::iroh::endpoint_addr(eid, &addrs, iroh_relay) {
                Ok(addr) => {
                    let host_id = addr.id; // capture before `addr` is moved into connect_iroh
                    let secret = core_net::iroh::secret_from_device(&device);
                    match core_net::iroh::bind_endpoint(secret, iroh_relay.is_none()).await {
                        Ok(ep) => {
                            dbg_drive("iroh: bound endpoint, calling connect_iroh…");
                            // Cap the dial: a stale/unreachable published addr would otherwise
                            // hang connect_iroh forever and stall the whole console. On timeout
                            // or error, fall through to the relay.
                            let dial = client_core::RemoteDrive::connect_iroh(&ep, addr, &device, &host_pub);
                            match tokio::time::timeout(std::time::Duration::from_secs(6), dial).await {
                                Ok(Ok(d)) => {
                                    // QUIC is up — but "up" is NOT "direct": it may be riding the
                                    // n0 DERP relay. Record the transport now; classify the real
                                    // path after the warmup pushes traffic (below).
                                    dbg_drive("iroh: connect_iroh OK (QUIC up; path classified after warmup)");
                                    endpoint = Some(ep);
                                    peer = Some(host_id);
                                    path = "direct"; // provisional — reclassified honestly below
                                    drive = Some(d);
                                }
                                Ok(Err(e)) => dbg_drive(&format!("iroh: connect_iroh FAILED: {e}")),
                                Err(_) => dbg_drive("iroh: connect_iroh TIMED OUT (6s) → relay"),
                            }
                        }
                        Err(e) => dbg_drive(&format!("iroh: bind FAILED: {e}")),
                    }
                }
                Err(e) => dbg_drive(&format!("iroh: endpoint_addr FAILED: {e}")),
            }
        } else {
            dbg_drive("iroh: skipped (no host addrs)");
        }
    } else {
        dbg_drive("iroh: skipped (no host_eid)");
    }
    let mut drive = match drive {
        Some(d) => d,
        None => {
            dbg_drive("relay: connecting…");
            match client_core::RemoteDrive::connect(
                args.relay_url.trim(),
                args.account.trim(),
                &device,
                &host_pub,
                None,
                args.token.as_deref(),
            )
            .await
            {
                Ok(d) => {
                    dbg_drive("relay: connect OK");
                    d
                }
                Err(e) => {
                    dbg_drive(&format!("relay: connect FAILED: {e}"));
                    return Err(e.to_string());
                }
            }
        }
    };

    // Warm + verify with one round-trip so a bad connection fails HERE (→ TS relay fallback)
    // instead of surfacing later mid-use. Cap it so a half-open path doesn't stall the console.
    let warm = drive.request_raw(core_proto::Request::GetQuota);
    match tokio::time::timeout(std::time::Duration::from_secs(10), warm).await {
        Ok(Ok(r)) => dbg_drive(&format!("warmup GetQuota OK via {path}: {r:?}")),
        Ok(Err(e)) => {
            dbg_drive(&format!("warmup GetQuota FAILED via {path}: {e}"));
            return Err(e.to_string());
        }
        Err(_) => {
            dbg_drive(&format!("warmup GetQuota TIMED OUT via {path}"));
            return Err("host did not respond".into());
        }
    }

    // Honest path reporting. A successful iroh dial only means QUIC is up — it may be
    // running over the n0 DERP relay (dials fine, but every byte is relayed, ~relay speed,
    // which is exactly the "why is my P2P slow" symptom). Now that the warmup pushed real
    // traffic, give hole-punching a few seconds to settle and report what the link is
    // ACTUALLY using, not what we hoped for. Tunable via PC_DRIVE_PATH_WAIT_MS (default 4s);
    // returns early the instant a direct path appears, so a genuine LAN link isn't delayed.
    if let (Some(ep), Some(pid)) = (endpoint.as_ref(), peer) {
        let wait_ms = std::env::var("PC_DRIVE_PATH_WAIT_MS")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(4000);
        let pt = core_net::iroh::settled_path_type(ep, pid, std::time::Duration::from_millis(wait_ms)).await;
        dbg_drive(&format!("iroh path settled: {pt:?} → reporting \"{}\"", pt.wire_str()));
        path = pt.wire_str();
    }

    *state.drive.lock().await = Some(DriveConn { drive, endpoint, peer });
    dbg_drive(&format!("drive_connect DONE path={path}"));
    Ok(path.to_string())
}

/// Send one session RPC over the console's native connection. `request_json` is the SAME
/// wire JSON the relay transport uses; the reply is the serialized `Response`.
#[tauri::command]
async fn drive_rpc(state: tauri::State<'_, AppState>, request_json: String) -> Result<String, String> {
    let req: core_proto::Request =
        serde_json::from_str(&request_json).map_err(|e| format!("bad request json: {e}"))?;
    let mut guard = state.drive.lock().await;
    let conn = guard.as_mut().ok_or("drive not connected")?;
    let resp = conn.drive.request_raw(req).await.map_err(|e| e.to_string())?;
    serde_json::to_string(&resp).map_err(|e| e.to_string())
}

/// Upload one already-encrypted content chunk over the native transport as a RAW binary frame.
/// The ciphertext arrives as the raw IPC body (an ArrayBuffer) — NOT a base64'd multi-MB JSON
/// string like `drive_rpc` — and the upload id rides in a header. The Rust side builds the
/// `TAG_UPLOAD_CHUNK` frame directly (raw ciphertext, one crypto pass), so a 4 MiB chunk stops
/// paying the char-by-char-base64 + 5.6 MB-JSON-over-IPC + re-base64 + double-seal tax that made
/// desktop uploads crawl. E2EE is unchanged — the ciphertext is the caller's content-AEAD output.
#[tauri::command]
async fn drive_upload_chunk(
    state: tauri::State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let upload_id = request
        .headers()
        .get("upload-id")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing upload-id header")?
        .to_string();
    let ciphertext: &[u8] = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes,
        _ => return Err("drive_upload_chunk expects a raw (ArrayBuffer) body".into()),
    };
    let n = ciphertext.len();
    let mut guard = state.drive.lock().await;
    let conn = guard.as_mut().ok_or("drive not connected")?;
    let t0 = std::time::Instant::now();
    let resp = conn.drive.upload_chunk_raw(&upload_id, ciphertext).await.map_err(|e| e.to_string())?;
    dbg_drive(&format!("upload_chunk: {n} bytes, host round-trip {} ms (raw frame)", t0.elapsed().as_millis()));
    serde_json::to_string(&resp).map_err(|e| e.to_string())
}

/// The transport the console's live connection is CURRENTLY using: `"direct"` (hole-punched
/// P2P), `"relay-iroh"` (QUIC over the n0 DERP relay), `"relay"` (WebSocket cloud relay), or
/// `"unknown"`. Unlike `drive_connect`'s connect-time snapshot this re-queries live, so it
/// catches a relay→direct upgrade that completes after the initial connect. `"disconnected"`
/// when nothing is connected.
#[tauri::command]
async fn drive_path(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let guard = state.drive.lock().await;
    let Some(conn) = guard.as_ref() else {
        return Ok("disconnected".into());
    };
    match (conn.endpoint.as_ref(), conn.peer) {
        (Some(ep), Some(pid)) => Ok(core_net::iroh::path_type(ep, pid).await.wire_str().to_string()),
        // No iroh endpoint → the connection is the WebSocket cloud relay.
        _ => Ok("relay".into()),
    }
}

#[tauri::command]
async fn drive_disconnect(state: tauri::State<'_, AppState>) -> Result<(), String> {
    if let Some(conn) = state.drive.lock().await.take() {
        let _ = conn.drive.close().await;
    }
    Ok(())
}

// --- host mode ("Store my files"): manage a pc-daemon child (see host_mode.rs) ---

/// Start the host role. First run: pass `claim` (a pairing code from the client app); the
/// daemon self-enrolls and waits for you to approve. Later runs read host.json (no code).
#[tauri::command]
fn start_host_daemon(
    state: tauri::State<'_, AppState>,
    args: host_mode::HostStartArgs,
) -> Result<(), String> {
    let mut g = state.host.lock().unwrap();
    if g.as_mut().map(|h| h.running()).unwrap_or(false) {
        return Err("host is already running".into());
    }
    *g = Some(host_mode::spawn(args)?);
    Ok(())
}

/// Stop the host daemon child.
#[tauri::command]
fn stop_host_daemon(state: tauri::State<'_, AppState>) {
    // Remove the service FIRST. It restarts the daemon on exit, so killing the process while
    // it is still registered just brings the host straight back up.
    let _ = service::uninstall();
    if let Some(mut h) = state.host.lock().unwrap().take() {
        h.stop();
    }
}

/// Whether the host daemon is currently running.
#[tauri::command]
fn host_daemon_running(state: tauri::State<'_, AppState>) -> bool {
    state.host.lock().unwrap().as_mut().map(|h| h.running()).unwrap_or(false)
}

/// Whether this machine's host is managed by a service (launchd / Task Scheduler), and
/// therefore survives a reboot.
#[tauri::command]
fn host_service_status() -> serde_json::Value {
    serde_json::json!({
        "installed": service::is_installed(),
        "loaded": service::is_loaded(),
        "kind": service::kind(),
        "unit": service::unit_path().to_string_lossy(),
    })
}

/// Remove the service, handing the daemon back to the app (or stopping it entirely). Needed
/// before stopping a host: the service would otherwise restart it immediately.
#[tauri::command]
fn host_service_uninstall() -> Result<(), String> {
    service::uninstall()
}

/// The host's persisted onboarding summary (account + whether approved/active).
#[tauri::command]
fn host_daemon_config(data_dir: Option<String>) -> Option<host_mode::HostConfigSummary> {
    host_mode::config_summary(data_dir)
}

pub fn run() {
    // Process-wide rustls provider so the relay client's wss:// fallback works (the Iroh
    // path installs one too; this is idempotent and covers the relay-only case).
    let _ = rustls::crypto::ring::default_provider().install_default();

    tauri::Builder::default()
        // Auto-update. Inert until `plugins.updater.pubkey` is filled in from
        // `tauri signer generate` — the private half of that pair never enters the repo, so
        // the control plane cannot ship an update even if it is fully compromised.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::default())
        .setup(|app| {
            // Move an install off the pre-rename "Personal Cloud" directories before anything
            // reads or spawns against them (no-op on a fresh install). Must run first: autostart
            // below resolves the host data dir, and a half-migrated store would enroll twice.
            paths::migrate_legacy();
            // If this machine was set up as a host, the daemon only lived as long as the app
            // that spawned it — so a relaunch or reboot left the host offline. Bring it back up
            // from its saved launch config (no-op on machines that aren't hosts).
            if let Some(proc) = host_mode::autostart() {
                let state = app.state::<AppState>();
                *state.host.lock().unwrap() = Some(proc);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            client_device_id,
            host_status,
            host_quota_gb,
            free_disk_bytes,
            mount_start,
            mount_remote_start,
            mount_stop,
            mount_status,
            mount_raise_file_limit,
            drive_connect,
            drive_rpc,
            drive_upload_chunk,
            drive_path,
            drive_disconnect,
            start_host_daemon,
            stop_host_daemon,
            host_daemon_running,
            host_daemon_config,
            host_service_status,
            host_service_uninstall
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            // Tear the host daemon down when the app exits, so quitting doesn't leave an orphaned
            // daemon that the next launch would then double up on. (A crash/force-quit skips this;
            // `kill_stale_daemon` cleans that up on the next spawn.)
            // Quitting must not take the host down: once launchd owns the daemon the whole
            // point is that it outlives the app. Only a child this session spawned is stopped.
            if let tauri::RunEvent::Exit = event {
                if let Some(mut h) = app_handle.state::<AppState>().host.lock().unwrap().take() {
                    h.stop();
                }
            }
        });
}
