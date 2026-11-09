//! "Store my files" — run the host role from the desktop app by managing a `pc-daemon`
//! child process. Spawning the daemon (rather than re-implementing the host loop in the
//! app) reuses ALL of its logic: pairing-code enrollment, relay + Iroh serving, the mirror
//! mesh, and the headless-setup fallback. The app just supplies config and start/stop.
//!
//! The frontend ("Store my files" screens, status view) is built separately and drives the
//! Tauri commands in `lib.rs` (`start_host_daemon` / `stop_host_daemon` /
//! `host_daemon_running` / `host_daemon_config`).
//!
//! Binary resolution: `PC_DAEMON_BIN` env → next to the app executable (a bundled
//! sidecar/resource) → `pc-daemon` on `PATH` (dev). Bundling the binary into the app is a
//! build/packaging step.

use std::path::PathBuf;
use std::process::{Child, Stdio};

/// Config for starting the host daemon. Onboarding uses `claim` on first run; later runs
/// read the persisted `host.json` in `data_dir` and need no code.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostStartArgs {
    pub control_url: String,
    pub data_dir: Option<String>,
    pub claim: Option<String>,      // pairing code (first run)
    pub relay_url: Option<String>,  // serve over this relay (in addition to Iroh)
    pub host_name: Option<String>,  // label shown in the Hosts panel
    pub host_icon: Option<String>,  // glyph the owner picked on the name+icon screen
    pub quota_gb: Option<u64>,      // placeholder until the license is authoritative
}

/// The subset of `HostStartArgs` we persist so the app can respawn the daemon on the next
/// launch without going through onboarding again. Excludes `claim` (single-use, consumed on
/// first enrollment — later runs read host.json) and `data_dir` (implied by where this is
/// written). `control_url`/`relay_url` aren't in host.json but the daemon needs them to fetch
/// its authorized-client list and serve the relay room, so we have to carry them here.
#[derive(serde::Serialize, serde::Deserialize)]
struct LaunchConfig {
    control_url: String,
    #[serde(default)]
    relay_url: Option<String>,
    #[serde(default)]
    host_name: Option<String>,
    #[serde(default)]
    host_icon: Option<String>,
    #[serde(default)]
    quota_gb: Option<u64>,
}

fn launch_config_path(data_dir: &std::path::Path) -> PathBuf {
    data_dir.join("host-launch.json")
}

/// Record how this host was started so `autostart` can replay it next launch (best-effort).
fn persist_launch_config(data_dir: &std::path::Path, args: &HostStartArgs) {
    let cfg = LaunchConfig {
        control_url: args.control_url.clone(),
        relay_url: args.relay_url.clone(),
        host_name: args.host_name.clone(),
        host_icon: args.host_icon.clone(),
        quota_gb: args.quota_gb,
    };
    if let Ok(bytes) = serde_json::to_vec_pretty(&cfg) {
        let _ = std::fs::write(launch_config_path(data_dir), bytes);
    }
}

fn load_launch_config(data_dir: &std::path::Path) -> Option<LaunchConfig> {
    let raw = std::fs::read(launch_config_path(data_dir)).ok()?;
    serde_json::from_slice(&raw).ok()
}

/// Fallback launch config for a host that was set up BEFORE we started saving `host-launch.json`
/// (e.g. enrolled headlessly) — so its daemon still auto-restarts. Uses the control-plane URL
/// baked in at build time (`VITE_CONTROL_URL`, the same value the desktop bundle points the UI
/// at) and derives the relay origin from it exactly as the frontend does (http→ws). `None` if
/// the build didn't set it (a dev/same-origin build), where there's no safe default to guess.
fn fallback_launch_config() -> Option<LaunchConfig> {
    let control_url = option_env!("VITE_CONTROL_URL")?.trim_end_matches('/').to_string();
    if control_url.is_empty() {
        return None;
    }
    // relayOrigin(): the control-plane origin as ws(s) (https→wss, http→ws).
    let relay_url = control_url.replacen("http", "ws", 1);
    Some(LaunchConfig {
        control_url,
        relay_url: Some(relay_url),
        host_name: None, // only used at first enrollment; the daemon reads host.json on restart
        host_icon: None,
        quota_gb: None, // restored from host.json's persisted owner quota
    })
}

/// A running host daemon child.
pub struct HostProcess {
    child: Child,
    #[allow(dead_code)]
    data_dir: PathBuf,
}

impl HostProcess {
    pub fn running(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }
    pub fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_file(pidfile_path(&self.data_dir));
    }
}

fn pidfile_path(data_dir: &std::path::Path) -> PathBuf {
    data_dir.join("daemon.pid")
}

/// Kill a daemon left running for this data dir by a PREVIOUS app session (orphaned when the app
/// was force-quit or crashed, so the exit handler never ran). Two daemons against one store would
/// race on the SQLite DB and fight over the published endpoint, so a fresh spawn must clear any
/// stale one first. Verifies the pid is actually a `pc-daemon` before signalling — a bare pidfile
/// could point at a reused pid — then waits briefly for it to release the store.
fn kill_stale_daemon(data_dir: &std::path::Path) {
    let Some(pid) = std::fs::read_to_string(pidfile_path(data_dir))
        .ok()
        .and_then(|s| s.trim().parse::<i32>().ok())
    else {
        return;
    };
    if pid_is_daemon(pid) {
        eprintln!("[host] killing orphaned daemon pid {pid} before restart");
        kill_pid(pid);
        std::thread::sleep(std::time::Duration::from_millis(400));
    }
    let _ = std::fs::remove_file(pidfile_path(data_dir));
}

#[cfg(unix)]
fn pid_is_daemon(pid: i32) -> bool {
    crate::sys::command("ps")
        .args(["-p", &pid.to_string(), "-o", "comm="])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("pc-daemon"))
        .unwrap_or(false)
}

#[cfg(unix)]
fn kill_pid(pid: i32) {
    let _ = crate::sys::command("kill").arg(pid.to_string()).status();
}

#[cfg(windows)]
fn pid_is_daemon(pid: i32) -> bool {
    // CSV without a header: `"pc-daemon.exe","1234",...` — or an "INFO: No tasks" line.
    crate::sys::command("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("pc-daemon"))
        .unwrap_or(false)
}

#[cfg(windows)]
fn kill_pid(pid: i32) {
    let _ = crate::sys::command("taskkill").args(["/PID", &pid.to_string(), "/F"]).status();
}

/// Default host store, kept separate from the client mount data dir.
pub fn default_host_data_dir() -> PathBuf {
    crate::paths::app_dir().join("host")
}

fn daemon_bin() -> PathBuf {
    if let Ok(p) = std::env::var("PC_DAEMON_BIN") {
        return PathBuf::from(p);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let cand = dir.join(format!("pc-daemon{}", std::env::consts::EXE_SUFFIX));
            if cand.exists() {
                return cand;
            }
        }
    }
    PathBuf::from("pc-daemon")
}

pub fn spawn(args: HostStartArgs) -> Result<HostProcess, String> {
    let data_dir = args.data_dir.clone().map(PathBuf::from).unwrap_or_else(default_host_data_dir);
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    // Clear any daemon a previous app session orphaned (force-quit/crash) so we never run two
    // against the same store.
    kill_stale_daemon(&data_dir);
    // Record the config so the app can respawn this daemon on the next launch (see `autostart`).
    persist_launch_config(&data_dir, &args);

    // A GUI app's stdout is detached, so piping the daemon's output and never draining it would
    // let the OS pipe buffer fill and BLOCK the daemon (fatal for a long-lived autostarted host).
    // Redirect to a rolling log file in the data dir instead — it drains cleanly and is
    // inspectable. Fall back to /dev/null if the log can't be opened.
    let (out, err) = match std::fs::File::create(data_dir.join("daemon.log")) {
        Ok(f) => match f.try_clone() {
            Ok(f2) => (Stdio::from(f), Stdio::from(f2)),
            Err(_) => (Stdio::null(), Stdio::null()),
        },
        Err(_) => (Stdio::null(), Stdio::null()),
    };

    let bin = daemon_bin();
    let mut cmd = crate::sys::command(&bin);
    cmd.env("PC_DATA_DIR", &data_dir)
        .env("PC_CONTROL_URL", &args.control_url)
        .env("PC_IROH", "1") // hosts serve the direct-QUIC fast path
        // Serve the account's default relay room — the one the web/desktop console dials
        // (`/signal?account=…&role=client`, no host suffix). PC_HOST_ROOM=self would put the
        // host in `account:<host_id>`, a different Durable Object than the console, so they'd
        // never meet over the relay (it worked only when iroh-direct succeeded on the LAN).
        // Per-host rooms are a multi-host concern; the console can't target them yet.
        .stdin(Stdio::null())
        .stdout(out)
        .stderr(err);
    if let Some(c) = &args.claim {
        cmd.env("PC_CLAIM", c);
    }
    if let Some(r) = &args.relay_url {
        cmd.env("PC_RELAY_URL", r);
    }
    if let Some(n) = &args.host_name {
        cmd.env("PC_HOST_NAME", n);
    }
    if let Some(ic) = &args.host_icon {
        cmd.env("PC_HOST_ICON", ic);
    }
    if let Some(q) = args.quota_gb {
        cmd.env("PC_QUOTA_GB", q.to_string());
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("could not start host daemon ({}): {e}", bin.display()))?;
    // Record the pid so a future launch can clear this daemon if the app is force-quit/crashes
    // before its exit handler stops it (see `kill_stale_daemon`).
    let _ = std::fs::write(pidfile_path(&data_dir), child.id().to_string());
    Ok(HostProcess { child, data_dir })
}

/// Respawn the host daemon on app launch if this machine was previously set up as a host.
///
/// The daemon only stayed alive while the app process ran, so a relaunch (or a reboot) used to
/// leave the host offline until the owner re-triggered onboarding. Here we detect a configured
/// host — `host.json` exists (the daemon wrote it on first enrollment) AND we saved a launch
/// config — and start it again with the SAME control/relay config, minus the one-time claim.
///
/// Returns `Some(process)` if it started the daemon, `None` if this machine isn't a host or has
/// no saved launch config (nothing to restart). A spawn error is logged and swallowed — a failed
/// autostart must not block the app from opening.
pub fn autostart() -> Option<HostProcess> {
    let data_dir = default_host_data_dir();
    // Only a machine the daemon already enrolled (host.json present) should auto-host; without
    // it there's no account/license and the daemon would just error out on start.
    if !data_dir.join("host.json").exists() {
        return None;
    }

    // The service (launchd / Task Scheduler) owns the daemon on a machine that has been
    // promoted to one. Spawning a child here as well would put two daemons on one store, which
    // corrupts it, so the app deliberately does nothing.
    if crate::service::is_loaded() {
        eprintln!("[host] managed by the service; not starting a child");
        // A registered task that exited cleanly sits idle until its next trigger; launchd's
        // KeepAlive has no such gap. Kick it (a no-op while it is already running).
        crate::service::start();
        return None;
    }

    // Prefer the config saved when the app last started this host; fall back to the build-time
    // control URL for hosts enrolled before we saved it (so they auto-restart too).
    let cfg = load_launch_config(&data_dir).or_else(fallback_launch_config)?;

    // Promote this host to a service (launchd agent / scheduled task), so from here on it
    // survives reboots, crashes, and the app never being opened again. Only fall back to a
    // child process if that fails, since an app-managed daemon is still better than an
    // offline host.
    let spec = crate::service::AgentSpec {
        program: daemon_bin(),
        data_dir: data_dir.clone(),
        control_url: cfg.control_url.clone(),
        relay_url: cfg.relay_url.clone(),
        host_name: cfg.host_name.clone(),
        host_icon: cfg.host_icon.clone(),
        quota_gb: cfg.quota_gb,
    };
    match crate::service::install(&spec) {
        Ok(()) => {
            eprintln!("[host] installed the service; it owns the daemon from now on");
            return None;
        }
        Err(e) => eprintln!("[host] could not install the service ({e}); running as a child"),
    }

    let args = HostStartArgs {
        control_url: cfg.control_url,
        data_dir: Some(data_dir.to_string_lossy().into_owned()),
        claim: None, // consumed on first run; later runs read host.json
        relay_url: cfg.relay_url,
        host_name: cfg.host_name,
        host_icon: cfg.host_icon,
        quota_gb: cfg.quota_gb,
    };
    match spawn(args) {
        Ok(proc) => {
            eprintln!("[host] auto-restarted daemon from saved config ({})", data_dir.display());
            Some(proc)
        }
        Err(e) => {
            eprintln!("[host] autostart failed: {e}");
            None
        }
    }
}

/// A summary of the persisted host.json for the status view.
#[derive(serde::Serialize)]
pub struct HostConfigSummary {
    pub account: String,
    /// True once the owner has approved and the license was fetched.
    pub active: bool,
    /// The label + glyph the owner chose (from host-launch.json), so the "this machine is a
    /// host" view can show the real name on a returning launch — `None` for hosts enrolled
    /// before we saved the launch config.
    pub name: Option<String>,
    pub icon: Option<String>,
}

/// Read the host's persisted onboarding state (account + whether it's approved/active, plus the
/// owner-chosen name/icon). `Some` iff this machine is a configured host (host.json present) —
/// the frontend uses that to route the host machine to its own status view instead of the
/// client dashboard.
pub fn config_summary(data_dir: Option<String>) -> Option<HostConfigSummary> {
    let dir = data_dir.map(PathBuf::from).unwrap_or_else(default_host_data_dir);
    let raw = std::fs::read(dir.join("host.json")).ok()?;
    let v: serde_json::Value = serde_json::from_slice(&raw).ok()?;
    let launch = load_launch_config(&dir);
    Some(HostConfigSummary {
        account: v.get("account").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        active: v.get("license").and_then(|x| x.as_str()).is_some(),
        name: launch.as_ref().and_then(|c| c.host_name.clone()),
        icon: launch.as_ref().and_then(|c| c.host_icon.clone()),
    })
}
