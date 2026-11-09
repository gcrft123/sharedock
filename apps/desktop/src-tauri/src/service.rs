//! Keeping a host running: a service that owns the daemon instead of the app.
//!
//! The premise of the product is an old machine in a cupboard that is simply always on. Until
//! now the daemon lived and died with the desktop app, so a reboot, a crash, or a software
//! update left the host offline until somebody walked over and opened the GUI. That is exactly
//! the machine least likely to have somebody near it.
//!
//! macOS: a per-user LaunchAgent that launchd starts at login and restarts whenever the daemon
//! exits, so a host survives reboots and crashes without the app being involved at all.
//!
//! WHY A LAUNCHAGENT AND NOT A LAUNCHDAEMON. A LaunchDaemon starts at boot with no login, which
//! is strictly better for a headless box, but it lives in /Library/LaunchDaemons and needs root
//! to install. A sandboxed GUI app cannot write there without shipping a privileged helper and
//! asking for an admin password mid-onboarding. The agent covers the real case (these machines
//! are set to log in automatically) and needs no elevation. The gap is worth stating to the
//! owner plainly: a host only comes back after a reboot once someone (or autologin) logs in.
//!
//! Windows: a Task Scheduler task. Registered with an S4U principal it runs at boot with nobody
//! logged in — better than the macOS agent — and needs no stored password; that registration
//! needs the "log on as a batch job" right, which every administrator account has. A standard
//! user gets a logon-triggered task instead, which is the LaunchAgent shape. Task Scheduler
//! cannot set environment variables per task, so the daemon's configuration is written to a
//! file the task passes with `--env-file`.

use std::path::PathBuf;

/// Reverse-DNS label, matching the app's bundle identifier family.
pub const LABEL: &str = "app.sharedock.host";

/// The daemon's config travels as environment variables, exactly as `host_mode::spawn` passes
/// them, so a service-run host and an app-run host are configured identically.
pub struct AgentSpec {
    pub program: PathBuf,
    pub data_dir: PathBuf,
    pub control_url: String,
    pub relay_url: Option<String>,
    pub host_name: Option<String>,
    pub host_icon: Option<String>,
    pub quota_gb: Option<u64>,
}

/// Which service backend this build uses, for the UI.
pub fn kind() -> &'static str {
    if cfg!(target_os = "macos") {
        "launchd"
    } else if cfg!(windows) {
        "task-scheduler"
    } else {
        "none"
    }
}

#[cfg(target_os = "macos")]
pub use launchd::{install, is_installed, is_loaded, start, uninstall, unit_path};
#[cfg(windows)]
pub use task::{install, is_installed, is_loaded, start, uninstall, unit_path};
#[cfg(not(any(target_os = "macos", windows)))]
pub use unsupported::{install, is_installed, is_loaded, start, uninstall, unit_path};

// -----------------------------------------------------------------------------------------
// macOS: launchd agent
// -----------------------------------------------------------------------------------------

#[cfg(target_os = "macos")]
mod launchd {
    use super::{AgentSpec, LABEL};
    use std::path::PathBuf;
    use std::process::Command;

    fn agents_dir() -> PathBuf {
        crate::paths::home().join("Library/LaunchAgents")
    }

    /// The plist on disk.
    pub fn unit_path() -> PathBuf {
        agents_dir().join(format!("{LABEL}.plist"))
    }

    /// Minimal XML escaping. Paths and host names reach the plist, and a name containing `&`
    /// or `<` would otherwise produce a file launchd silently refuses to load.
    fn esc(s: &str) -> String {
        s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
    }

    fn kv(key: &str, value: &str) -> String {
        format!("    <key>{}</key>\n    <string>{}</string>\n", esc(key), esc(value))
    }

    pub(super) fn plist(spec: &AgentSpec) -> String {
        let mut env = String::new();
        env.push_str(&kv("PC_DATA_DIR", &spec.data_dir.to_string_lossy()));
        env.push_str(&kv("PC_CONTROL_URL", &spec.control_url));
        // Without this the daemon serves over the relay but never publishes its endpoint, so
        // it is invisible to discovery and every client silently falls back to the slow path.
        env.push_str(&kv("PC_IROH", "1"));
        if let Some(r) = &spec.relay_url {
            env.push_str(&kv("PC_RELAY_URL", r));
        }
        if let Some(n) = &spec.host_name {
            env.push_str(&kv("PC_HOST_NAME", n));
        }
        if let Some(i) = &spec.host_icon {
            env.push_str(&kv("PC_HOST_ICON", i));
        }
        if let Some(q) = spec.quota_gb {
            env.push_str(&kv("PC_QUOTA_GB", &q.to_string()));
        }

        let log = spec.data_dir.join("daemon.log");
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{program}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
{env}  </dict>
  <!-- Start when the user logs in, and restart whenever the daemon exits for any reason.
       Together these are what make the host outlive a reboot or a crash. -->
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <!-- Do not hammer a daemon that is failing at startup (bad config, busy store). -->
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>{log}</string>
  <key>StandardErrorPath</key>
  <string>{log}</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
"#,
            label = LABEL,
            program = esc(&spec.program.to_string_lossy()),
            env = env,
            log = esc(&log.to_string_lossy()),
        )
    }

    fn gui_target() -> String {
        // launchctl's modern subcommands address a user's GUI domain by uid.
        format!("gui/{}", unsafe { libc::getuid() })
    }

    /// Is the agent currently loaded into launchd?
    pub fn is_loaded() -> bool {
        Command::new("launchctl")
            .args(["print", &format!("{}/{}", gui_target(), LABEL)])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// Is the agent installed on disk (whether or not currently loaded)?
    pub fn is_installed() -> bool {
        unit_path().exists()
    }

    /// launchd's KeepAlive already restarts the daemon; nothing to do.
    pub fn start() {}

    /// Write the plist and load it. Idempotent: an existing agent is replaced, so changing
    /// the host's name or quota just reinstalls.
    pub fn install(spec: &AgentSpec) -> Result<(), String> {
        if !spec.program.exists() {
            return Err(format!("daemon binary not found at {}", spec.program.display()));
        }
        std::fs::create_dir_all(agents_dir()).map_err(|e| e.to_string())?;
        let path = unit_path();
        // Unload any previous version first, or launchd keeps running the old ProgramArguments.
        let _ = uninstall();
        std::fs::write(&path, plist(spec))
            .map_err(|e| format!("could not write {}: {e}", path.display()))?;

        let out = Command::new("launchctl")
            .args(["bootstrap", &gui_target(), &path.to_string_lossy()])
            .output()
            .map_err(|e| format!("launchctl bootstrap failed: {e}"))?;
        if !out.status.success() {
            // `bootstrap` is unavailable before 10.11 and errors if already loaded; `load` is
            // the long-standing spelling and is accepted everywhere this app runs.
            let legacy = Command::new("launchctl")
                .args(["load", "-w", &path.to_string_lossy()])
                .output()
                .map_err(|e| format!("launchctl load failed: {e}"))?;
            if !legacy.status.success() {
                let _ = std::fs::remove_file(&path);
                return Err(format!(
                    "launchctl could not load the agent: {}",
                    String::from_utf8_lossy(&legacy.stderr).trim()
                ));
            }
        }
        Ok(())
    }

    /// Unload and remove the agent. Safe to call when nothing is installed.
    pub fn uninstall() -> Result<(), String> {
        let path = unit_path();
        let target = format!("{}/{}", gui_target(), LABEL);
        let _ = Command::new("launchctl").args(["bootout", &target]).output();
        if path.exists() {
            let _ = Command::new("launchctl").args(["unload", "-w", &path.to_string_lossy()]).output();
            std::fs::remove_file(&path)
                .map_err(|e| format!("could not remove {}: {e}", path.display()))?;
        }
        Ok(())
    }
}

// -----------------------------------------------------------------------------------------
// Windows: Task Scheduler
// -----------------------------------------------------------------------------------------

#[cfg(windows)]
mod task {
    use super::AgentSpec;
    use std::path::{Path, PathBuf};

    /// Task name. The leading backslash puts it at the root of the Task Scheduler library,
    /// where the owner can find it.
    pub const TASK_NAME: &str = "\\Sharedock Host";

    fn data_dir() -> PathBuf {
        crate::host_mode::default_host_data_dir()
    }

    /// The task definition we registered, kept next to the store for inspection.
    pub fn unit_path() -> PathBuf {
        data_dir().join("host-task.xml")
    }

    fn env_path(dir: &Path) -> PathBuf {
        dir.join("daemon.env")
    }

    /// The current user's SID, which Task Scheduler accepts wherever it wants a UserId and
    /// which is unambiguous for local, domain and Microsoft accounts alike. Names are not:
    /// `USERDOMAIN` reads `WORKGROUP` in some sessions, and that maps to nothing. Falls back
    /// to the bare user name, which schtasks resolves locally.
    fn principal() -> String {
        // `whoami /user /fo csv /nh` → "host\user","S-1-5-21-…"
        let sid = crate::sys::command("whoami")
            .args(["/user", "/fo", "csv", "/nh"])
            .output()
            .ok()
            .and_then(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .next()?
                    .rsplit(',')
                    .next()
                    .map(|f| f.trim().trim_matches('"').to_string())
            })
            .filter(|s| s.starts_with("S-1-"));
        sid.unwrap_or_else(|| std::env::var("USERNAME").unwrap_or_default())
    }

    fn esc(s: &str) -> String {
        s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
    }

    /// The daemon's configuration as `KEY=VALUE` lines (see `--env-file` in pc-daemon). The
    /// format has no quoting, so a value cannot contain a newline; a host name is the only
    /// free-text field and one with a newline in it is not worth preserving.
    pub(super) fn env_lines(spec: &AgentSpec) -> String {
        let mut s = String::new();
        let mut kv = |k: &str, v: &str| {
            s.push_str(k);
            s.push('=');
            s.push_str(v.replace(['\r', '\n'], " ").trim());
            s.push('\n');
        };
        kv("PC_DATA_DIR", &spec.data_dir.to_string_lossy());
        kv("PC_CONTROL_URL", &spec.control_url);
        // Without this the daemon serves over the relay but never publishes its endpoint, so
        // it is invisible to discovery and every client silently falls back to the slow path.
        kv("PC_IROH", "1");
        // A scheduled task has no console; without this the daemon's output goes nowhere.
        kv("PC_LOG_FILE", &spec.data_dir.join("daemon.log").to_string_lossy());
        if let Some(r) = &spec.relay_url {
            kv("PC_RELAY_URL", r);
        }
        if let Some(n) = &spec.host_name {
            kv("PC_HOST_NAME", n);
        }
        if let Some(i) = &spec.host_icon {
            kv("PC_HOST_ICON", i);
        }
        if let Some(q) = spec.quota_gb {
            kv("PC_QUOTA_GB", &q.to_string());
        }
        s
    }

    /// `logon` is `S4U` (runs at boot, nobody logged in) or `InteractiveToken` (runs at this
    /// user's logon — the fallback when S4U registration is refused).
    pub(super) fn task_xml(spec: &AgentSpec, logon: &str) -> String {
        let user = esc(&principal());
        // A boot trigger only makes sense for a principal that can run without a session.
        let boot = if logon == "S4U" {
            "\n    <BootTrigger><Enabled>true</Enabled></BootTrigger>"
        } else {
            ""
        };
        format!(
            r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Sharedock host: keeps this computer serving its encrypted drive after reboots and crashes.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>{user}</UserId></LogonTrigger>{boot}
  </Triggers>
  <Principals>
    <Principal id="Author"><UserId>{user}</UserId><LogonType>{logon}</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <!-- A host runs until told otherwise; the default one-day limit would kill it every day. -->
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <!-- The KeepAlive equivalent: a crash restarts it a minute later, indefinitely. -->
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
    <Hidden>false</Hidden>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{program}</Command>
      <Arguments>--env-file "{env}"</Arguments>
      <WorkingDirectory>{cwd}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"#,
            program = esc(&spec.program.to_string_lossy()),
            env = esc(&env_path(&spec.data_dir).to_string_lossy()),
            cwd = esc(&spec.data_dir.to_string_lossy()),
        )
    }

    /// schtasks reads task XML as UTF-16 with a byte-order mark, the encoding it exports.
    fn write_utf16(path: &Path, text: &str) -> Result<(), String> {
        let mut bytes = vec![0xFF, 0xFE];
        for u in text.encode_utf16() {
            bytes.extend_from_slice(&u.to_le_bytes());
        }
        std::fs::write(path, bytes).map_err(|e| format!("could not write {}: {e}", path.display()))
    }

    fn schtasks(args: &[&str]) -> Result<std::process::Output, String> {
        crate::sys::command("schtasks").args(args).output().map_err(|e| format!("schtasks: {e}"))
    }

    fn failure(out: &std::process::Output) -> String {
        // schtasks reports errors on stdout as often as stderr.
        format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout).trim(),
            String::from_utf8_lossy(&out.stderr).trim()
        )
    }

    /// `Ready`, `Running`, `Disabled`, … from the CSV query, or None if not registered.
    fn status() -> Option<String> {
        let out = schtasks(&["/Query", "/TN", TASK_NAME, "/FO", "CSV", "/NH"]).ok()?;
        if !out.status.success() {
            return None;
        }
        // "\Sharedock Host","01/01/2026 00:00:00","Running"
        let line = String::from_utf8_lossy(&out.stdout);
        let field = line.lines().next()?.rsplit(',').next()?.trim().trim_matches('"');
        Some(field.to_string())
    }

    /// Registered and enabled — Task Scheduler owns the daemon (it may be between restarts).
    pub fn is_loaded() -> bool {
        matches!(status().as_deref(), Some(s) if !s.eq_ignore_ascii_case("Disabled"))
    }

    /// Registration is the installation on Windows.
    pub fn is_installed() -> bool {
        status().is_some()
    }

    /// Start the task now if it is idle. `IgnoreNew` makes this a no-op while it is running,
    /// so it is safe to call on every app launch.
    pub fn start() {
        let _ = schtasks(&["/Run", "/TN", TASK_NAME]);
    }

    /// Write the env file and the task definition, register it, and start it. Idempotent: an
    /// existing task is replaced, so changing the host's name or quota just reinstalls.
    pub fn install(spec: &AgentSpec) -> Result<(), String> {
        if !spec.program.exists() {
            return Err(format!("daemon binary not found at {}", spec.program.display()));
        }
        std::fs::create_dir_all(&spec.data_dir).map_err(|e| e.to_string())?;
        let env = env_path(&spec.data_dir);
        std::fs::write(&env, env_lines(spec))
            .map_err(|e| format!("could not write {}: {e}", env.display()))?;
        let _ = uninstall();

        let xml = spec.data_dir.join("host-task.xml");
        let mut last = String::new();
        for logon in ["S4U", "InteractiveToken"] {
            write_utf16(&xml, &task_xml(spec, logon))?;
            let out = schtasks(&["/Create", "/TN", TASK_NAME, "/XML", &xml.to_string_lossy(), "/F"])?;
            if out.status.success() {
                start();
                return Ok(());
            }
            last = failure(&out);
        }
        let _ = std::fs::remove_file(&xml);
        Err(format!("schtasks could not register the task: {last}"))
    }

    /// Stop and unregister the task. Safe to call when nothing is installed. The env file is
    /// left in place: it holds no secrets and documents how the host was configured.
    pub fn uninstall() -> Result<(), String> {
        if status().is_none() {
            return Ok(());
        }
        // `/End` terminates the running instance (AllowHardTerminate), which is how a
        // service-managed host is stopped.
        let _ = schtasks(&["/End", "/TN", TASK_NAME]);
        let out = schtasks(&["/Delete", "/TN", TASK_NAME, "/F"])?;
        if !out.status.success() {
            return Err(format!("schtasks could not delete the task: {}", failure(&out)));
        }
        let _ = std::fs::remove_file(unit_path());
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod unsupported {
    use super::AgentSpec;
    use std::path::PathBuf;

    pub fn unit_path() -> PathBuf {
        PathBuf::new()
    }
    pub fn is_loaded() -> bool {
        false
    }
    pub fn is_installed() -> bool {
        false
    }
    pub fn start() {}
    pub fn install(_spec: &AgentSpec) -> Result<(), String> {
        Err("no service backend on this platform".into())
    }
    pub fn uninstall() -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> AgentSpec {
        AgentSpec {
            program: PathBuf::from("/Applications/Sharedock.app/Contents/MacOS/pc-daemon"),
            data_dir: PathBuf::from("/Users/x/.sharedock/host"),
            control_url: "https://example.com".into(),
            relay_url: Some("wss://example.com".into()),
            host_name: Some("Loft Server".into()),
            host_icon: Some("server".into()),
            quota_gb: Some(512),
        }
    }

    #[cfg(target_os = "macos")]
    mod macos {
        use super::*;
        use crate::service::launchd::plist;

        #[test]
        fn plist_carries_the_daemons_whole_configuration() {
            let x = plist(&spec());
            assert!(x.contains("<string>app.sharedock.host</string>"));
            assert!(x.contains("/Contents/MacOS/pc-daemon"));
            assert!(x.contains("PC_CONTROL_URL"));
            assert!(x.contains("PC_QUOTA_GB"));
            assert!(x.contains("Loft Server"));
            // The two keys that make a host outlive a reboot or a crash.
            assert!(x.contains("<key>RunAtLoad</key>\n  <true/>"));
            assert!(x.contains("<key>KeepAlive</key>\n  <true/>"));
        }

        /// Without PC_IROH the daemon serves but never publishes its endpoint, so it is
        /// invisible to discovery and every client silently drops to the relay. Easy to omit,
        /// hard to debug.
        #[test]
        fn plist_always_enables_the_direct_path() {
            assert!(plist(&spec()).contains("<key>PC_IROH</key>\n    <string>1</string>"));
        }

        #[test]
        fn optional_settings_are_omitted_rather_than_written_empty() {
            let mut s = spec();
            s.relay_url = None;
            s.host_name = None;
            s.quota_gb = None;
            let x = plist(&s);
            assert!(!x.contains("PC_RELAY_URL"));
            assert!(!x.contains("PC_HOST_NAME"));
            assert!(!x.contains("PC_QUOTA_GB"));
            assert!(x.contains("PC_CONTROL_URL"));
        }

        /// A host named with an ampersand would otherwise produce a plist launchd refuses to
        /// load, and the host would simply never come back after a reboot.
        #[test]
        fn host_names_needing_xml_escaping_do_not_corrupt_the_plist() {
            let mut s = spec();
            s.host_name = Some("Ben & Jerry's <box>".into());
            let x = plist(&s);
            assert!(x.contains("Ben &amp; Jerry's &lt;box&gt;"));
            assert!(!x.contains("<box>"));
        }
    }

    #[cfg(windows)]
    mod windows {
        use super::*;
        use crate::service::task::{env_lines, task_xml};

        fn wspec() -> AgentSpec {
            let mut s = spec();
            s.program = PathBuf::from(r"C:\Program Files\Sharedock\pc-daemon.exe");
            s.data_dir = PathBuf::from(r"C:\Users\x\AppData\Local\Sharedock\host");
            s
        }

        /// The env file is the daemon's entire configuration under Task Scheduler; a missing
        /// line here is a host that comes back after a reboot misconfigured.
        #[test]
        fn env_file_carries_the_daemons_whole_configuration() {
            let e = env_lines(&wspec());
            assert!(e.contains("PC_DATA_DIR=C:\\Users\\x\\AppData\\Local\\Sharedock\\host\n"));
            assert!(e.contains("PC_CONTROL_URL=https://example.com\n"));
            assert!(e.contains("PC_IROH=1\n"));
            assert!(e.contains("PC_LOG_FILE=C:\\Users\\x\\AppData\\Local\\Sharedock\\host\\daemon.log\n"));
            assert!(e.contains("PC_HOST_NAME=Loft Server\n"));
            assert!(e.contains("PC_QUOTA_GB=512\n"));
        }

        #[test]
        fn optional_settings_are_omitted_rather_than_written_empty() {
            let mut s = wspec();
            s.relay_url = None;
            s.host_name = None;
            s.quota_gb = None;
            let e = env_lines(&s);
            assert!(!e.contains("PC_RELAY_URL"));
            assert!(!e.contains("PC_HOST_NAME"));
            assert!(!e.contains("PC_QUOTA_GB"));
        }

        /// The file format has no quoting, so a newline in a value would become a second,
        /// garbage line the daemon refuses to parse — and then never start.
        #[test]
        fn a_newline_in_a_host_name_cannot_break_the_env_file() {
            let mut s = wspec();
            s.host_name = Some("Loft\nServer\r\n".into());
            let e = env_lines(&s);
            assert!(e.contains("PC_HOST_NAME=Loft Server\n"), "{e}");
            assert!(e.lines().all(|l| l.contains('=')), "{e}");
        }

        /// The settings that make a host outlive a reboot or a crash.
        #[test]
        fn task_runs_at_boot_forever_and_restarts_on_failure() {
            let x = task_xml(&wspec(), "S4U");
            assert!(x.contains("<BootTrigger>"));
            assert!(x.contains("<LogonTrigger>"));
            assert!(x.contains("<LogonType>S4U</LogonType>"));
            assert!(x.contains("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>"));
            assert!(x.contains("<RestartOnFailure>"));
            assert!(x.contains(r#"--env-file "C:\Users\x\AppData\Local\Sharedock\host\daemon.env""#));
            assert!(x.contains(r"<Command>C:\Program Files\Sharedock\pc-daemon.exe</Command>"));
        }

        /// The fallback for accounts that cannot register a batch logon: same task, at logon
        /// only, since an interactive token cannot run before there is a session.
        #[test]
        fn interactive_fallback_has_no_boot_trigger() {
            let x = task_xml(&wspec(), "InteractiveToken");
            assert!(!x.contains("<BootTrigger>"));
            assert!(x.contains("<LogonType>InteractiveToken</LogonType>"));
        }

        #[test]
        fn program_paths_needing_xml_escaping_do_not_corrupt_the_task() {
            let mut s = wspec();
            s.program = PathBuf::from(r"C:\Tools & Apps\pc-daemon.exe");
            let x = task_xml(&s, "S4U");
            assert!(x.contains(r"C:\Tools &amp; Apps\pc-daemon.exe"));
        }

        /// Registers a REAL task with Task Scheduler, lets it start the daemon, and removes
        /// it. Ignored by default because it touches this machine's task library (and would
        /// replace a genuine Sharedock Host task). On a Windows box:
        ///
        ///   $env:PC_DAEMON_BIN = "...\pc-daemon.exe"
        ///   cargo test --lib -- --ignored service_round_trip
        #[test]
        #[ignore]
        fn service_round_trip_registers_runs_and_removes() {
            use std::time::{Duration, Instant};

            let program = std::env::var("PC_DAEMON_BIN")
                .map(PathBuf::from)
                .expect("set PC_DAEMON_BIN to a built pc-daemon.exe");
            let dir = std::env::temp_dir().join(format!("sharedock-svc-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let spec = AgentSpec {
                program,
                data_dir: dir.clone(),
                control_url: "https://example.invalid".into(),
                relay_url: None, // no relay: the daemon prints its status and exits
                host_name: Some("Round Trip".into()),
                host_icon: None,
                quota_gb: Some(1),
            };

            install(&spec).unwrap();
            assert!(is_installed());
            assert!(is_loaded());

            // Anything in daemon.log got there through the whole chain: Task Scheduler ran
            // the program, the program read the env file, and PC_LOG_FILE routed its output.
            let log = dir.join("daemon.log");
            let deadline = Instant::now() + Duration::from_secs(30);
            while Instant::now() < deadline
                && !std::fs::read_to_string(&log).unwrap_or_default().contains("host agent")
            {
                std::thread::sleep(Duration::from_millis(500));
            }
            let text = std::fs::read_to_string(&log).unwrap_or_default();

            uninstall().unwrap();
            assert!(!is_installed());
            assert!(!is_loaded());

            assert!(text.contains("host agent"), "daemon did not run under the task:\n{text}");
            assert!(
                text.contains(&*dir.to_string_lossy()),
                "daemon ran against the wrong data dir:\n{text}"
            );
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
}
