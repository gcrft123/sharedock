//! Headless host agent for NAS / always-on servers (no GUI).
//!
//! Config via env:
//!   PC_DATA_DIR         data + blob store dir        (default ./.pc-data)
//!   PC_QUOTA_GB         partition cap in GiB         (default 512; a license overrides)
//!   PC_RELAY_URL        e.g. ws://127.0.0.1:8787     (if set, serve the loop)
//!   PC_ACCOUNT          rendezvous account id        (default "default"; a license overrides)
//!
//!   PC_LICENSE          perpetual signed license token (from a one-time purchase)
//!   PC_LICENSE_PUBKEY   hex Ed25519 control-plane key that signs licenses (pinned)
//!                       → when both are set the license is verified and its
//!                         quota + account are authoritative.
//!
//! Onboarding (recommended — pair from the client app instead of the manual env above):
//!   PC_CLAIM            a pairing code minted in the client app. On first run the host
//!                       redeems it, self-enrolls as PENDING, and waits for you to approve
//!                       on your main device; the license is then fetched + saved to
//!                       host.json (later runs need no code).
//!   PC_CONTROL_URL      control-plane base (http for the headless fetch) — required to redeem.
//!   PC_HOST_NAME        optional label shown in the client's Hosts panel.
//!   PC_SETUP=1          headless box with no screen: serve a LAN setup page (default port
//!   PC_SETUP_PORT       4920) where you paste the code from a browser on the same network,
//!                       instead of passing PC_CLAIM.
//!
//! Client authorization (which paired clients may connect), preferred → fallback:
//!   PC_CONTROL_URL      http(s) control-plane base; the host fetches its approved
//!                       client list from /api/account/authorized (dev: http)
//!   PC_AUTHORIZED       comma-separated approved client device ids (hex)
//!   PC_DEV_ACCEPT_ANY=1 dev only: accept any signature-valid client (no allowlist)
//!
//! Multi-host (pooling/mirroring):
//!   PC_HOST_ROOM=self   serve a per-host relay room `account:<endpoint_id>` (so several
//!                       hosts of one account stay isolated; clients dial the specific host)
//!   PC_PEERS            ';'-separated mirror peers, each `endpoint_id,agreement_pub_hex`.
//!                       When set, this host runs the mirror mesh: it authorizes each peer
//!                       and replicates its objects to them (host-driven mirroring). Point
//!                       each host's PC_PEERS at the others and run all with PC_HOST_ROOM=self.
//!
//! Output:
//!   PC_LOG_FILE         append everything (log lines and the pairing printout) to this file.
//!                       A host started by launchd or Task Scheduler has no terminal; the
//!                       desktop app sets this when it installs the service.
//!
//! Arguments:
//!   --env-file <path>   load KEY=VALUE lines into the environment before reading any of the
//!                       above. Task Scheduler cannot set variables per task, so a Windows
//!                       service host carries its whole configuration in this file. A variable
//!                       already in the real environment wins over the file.
//!
//! Prints the device id + agreement pubkey so a client can pair/dial this host.

// A Windows daemon must be a GUI-subsystem executable: a console-subsystem one opens a visible
// terminal window whenever Task Scheduler or the desktop app starts it, and keeps it open for
// as long as the host runs. The cost is that a terminal launch has no console to print to
// until `attach_console` below claims the parent's.
#![cfg_attr(windows, windows_subsystem = "windows")]

use anyhow::{anyhow, bail, Result};
use core_crypto::{verify_license, AgreementPublic, DeviceKeypair, License};
use host_agent::{HostAgent, HostConfig};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// A mirror replication peer: its endpoint id (= device id, also its relay room name and
/// the id we authorize) and the agreement pubkey the peer session seals to.
struct PeerSpec {
    eid: String,
    agreement_pub: AgreementPublic,
}

/// Parse `PC_PEERS` — ';'-separated peers, each `endpoint_id,agreement_pub_hex`.
fn parse_peers() -> Vec<PeerSpec> {
    let Ok(raw) = std::env::var("PC_PEERS") else {
        return Vec::new();
    };
    raw.split(';')
        .filter_map(|s| {
            let s = s.trim();
            if s.is_empty() {
                return None;
            }
            let mut parts = s.split(',');
            let eid = parts.next()?.trim().to_string();
            let pub_hex = parts.next()?.trim();
            let arr: [u8; 32] = core_crypto::from_hex(pub_hex)?.as_slice().try_into().ok()?;
            Some(PeerSpec { eid, agreement_pub: AgreementPublic::from_bytes(arr) })
        })
        .collect()
}

fn load_device(data_dir: &str) -> Result<DeviceKeypair> {
    let raw = std::fs::read(std::path::Path::new(data_dir).join("identity.key"))?;
    let bytes: [u8; 64] =
        raw.as_slice().try_into().map_err(|_| anyhow!("identity.key must be 64 bytes"))?;
    Ok(DeviceKeypair::from_bytes(&bytes))
}

/// Persisted onboarding state, next to identity.key. Written once a pairing code is
/// redeemed; `license` is filled in once the owner approves this host.
#[derive(serde::Serialize, serde::Deserialize)]
struct HostConfigFile {
    account: String,
    cp_pubkey: String, // pinned Ed25519 key that signs licenses (hex)
    host_token: String,
    #[serde(default)]
    license: Option<String>,
    /// The owner's partition allocation (bytes), set by a `SetQuota` from their console.
    /// Absent until they allocate — the desktop host screen shows "Setting up…" until then,
    /// and it's restored on restart so the partition survives.
    #[serde(default)]
    quota_bytes: Option<u64>,
}

/// Persist the owner's allocated partition size to host.json (best-effort) so it survives
/// daemon restarts and the host UI can tell "set" from the startup placeholder.
fn persist_owner_quota(data_dir: &str, quota_bytes: u64) {
    if let Some(mut cfg) = load_host_config(data_dir) {
        cfg.quota_bytes = Some(quota_bytes);
        let _ = save_host_config(data_dir, &cfg);
    }
}

fn host_config_path(data_dir: &str) -> PathBuf {
    PathBuf::from(data_dir).join("host.json")
}
fn load_host_config(data_dir: &str) -> Option<HostConfigFile> {
    std::fs::read(host_config_path(data_dir)).ok().and_then(|b| serde_json::from_slice(&b).ok())
}
fn save_host_config(data_dir: &str, cfg: &HostConfigFile) -> Result<()> {
    std::fs::write(host_config_path(data_dir), serde_json::to_vec_pretty(cfg)?)?;
    Ok(())
}

/// Onboarding: redeem a `PC_CLAIM` pairing code on first run (or load a saved `host.json`),
/// then poll the control plane until the owner approves and hand back the account license.
/// Returns `(account, license_token, cp_pubkey_hex)`, or `None` if no onboarding path is
/// configured (→ fall back to the manual `PC_LICENSE`/`PC_ACCOUNT` env). Uses the http-only
/// fetch, so it works against a LAN/local control plane (the deployed https CP needs the
/// TLS-client finishing touch, same as the authorized-list fetch).
async fn enroll_or_load(
    data_dir: &str,
    endpoint_id: &str,
    agreement_pub_hex: &str,
) -> Result<Option<(String, String, String)>> {
    let control = std::env::var("PC_CONTROL_URL").ok();
    let mut cfg = load_host_config(data_dir);

    // First run with a pairing code in the env → redeem it.
    if cfg.is_none() {
        if let Ok(code) = std::env::var("PC_CLAIM") {
            let Some(control) = control.as_deref() else {
                tracing::warn!("PC_CLAIM set but PC_CONTROL_URL missing — cannot redeem");
                return Ok(None);
            };
            let name = std::env::var("PC_HOST_NAME").ok();
            let icon = std::env::var("PC_HOST_ICON").ok();
            let c = redeem_code(control, &code, endpoint_id, agreement_pub_hex, name, icon).await?;
            save_host_config(data_dir, &c)?;
            println!(
                "  paired with account {}… — waiting for approval on your main device",
                &c.account[..8.min(c.account.len())]
            );
            cfg = Some(c);
        }
    }

    // First run, no env code, headless setup enabled → serve a LAN page and redeem there.
    if cfg.is_none() && std::env::var("PC_SETUP").as_deref() == Ok("1") {
        match control.as_deref() {
            Some(control) => {
                run_setup_page(data_dir, endpoint_id, agreement_pub_hex, control).await?;
                cfg = load_host_config(data_dir);
            }
            None => tracing::warn!("PC_SETUP=1 but PC_CONTROL_URL missing — cannot serve setup"),
        }
    }

    let Some(mut c) = cfg else { return Ok(None) };

    // Already approved on an earlier run → we saved the license.
    if let Some(lic) = &c.license {
        return Ok(Some((c.account.clone(), lic.clone(), c.cp_pubkey.clone())));
    }

    // Pending → poll the credential endpoint until the owner approves.
    let control = control.ok_or_else(|| anyhow!("host.json present but PC_CONTROL_URL not set"))?;
    let url = format!("{}/api/host/credential", control.trim_end_matches('/'));
    let mut waited = 0u64;
    loop {
        match http_json("GET", &url, &c.host_token, None).await {
            Ok(v) if v.get("approved").and_then(|x| x.as_bool()) == Some(true) => {
                if let Some(lic) = v.get("license").and_then(|x| x.as_str()) {
                    c.license = Some(lic.to_string());
                    save_host_config(data_dir, &c)?;
                    println!("  approved ✓");
                    return Ok(Some((c.account, lic.to_string(), c.cp_pubkey)));
                }
            }
            Ok(_) => {} // still pending
            Err(e) => tracing::warn!("credential poll failed: {e}"),
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
        waited += 3;
        if waited % 30 == 0 {
            println!("  still waiting for approval… ({waited}s)");
        }
    }
}

const GIB: u64 = 1024 * 1024 * 1024;

/// Redeem a pairing code → the pending host config (account, cp_pubkey, host_token).
async fn redeem_code(
    control: &str,
    code: &str,
    endpoint_id: &str,
    agreement_pub_hex: &str,
    name: Option<String>,
    icon: Option<String>,
) -> Result<HostConfigFile> {
    let body = serde_json::json!({
        "code": code,
        "endpoint_id": endpoint_id,
        "agreement_pub": agreement_pub_hex,
        "name": name,
        "icon": icon,
    })
    .to_string();
    let url = format!("{}/api/host/claim/redeem", control.trim_end_matches('/'));
    let v = http_json("POST", &url, "", Some(&body)).await?;
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string);
    Ok(HostConfigFile {
        account: s("account").ok_or_else(|| anyhow!("redeem: missing account"))?,
        cp_pubkey: s("cp_pubkey").ok_or_else(|| anyhow!("redeem: missing cp_pubkey"))?,
        host_token: s("host_token").ok_or_else(|| anyhow!("redeem: missing host_token"))?,
        license: None,
        quota_bytes: None,
    })
}

fn find_subslice(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

/// Read one HTTP request as (method, path, body), honoring Content-Length. Minimal — just
/// for the local setup page.
async fn read_request(sock: &mut tokio::net::TcpStream) -> Option<(String, String, String)> {
    use tokio::io::AsyncReadExt;
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    loop {
        let n = sock.read(&mut tmp).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = find_subslice(&buf, b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&buf[..pos]).to_string();
            let content_len = head
                .lines()
                .find_map(|l| {
                    l.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .and_then(|v| v.trim().parse::<usize>().ok())
                })
                .unwrap_or(0);
            let body_start = pos + 4;
            if buf.len() - body_start >= content_len {
                let body = String::from_utf8_lossy(&buf[body_start..body_start + content_len]).to_string();
                let mut hp = head.lines().next().unwrap_or("").split(' ');
                let method = hp.next().unwrap_or("").to_string();
                let path = hp.next().unwrap_or("/").to_string();
                return Some((method, path, body));
            }
        }
        if buf.len() > 64 * 1024 {
            return None;
        }
    }
}

async fn write_response(sock: &mut tokio::net::TcpStream, status: &str, ctype: &str, body: &str) {
    use tokio::io::AsyncWriteExt;
    let resp = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = sock.write_all(resp.as_bytes()).await;
}

/// Serve a tiny LAN setup page for a headless host (PC_SETUP=1): paste the pairing code →
/// redeem → write host.json → return (main() then polls for approval). Torn down once paired.
async fn run_setup_page(
    data_dir: &str,
    endpoint_id: &str,
    agreement_pub_hex: &str,
    control: &str,
) -> Result<()> {
    let port: u16 = std::env::var("PC_SETUP_PORT").ok().and_then(|s| s.parse().ok()).unwrap_or(4920);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    println!("  setup: browse to http://<this-device-ip>:{port} on your network and paste the pairing code");
    loop {
        let Ok((mut sock, _)) = listener.accept().await else { continue };
        let Some((method, path, body)) = read_request(&mut sock).await else { continue };
        if method == "GET" && (path == "/" || path.starts_with("/?")) {
            write_response(&mut sock, "200 OK", "text/html; charset=utf-8", SETUP_HTML).await;
        } else if method == "POST" && path == "/setup" {
            let parsed: serde_json::Value =
                serde_json::from_str(body.trim()).unwrap_or(serde_json::Value::Null);
            let code = parsed.get("code").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
            let name = parsed
                .get("name")
                .and_then(|x| x.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            // The LAN setup page has no icon picker; fall back to PC_HOST_ICON if the env set one.
            let icon = parsed
                .get("icon")
                .and_then(|x| x.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .or_else(|| std::env::var("PC_HOST_ICON").ok());
            if code.is_empty() {
                write_response(&mut sock, "400 Bad Request", "application/json", r#"{"error":"code required"}"#).await;
                continue;
            }
            match redeem_code(control, &code, endpoint_id, agreement_pub_hex, name, icon).await {
                Ok(c) => {
                    save_host_config(data_dir, &c)?;
                    write_response(&mut sock, "200 OK", "application/json", r#"{"ok":true}"#).await;
                    println!("  paired via setup page — waiting for approval on your main device");
                    return Ok(());
                }
                Err(e) => {
                    let msg = format!(r#"{{"error":"{}"}}"#, e.to_string().replace('"', "'"));
                    write_response(&mut sock, "400 Bad Request", "application/json", &msg).await;
                }
            }
        } else {
            write_response(&mut sock, "404 Not Found", "application/json", r#"{"error":"not found"}"#).await;
        }
    }
}

const SETUP_HTML: &str = r#"<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Set up this storage device</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;max-width:30rem;margin:3rem auto;padding:0 1rem;color:#1a1a1a}
  h1{font-size:1.4rem} p{color:#555;line-height:1.5}
  input{width:100%;padding:.7rem;font-size:1.1rem;border:1px solid #ccc;border-radius:8px;margin:.4rem 0;box-sizing:border-box}
  #code{text-transform:uppercase;letter-spacing:.06em}
  button{width:100%;padding:.8rem;font-size:1.05rem;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer;margin-top:.6rem}
  button:disabled{opacity:.5}
  #msg{margin-top:1rem;padding:.8rem;border-radius:8px;display:none}
  .ok{background:#dcfce7;color:#166534}.err{background:#fee2e2;color:#991b1b}
</style></head>
<body>
  <h1>Set up this storage device</h1>
  <p>On your main device, open Sharedock, choose <b>Add a storage device</b>, and enter the pairing code it shows here.</p>
  <input id="code" placeholder="PAIRING CODE" autocomplete="off" autocapitalize="characters">
  <input id="name" placeholder="Name (optional, e.g. Mac mini)">
  <button id="go">Pair this device</button>
  <div id="msg"></div>
<script>
  const msg=document.getElementById('msg'),go=document.getElementById('go');
  function show(t,c){msg.textContent=t;msg.className=c;msg.style.display='block';}
  go.onclick=async()=>{
    const code=document.getElementById('code').value.trim();
    const name=document.getElementById('name').value.trim();
    if(!code){show('Enter the pairing code.','err');return;}
    go.disabled=true;show('Pairing…','ok');
    try{
      const r=await fetch('/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,name})});
      const j=await r.json();
      if(r.ok&&j.ok){show('Paired! Now approve this device on your main device. You can close this page.','ok');}
      else{show(j.error||'Pairing failed.','err');go.disabled=false;}
    }catch(e){show('Could not reach the host.','err');go.disabled=false;}
  };
</script>
</body></html>"#;

/// The `KEY=VALUE` lines of an env file. Blank lines and `#` comments are skipped; the value
/// is everything after the first `=`, so a URL with `=` in its query survives. There is no
/// quoting: a value runs to the end of the line.
fn parse_env_lines(text: &str) -> Result<Vec<(String, String)>> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((k, v)) = line.split_once('=') else {
            bail!("expected KEY=VALUE, got {line:?}");
        };
        let k = k.trim();
        if k.is_empty() {
            bail!("empty key in {line:?}");
        }
        out.push((k.to_string(), v.trim().to_string()));
    }
    Ok(out)
}

/// `--env-file <path>`: `KEY=VALUE` lines loaded into the environment before any config is
/// read. Runs on the main thread before the runtime exists, so `set_var` has no other thread
/// to race with. A key already present in the real environment is left alone, so an operator
/// can override one line for a single run.
fn apply_env_file() -> Result<()> {
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        if a != "--env-file" {
            continue;
        }
        let path = args.next().ok_or_else(|| anyhow!("--env-file needs a path"))?;
        let text = std::fs::read_to_string(&path).map_err(|e| anyhow!("--env-file {path}: {e}"))?;
        for (k, v) in parse_env_lines(&text).map_err(|e| anyhow!("--env-file {path}: {e}"))? {
            if std::env::var_os(&k).is_none() {
                std::env::set_var(k, v);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod env_file_tests {
    use super::parse_env_lines;

    #[test]
    fn parses_keys_comments_and_values_with_equals_signs() {
        let got = parse_env_lines(
            "# how this host was configured\nPC_DATA_DIR=C:\\x\\host\n\nPC_CONTROL_URL=https://cp.example?a=1&b=2\n  PC_HOST_NAME = Loft Server \n",
        )
        .unwrap();
        assert_eq!(
            got,
            vec![
                ("PC_DATA_DIR".to_string(), "C:\\x\\host".to_string()),
                ("PC_CONTROL_URL".to_string(), "https://cp.example?a=1&b=2".to_string()),
                ("PC_HOST_NAME".to_string(), "Loft Server".to_string()),
            ]
        );
    }

    /// A file the desktop app wrote wrongly must stop the daemon, not start a host with half
    /// its configuration missing.
    #[test]
    fn a_line_without_equals_is_an_error() {
        assert!(parse_env_lines("PC_DATA_DIR=/x\nnot a pair\n").is_err());
        assert!(parse_env_lines("=value\n").is_err());
    }
}

/// Send stdout and stderr to `path` (appending) at the file-descriptor level, so the pairing
/// `println!`s and the tracing log land in the same file in order — the same shape launchd
/// gives a service with one path for both streams.
fn redirect_output(path: &std::ffi::OsStr) -> std::io::Result<()> {
    let f = std::fs::OpenOptions::new().create(true).append(true).open(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::io::AsRawFd;
        // SAFETY: dup2 onto the two standard descriptors; `f` stays open until the end of scope
        // and the duplicates outlive it.
        unsafe {
            libc::dup2(f.as_raw_fd(), 1);
            libc::dup2(f.as_raw_fd(), 2);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::IntoRawHandle;
        let h = f.into_raw_handle();
        // SAFETY: `h` is a valid file handle that is intentionally leaked — it is now the
        // process's stdout and stderr for the rest of its life.
        unsafe {
            win::SetStdHandle(win::STD_OUTPUT_HANDLE, h);
            win::SetStdHandle(win::STD_ERROR_HANDLE, h);
        }
    }
    Ok(())
}

#[cfg(windows)]
mod win {
    use std::ffi::c_void;

    pub const STD_OUTPUT_HANDLE: u32 = -11i32 as u32;
    pub const STD_ERROR_HANDLE: u32 = -12i32 as u32;
    pub const ATTACH_PARENT_PROCESS: u32 = u32::MAX;

    // kernel32 is always linked; declare the three calls rather than pull in a bindings crate.
    #[link(name = "kernel32")]
    extern "system" {
        pub fn AttachConsole(process_id: u32) -> i32;
        pub fn GetStdHandle(std_handle: u32) -> *mut c_void;
        pub fn SetStdHandle(std_handle: u32, handle: *mut c_void) -> i32;
    }

    fn usable(h: *mut c_void) -> bool {
        !h.is_null() && h as isize != -1
    }

    /// A GUI-subsystem process starts with no console. If the parent redirected our output
    /// (the desktop app pipes the daemon into daemon.log) there is nothing to do; otherwise
    /// attach to the parent's console — the terminal the operator typed into — and point the
    /// standard handles at it, so headless pairing still prints where they are looking.
    /// With no parent console at all (Task Scheduler), output simply goes nowhere, which is
    /// why the service always sets PC_LOG_FILE.
    pub fn attach_console() {
        // SAFETY: plain Win32 calls; the CONOUT$ handle is leaked on purpose.
        unsafe {
            if usable(GetStdHandle(STD_ERROR_HANDLE)) {
                return;
            }
            if AttachConsole(ATTACH_PARENT_PROCESS) == 0 {
                return;
            }
            if usable(GetStdHandle(STD_ERROR_HANDLE)) {
                return;
            }
            if let Ok(f) = std::fs::OpenOptions::new().read(true).write(true).open("CONOUT$") {
                use std::os::windows::io::IntoRawHandle;
                let h = f.into_raw_handle();
                SetStdHandle(STD_OUTPUT_HANDLE, h);
                SetStdHandle(STD_ERROR_HANDLE, h);
            }
        }
    }
}

fn main() -> Result<()> {
    apply_env_file()?;
    match std::env::var_os("PC_LOG_FILE") {
        Some(p) => redirect_output(&p).map_err(|e| anyhow!("PC_LOG_FILE {}: {e}", p.to_string_lossy()))?,
        None => {
            #[cfg(windows)]
            win::attach_console();
        }
    }
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        // A log file is read back in an editor, where escape codes are noise.
        .with_ansi(std::env::var_os("PC_LOG_FILE").is_none())
        .init();
    tokio::runtime::Builder::new_multi_thread().enable_all().build()?.block_on(run())
}

async fn run() -> Result<()> {
    // Install a process-wide rustls crypto provider so the relay client can do wss://
    // (tokio-tungstenite's default TLS connector uses the process default). Idempotent —
    // ignore the error if iroh's TLS stack already installed one.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let data_dir = std::env::var("PC_DATA_DIR").unwrap_or_else(|_| "./.pc-data".to_string());

    // Requested partition size (bounded to the free disk by HostAgent::init). The owner's
    // `SetQuota` later narrows it to their allocation. HostAgent::init also creates
    // identity.key so we have this host's endpoint id + agreement pubkey to enroll with.
    let quota_bytes = std::env::var("PC_QUOTA_GB")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(512)
        .saturating_mul(GIB);
    let mut account = std::env::var("PC_ACCOUNT").unwrap_or_else(|_| "default".to_string());

    let host = HostAgent::init(HostConfig { data_dir: PathBuf::from(&data_dir), quota_bytes })?;
    let eid = core_crypto::to_hex(host.device_id().as_bytes());
    let agreement_pub_hex = core_crypto::to_hex(host.agreement_public().as_bytes());

    // Onboarding: a saved host.json or a PC_CLAIM pairing code yields the account + license
    // (after the owner approves); otherwise fall back to the manual PC_LICENSE env.
    let (license_token, cp_pubkey_hex): (Option<String>, Option<String>) =
        match enroll_or_load(&data_dir, &eid, &agreement_pub_hex).await? {
            Some((_acct, lic, cpk)) => (Some(lic), Some(cpk)),
            None => (std::env::var("PC_LICENSE").ok(), std::env::var("PC_LICENSE_PUBKEY").ok()),
        };

    // Downstream steps read the license from the PC_LICENSE env: the relay-token fetch, the
    // authorized-client-list fetch, and — critically — the endpoint publish that makes this host
    // discoverable (`/api/host/endpoint`). That env is only set in the manual/headless flow; when
    // we obtained the license via pairing-code enrollment instead, mirror it into the env so those
    // steps run. Without this a paired host comes online but never publishes, so the client's
    // "Create a partition" hangs forever waiting for the endpoint. (edition 2021: set_var is safe.)
    if let (Some(lic), Some(pk)) = (&license_token, &cp_pubkey_hex) {
        std::env::set_var("PC_LICENSE", lic);
        std::env::set_var("PC_LICENSE_PUBKEY", pk);
    }

    let license: Option<License> = match (&license_token, &cp_pubkey_hex) {
        (Some(token), Some(pk_hex)) => {
            let pk_bytes = core_crypto::from_hex(pk_hex).ok_or_else(|| anyhow!("bad license pubkey hex"))?;
            let pk: [u8; 32] = pk_bytes.as_slice().try_into().map_err(|_| anyhow!("license pubkey must be 32 bytes"))?;
            match verify_license(token, &pk) {
                Ok(lic) => {
                    // The license grants host SEATS (a tier → N hosts), not a byte quota — so
                    // it sets the account, never the storage cap. A host lends from its own
                    // disk (see HostAgent::init, which caps the partition at the free disk).
                    account = lic.account.clone();
                    Some(lic)
                }
                // A present-but-invalid license is a hard error (don't silently ignore it).
                Err(e) => bail!("license failed verification: {e}"),
            }
        }
        (Some(_), None) => bail!("license set but no control-plane pubkey (need the pinned key)"),
        _ => None,
    };

    // The partition cap + its ceiling were set in HostAgent::init (min(PC_QUOTA_GB, free
    // disk); the owner's `SetQuota` later narrows it to the allocation). No license byte
    // quota to apply here. Restore a previously-owner-set allocation (clamped to the free
    // disk) so a resized host keeps its size across restarts.
    if let Some(oq) = load_host_config(&data_dir).and_then(|c| c.quota_bytes) {
        let disk = host.disk_avail_bytes();
        let _ = host.set_quota(if disk > 0 { oq.min(disk) } else { oq });
    }

    println!("sharedock · host agent");
    println!("  {}", host.status_line()?);
    println!("  device id:        {}", core_crypto::to_hex(host.device_id().as_bytes()));
    println!("  agreement pubkey: {}", core_crypto::to_hex(host.agreement_public().as_bytes()));
    match &license {
        Some(l) => println!(
            "  license:          tier {} · quota {} GiB · account {} · valid ✓",
            l.tier,
            l.quota_bytes / GIB,
            l.account
        ),
        None => println!("  license:          none (using PC_QUOTA_GB / PC_ACCOUNT)"),
    }

    let Ok(relay) = std::env::var("PC_RELAY_URL") else {
        println!("  PC_RELAY_URL not set → init only (set it to serve over a relay).");
        return Ok(());
    };

    // --- build the client authorization set ---
    let accept_any = std::env::var("PC_DEV_ACCEPT_ANY").as_deref() == Ok("1");
    // Static entries never change while we run: the PC_AUTHORIZED env list + mirror peers.
    let mut static_allow: HashSet<[u8; 32]> = HashSet::new();
    if let Ok(list) = std::env::var("PC_AUTHORIZED") {
        for id in list.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            match core_crypto::from_hex(id).and_then(|b| <[u8; 32]>::try_from(b.as_slice()).ok()) {
                Some(arr) => {
                    static_allow.insert(arr);
                }
                None => tracing::warn!("PC_AUTHORIZED: skipping malformed id {id}"),
            }
        }
    }
    // Mirror peers (same-account hosts): authorize each so it can push replication to us.
    //
    // Two sources, merged: `PC_PEERS` for a hand-configured mesh, and the control plane for
    // the account's mirror mode. The control plane is what makes the console's mirror switch
    // actually replicate; PC_PEERS stays supported so an existing headless setup keeps
    // working and can mirror without the console at all.
    let mut peers = parse_peers();
    let self_eid = core_crypto::to_hex(host.device_id().as_bytes());
    if let (Ok(control), Some(token)) =
        (std::env::var("PC_CONTROL_URL"), std::env::var("PC_LICENSE").ok().or_else(|| license_token.clone()))
    {
        match fetch_peers(&control, &account, &self_eid, &token).await {
            Ok(found) => {
                for p in found {
                    if !peers.iter().any(|q| q.eid == p.eid) {
                        peers.push(p);
                    }
                }
                if !peers.is_empty() {
                    tracing::info!("mirror peers: {}", peers.len());
                }
            }
            // Not fatal: a host that cannot reach the control plane still serves its own
            // files. It just will not mirror until it can.
            Err(e) => tracing::warn!("could not fetch mirror peers: {e}"),
        }
    }
    for p in &peers {
        if let Some(arr) =
            core_crypto::from_hex(&p.eid).and_then(|b| <[u8; 32]>::try_from(b.as_slice()).ok())
        {
            static_allow.insert(arr);
        }
    }

    // Seed the live set from the static base + one control-plane fetch. The control-plane
    // approved list is DYNAMIC (owners approve/revoke devices while we run), so a background
    // task below re-fetches it on a timer — a newly-approved device must not need a restart.
    let mut allow_set = static_allow.clone();
    if let (Ok(control), Some(token)) = (std::env::var("PC_CONTROL_URL"), std::env::var("PC_LICENSE").ok()) {
        match fetch_authorized(&control, &account, &token).await {
            Ok(ids) => {
                allow_set.extend(ids);
                tracing::info!("fetched {} approved client id(s) from control plane", allow_set.len());
            }
            Err(e) => tracing::warn!("could not fetch approved clients from {control}: {e} (using PC_AUTHORIZED)"),
        }
    }

    if accept_any {
        tracing::warn!("PC_DEV_ACCEPT_ANY=1 — accepting any signature-valid client (dev only)");
    } else if allow_set.is_empty() {
        tracing::warn!("no approved clients configured — every client will be refused (set PC_AUTHORIZED / PC_CONTROL_URL)");
    } else {
        println!("  authorized clients: {}", allow_set.len());
    }

    // In production the relay requires a short-lived admission token; fetch one if
    // we have a control plane + license. (Dev relay admits tokenless connections.)
    let relay_token = match (std::env::var("PC_CONTROL_URL"), &license) {
        (Ok(control), Some(_)) => {
            let dev_hex = core_crypto::to_hex(host.device_id().as_bytes());
            match fetch_relay_token(&control, &account, "host", &dev_hex, &std::env::var("PC_LICENSE").unwrap()).await {
                Ok(t) => Some(t),
                Err(e) => {
                    tracing::warn!("relay-token fetch failed: {e} (continuing tokenless — dev relay only)");
                    None
                }
            }
        }
        _ => None,
    };

    // Share the host + allowlist so the relay loop and the (optional) Iroh accept
    // loop can both use them (single-writer via the mutex).
    let host = std::sync::Arc::new(std::sync::Mutex::new(host));
    // RwLock so the refresher below can swap in an updated approved-client set while the serve
    // loops read it — approvals/revocations take effect live, no host restart.
    let allow = std::sync::Arc::new(std::sync::RwLock::new(allow_set));

    // Re-fetch the control-plane approved list on a timer so an owner's approve (or revoke)
    // takes effect within one interval instead of only at startup. Rebuilds `static_base ∪
    // fetched` each pass (so revoked ids drop out too); a failed fetch keeps the current set.
    if let (Ok(control), Ok(license)) = (std::env::var("PC_CONTROL_URL"), std::env::var("PC_LICENSE")) {
        let allow_ref = allow.clone();
        let account_r = account.clone();
        let base = static_allow;
        tokio::spawn(async move {
            const REFRESH: Duration = Duration::from_secs(30);
            loop {
                tokio::time::sleep(REFRESH).await;
                match fetch_authorized(&control, &account_r, &license).await {
                    Ok(ids) => {
                        let mut next = base.clone();
                        next.extend(ids);
                        // Only take the write lock (and log) when the set actually changed.
                        let changed = *allow_ref.read().unwrap() != next;
                        if changed {
                            let n = next.len();
                            *allow_ref.write().unwrap() = next;
                            tracing::info!("approved-client list refreshed: {n} authorized");
                        }
                    }
                    Err(e) => tracing::debug!("approved-client refresh failed: {e} (keeping current set)"),
                }
            }
        });
    }

    // Live sync: every store mutation fans out a "re-list" notification, which the
    // relay serve loop pushes to the connected console. Kept alive for the process.
    let (notify_tx, _) = tokio::sync::broadcast::channel::<()>(64);

    // Mirror mesh: replicate our objects to each peer (host-driven mirroring). Runs on
    // mutation + a periodic anti-entropy tick. Configure PC_PEERS + PC_HOST_ROOM=self.
    if !peers.is_empty() {
        tokio::spawn(start_mesh(
            data_dir.clone(),
            relay.clone(),
            account.clone(),
            host.clone(),
            peers,
            notify_tx.subscribe(),
        ));
    }

    // Optional direct-QUIC (Iroh) fast path: dial the host by key, bypassing the
    // relay on the LAN. Opt-in via PC_IROH; PC_IROH_RELAY=1 also enables n0 relays
    // for WAN NAT traversal (default is direct/LAN only).
    if std::env::var("PC_IROH").is_ok() {
        if let Err(e) =
            start_iroh(&data_dir, &account, &host, &allow, accept_any, notify_tx.clone()).await
        {
            tracing::warn!("iroh fast path disabled: {e}");
        }
    }

    println!("  serving on {relay} (account={account})");
    // Multi-host: optionally serve a per-host room `account:<host_id>` so several hosts of
    // one account stay isolated on a shared relay. `PC_HOST_ROOM=self` uses this daemon's
    // own endpoint id (what clients discover via the control plane). Unset → the legacy
    // account-only room (single-host, backward compat).
    let host_room: Option<String> = match std::env::var("PC_HOST_ROOM").ok().as_deref() {
        Some("self") | Some("1") => {
            Some(core_crypto::to_hex(host.lock().unwrap().device_id().as_bytes()))
        }
        Some(v) if !v.is_empty() => Some(v.to_string()),
        _ => None,
    };
    if let Some(h) = &host_room {
        println!("  host room: {account}:{h}");
    }
    // Reconnect loop: one client session per serve() call.
    loop {
        let ntx = notify_tx.clone();
        let dd = data_dir.clone();
        // Bound to a local FIRST. Written inline in the argument list, the MutexGuard from
        // `host.lock()` is a temporary that lives until the end of the whole `serve(...)`
        // statement — which is the entire serve loop — so `open_sealed` below would deadlock
        // against it on the first handshake and no client would ever connect.
        let host_agreement = host.lock().unwrap().agreement_public();
        let r = core_net::relay::serve(
            &relay,
            &account,
            host_room.as_deref(),
            relay_token.as_deref(),
            host_agreement,
            |b| host.lock().unwrap().open_sealed(b),
            |id| accept_any || allow.read().unwrap().contains(id.as_bytes()),
            |req| {
                let is_set_quota = matches!(&req, core_proto::Request::SetQuota { .. });
                let mutated = is_mutation(&req);
                let resp = host.lock().unwrap().handle(req);
                let ok = !matches!(resp, core_proto::Response::Error { .. });
                // Persist the owner's allocation so it survives restarts + the host UI can tell
                // "set by owner" from the startup placeholder.
                if is_set_quota && ok {
                    if let core_proto::Response::Quota(q) = &resp {
                        persist_owner_quota(&dd, q.quota_bytes);
                    }
                }
                if mutated && ok {
                    let _ = ntx.send(());
                }
                resp
            },
            notify_tx.subscribe(),
        )
        .await;
        if let Err(e) = r {
            tracing::debug!("serve session ended: {e}");
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

/// Bind an Iroh endpoint keyed by the host identity (so EndpointId == device id)
/// and serve clients directly over QUIC, alongside the relay.
/// Requests that change the store — a successful one fans out a live-sync notify.
fn is_mutation(req: &core_proto::Request) -> bool {
    use core_proto::Request::*;
    matches!(req, Mkdir { .. } | Delete { .. } | Rename { .. } | PutFile { .. } | UploadCommit { .. } | SetQuota { .. })
}

/// Mirror mesh: push this host's objects to each peer over the relay, on every store
/// mutation (immediate) and a periodic tick (offline catch-up / anti-entropy). Each peer
/// must serve its own relay room (run every host with `PC_HOST_ROOM=self`). Replication is
/// bidirectional because every host runs its own mesh pushing to its peers.
async fn start_mesh(
    data_dir: String,
    relay: String,
    account: String,
    host: Arc<Mutex<HostAgent>>,
    peers: Vec<PeerSpec>,
    mut notify: tokio::sync::broadcast::Receiver<()>,
) {
    use tokio::sync::broadcast::error::RecvError;
    let dev = match load_device(&data_dir) {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!("mirror mesh disabled: {e}");
            return;
        }
    };
    println!("  mirror mesh: {} peer(s)", peers.len());
    let interval = Duration::from_secs(20);
    let mut open = true;
    loop {
        // Sync on a mutation OR the periodic anti-entropy tick.
        tokio::select! {
            n = notify.recv(), if open => match n {
                Ok(()) | Err(RecvError::Lagged(_)) => {}
                Err(RecvError::Closed) => { open = false; continue; }
            },
            _ = tokio::time::sleep(interval) => {}
        }
        for peer in &peers {
            if let Err(e) = sync_to_peer(&relay, &account, &dev, &host, peer).await {
                let short = &peer.eid[..8.min(peer.eid.len())];
                tracing::debug!("mesh sync to {short}… failed: {e}");
            }
        }
    }
}

/// One anti-entropy pass to `peer`: diff manifests and push each object it lacks or holds
/// with an older mtime.
async fn sync_to_peer(
    relay: &str,
    account: &str,
    dev: &DeviceKeypair,
    host: &Arc<Mutex<HostAgent>>,
    peer: &PeerSpec,
) -> Result<()> {
    let mut conn = client_core::RemoteDrive::connect(
        relay,
        account,
        dev,
        &peer.agreement_pub,
        Some(&peer.eid),
        None,
    )
    .await?;
    let peer_manifest = conn.list_manifest().await?;
    let local = host.lock().unwrap().manifest()?;
    for id in host_agent::objects_to_push(&local, &peer_manifest) {
        let export = { host.lock().unwrap().export_object(&id)? };
        if let Some(export) = export {
            conn.import_object(export).await?;
        }
    }
    conn.close().await?;
    Ok(())
}

async fn start_iroh(
    data_dir: &str,
    account: &str,
    host: &std::sync::Arc<std::sync::Mutex<host_agent::HostAgent>>,
    allow: &std::sync::Arc<std::sync::RwLock<std::collections::HashSet<[u8; 32]>>>,
    accept_any: bool,
    notify_tx: tokio::sync::broadcast::Sender<()>,
) -> Result<()> {
    let raw = std::fs::read(std::path::Path::new(data_dir).join("identity.key"))?;
    let bytes: [u8; 64] =
        raw.as_slice().try_into().map_err(|_| anyhow!("identity.key must be 64 bytes"))?;
    let dev = core_crypto::DeviceKeypair::from_bytes(&bytes);

    let offline = std::env::var("PC_IROH_RELAY").is_err();
    let endpoint =
        core_net::iroh::bind_endpoint(core_net::iroh::secret_from_device(&dev), offline).await?;

    // Let netcheck populate direct addresses, then report them (Phase D publishes
    // this EndpointAddr to the control plane for discovery).
    tokio::time::sleep(Duration::from_millis(300)).await;
    println!("  iroh: EndpointId {}  (account={account})", endpoint.id());
    for a in endpoint.addr().ip_addrs() {
        println!("        direct {a}");
    }

    // Publish the EndpointAddr to the control plane so clients can discover + dial it, and
    // KEEP publishing on a timer: iroh can rebind its socket (network change, sleep/wake), and
    // a one-shot publish would leave a STALE address that clients dial forever (connect hangs).
    // Re-publishing also keeps `updated_at` fresh so clients see the host as online + picks up
    // the current partition quota. iroh's Endpoint is an Arc, so cloning it is cheap.
    if let (Ok(control), Ok(license)) = (std::env::var("PC_CONTROL_URL"), std::env::var("PC_LICENSE")) {
        let ep = endpoint.clone();
        let host_pub = host.clone();
        tokio::spawn(async move {
            let url = format!("{}/api/host/endpoint", control.trim_end_matches('/'));
            let mut first = true;
            loop {
                let addr = ep.addr();
                let direct: Vec<String> = addr.ip_addrs().map(|a| a.to_string()).collect();
                let relay = addr.relay_urls().next().map(|u| u.to_string());
                let (agreement_pub, quota_bytes, disk_bytes) = {
                    let h = host_pub.lock().unwrap();
                    (core_crypto::to_hex(h.agreement_public().as_bytes()), h.quota_bytes(), h.disk_avail_bytes())
                };
                let body = serde_json::json!({
                    "endpoint_id": ep.id().to_string(),
                    "agreement_pub": agreement_pub,
                    "relay_url": relay,
                    "disk_bytes": disk_bytes,
                    "direct_addrs": direct,
                    "quota_bytes": quota_bytes,
                })
                .to_string();
                match http_json("POST", &url, &license, Some(&body)).await {
                    Ok(_) if first => tracing::info!("published iroh endpoint to control plane"),
                    Ok(_) => {}
                    Err(e) => tracing::warn!("could not publish iroh endpoint: {e}"),
                }
                first = false;
                tokio::time::sleep(Duration::from_secs(30)).await;
            }
        });
    }

    let (h1, h3) = (host.clone(), host.clone());
    // Read once, before the closures take their clones: the Hello signature binds this key,
    // so a captured Hello cannot be replayed at a different host.
    let host_agreement_pub = host.lock().unwrap().agreement_public();
    let allow_i = allow.clone();
    tokio::spawn(async move {
        let _ = core_net::iroh::serve_iroh(
            endpoint,
            host_agreement_pub,
            move |b| h1.lock().unwrap().open_sealed(b),
            move |id| accept_any || allow_i.read().unwrap().contains(id.as_bytes()),
            // A mutation from the Iroh mount fans out a live-sync notification so a
            // connected console re-lists (the console reflects Finder changes).
            move |req| {
                let mutated = is_mutation(&req);
                let resp = h3.lock().unwrap().handle(req);
                if mutated && !matches!(resp, core_proto::Response::Error { .. }) {
                    let _ = notify_tx.send(());
                }
                resp
            },
        )
        .await;
    });
    Ok(())
}

/// Minimal HTTP GET/POST-JSON helper for the dev control plane (http only). The
/// production build talks to the control plane over TLS via the desktop app's
/// HTTP client; this keeps the headless daemon dependency-light for local + LAN
/// deployments.
async fn http_json(method: &str, url: &str, bearer: &str, body: Option<&str>) -> Result<serde_json::Value> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;
    let mut req = match method {
        "POST" => client.post(url),
        "GET" => client.get(url),
        other => bail!("unsupported HTTP method {other}"),
    }
    .header("Authorization", format!("Bearer {bearer}"));
    if let Some(b) = body {
        req = req.header("Content-Type", "application/json").body(b.to_string());
    }
    let resp = req.send().await?;
    let status = resp.status();
    let text = resp.text().await?;
    if !status.is_success() {
        bail!("control plane returned {status}: {}", text.trim());
    }
    Ok(serde_json::from_str(text.trim())?)
}

async fn fetch_authorized(control: &str, account: &str, license: &str) -> Result<Vec<[u8; 32]>> {
    let url = format!("{}/api/account/authorized?account={}", control.trim_end_matches('/'), account);
    let v = http_json("GET", &url, license, None).await?;
    let mut out = Vec::new();
    if let Some(arr) = v.get("approved").and_then(|a| a.as_array()) {
        for id in arr.iter().filter_map(|x| x.as_str()) {
            if let Some(a) = core_crypto::from_hex(id).and_then(|b| <[u8; 32]>::try_from(b.as_slice()).ok()) {
                out.push(a);
            }
        }
    }
    Ok(out)
}

/// Mirror peers for this host, from the control plane.
///
/// Returns empty unless the owner has set the account to mirror mode in the console. This is
/// what makes that switch mean something: before it existed, peers came only from `PC_PEERS`
/// set by hand, so the console's mirror toggle wrote a preference no host ever read.
async fn fetch_peers(control: &str, account: &str, self_eid: &str, license: &str) -> Result<Vec<PeerSpec>> {
    let url = format!(
        "{}/api/account/peers?account={}&self={}",
        control.trim_end_matches('/'),
        account,
        self_eid
    );
    let v = http_json("GET", &url, license, None).await?;
    let mut out = Vec::new();
    for p in v.get("peers").and_then(|a| a.as_array()).into_iter().flatten() {
        let (Some(eid), Some(pubhex)) = (
            p.get("endpoint_id").and_then(|x| x.as_str()),
            p.get("agreement_pub").and_then(|x| x.as_str()),
        ) else {
            continue;
        };
        let Some(arr) = core_crypto::from_hex(pubhex).and_then(|b| <[u8; 32]>::try_from(b.as_slice()).ok())
        else {
            tracing::warn!("peer {eid}: malformed agreement pubkey, skipping");
            continue;
        };
        out.push(PeerSpec { eid: eid.to_string(), agreement_pub: AgreementPublic::from_bytes(arr) });
    }
    Ok(out)
}

async fn fetch_relay_token(control: &str, account: &str, role: &str, device: &str, license: &str) -> Result<String> {
    let url = format!("{}/api/relay/token", control.trim_end_matches('/'));
    let body = serde_json::json!({ "account": account, "role": role, "device": device }).to_string();
    let v = http_json("POST", &url, license, Some(&body)).await?;
    v.get("token").and_then(|t| t.as_str()).map(|s| s.to_string()).ok_or_else(|| anyhow!("no token in response"))
}
