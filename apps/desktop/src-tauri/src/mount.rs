//! WebDAV mount orchestration for the desktop app: start an in-process WebDAV
//! server over an encrypted drive (LOCAL store or a REMOTE host), then mount it in
//! Finder via `mount_webdav` — or, on Windows, map it to a drive letter with `net use`
//! through the WebClient redirector. This is the native delivery of the P2 WebDAV feature.
//!
//! The remote path is the P2 Iroh fast path: it prefers a direct QUIC connection to
//! the host (`RemoteDrive::connect_auto`) and falls back to the relay.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Result};
use core_crypto::{AccountRootKey, AgreementPublic, DeviceKeypair};
use core_fs::Store;
use core_webdav::{Drive, LocalDrive, RemoteDrive};
use tokio::task::JoinHandle;

pub use platform::{default_mountpoint, raise_file_limit, unmount};
use platform::finish_mount;

const GIB: u64 = 1024 * 1024 * 1024;

/// A live mount: the Finder mountpoint, the local server URL/port, and the server
/// task handle (aborted on unmount). Holds the drive (and, for a remote Iroh mount,
/// the endpoint) alive for the duration of the mount.
pub struct MountState {
    pub mountpoint: PathBuf,
    pub url: String,
    pub port: u16,
    /// Something the owner should know about this mount that is not an error — on Windows,
    /// that Explorer copies are capped until the WebClient file limit is raised.
    pub notice: Option<String>,
    server: JoinHandle<()>,
    _drive: Arc<dyn Drive>,
    // The iroh endpoint owns the QUIC socket + driver task; dropping it closes the
    // connection, so keep it alive as long as the (remote) mount is. None for local.
    _endpoint: Option<core_net::iroh::Endpoint>,
}

impl MountState {
    pub fn stop_server(&self) {
        self.server.abort();
    }
}

/// How to reach a remote host for a remote mount. `host_eid` + `host_addrs` (as
/// printed by pc-daemon / published to the control plane) enable the direct Iroh
/// fast path; without them the relay is used.
pub struct RemoteParams {
    pub relay_url: String,
    pub account: String,
    pub host_pub: AgreementPublic,
    pub token: Option<String>,
    pub host_eid: Option<String>,
    pub host_addrs: Vec<String>,
    pub iroh_relay: Option<String>,
    /// Shared account key (ARK) as hex; when set, this mount uses it (and persists it
    /// to `ark.key`) so it can decrypt files written by other clients on the account.
    pub ark_hex: Option<String>,
}

/// Default data dir for the desktop's local drive (encrypted store + ARK).
pub fn default_data_dir() -> PathBuf {
    crate::paths::support_dir().join("drive")
}

/// Write `bytes` to `path` readable by this user only (0600 / an owner-only ACL).
fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    Ok(core_fs::write_private(path, bytes)?)
}

fn load_or_create_ark(path: &Path) -> Result<AccountRootKey> {
    if let Ok(bytes) = std::fs::read(path) {
        if bytes.len() == 32 {
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&bytes);
            return Ok(AccountRootKey::from_bytes(arr));
        }
    }
    let ark = AccountRootKey::generate();
    write_private(path, &ark.to_bytes())?;
    Ok(ark)
}

/// Load (or create + persist) the client device identity, so this desktop keeps a
/// STABLE client id across mounts — the host authorizes clients by id, so a fresh
/// key every mount would need re-approval.
fn load_or_create_device(path: &Path) -> Result<DeviceKeypair> {
    if let Ok(bytes) = std::fs::read(path) {
        if bytes.len() == 64 {
            let mut arr = [0u8; 64];
            arr.copy_from_slice(&bytes);
            return Ok(DeviceKeypair::from_bytes(&arr));
        }
    }
    let kp = DeviceKeypair::generate();
    write_private(path, &kp.to_bytes())?;
    Ok(kp)
}

/// Start a local WebDAV server over `data_dir` and mount it at `mountpoint`.
pub async fn mount_local(
    data_dir: PathBuf,
    mountpoint: PathBuf,
    quota_gb: u64,
) -> Result<MountState> {
    std::fs::create_dir_all(&data_dir)?;
    let store = Store::open(&data_dir.join("meta.db"), &data_dir.join("blobs"))?;
    store.set_quota(quota_gb.saturating_mul(GIB))?;
    let ark = load_or_create_ark(&data_dir.join("ark.key"))?;
    let drive: Arc<dyn Drive> = Arc::new(LocalDrive::new(store, ark));
    finish_mount(drive, mountpoint, None).await
}

/// Connect to a remote host and mount it at `mountpoint`. Prefers the direct Iroh
/// fast path (when discovery is supplied), falling back to the relay.
///
/// NOTE (dev): the ARK is loaded from `<data_dir>/ark.key` like the local mount. A
/// REAL remote mount must use the ACCOUNT's ARK (else nothing the host holds
/// decrypts); that comes from the account key material, not a local dev file.
pub async fn mount_remote(
    data_dir: PathBuf,
    mountpoint: PathBuf,
    params: RemoteParams,
) -> Result<MountState> {
    std::fs::create_dir_all(&data_dir)?;
    // Prefer the shared account key when supplied (and persist it), so this mount
    // decrypts files written by the console/CLI; otherwise use the local ark.key.
    let ark_path = data_dir.join("ark.key");
    let ark = match params.ark_hex.as_deref().and_then(core_crypto::from_hex) {
        Some(b) if b.len() == 32 => {
            let mut a = [0u8; 32];
            a.copy_from_slice(&b);
            write_private(&ark_path, &a)?;
            AccountRootKey::from_bytes(a)
        }
        _ => load_or_create_ark(&ark_path)?,
    };
    let device = load_or_create_device(&data_dir.join("client.key"))?;

    // Build the optional direct-QUIC dial from control-plane-style discovery.
    let mut endpoint: Option<core_net::iroh::Endpoint> = None;
    let iroh = match &params.host_eid {
        Some(eid) if !params.host_addrs.is_empty() => {
            let host_addr = core_net::iroh::endpoint_addr(
                eid,
                &params.host_addrs,
                params.iroh_relay.as_deref(),
            )?;
            let secret = core_net::iroh::secret_from_device(&device);
            let ep = core_net::iroh::bind_endpoint(secret, params.iroh_relay.is_none()).await?;
            endpoint = Some(ep);
            Some((endpoint.as_ref().unwrap(), host_addr))
        }
        _ => None,
    };

    let mut client = client_core::RemoteDrive::connect_auto(
        iroh,
        &params.relay_url,
        &params.account,
        &device,
        &params.host_pub,
        None, // single remote host → the legacy account room (multi-host discovery: 2c)
        params.token.as_deref(),
    )
    .await?;

    // Warm + verify the connection with one round-trip BEFORE we mount: fail fast if
    // the host is unreachable (rather than reporting "Mounted" then erroring), and
    // prime the QUIC path so Finder's first request isn't slow enough to trip
    // webdavfs's "host not responding".
    client
        .quota()
        .await
        .map_err(|e| anyhow!("host not responding — could not reach the drive ({e})"))?;

    let drive: Arc<dyn Drive> = Arc::new(RemoteDrive::new(client, ark));
    finish_mount(drive, mountpoint, endpoint).await
}

// -----------------------------------------------------------------------------------------
// macOS: mount_webdav into a hidden home-directory mountpoint
// -----------------------------------------------------------------------------------------

#[cfg(target_os = "macos")]
mod platform {
    use super::MountState;
    use anyhow::{anyhow, Result};
    use core_webdav::{spawn_server, Drive};
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::time::Duration;

    /// Finder mountpoint. Deliberately under a HIDDEN parent (`~/.sharedock/…`) so
    /// that listing the home folder never stat-probes the mount — on a network drive that
    /// probe storm stalls Finder. We `open` it right after mounting so the user gets a
    /// Finder window; the basename gives it the name "Sharedock".
    ///
    /// Trade-off on "show it in the sidebar Locations": a `mount_webdav` mount at a home
    /// path does NOT appear under Locations, and the two ways to get it there are both
    /// worse — `/Volumes` is root-owned (mount_webdav isn't setuid), and NetFS
    /// (`mount volume`, which DOES populate Locations) pops a credentials dialog on EVERY
    /// mount even for our no-auth server. So we keep the seamless mount + auto-open; a
    /// persistent sidebar pin would need the (deprecated) LSSharedFileList native API.
    pub fn default_mountpoint() -> PathBuf {
        crate::paths::app_dir().join("Sharedock")
    }

    /// Shared tail: spawn the in-process WebDAV server for `drive`, fire `mount_webdav`,
    /// and poll the kernel mount table until the volume appears.
    pub async fn finish_mount(
        drive: Arc<dyn Drive>,
        mountpoint: PathBuf,
        endpoint: Option<core_net::iroh::Endpoint>,
    ) -> Result<MountState> {
        // Local and remote mounts share this mountpoint, so FIRST make sure it's free.
        // A leftover mount (a stale local mount, or a zombie from an abrupt termination)
        // would otherwise shadow this one and Finder would open the WRONG drive's contents.
        for _ in 0..3 {
            if !is_mounted(&mountpoint).await {
                break;
            }
            let _ = unmount(&mountpoint).await;
        }
        if is_mounted(&mountpoint).await {
            return Err(anyhow!(
                "a stale volume is already mounted at {}; unmount it (Finder ⏏) and retry",
                mountpoint.display()
            ));
        }

        let (bound, server) = spawn_server(drive.clone(), ([127, 0, 0, 1], 0).into(), false).await?;
        let port = bound.port();
        let url = format!("http://127.0.0.1:{port}/");

        std::fs::create_dir_all(&mountpoint)?;
        // `mount_webdav` may not RETURN until macOS finishes its (slow) cold-start
        // handshake, even though the volume registers early — so fire it off and poll
        // the kernel mount table for the volume to appear instead of blocking on exit.
        tokio::spawn(run_mount(url.clone(), mountpoint.clone()));

        for _ in 0..40 {
            match mounted_url(&mountpoint).await {
                // OUR server is the one mounted here — success.
                Some(u) if u == url => {
                    // The mountpoint is hidden, so open a Finder window onto it, and pin
                    // it to the Finder sidebar Favorites for one-click access later.
                    let _ = tokio::process::Command::new("open").arg(&mountpoint).spawn();
                    crate::sidebar::add_to_favorites(&mountpoint);
                    return Ok(MountState {
                        mountpoint,
                        url,
                        port,
                        notice: None,
                        server,
                        _drive: drive,
                        _endpoint: endpoint,
                    });
                }
                // A DIFFERENT volume raced in — clear it and re-fire our mount.
                Some(_) => {
                    let _ = unmount(&mountpoint).await;
                    tokio::spawn(run_mount(url.clone(), mountpoint.clone()));
                }
                None => {}
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        server.abort();
        Err(anyhow!("mount did not appear within 20s (a stale mount may be blocking it)"))
    }

    async fn run_mount(url: String, mountpoint: PathBuf) -> Result<()> {
        let out =
            tokio::process::Command::new("mount_webdav").arg(&url).arg(&mountpoint).output().await?;
        if !out.status.success() {
            return Err(anyhow!("mount_webdav failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
        }
        Ok(())
    }

    /// The `http://…` URL of the webdav volume mounted at `mountpoint`, if any. Lets us
    /// tell OUR fresh mount apart from a stale one left at the shared mountpoint (a
    /// leftover local mount, or a zombie from a crash) — matching only the path would
    /// make us "succeed" on the wrong drive and reveal its contents. Reads the kernel
    /// mount table, so it never stats the mount and can't hang on a busy cold-start.
    async fn mounted_url(mountpoint: &Path) -> Option<String> {
        let out = tokio::process::Command::new("mount").output().await.ok()?;
        let needle = format!(" on {} (", mountpoint.display());
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .find(|l| l.contains(&needle) && l.contains("webdav"))
            .and_then(|l| l.split(" on ").next())
            .map(|u| u.trim().to_string())
    }

    /// True if any WebDAV volume is mounted at `mountpoint`.
    async fn is_mounted(mountpoint: &Path) -> bool {
        mounted_url(mountpoint).await.is_some()
    }

    /// Detach the Finder volume. Each attempt is **time-bounded** so the UI never spins
    /// forever (the old unbounded `diskutil unmount force` could hang when the backing
    /// server was already gone). Try a graceful unmount, then a forced one, then
    /// `umount -f` as a last resort; all best-effort.
    pub async fn unmount(mountpoint: &Path) -> Result<()> {
        async fn diskutil(force: bool, mp: &Path, secs: u64) -> bool {
            let mut c = tokio::process::Command::new("diskutil");
            c.arg("unmount");
            if force {
                c.arg("force");
            }
            c.arg(mp);
            matches!(
                tokio::time::timeout(Duration::from_secs(secs), c.output()).await,
                Ok(Ok(o)) if o.status.success()
            )
        }
        // Graceful first — fast for a healthy mount (returns in ~1s).
        if diskutil(false, mountpoint, 6).await {
            return Ok(());
        }
        // Escalate immediately: an abrupt prior termination (crash / force-quit) leaves a
        // wedged `webdavfs_agent` holding the mount, so force-unmount just HANGS until it
        // times out — the "takes forever". Kill that agent (scoped to this mountpoint, so
        // no collateral) FIRST, then force-unmount cleanly.
        let pat = format!("webdavfs_agent.*{}", mountpoint.display());
        let _ = tokio::time::timeout(
            Duration::from_secs(3),
            tokio::process::Command::new("pkill").arg("-f").arg(&pat).output(),
        )
        .await;
        if diskutil(true, mountpoint, 8).await {
            return Ok(());
        }
        let _ = tokio::time::timeout(
            Duration::from_secs(6),
            tokio::process::Command::new("umount").arg("-f").arg(mountpoint).output(),
        )
        .await;
        Ok(())
    }

    /// The WebClient file-size limit is a Windows concern; nothing to raise here.
    pub fn raise_file_limit() -> Result<()> {
        Err(anyhow!("not applicable on this platform"))
    }
}

// -----------------------------------------------------------------------------------------
// Windows: `net use` a drive letter through the WebClient (WebDAV mini-redirector)
// -----------------------------------------------------------------------------------------
//
// Verified on Windows 11: the redirector speaks to our server as a Class 2 client (LOCK /
// UNLOCK via the fake lock system), and a DAV URL trigger-starts the WebClient service when
// it is stopped, so mapping needs no elevation. Two limits are the redirector's, not ours:
// `FileSizeLimitInBytes` (ships at ~50 MB; an HKLM value, so raising it needs admin — see
// `raise_file_limit`) and a hard 4 GB ceiling per file regardless of that setting.

#[cfg(windows)]
mod platform {
    use super::MountState;
    use anyhow::{anyhow, Result};
    use core_webdav::{spawn_server, Drive};
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::time::Duration;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetLogicalDrives() -> u32;
    }

    /// The redirector's hard per-file ceiling, and the highest value the limit accepts.
    pub const FILE_LIMIT_MAX: u64 = 0xFFFF_FFFF;

    /// Is a drive letter in use? From the kernel's bitmask — never by probing the path, which
    /// can hang on a dead network mapping.
    fn taken(letter: char) -> bool {
        // SAFETY: no arguments; returns a bitmask of letters A..Z.
        let mask = unsafe { GetLogicalDrives() };
        mask & (1 << (letter as u8 - b'A')) != 0
    }

    /// `S:` for Sharedock when it is free (or holds a stale mapping of ours), else the highest
    /// free letter — the convention for network drives, and clear of the low letters that
    /// removable media take.
    pub fn default_mountpoint() -> PathBuf {
        let pick = std::iter::once('S')
            .chain(('D'..='Z').rev())
            .find(|&l| !taken(l) || ours_at(l))
            .unwrap_or('S');
        PathBuf::from(format!("{pick}:\\"))
    }

    /// `S:\` → `S:`
    fn letter(mountpoint: &Path) -> String {
        mountpoint.to_string_lossy().chars().take(2).collect()
    }

    /// The UNC the redirector reports for a mapped letter — `\\127.0.0.1@4918\DavWWWRoot` for
    /// ours — or None if the letter is not a network mapping. Found by shape (the only word in
    /// `net use X:` output that starts with `\\`), so it does not depend on the display
    /// language of the labels.
    fn remote_name(letter: &str) -> Option<String> {
        let out = crate::sys::command("net").args(["use", letter]).output().ok()?;
        if !out.status.success() {
            return None;
        }
        String::from_utf8_lossy(&out.stdout)
            .split_whitespace()
            .find(|w| w.starts_with("\\\\"))
            .map(str::to_string)
    }

    fn is_ours(remote: &str) -> bool {
        remote.starts_with("\\\\127.0.0.1@")
    }

    fn ours_at(l: char) -> bool {
        remote_name(&format!("{l}:")).map(|r| is_ours(&r)).unwrap_or(false)
    }

    /// The WebClient per-file limit in bytes, from the registry (`REG_DWORD`, printed as hex).
    fn file_size_limit() -> Option<u64> {
        let out = crate::sys::command("reg")
            .args([
                "query",
                r"HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters",
                "/v",
                "FileSizeLimitInBytes",
            ])
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        let hex = text.split_whitespace().find(|w| w.starts_with("0x"))?;
        u64::from_str_radix(&hex[2..], 16).ok()
    }

    fn file_limit_notice() -> Option<String> {
        let limit = file_size_limit()?;
        if limit >= FILE_LIMIT_MAX {
            return None;
        }
        Some(format!(
            "Windows caps files copied through Explorer at {} MB until its WebDAV limit is raised (needs an administrator). Larger files still work through the app.",
            limit / 1_000_000
        ))
    }

    fn net(args: &[&str]) -> tokio::process::Command {
        let mut cmd = tokio::process::Command::from(crate::sys::command("net"));
        cmd.args(args);
        cmd
    }

    /// Shared tail: spawn the in-process WebDAV server for `drive`, map it to the letter, and
    /// confirm the letter points at OUR server before handing it to the owner.
    pub async fn finish_mount(
        drive: Arc<dyn Drive>,
        mountpoint: PathBuf,
        endpoint: Option<core_net::iroh::Endpoint>,
    ) -> Result<MountState> {
        let l = letter(&mountpoint);
        // A leftover mapping of OURS at this letter (a zombie from an abrupt termination) is
        // cleared; anything else is somebody's drive and we refuse to touch it.
        if let Some(remote) = remote_name(&l) {
            if !is_ours(&remote) {
                return Err(anyhow!("{l} is already mapped to {remote}; free it and retry"));
            }
            unmount(&mountpoint).await?;
        }

        let (bound, server) = spawn_server(drive.clone(), ([127, 0, 0, 1], 0).into(), false).await?;
        let port = bound.port();
        let url = format!("http://127.0.0.1:{port}/");

        // Time-bounded: a wedged redirector would otherwise hang the UI on the button.
        let out = match tokio::time::timeout(
            Duration::from_secs(45),
            net(&["use", &l, &url, "/persistent:no"]).output(),
        )
        .await
        {
            Ok(Ok(o)) => o,
            Ok(Err(e)) => {
                server.abort();
                return Err(anyhow!("net use: {e}"));
            }
            Err(_) => {
                server.abort();
                return Err(anyhow!(
                    "mapping {l} did not finish within 45s (is the WebClient service disabled?)"
                ));
            }
        };
        if !out.status.success() {
            server.abort();
            return Err(anyhow!(
                "could not map {l}: {}{}",
                String::from_utf8_lossy(&out.stdout).trim(),
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        // The letter must now point at THIS server, not a mapping that raced in — matching
        // only the letter would make us "succeed" on the wrong drive and reveal its contents.
        match remote_name(&l) {
            Some(r) if r.starts_with(&format!("\\\\127.0.0.1@{port}\\")) => {}
            other => {
                server.abort();
                return Err(anyhow!("{l} did not map to this drive (got {other:?})"));
            }
        }
        // Open an Explorer window onto it, as the Finder path does.
        let _ = crate::sys::command("explorer.exe").arg(format!("{l}\\")).spawn();
        Ok(MountState {
            mountpoint,
            url,
            port,
            notice: file_limit_notice(),
            server,
            _drive: drive,
            _endpoint: endpoint,
        })
    }

    /// Drop the mapping. Best-effort and time-bounded, like the macOS unmount.
    pub async fn unmount(mountpoint: &Path) -> Result<()> {
        let l = letter(mountpoint);
        let _ = tokio::time::timeout(Duration::from_secs(20), net(&["use", &l, "/delete", "/y"]).output()).await;
        Ok(())
    }

    /// Raise the WebClient per-file limit to its maximum and restart the service so it takes
    /// effect. This is an HKLM write, so it goes through a UAC prompt; the restart drops the
    /// current mapping, and the caller remounts.
    pub fn raise_file_limit() -> Result<()> {
        let script = std::env::temp_dir().join("sharedock-webclient-limit.ps1");
        std::fs::write(
            &script,
            format!(
                "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\WebClient\\Parameters' -Name FileSizeLimitInBytes -Value {FILE_LIMIT_MAX} -Type DWord\nRestart-Service WebClient -Force\n"
            ),
        )?;
        let out = crate::sys::command("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "Start-Process -Verb RunAs -Wait -WindowStyle Hidden powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','\"{}\"'",
                    script.display()
                ),
            ])
            .output()?;
        if !out.status.success() {
            return Err(anyhow!("{}", String::from_utf8_lossy(&out.stderr).trim()));
        }
        match file_size_limit() {
            Some(v) if v >= FILE_LIMIT_MAX => Ok(()),
            other => Err(anyhow!("the limit did not change ({other:?}); the prompt was probably declined")),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn a_mountpoint_is_a_drive_letter() {
            let mp = default_mountpoint();
            let s = mp.to_string_lossy();
            assert_eq!(s.len(), 3, "{s}");
            assert!(s.ends_with(":\\"), "{s}");
            assert_eq!(letter(&mp).len(), 2);
        }

        /// The mountpoint chooser must never hand out a letter that is already a disk.
        #[test]
        fn the_system_drive_is_never_picked() {
            assert!(taken('C'));
            assert_ne!(default_mountpoint().to_string_lossy().chars().next(), Some('C'));
        }

        #[test]
        fn an_unmapped_letter_has_no_remote_name() {
            // Pick a letter that is free per the kernel; `net use` must agree.
            let free = ('D'..='Z').rev().find(|&l| !taken(l)).unwrap();
            assert_eq!(remote_name(&format!("{free}:")), None);
        }

        /// Reads the real value: the test asserts only that the registry is parseable, since
        /// the value itself is whatever the machine has.
        #[test]
        fn the_webclient_limit_is_readable() {
            assert!(file_size_limit().is_some());
        }

        /// The whole Windows mount path, exactly as the button runs it: an in-process WebDAV
        /// server over a fresh local store, `net use` onto a drive letter, a file written and
        /// read back THROUGH THE LETTER by ordinary std::fs, then unmapped. Ignored by default
        /// because it maps a real drive letter on this machine:
        ///
        ///   cargo test --lib -- --ignored mount_round_trip
        #[tokio::test(flavor = "multi_thread")]
        #[ignore]
        async fn mount_round_trip_through_a_drive_letter() {
            let data = std::env::temp_dir().join(format!("sharedock-mount-{}", std::process::id()));
            let mp = default_mountpoint();
            let st = super::super::mount_local(data.clone(), mp.clone(), 1).await.unwrap();
            assert_eq!(st.mountpoint, mp);
            assert!(remote_name(&letter(&mp)).unwrap().contains(&format!("127.0.0.1@{}", st.port)));

            let file = mp.join("round-trip.txt");
            std::fs::write(&file, b"through the redirector").unwrap();
            assert_eq!(std::fs::read(&file).unwrap(), b"through the redirector");
            std::fs::create_dir(mp.join("a folder")).unwrap();
            assert!(mp.join("a folder").is_dir());
            // The plaintext must not be on disk anywhere under the store.
            for entry in walk(&data.join("blobs")) {
                let bytes = std::fs::read(&entry).unwrap();
                assert!(
                    !bytes.windows(22).any(|w| w == b"through the redirector"),
                    "plaintext at rest in {}",
                    entry.display()
                );
            }

            unmount(&mp).await.unwrap();
            st.stop_server();
            assert_eq!(remote_name(&letter(&mp)), None);
            let _ = std::fs::remove_dir_all(&data);
        }

        fn walk(dir: &Path) -> Vec<PathBuf> {
            let mut out = Vec::new();
            if let Ok(rd) = std::fs::read_dir(dir) {
                for e in rd.flatten() {
                    let p = e.path();
                    if p.is_dir() {
                        out.extend(walk(&p));
                    } else {
                        out.push(p);
                    }
                }
            }
            out
        }
    }
}
