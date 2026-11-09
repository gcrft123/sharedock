//! Host role: owns the storage partition + metadata store and answers the file
//! RPC. `handle` is the pure request→response core (mapped onto `core-fs`); the
//! network/session layer (see `core-net`) sits in front of it and the relay only
//! ever carries the AEAD-sealed frames.

use anyhow::{Context, Result};
use core_crypto::{AgreementPublic, CryptoResult, DeviceId, DeviceKeypair, SymKey};
use core_fs::{EntryRow, Kind, PutOutcome, Store, UploadBeginOutcome};
use core_proto::{
    ActivityEvent, DirListing, EntryKind, FileEntry, FilePayload, HostStatus, ManifestEntry,
    ObjectExport, Quota, Request, Response,
};
use std::path::PathBuf;
use std::time::Instant;

pub struct HostConfig {
    pub data_dir: PathBuf,
    pub quota_bytes: u64,
}

pub struct HostAgent {
    store: Store,
    device: DeviceKeypair,
    config: HostConfig,
    /// Hard ceiling for `SetQuota` (this host's free disk). The owner may lend up to this —
    /// never more, since you can't store bytes the disk doesn't have. The license is about
    /// how MANY hosts you may pair, not a byte quota, so it never caps a single partition.
    max_quota_bytes: u64,
    /// Physical disk of the data-dir filesystem (0 if detection failed), reported in
    /// HostStatus so the console's allocate slider reflects real capacity.
    disk_avail_bytes: u64,
    disk_total_bytes: u64,
    started: Instant,
    authorized: Vec<DeviceId>,
}

impl HostAgent {
    /// Prepare data dir, open/migrate the metadata DB + blob store, set the quota
    /// cap, and mint a device identity.
    /// Open the store AND set the partition quota from `config` — for the running host.
    pub fn init(config: HostConfig) -> Result<Self> {
        Self::open_inner(config, true)
    }

    /// Open the store READ-ONLY (leaving the persisted quota untouched) — for status queries
    /// that share the data dir with a running daemon and must never clobber its quota.
    pub fn open(config: HostConfig) -> Result<Self> {
        Self::open_inner(config, false)
    }

    fn open_inner(config: HostConfig, set_initial_quota: bool) -> Result<Self> {
        std::fs::create_dir_all(&config.data_dir)?;
        let store = Store::open(&config.data_dir.join("meta.db"), &config.data_dir.join("blobs"))
            .context("open store")?;
        let device = load_or_create_device(&config.data_dir)?;

        // The partition can't exceed the host's free disk. If detection fails (0), don't
        // clamp — fall back to the requested quota so the host still serves.
        let (disk_avail_bytes, disk_total_bytes) = disk_space(&config.data_dir);
        let max_quota_bytes = if disk_avail_bytes > 0 { disk_avail_bytes } else { config.quota_bytes };
        if set_initial_quota {
            store.set_quota(config.quota_bytes.min(max_quota_bytes))?;
        }

        Ok(Self {
            store,
            device,
            config,
            max_quota_bytes,
            disk_avail_bytes,
            disk_total_bytes,
            started: Instant::now(),
            authorized: Vec::new(),
        })
    }

    // ---- identity / auth (used by the session handshake) ----

    /// Update the storage quota cap — e.g. after the license is obtained during onboarding
    /// (the host is created with a placeholder quota before it knows its license).
    pub fn set_quota(&self, bytes: u64) -> Result<()> {
        self.store.set_quota(bytes)
    }

    /// The current partition quota cap in bytes (published to the control plane so clients
    /// can do multi-host capacity math).
    pub fn quota_bytes(&self) -> u64 {
        self.store.quota().map(|q| q.quota_bytes).unwrap_or(0)
    }

    /// This host's free disk in bytes (0 if detection failed) — the ceiling on how much it
    /// can lend, published so the console's allocate slider reflects real capacity.
    pub fn disk_avail_bytes(&self) -> u64 {
        self.disk_avail_bytes
    }

    /// Override the `SetQuota` ceiling (normally the free disk, set in `init`). Used by tests
    /// to pin a deterministic ceiling regardless of the runner's real disk.
    pub fn set_max_quota(&mut self, bytes: u64) {
        self.max_quota_bytes = bytes;
    }

    pub fn device_id(&self) -> DeviceId {
        self.device.id
    }
    pub fn agreement_public(&self) -> AgreementPublic {
        self.device.agreement_public()
    }
    /// Unwrap a session key sealed to this host's agreement key.
    pub fn open_sealed(&self, blob: &[u8]) -> CryptoResult<SymKey> {
        self.device.open_sealed(blob)
    }
    pub fn authorize_client(&mut self, id: DeviceId) {
        if !self.authorized.contains(&id) {
            self.authorized.push(id);
        }
    }
    pub fn is_authorized(&self, id: &DeviceId) -> bool {
        self.authorized.contains(id)
    }

    pub fn status_line(&self) -> Result<String> {
        let q = self.store.quota()?;
        let mib = 1024 * 1024;
        Ok(format!(
            "host {} · partition {}/{} MiB used · data {}",
            self.device.id.short(),
            q.committed_bytes / mib,
            q.quota_bytes / mib,
            self.config.data_dir.display(),
        ))
    }

    // ---- the RPC core ----

    /// Append an activity-log event (best-effort; a log failure never fails the RPC).
    fn log(&self, kind: &str, detail: impl Into<String>) {
        let _ = self.store.log_activity(kind, "client", &detail.into());
    }

    pub fn handle(&self, req: Request) -> Response {
        match req {
            Request::ListDir { path } => match self.store.list(&path) {
                Ok(rows) => Response::DirListing(DirListing {
                    path,
                    entries: rows.into_iter().map(to_entry).collect(),
                }),
                Err(e) => Response::error(e.to_string()),
            },
            Request::Stat { id } => match self.store.stat(&id) {
                Ok(Some(e)) => Response::Entry(to_entry(e)),
                Ok(None) => Response::error("not found"),
                Err(e) => Response::error(e.to_string()),
            },
            Request::Mkdir { parent, name } => match self.store.mkdir(&parent, &name) {
                Ok(_) => {
                    self.log("system", format!("New folder {name}"));
                    Response::Ok
                }
                Err(e) => Response::error(e.to_string()),
            },
            Request::Rename { from, to_parent, to_name } => {
                match self.store.rename(&from, &to_parent, &to_name) {
                    Ok(()) => Response::Ok,
                    Err(e) => Response::error(e.to_string()),
                }
            }
            Request::Delete { id } => match self.store.delete(&id) {
                Ok(()) => {
                    self.log("delete", split_parent_name(&id).1);
                    Response::Ok
                }
                Err(e) => Response::error(e.to_string()),
            },

            // --- star + soft-trash ---
            Request::Star { id, on } => match self.store.set_star(&id, on) {
                Ok(()) => Response::Ok,
                Err(e) => Response::error(e.to_string()),
            },
            Request::Trash { id } => match self.store.trash(&id) {
                Ok(()) => {
                    self.log("delete", format!("Trashed {}", split_parent_name(&id).1));
                    Response::Ok
                }
                Err(e) => Response::error(e.to_string()),
            },
            Request::Restore { id } => match self.store.restore(&id) {
                Ok(()) => Response::Ok,
                Err(e) => Response::error(e.to_string()),
            },
            Request::EmptyTrash => match self.store.empty_trash() {
                Ok(()) => Response::Ok,
                Err(e) => Response::error(e.to_string()),
            },
            Request::ListTrash => match self.store.list_trash() {
                Ok(rows) => Response::DirListing(DirListing {
                    path: "trash".to_string(),
                    entries: rows.into_iter().map(to_entry).collect(),
                }),
                Err(e) => Response::error(e.to_string()),
            },

            // --- global views ---
            Request::RewrapKey { id, wrapped_ck } => {
                match self.store.rewrap_current_version(&id, &wrapped_ck) {
                    Ok(()) => Response::Ok,
                    Err(e) => Response::Error { message: e.to_string() },
                }
            }
            Request::Search { query } => match self.store.search(&query) {
                Ok(rows) => Response::DirListing(DirListing {
                    path: "search".to_string(),
                    entries: rows.into_iter().map(to_entry).collect(),
                }),
                Err(e) => Response::error(e.to_string()),
            },
            Request::ListStarred => match self.store.list_starred() {
                Ok(rows) => Response::DirListing(DirListing {
                    path: "starred".to_string(),
                    entries: rows.into_iter().map(to_entry).collect(),
                }),
                Err(e) => Response::error(e.to_string()),
            },
            Request::ListRecent { limit } => match self.store.list_recent(limit) {
                Ok(rows) => Response::DirListing(DirListing {
                    path: "recent".to_string(),
                    entries: rows.into_iter().map(to_entry).collect(),
                }),
                Err(e) => Response::error(e.to_string()),
            },
            Request::GetActivity { limit } => match self.store.list_activity(limit) {
                Ok(rows) => Response::Activity {
                    events: rows
                        .into_iter()
                        .map(|a| ActivityEvent { id: a.id, ts: a.ts, kind: a.kind, actor: a.actor, detail: a.detail })
                        .collect(),
                },
                Err(e) => Response::error(e.to_string()),
            },

            Request::GetQuota => match self.quota() {
                Ok(q) => Response::Quota(q),
                Err(e) => Response::error(e.to_string()),
            },
            // The owner's partition allocation. Clamp to the license ceiling (a client must
            // never grant itself more than was paid for), then report the resulting quota.
            Request::SetQuota { quota_bytes } => {
                let capped = quota_bytes.min(self.max_quota_bytes);
                match self.set_quota(capped).and_then(|_| self.quota()) {
                    Ok(q) => Response::Quota(q),
                    Err(e) => Response::error(e.to_string()),
                }
            }
            Request::GetHostStatus => Response::HostStatus(self.status()),
            Request::PutFile { parent, name, payload } => {
                match self.store.put_file(
                    &parent,
                    &name,
                    payload.plaintext_len,
                    &payload.wrapped_ck,
                    &payload.ciphertext,
                ) {
                    Ok(PutOutcome::Stored { id }) => match self.store.stat(&id) {
                        Ok(Some(e)) => Response::Entry(to_entry(e)),
                        _ => Response::Ok,
                    },
                    Ok(PutOutcome::QuotaExceeded { needed, available }) => {
                        Response::QuotaExceeded { needed, available }
                    }
                    Err(e) => Response::error(e.to_string()),
                }
            }
            Request::ReadFile { id } => match self.store.read_file(&id) {
                Ok(Some(fd)) => Response::File(FilePayload {
                    wrapped_ck: fd.wrapped_ck,
                    plaintext_len: fd.plaintext_len,
                    ciphertext: fd.ciphertext,
                }),
                Ok(None) => Response::error("not found"),
                Err(e) => Response::error(e.to_string()),
            },

            // --- chunked/streamed transfer ---
            Request::UploadBegin { parent, name, plaintext_len, wrapped_ck } => {
                match self.store.begin_upload(&parent, &name, plaintext_len, &wrapped_ck) {
                    Ok(UploadBeginOutcome::Started { upload_id }) => Response::UploadStarted { upload_id },
                    Ok(UploadBeginOutcome::QuotaExceeded { needed, available }) => Response::QuotaExceeded { needed, available },
                    Err(e) => Response::error(e.to_string()),
                }
            }
            Request::UploadChunk { upload_id, ciphertext } => match self.store.upload_chunk(&upload_id, &ciphertext) {
                Ok(()) => Response::Ok,
                Err(e) => Response::error(e.to_string()),
            },
            Request::UploadCommit { upload_id } => match self.store.commit_upload(&upload_id) {
                Ok(id) => {
                    self.log("upload", split_parent_name(&id).1);
                    match self.store.stat(&id) {
                        Ok(Some(e)) => Response::Entry(to_entry(e)),
                        _ => Response::Ok,
                    }
                }
                Err(e) => Response::error(e.to_string()),
            },
            Request::UploadAbort { upload_id } => match self.store.abort_upload(&upload_id) {
                Ok(()) => Response::Ok,
                Err(e) => Response::error(e.to_string()),
            },
            Request::ReadBegin { id } => match self.store.begin_read(&id) {
                Ok(Some(info)) => {
                    self.log("download", split_parent_name(&id).1);
                    Response::FileInfo {
                        wrapped_ck: info.wrapped_ck,
                        plaintext_len: info.plaintext_len,
                        chunk_count: info.chunk_count,
                    }
                }
                Ok(None) => Response::error("not found"),
                Err(e) => Response::error(e.to_string()),
            },
            Request::ReadChunk { id, seq } => match self.store.read_chunk(&id, seq) {
                Ok(Some(ct)) => Response::Chunk { ciphertext: ct },
                Ok(None) => Response::error("chunk not found"),
                Err(e) => Response::error(e.to_string()),
            },

            // --- host-to-host mirror replication (a peer host asks) ---
            Request::ListManifest => match self.manifest() {
                Ok(entries) => Response::Manifest { entries },
                Err(e) => Response::error(e.to_string()),
            },
            Request::ImportObject { export } => self.apply_import(export),
        }
    }

    /// This host's full object manifest — live objects PLUS deletion tombstones — the
    /// input to mirror anti-entropy diffing.
    pub fn manifest(&self) -> Result<Vec<ManifestEntry>> {
        let mut entries: Vec<ManifestEntry> = self
            .store
            .manifest()?
            .into_iter()
            .map(|r| ManifestEntry {
                id: r.id,
                kind: kind_to_proto(r.kind),
                mtime: r.mtime,
                size_bytes: r.size_plain,
                deleted: false,
                starred: r.starred,
                trashed_at: r.trashed_at,
            })
            .collect();
        for (id, deleted_at) in self.store.tombstones()? {
            entries.push(ManifestEntry {
                id,
                kind: EntryKind::File,
                mtime: deleted_at,
                size_bytes: 0,
                deleted: true,
                starred: false,
                trashed_at: None,
            });
        }
        Ok(entries)
    }

    /// Export one object to ship to a peer: a live object (metadata + exact ciphertext for
    /// a file), or a **tombstone** (`deleted = true`) if the id was deleted. `None` if the
    /// id was never seen.
    pub fn export_object(&self, id: &str) -> Result<Option<ObjectExport>> {
        if let Some(e) = self.store.stat(id)? {
            let (parent, name) = split_parent_name(&e.id);
            let file = match e.kind {
                Kind::Dir => None,
                Kind::File => {
                    let fd = self.store.read_file(&e.id)?.context("file vanished during export")?;
                    Some(FilePayload {
                        wrapped_ck: fd.wrapped_ck,
                        plaintext_len: fd.plaintext_len,
                        ciphertext: fd.ciphertext,
                    })
                }
            };
            return Ok(Some(ObjectExport {
                id: e.id,
                parent,
                name,
                kind: kind_to_proto(e.kind),
                mtime: e.mtime,
                file,
                deleted: false,
                starred: e.starred,
                trashed_at: e.trashed_at,
            }));
        }
        if let Some((deleted_at, true)) = self.store.object_state(id)? {
            let (parent, name) = split_parent_name(id);
            return Ok(Some(ObjectExport {
                id: id.to_string(),
                parent,
                name,
                kind: EntryKind::File,
                mtime: deleted_at,
                file: None,
                deleted: true,
                starred: false,
                trashed_at: None,
            }));
        }
        Ok(None)
    }

    /// Apply a peer's pushed object or tombstone, keeping the newer copy (mtime LWW). Star +
    /// trash state ride along: since they don't bump mtime, a state-only change is converged
    /// even when content is same-or-newer locally.
    fn apply_import(&self, export: ObjectExport) -> Response {
        let local = self.store.stat(&export.id).ok().flatten();
        // LWW over BOTH live objects and tombstones: keep our content if same-or-newer.
        if let Ok(Some((local_mtime, _))) = self.store.object_state(&export.id) {
            if local_mtime >= export.mtime {
                // Content stays, but converge star/trash on a still-live local object.
                if let Some(l) = &local {
                    if !export.deleted && (l.starred != export.starred || l.trashed_at != export.trashed_at) {
                        let _ = self.store.apply_star_trash(&export.id, export.starred, export.trashed_at);
                    }
                }
                return Response::Ok;
            }
        }
        if export.deleted {
            return match self.store.apply_remote_delete(&export.id, export.mtime) {
                Ok(_) => Response::Ok, // applied, or deferred (non-empty dir) — both fine
                Err(e) => Response::error(e.to_string()),
            };
        }
        let applied = match export.kind {
            EntryKind::Dir => self.store.mkdir_at(&export.parent, &export.name, export.mtime).map(|_| ()),
            EntryKind::File => {
                let Some(file) = export.file.as_ref() else {
                    return Response::error("file export missing payload");
                };
                match self.store.put_file_at(
                    &export.parent,
                    &export.name,
                    file.plaintext_len,
                    &file.wrapped_ck,
                    &file.ciphertext,
                    export.mtime,
                ) {
                    Ok(PutOutcome::Stored { .. }) => Ok(()),
                    Ok(PutOutcome::QuotaExceeded { needed, available }) => {
                        return Response::QuotaExceeded { needed, available }
                    }
                    Err(e) => return Response::error(e.to_string()),
                }
            }
        };
        match applied {
            // Carry the peer's star/trash state onto the freshly-applied object.
            Ok(()) => {
                let _ = self.store.apply_star_trash(&export.id, export.starred, export.trashed_at);
                Response::Ok
            }
            Err(e) => Response::error(e.to_string()),
        }
    }

    fn quota(&self) -> Result<Quota> {
        let q = self.store.quota()?;
        Ok(Quota {
            used_bytes: q.committed_bytes,
            quota_bytes: q.quota_bytes,
            file_count: self.store.file_count()?,
        })
    }

    fn status(&self) -> HostStatus {
        HostStatus {
            host_id: self.device.id.short(),
            machine_name: std::env::var("HOSTNAME").unwrap_or_else(|_| "host".to_string()),
            os: std::env::consts::OS.to_string(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            online: true,
            uptime_secs: self.started.elapsed().as_secs(),
            disk_free_bytes: self.disk_avail_bytes,
            disk_total_bytes: self.disk_total_bytes,
        }
    }
}

/// Free (available) bytes on the filesystem holding `path`. Implemented via `statvfs`
/// (unix) or `GetDiskFreeSpaceExW` (Windows); `0` = unknown (the query failed, or an
/// unsupported target). Public wrapper over `disk_space` for the desktop app's
/// "free space on this device" chip.
pub fn free_bytes(path: &std::path::Path) -> u64 {
    disk_space(path).0
}

/// Free + total bytes of the filesystem holding `path`. Uses `statvfs` on unix and
/// `GetDiskFreeSpaceExW` on Windows; returns `(0, 0)` if the query fails or the target is
/// neither — callers treat 0 as "unknown, don't clamp".
fn disk_space(path: &std::path::Path) -> (u64, u64) {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let Ok(c) = std::ffi::CString::new(path.as_os_str().as_bytes()) else { return (0, 0) };
        // SAFETY: `c` is a valid NUL-terminated path; `stat` is zeroed before the call and
        // only read after a success (return 0).
        unsafe {
            let mut stat: libc::statvfs = std::mem::zeroed();
            if libc::statvfs(c.as_ptr(), &mut stat) != 0 {
                return (0, 0);
            }
            let unit = stat.f_frsize as u64;
            let avail = (stat.f_bavail as u64).saturating_mul(unit);
            let total = (stat.f_blocks as u64).saturating_mul(unit);
            (avail, total)
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        // kernel32 is always linked into a Windows process; declare the one call we need
        // rather than pull a Windows-bindings crate for a single syscall (this mirrors the
        // unix `libc` gate). Signature per the Win32 `GetDiskFreeSpaceExW` docs — each
        // `PULARGE_INTEGER` out-param is a `u64`, `BOOL` is a nonzero-on-success `i32`.
        #[link(name = "kernel32")]
        extern "system" {
            fn GetDiskFreeSpaceExW(
                lp_directory_name: *const u16,
                lp_free_bytes_available_to_caller: *mut u64,
                lp_total_number_of_bytes: *mut u64,
                lp_total_number_of_free_bytes: *mut u64,
            ) -> i32;
        }
        // A NUL-terminated UTF-16 path; the API accepts a directory and reports the volume
        // that contains it.
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let mut avail: u64 = 0; // free bytes usable by the calling user (respects quotas)
        let mut total: u64 = 0; // total size of the volume
        let mut total_free: u64 = 0; // volume-wide free (unused, but the API wants a ptr)
        // SAFETY: `wide` is a valid NUL-terminated UTF-16 path; the three out-params are
        // valid `u64`s written only when the call succeeds (a nonzero return).
        let ok = unsafe {
            GetDiskFreeSpaceExW(wide.as_ptr(), &mut avail, &mut total, &mut total_free)
        };
        if ok == 0 {
            return (0, 0);
        }
        (avail, total)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
        (0, 0)
    }
}

/// Load a persisted device identity from `data_dir/identity.key`, or mint + save
/// one. Persisting keeps the host's pubkey stable across restarts so paired
/// clients keep working. (Dev daemon writes a 0600 file; the real build uses the
/// OS keychain.)
fn load_or_create_device(data_dir: &std::path::Path) -> Result<DeviceKeypair> {
    let path = data_dir.join("identity.key");
    if let Ok(bytes) = std::fs::read(&path) {
        if bytes.len() == 64 {
            let mut arr = [0u8; 64];
            arr.copy_from_slice(&bytes);
            return Ok(DeviceKeypair::from_bytes(&arr));
        }
    }
    let kp = DeviceKeypair::generate();
    core_fs::write_private(&path, &kp.to_bytes())?;
    Ok(kp)
}

/// Anti-entropy diff: which of `local`'s manifest entries (objects AND tombstones) to
/// push to a peer whose manifest is `peer` — those the peer lacks or holds with an OLDER
/// mtime (last-writer-wins). A live object is pushed even if the peer has never seen it; a
/// tombstone is pushed only when the peer still holds an older copy of that id (no point
/// telling a peer to delete something it never had). Sorted by id so a parent directory is
/// pushed before its children.
pub fn objects_to_push(local: &[ManifestEntry], peer: &[ManifestEntry]) -> Vec<String> {
    use std::collections::HashMap;
    let peer_map: HashMap<&str, &ManifestEntry> = peer.iter().map(|e| (e.id.as_str(), e)).collect();
    let mut ids: Vec<String> = local
        .iter()
        .filter(|e| match peer_map.get(e.id.as_str()) {
            // newer content, OR same content but diverged star/trash state → push
            Some(p) => {
                e.mtime > p.mtime
                    || (e.mtime == p.mtime
                        && !e.deleted
                        && (e.starred != p.starred || e.trashed_at != p.trashed_at))
            }
            None => !e.deleted, // peer never saw it: push a live object, not a tombstone
        })
        .map(|e| e.id.clone())
        .collect();
    ids.sort();
    ids
}

fn kind_to_proto(k: Kind) -> EntryKind {
    match k {
        Kind::File => EntryKind::File,
        Kind::Dir => EntryKind::Dir,
    }
}

/// Split a normalized path id into `(parent, name)`: `/a/b -> ("/a","b")`, `/x -> ("/","x")`.
fn split_parent_name(id: &str) -> (String, String) {
    let trimmed = id.trim_end_matches('/');
    match trimmed.rsplit_once('/') {
        Some(("", name)) => ("/".to_string(), name.to_string()),
        Some((parent, name)) => (parent.to_string(), name.to_string()),
        None => ("/".to_string(), trimmed.to_string()),
    }
}

fn to_entry(e: EntryRow) -> FileEntry {
    FileEntry {
        // `fs_object.id` is the normalized path, so the two are the same string here. They
        // are still sent as separate fields: clients treat the id as opaque.
        path: e.id.clone(),
        id: e.id,
        name: e.name,
        kind: kind_to_proto(e.kind),
        size_bytes: e.size_plain,
        modified: e.mtime,
        starred: e.starred,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

    fn agent() -> HostAgent {
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("pc-host-test-{}-{}", std::process::id(), n));
        HostAgent::init(HostConfig { data_dir: dir, quota_bytes: 10_000 }).unwrap()
    }

    #[test]
    fn handle_mkdir_put_list_read() {
        let a = agent();
        assert!(matches!(a.handle(Request::Mkdir { parent: "/".into(), name: "Docs".into() }), Response::Ok));

        let payload = FilePayload { wrapped_ck: b"wk".to_vec(), plaintext_len: 500, ciphertext: vec![3u8; 800] };
        let put = a.handle(Request::PutFile { parent: "/Docs".into(), name: "a.bin".into(), payload });
        assert!(matches!(put, Response::Entry(_)));

        match a.handle(Request::ListDir { path: "/Docs".into() }) {
            Response::DirListing(d) => {
                assert_eq!(d.entries.len(), 1);
                assert_eq!(d.entries[0].name, "a.bin");
            }
            other => panic!("unexpected {other:?}"),
        }

        match a.handle(Request::ReadFile { id: "/Docs/a.bin".into() }) {
            Response::File(f) => {
                assert_eq!(f.ciphertext, vec![3u8; 800]);
                assert_eq!(f.wrapped_ck, b"wk");
                assert_eq!(f.plaintext_len, 500);
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn handle_star_trash_restore_empty() {
        let a = agent();
        a.handle(Request::Mkdir { parent: "/".into(), name: "d".into() });
        let payload = FilePayload { wrapped_ck: b"k".to_vec(), plaintext_len: 100, ciphertext: vec![5u8; 150] };
        a.handle(Request::PutFile { parent: "/d".into(), name: "f.bin".into(), payload });

        // star surfaces on the listing
        assert!(matches!(a.handle(Request::Star { id: "/d/f.bin".into(), on: true }), Response::Ok));
        match a.handle(Request::ListDir { path: "/d".into() }) {
            Response::DirListing(l) => assert!(l.entries[0].starred),
            other => panic!("unexpected {other:?}"),
        }

        // trash hides from the parent listing, surfaces in ListTrash
        assert!(matches!(a.handle(Request::Trash { id: "/d".into() }), Response::Ok));
        match a.handle(Request::ListDir { path: "/".into() }) {
            Response::DirListing(l) => assert!(l.entries.iter().all(|e| e.name != "d")),
            other => panic!("unexpected {other:?}"),
        }
        match a.handle(Request::ListTrash) {
            Response::DirListing(l) => {
                assert_eq!(l.entries.len(), 1);
                assert_eq!(l.entries[0].name, "d");
            }
            other => panic!("unexpected {other:?}"),
        }

        // restore brings it back
        assert!(matches!(a.handle(Request::Restore { id: "/d".into() }), Response::Ok));
        match a.handle(Request::ListDir { path: "/".into() }) {
            Response::DirListing(l) => assert!(l.entries.iter().any(|e| e.name == "d")),
            other => panic!("unexpected {other:?}"),
        }

        // trash again, then empty purges it and frees quota
        a.handle(Request::Trash { id: "/d".into() });
        assert!(matches!(a.handle(Request::EmptyTrash), Response::Ok));
        assert!(matches!(a.handle(Request::Stat { id: "/d".into() }), Response::Error { .. }));
        match a.handle(Request::GetQuota) {
            Response::Quota(q) => assert_eq!(q.used_bytes, 0),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn set_quota_applies_and_clamps_to_ceiling() {
        let mut a = agent(); // starts with quota_bytes = 10_000 (also the ceiling placeholder)
        a.set_max_quota(10_000); // license ceiling

        // Lowering the allocation is honored and reflected by GetQuota.
        match a.handle(Request::SetQuota { quota_bytes: 4_000 }) {
            Response::Quota(q) => assert_eq!(q.quota_bytes, 4_000),
            other => panic!("unexpected {other:?}"),
        }
        match a.handle(Request::GetQuota) {
            Response::Quota(q) => assert_eq!(q.quota_bytes, 4_000),
            other => panic!("unexpected {other:?}"),
        }

        // Asking for MORE than the license ceiling is clamped down — a client can't grant
        // itself extra storage.
        match a.handle(Request::SetQuota { quota_bytes: 999_999 }) {
            Response::Quota(q) => assert_eq!(q.quota_bytes, 10_000),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn handle_quota_exceeded() {
        let a = agent();
        let payload = FilePayload { wrapped_ck: b"k".to_vec(), plaintext_len: 20_000, ciphertext: vec![0u8; 100] };
        let put = a.handle(Request::PutFile { parent: "/".into(), name: "big".into(), payload });
        assert!(matches!(put, Response::QuotaExceeded { .. }));
    }

    fn obj(id: &str, mtime: i64) -> ManifestEntry {
        ManifestEntry {
            id: id.into(),
            kind: EntryKind::File,
            mtime,
            size_bytes: 5,
            deleted: false,
            starred: false,
            trashed_at: None,
        }
    }
    fn tomb(id: &str, mtime: i64) -> ManifestEntry {
        ManifestEntry {
            id: id.into(),
            kind: EntryKind::File,
            mtime,
            size_bytes: 0,
            deleted: true,
            starred: false,
            trashed_at: None,
        }
    }

    #[test]
    fn objects_to_push_diffs_by_mtime() {
        let local = vec![obj("/a", 10), obj("/a/x", 20), obj("/a/y", 30)];
        let peer = vec![
            obj("/a", 10),   // equal — skip
            obj("/a/x", 15), // older on peer — push
            // /a/y absent on peer — push (a live object)
        ];
        assert_eq!(objects_to_push(&local, &peer), vec!["/a/x".to_string(), "/a/y".to_string()]);
    }

    #[test]
    fn objects_to_push_handles_tombstones() {
        // Local has a tombstone newer than the peer's live copy → push it (peer will delete).
        let local = vec![tomb("/gone", 50), tomb("/never-elsewhere", 40)];
        let peer = vec![obj("/gone", 30)];
        // /gone: peer holds an older live copy → push the tombstone.
        // /never-elsewhere: peer never saw it → don't push a tombstone for it.
        assert_eq!(objects_to_push(&local, &peer), vec!["/gone".to_string()]);

        // A tombstone OLDER than the peer's live copy (a re-create won) is not pushed.
        let local2 = vec![tomb("/gone", 20)];
        let peer2 = vec![obj("/gone", 30)];
        assert!(objects_to_push(&local2, &peer2).is_empty());
    }

    #[test]
    fn mirror_propagates_deletes_without_resurrection() {
        let a = agent();
        let b = agent();
        let sync = |from: &HostAgent, to: &HostAgent| {
            for id in objects_to_push(&from.manifest().unwrap(), &to.manifest().unwrap()) {
                if let Some(export) = from.export_object(&id).unwrap() {
                    assert!(matches!(to.handle(Request::ImportObject { export }), Response::Ok));
                }
            }
        };
        let payload = FilePayload { wrapped_ck: b"k".to_vec(), plaintext_len: 10, ciphertext: vec![1u8; 20] };
        a.handle(Request::PutFile { parent: "/".into(), name: "f.bin".into(), payload });
        sync(&a, &b);
        assert!(matches!(b.handle(Request::Stat { id: "/f.bin".into() }), Response::Entry(_)));

        // A deletes the file; B is "offline" and still holds it.
        std::thread::sleep(std::time::Duration::from_millis(3));
        assert!(matches!(a.handle(Request::Delete { id: "/f.bin".into() }), Response::Ok));

        // Resurrection guard: B (still holding the file) syncing to A must NOT recreate it —
        // A holds a newer tombstone.
        sync(&b, &a);
        assert!(
            matches!(a.handle(Request::Stat { id: "/f.bin".into() }), Response::Error { .. }),
            "A must stay deleted (no resurrection from B's stale copy)"
        );

        // A syncing to B propagates the delete (the tombstone wins over B's older copy).
        sync(&a, &b);
        assert!(
            matches!(b.handle(Request::Stat { id: "/f.bin".into() }), Response::Error { .. }),
            "B should have applied the delete"
        );

        // Fully converged in both directions.
        assert!(objects_to_push(&a.manifest().unwrap(), &b.manifest().unwrap()).is_empty());
        assert!(objects_to_push(&b.manifest().unwrap(), &a.manifest().unwrap()).is_empty());
    }

    #[test]
    fn mirror_converges_star_and_trash() {
        let a = agent();
        let b = agent();
        let sync = |from: &HostAgent, to: &HostAgent| {
            for id in objects_to_push(&from.manifest().unwrap(), &to.manifest().unwrap()) {
                if let Some(export) = from.export_object(&id).unwrap() {
                    assert!(matches!(to.handle(Request::ImportObject { export }), Response::Ok));
                }
            }
        };
        let payload = FilePayload { wrapped_ck: b"k".to_vec(), plaintext_len: 10, ciphertext: vec![1u8; 20] };
        a.handle(Request::PutFile { parent: "/".into(), name: "f.bin".into(), payload });
        sync(&a, &b);
        assert!(matches!(b.handle(Request::Stat { id: "/f.bin".into() }), Response::Entry(_)));

        // Starring on A does NOT bump mtime, yet still propagates via the state-diff push.
        assert!(matches!(a.handle(Request::Star { id: "/f.bin".into(), on: true }), Response::Ok));
        sync(&a, &b);
        match b.handle(Request::ListDir { path: "/".into() }) {
            Response::DirListing(l) => assert!(l.entries.iter().find(|e| e.name == "f.bin").unwrap().starred),
            other => panic!("unexpected {other:?}"),
        }
        assert!(objects_to_push(&a.manifest().unwrap(), &b.manifest().unwrap()).is_empty(), "converged after star");

        // Trashing on A propagates: B hides it from listings and surfaces it in trash.
        assert!(matches!(a.handle(Request::Trash { id: "/f.bin".into() }), Response::Ok));
        sync(&a, &b);
        match b.handle(Request::ListDir { path: "/".into() }) {
            Response::DirListing(l) => assert!(l.entries.iter().all(|e| e.name != "f.bin")),
            other => panic!("unexpected {other:?}"),
        }
        match b.handle(Request::ListTrash) {
            Response::DirListing(l) => assert_eq!(l.entries.len(), 1),
            other => panic!("unexpected {other:?}"),
        }
        assert!(objects_to_push(&a.manifest().unwrap(), &b.manifest().unwrap()).is_empty(), "converged after trash");
    }

    #[test]
    fn handle_search_starred_recent_activity() {
        let a = agent();
        a.handle(Request::Mkdir { parent: "/".into(), name: "Docs".into() });
        let p1 = FilePayload { wrapped_ck: b"k".to_vec(), plaintext_len: 10, ciphertext: vec![1u8; 12] };
        a.handle(Request::PutFile { parent: "/Docs".into(), name: "report.pdf".into(), payload: p1 });
        let p2 = FilePayload { wrapped_ck: b"k".to_vec(), plaintext_len: 5, ciphertext: vec![2u8; 6] };
        a.handle(Request::PutFile { parent: "/".into(), name: "photo.jpg".into(), payload: p2 });
        a.handle(Request::Star { id: "/photo.jpg".into(), on: true });

        match a.handle(Request::Search { query: "report".into() }) {
            Response::DirListing(l) => { assert_eq!(l.entries.len(), 1); assert_eq!(l.entries[0].name, "report.pdf"); }
            other => panic!("unexpected {other:?}"),
        }
        match a.handle(Request::ListStarred) {
            Response::DirListing(l) => { assert_eq!(l.entries.len(), 1); assert_eq!(l.entries[0].name, "photo.jpg"); }
            other => panic!("unexpected {other:?}"),
        }
        match a.handle(Request::ListRecent { limit: 10 }) {
            Response::DirListing(l) => assert_eq!(l.entries.len(), 2), // two files, no dirs
            other => panic!("unexpected {other:?}"),
        }
        // activity log captured the uploads (via UploadCommit is chunked; PutFile is not logged,
        // so drive a chunked download to log one event)
        match a.handle(Request::ReadBegin { id: "/photo.jpg".into() }) {
            Response::FileInfo { .. } => {}
            other => panic!("unexpected {other:?}"),
        }
        match a.handle(Request::GetActivity { limit: 10 }) {
            Response::Activity { events } => {
                assert!(events.iter().any(|e| e.kind == "download" && e.detail == "photo.jpg"));
                assert!(events.iter().any(|e| e.kind == "system")); // the Mkdir
            }
            other => panic!("unexpected {other:?}"),
        }
    }


    /// Every entry carries its full path, which is what lets a result found in a global view
    /// be renamed, opened in its folder, or downloaded with its subtree. Without it those
    /// actions silently do not exist in Recent, Starred and Search.
    #[test]
    fn entries_carry_their_path_in_every_view() {
        let a = agent();
        a.handle(Request::Mkdir { parent: "/".into(), name: "Docs".into() });
        a.handle(Request::Mkdir { parent: "/Docs".into(), name: "2026".into() });
        let p = FilePayload { wrapped_ck: b"k".to_vec(), plaintext_len: 10, ciphertext: vec![1u8; 12] };
        a.handle(Request::PutFile { parent: "/Docs/2026".into(), name: "report.pdf".into(), payload: p });
        a.handle(Request::Star { id: "/Docs/2026/report.pdf".into(), on: true });

        let want = "/Docs/2026/report.pdf";
        let path_of = |r: Response| -> String {
            match r {
                Response::DirListing(l) => l
                    .entries
                    .iter()
                    .find(|e| e.name == "report.pdf")
                    .map(|e| e.path.clone())
                    .unwrap_or_default(),
                other => panic!("unexpected {other:?}"),
            }
        };

        // The plain folder listing, and the three global views, which is where it matters.
        assert_eq!(path_of(a.handle(Request::ListDir { path: "/Docs/2026".into() })), want);
        assert_eq!(path_of(a.handle(Request::Search { query: "report".into() })), want);
        assert_eq!(path_of(a.handle(Request::ListStarred)), want);
        assert_eq!(path_of(a.handle(Request::ListRecent { limit: 10 })), want);
    }

    #[test]
    fn mirror_replicates_and_respects_lww() {
        let a = agent();
        let b = agent();
        // A gets a dir + file (as if a client wrote to the best-connected host A).
        a.handle(Request::Mkdir { parent: "/".into(), name: "m".into() });
        let v1 = FilePayload { wrapped_ck: b"wk1".to_vec(), plaintext_len: 100, ciphertext: vec![1u8; 200] };
        a.handle(Request::PutFile { parent: "/m".into(), name: "f.bin".into(), payload: v1 });

        // Anti-entropy A -> B: diff manifests, push what B lacks/older (parents first).
        let sync = |from: &HostAgent, to: &HostAgent| {
            for id in objects_to_push(&from.manifest().unwrap(), &to.manifest().unwrap()) {
                let export = from.export_object(&id).unwrap().unwrap();
                assert!(matches!(to.handle(Request::ImportObject { export }), Response::Ok));
            }
        };
        sync(&a, &b);

        // B now holds a byte-identical copy (same ciphertext + wrapped key).
        match b.handle(Request::ReadFile { id: "/m/f.bin".into() }) {
            Response::File(f) => {
                assert_eq!(f.ciphertext, vec![1u8; 200]);
                assert_eq!(f.wrapped_ck, b"wk1");
            }
            other => panic!("unexpected {other:?}"),
        }
        // Idempotent: a second sync has nothing to push.
        assert!(objects_to_push(&a.manifest().unwrap(), &b.manifest().unwrap()).is_empty());

        // LWW: a NEWER write on A propagates to B.
        std::thread::sleep(std::time::Duration::from_millis(3));
        let v2 = FilePayload { wrapped_ck: b"wk2".to_vec(), plaintext_len: 100, ciphertext: vec![2u8; 200] };
        a.handle(Request::PutFile { parent: "/m".into(), name: "f.bin".into(), payload: v2 });
        sync(&a, &b);
        match b.handle(Request::ReadFile { id: "/m/f.bin".into() }) {
            Response::File(f) => assert_eq!(f.ciphertext, vec![2u8; 200], "B should have the newer version"),
            other => panic!("unexpected {other:?}"),
        }

        // An OLDER export must NOT clobber B's newer copy (import is a no-op).
        let mut stale = a.export_object("/m/f.bin").unwrap().unwrap();
        stale.mtime -= 10_000;
        if let Some(f) = &mut stale.file {
            f.ciphertext = vec![9u8; 200];
        }
        assert!(matches!(b.handle(Request::ImportObject { export: stale }), Response::Ok));
        match b.handle(Request::ReadFile { id: "/m/f.bin".into() }) {
            Response::File(f) => assert_eq!(f.ciphertext, vec![2u8; 200], "stale import must not overwrite"),
            other => panic!("unexpected {other:?}"),
        }
    }
}
