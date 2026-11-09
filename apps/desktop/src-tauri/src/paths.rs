//! Canonical on-disk locations for the desktop app, and the one-time move off the
//! pre-rename "Personal Cloud" paths.
//!
//! The app shipped under the working name before it was called Sharedock, so an install
//! may still hold its host identity, license, encrypted store and account root key under
//! `~/.personal-cloud` or `~/Library/Application Support/Personal Cloud`. Every resolver
//! here moves the legacy directory into place on first use, so the rename can never
//! orphan a host that is already serving.

use std::path::PathBuf;

pub fn home() -> PathBuf {
    // Unix spells it HOME; Windows spells it USERPROFILE (HOME is only set under MSYS/Git Bash,
    // and then points somewhere the user would never look).
    ["HOME", "USERPROFILE"]
        .iter()
        .find_map(|k| std::env::var_os(k).map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Windows keeps everything under `%LOCALAPPDATA%\app.sharedock.desktop`: per-user and
/// per-machine (a host's store must not roam with a domain profile), named by the bundle
/// identifier like every Tauri app's data directory. NOT `%LOCALAPPDATA%\Sharedock` — that is
/// where the per-user installer puts the program, and an uninstall or upgrade must never be
/// able to touch a host's store; the uninstaller removes the identifier directory only when
/// the user ticks "delete application data". There is no legacy directory to migrate because
/// the Windows build never shipped under the old name.
#[cfg(windows)]
fn local_app_data() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join("AppData").join("Local"))
        .join("app.sharedock.desktop")
}

/// Move `legacy` onto `new` once, and return whichever path the data actually lives at.
///
/// Best-effort by design. The move can legitimately fail: the encrypted drive mounts
/// *inside* `~/.personal-cloud`, and the kernel holds a mounted directory busy, so an app
/// launched while a stale mount is up cannot rename it. Falling back to the legacy path
/// keeps a working install working and the move is retried on the next launch, which is
/// strictly better than silently starting a second, empty store beside the real one.
#[cfg_attr(windows, allow(dead_code))]
fn resolved(new: PathBuf, legacy: PathBuf) -> PathBuf {
    if new.exists() || !legacy.exists() {
        return new;
    }
    match std::fs::rename(&legacy, &new) {
        Ok(()) => {
            eprintln!("[paths] migrated {} -> {}", legacy.display(), new.display());
            new
        }
        Err(e) => {
            eprintln!("[paths] could not migrate {} ({e}); continuing to use it", legacy.display());
            legacy
        }
    }
}

/// `~/.sharedock` — the host store, and the hidden parent the drive mounts under.
/// (Windows: `%LOCALAPPDATA%\Sharedock`; the drive is a letter there, not a directory.)
pub fn app_dir() -> PathBuf {
    #[cfg(windows)]
    {
        local_app_data()
    }
    #[cfg(not(windows))]
    {
        resolved(home().join(".sharedock"), home().join(".personal-cloud"))
    }
}

/// `~/Library/Application Support/Sharedock` — the desktop's own local drive.
/// (Windows: the same `%LOCALAPPDATA%\Sharedock`; the two roles use different subdirectories.)
pub fn support_dir() -> PathBuf {
    #[cfg(windows)]
    {
        local_app_data()
    }
    #[cfg(not(windows))]
    {
        let support = home().join("Library/Application Support");
        resolved(support.join("Sharedock"), support.join("Personal Cloud"))
    }
}

/// Run both migrations at a predictable point in startup, before anything spawns a daemon
/// against a data directory. Idempotent, and a no-op on a fresh install.
pub fn migrate_legacy() {
    let _ = app_dir();
    let _ = support_dir();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static N: AtomicU32 = AtomicU32::new(0);

    /// A scratch directory unique to one test case, so the cases can run in parallel.
    fn scratch() -> PathBuf {
        let d = std::env::temp_dir()
            .join(format!("sharedock-paths-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// The case that matters: an install that is already a host must come through the
    /// rename still holding its identity, license and store.
    #[test]
    fn moves_a_legacy_directory_with_its_contents() {
        let s = scratch();
        let (new, legacy) = (s.join("Sharedock"), s.join("Personal Cloud"));
        std::fs::create_dir_all(legacy.join("host")).unwrap();
        std::fs::write(legacy.join("host/host.json"), b"{\"account\":\"a\"}").unwrap();

        assert_eq!(resolved(new.clone(), legacy.clone()), new);
        assert_eq!(std::fs::read(new.join("host/host.json")).unwrap(), b"{\"account\":\"a\"}");
        assert!(!legacy.exists(), "the legacy directory is moved, not copied");
    }

    /// Once migrated, a legacy directory that reappears (an older build run again, say) is
    /// left strictly alone rather than merged over live data.
    #[test]
    fn never_merges_onto_an_existing_directory() {
        let s = scratch();
        let (new, legacy) = (s.join("Sharedock"), s.join("Personal Cloud"));
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(new.join("keep"), b"live").unwrap();
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("stale"), b"old").unwrap();

        assert_eq!(resolved(new.clone(), legacy.clone()), new);
        assert_eq!(std::fs::read(new.join("keep")).unwrap(), b"live");
        assert!(!new.join("stale").exists());
        assert!(legacy.exists());
    }

    #[test]
    fn a_fresh_install_migrates_nothing_and_creates_nothing() {
        let s = scratch();
        let new = s.join("Sharedock");
        assert_eq!(resolved(new.clone(), s.join("Personal Cloud")), new);
        assert!(!new.exists(), "resolving a path must not create it");
    }
}
