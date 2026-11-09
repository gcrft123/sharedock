//! Host-side storage: the metadata DB (SQLite/WAL), a content-addressed **encrypted**
//! chunk store, and reserve→commit quota accounting that enforces the partition cap.
//!
//! The host is E2EE-blind: callers hand it **ciphertext** plus an opaque
//! `wrapped_ck` (the per-file content key wrapped to the account key). The host
//! chunks the ciphertext, content-addresses each chunk by BLAKE3, dedups by
//! refcount, and never sees plaintext or the content key. Quota is charged on the
//! caller-declared plaintext length.
//!
//! MVP uses fixed 1 MiB chunks; FastCDC (dedup/delta polish) swaps in later.

use anyhow::{anyhow, Context, Result};
use rusqlite::{Connection, OptionalExtension};
use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const CHUNK: usize = 1 << 20; // 1 MiB

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS fs_object (
  id                 TEXT PRIMARY KEY,      -- normalized path ("/", "/Docs/a.txt")
  parent_id          TEXT,
  name               TEXT NOT NULL,
  kind               TEXT NOT NULL,         -- 'file' | 'dir'
  size_plain         INTEGER NOT NULL DEFAULT 0,
  mtime              INTEGER NOT NULL,
  current_version_id TEXT,
  starred            INTEGER NOT NULL DEFAULT 0,  -- 0/1 starred flag
  trashed_at         INTEGER                      -- NULL = live; else epoch ms trashed (recoverable)
);
CREATE INDEX IF NOT EXISTS idx_fs_parent ON fs_object(parent_id);

CREATE TABLE IF NOT EXISTS version (
  id           TEXT PRIMARY KEY,
  object_id    TEXT NOT NULL,
  size_plain   INTEGER NOT NULL,
  size_cipher  INTEGER NOT NULL,
  wrapped_ck   BLOB NOT NULL,               -- content key wrapped to the ARK (opaque)
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS object_chunk (
  version_id  TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  chunk_hash  BLOB NOT NULL,
  len         INTEGER NOT NULL,
  PRIMARY KEY (version_id, seq)
);

CREATE TABLE IF NOT EXISTS chunk (
  hash        BLOB PRIMARY KEY,
  len_cipher  INTEGER NOT NULL,
  refcount    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quota (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  quota_bytes     INTEGER NOT NULL DEFAULT 0,
  reserved_bytes  INTEGER NOT NULL DEFAULT 0,
  committed_bytes INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO quota (id, quota_bytes, reserved_bytes, committed_bytes) VALUES (1, 0, 0, 0);

-- Deletion tombstones: a deleted object's id + when it was deleted, so mirror
-- anti-entropy can propagate deletes (and an offline host's stale copy loses to a
-- newer tombstone by mtime-LWW) instead of resurrecting the file.
CREATE TABLE IF NOT EXISTS tombstone (
  id          TEXT PRIMARY KEY,
  deleted_at  INTEGER NOT NULL
);

-- Append-only activity log: uploads/downloads/deletes/etc., newest-first for the feed.
CREATE TABLE IF NOT EXISTS activity (
  id      TEXT PRIMARY KEY,
  ts      INTEGER NOT NULL,
  kind    TEXT NOT NULL,
  actor   TEXT NOT NULL,
  detail  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity(ts);
"#;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    File,
    Dir,
}
impl Kind {
    fn parse(s: &str) -> Kind {
        if s == "dir" {
            Kind::Dir
        } else {
            Kind::File
        }
    }
}

#[derive(Clone, Debug)]
pub struct EntryRow {
    pub id: String,
    pub name: String,
    pub kind: Kind,
    pub size_plain: u64,
    pub mtime: i64,
    pub starred: bool,
    pub trashed_at: Option<i64>,
}

/// The columns every `row_to_entry` query selects, in order. Keep in sync with
/// [`row_to_entry`].
const ENTRY_COLS: &str = "id, name, kind, size_plain, mtime, starred, trashed_at";

/// One row of the mirror manifest: the object's replicated metadata + star/trash state.
#[derive(Clone, Debug)]
pub struct ManifestRow {
    pub id: String,
    pub kind: Kind,
    pub mtime: i64,
    pub size_plain: u64,
    pub starred: bool,
    pub trashed_at: Option<i64>,
}

/// One activity-log row.
#[derive(Clone, Debug)]
pub struct ActivityRow {
    pub id: String,
    pub ts: i64,
    pub kind: String,
    pub actor: String,
    pub detail: String,
}

#[derive(Clone, Debug)]
pub struct FileData {
    pub wrapped_ck: Vec<u8>,
    pub plaintext_len: u64,
    pub ciphertext: Vec<u8>,
}

#[derive(Clone, Copy, Debug)]
pub struct QuotaInfo {
    pub quota_bytes: u64,
    pub reserved_bytes: u64,
    pub committed_bytes: u64,
}
impl QuotaInfo {
    pub fn used_bytes(&self) -> u64 {
        self.committed_bytes.saturating_add(self.reserved_bytes)
    }
    pub fn available_bytes(&self) -> u64 {
        self.quota_bytes.saturating_sub(self.used_bytes())
    }
}

/// Result of a write: either the stored object id, or a quota rejection.
#[derive(Clone, Debug)]
pub enum PutOutcome {
    Stored { id: String },
    QuotaExceeded { needed: u64, available: u64 },
}

/// Result of starting a chunked upload.
#[derive(Clone, Debug)]
pub enum UploadBeginOutcome {
    Started { upload_id: String },
    QuotaExceeded { needed: u64, available: u64 },
}

/// Metadata to begin a chunked download.
#[derive(Clone, Debug)]
pub struct ReadInfo {
    pub wrapped_ck: Vec<u8>,
    pub plaintext_len: u64,
    pub chunk_count: u64,
}

/// An in-progress chunked upload. Quota is reserved on begin, chunk blobs are
/// stored as they arrive, and the version is materialized on commit (or the
/// blobs deref'd + reservation released on abort).
struct PendingUpload {
    parent: String,
    name: String,
    plaintext_len: u64,
    wrapped_ck: Vec<u8>,
    chunks: Vec<(Vec<u8>, usize)>, // (chunk_hash, len)
}

pub struct Store {
    conn: Connection,
    blobs: PathBuf,
    pending: RefCell<HashMap<String, PendingUpload>>,
}

impl Store {
    pub fn open(db_path: &Path, blobs_dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(blobs_dir)?;
        let conn = Connection::open(db_path).with_context(|| format!("open db {db_path:?}"))?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        Self::init(conn, blobs_dir.to_path_buf())
    }

    pub fn open_in_memory(blobs_dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(blobs_dir)?;
        let conn = Connection::open_in_memory()?;
        Self::init(conn, blobs_dir.to_path_buf())
    }

    fn init(conn: Connection, blobs: PathBuf) -> Result<Self> {
        conn.execute_batch(SCHEMA)?;
        migrate(&conn)?;
        // ensure root
        conn.execute(
            "INSERT OR IGNORE INTO fs_object (id, parent_id, name, kind, size_plain, mtime) VALUES ('/', NULL, '', 'dir', 0, ?1)",
            [now_millis()],
        )?;
        Ok(Self { conn, blobs, pending: RefCell::new(HashMap::new()) })
    }

    // ---- quota ----

    pub fn set_quota(&self, bytes: u64) -> Result<()> {
        self.conn
            .execute("UPDATE quota SET quota_bytes = ?1 WHERE id = 1", [bytes as i64])?;
        Ok(())
    }

    pub fn quota(&self) -> Result<QuotaInfo> {
        Ok(self.conn.query_row(
            "SELECT quota_bytes, reserved_bytes, committed_bytes FROM quota WHERE id = 1",
            [],
            |r| {
                Ok(QuotaInfo {
                    quota_bytes: r.get::<_, i64>(0)? as u64,
                    reserved_bytes: r.get::<_, i64>(1)? as u64,
                    committed_bytes: r.get::<_, i64>(2)? as u64,
                })
            },
        )?)
    }

    fn reserve(&self, bytes: u64) -> Result<bool> {
        let info = self.quota()?;
        if bytes > info.available_bytes() {
            return Ok(false);
        }
        self.conn.execute(
            "UPDATE quota SET reserved_bytes = reserved_bytes + ?1 WHERE id = 1",
            [bytes as i64],
        )?;
        Ok(true)
    }
    fn commit(&self, bytes: u64) -> Result<()> {
        self.conn.execute(
            "UPDATE quota SET reserved_bytes = MAX(0, reserved_bytes - ?1), committed_bytes = committed_bytes + ?1 WHERE id = 1",
            [bytes as i64],
        )?;
        Ok(())
    }
    fn release(&self, bytes: u64) -> Result<()> {
        self.conn.execute(
            "UPDATE quota SET reserved_bytes = MAX(0, reserved_bytes - ?1) WHERE id = 1",
            [bytes as i64],
        )?;
        Ok(())
    }
    fn uncommit(&self, bytes: u64) -> Result<()> {
        self.conn.execute(
            "UPDATE quota SET committed_bytes = MAX(0, committed_bytes - ?1) WHERE id = 1",
            [bytes as i64],
        )?;
        Ok(())
    }

    // ---- tree ----

    pub fn stat(&self, id: &str) -> Result<Option<EntryRow>> {
        let id = normalize(id);
        // No trashed filter: stat resolves trashed entries too, so restore/preview work.
        Ok(self
            .conn
            .query_row(
                &format!("SELECT {ENTRY_COLS} FROM fs_object WHERE id = ?1"),
                [&id],
                row_to_entry,
            )
            .optional()?)
    }

    pub fn list(&self, path: &str) -> Result<Vec<EntryRow>> {
        let path = normalize(path);
        // Trashed entries are hidden from normal listings (they live in the trash view).
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {ENTRY_COLS} FROM fs_object WHERE parent_id = ?1 AND trashed_at IS NULL
             ORDER BY (kind = 'dir') DESC, name ASC",
        ))?;
        let rows = stmt.query_map([&path], row_to_entry)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn mkdir(&self, parent: &str, name: &str) -> Result<String> {
        self.mkdir_at(parent, name, now_millis())
    }

    /// Like [`mkdir`](Self::mkdir) but stamps a specific mtime (mirror replication).
    pub fn mkdir_at(&self, parent: &str, name: &str, mtime: i64) -> Result<String> {
        let parent = normalize(parent);
        self.ensure_dir(&parent)?;
        let id = join(&parent, name);
        self.conn.execute(
            "INSERT OR IGNORE INTO fs_object (id, parent_id, name, kind, size_plain, mtime) VALUES (?1, ?2, ?3, 'dir', 0, ?4)",
            rusqlite::params![id, parent, name, mtime],
        )?;
        self.clear_tombstone(&id)?; // re-created → no longer deleted
        Ok(id)
    }

    /// Every object except the root — the input to mirror anti-entropy diffing (mtime is
    /// the last-writer-wins comparison key; star + trash state ride along so they converge).
    pub fn manifest(&self) -> Result<Vec<ManifestRow>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, kind, mtime, size_plain, starred, trashed_at FROM fs_object WHERE id != '/' ORDER BY id",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(ManifestRow {
                id: r.get::<_, String>(0)?,
                kind: Kind::parse(&r.get::<_, String>(1)?),
                mtime: r.get::<_, i64>(2)?,
                size_plain: r.get::<_, i64>(3)? as u64,
                starred: r.get::<_, i64>(4)? != 0,
                trashed_at: r.get::<_, Option<i64>>(5)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    fn ensure_dir(&self, path: &str) -> Result<()> {
        match self.stat(path)? {
            Some(e) if e.kind == Kind::Dir => Ok(()),
            Some(_) => Err(anyhow!("{path} is not a directory")),
            None => Err(anyhow!("parent {path} does not exist")),
        }
    }

    // ---- files (ciphertext in / ciphertext out) ----

    /// Store a file. `ciphertext` is the caller's already-encrypted bytes;
    /// Replace the wrapped content key on an object's CURRENT version.
    ///
    /// This is what makes account-key rotation possible. The content key itself does not
    /// change and the ciphertext is untouched: only the wrapping changes, from the old
    /// account key to the new one. That is why rotation costs one small write per file
    /// rather than re-encrypting every byte.
    ///
    /// The host cannot check the new wrapping — it has never held either key — so it treats
    /// the blob as opaque. A client that sends a wrapping under the wrong key makes its own
    /// file unreadable, which is why the client keeps the old key until rotation completes.
    pub fn rewrap_current_version(&self, id: &str, wrapped_ck: &[u8]) -> Result<()> {
        let n = self.conn.execute(
            "UPDATE version SET wrapped_ck = ?1
             WHERE id = (SELECT current_version_id FROM fs_object WHERE id = ?2)",
            rusqlite::params![wrapped_ck, id],
        )?;
        if n == 0 {
            anyhow::bail!("no current version for {id}");
        }
        Ok(())
    }

    /// `wrapped_ck` is the opaque wrapped content key; `plaintext_len` is what
    /// the quota is charged. Replaces any existing file at the same path.
    pub fn put_file(
        &self,
        parent: &str,
        name: &str,
        plaintext_len: u64,
        wrapped_ck: &[u8],
        ciphertext: &[u8],
    ) -> Result<PutOutcome> {
        self.put_file_at(parent, name, plaintext_len, wrapped_ck, ciphertext, now_millis())
    }

    /// Like [`put_file`](Self::put_file) but stamps a specific `mtime`. Mirror
    /// replication uses this so a replicated copy keeps the *source's* mtime — the
    /// comparison key for last-writer-wins reconciliation.
    #[allow(clippy::too_many_arguments)]
    pub fn put_file_at(
        &self,
        parent: &str,
        name: &str,
        plaintext_len: u64,
        wrapped_ck: &[u8],
        ciphertext: &[u8],
        mtime: i64,
    ) -> Result<PutOutcome> {
        let parent = normalize(parent);
        self.ensure_dir(&parent)?;
        let id = join(&parent, name);

        // Replacing an existing file frees its bytes first.
        if let Some(existing) = self.stat(&id)? {
            if existing.kind == Kind::Dir {
                return Err(anyhow!("{id} is a directory"));
            }
            self.delete(&id)?;
        }

        let info = self.quota()?;
        if plaintext_len > info.available_bytes() {
            return Ok(PutOutcome::QuotaExceeded {
                needed: plaintext_len,
                available: info.available_bytes(),
            });
        }
        if !self.reserve(plaintext_len)? {
            return Ok(PutOutcome::QuotaExceeded {
                needed: plaintext_len,
                available: self.quota()?.available_bytes(),
            });
        }

        let store_result = (|| -> Result<String> {
            let version_id = new_id("v");
            self.conn.execute(
                "INSERT INTO version (id, object_id, size_plain, size_cipher, wrapped_ck, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![version_id, id, plaintext_len as i64, ciphertext.len() as i64, wrapped_ck, now_millis()],
            )?;

            for (seq, part) in ciphertext.chunks(CHUNK).enumerate() {
                let hash = blake3::hash(part);
                let hb = hash.as_bytes().as_slice();
                self.store_chunk(hb, part)?;
                self.conn.execute(
                    "INSERT INTO object_chunk (version_id, seq, chunk_hash, len) VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![version_id, seq as i64, hb, part.len() as i64],
                )?;
            }

            self.conn.execute(
                "INSERT INTO fs_object (id, parent_id, name, kind, size_plain, mtime, current_version_id)
                 VALUES (?1, ?2, ?3, 'file', ?4, ?5, ?6)",
                rusqlite::params![id, parent, name, plaintext_len as i64, mtime, version_id],
            )?;
            self.clear_tombstone(&id)?; // re-created → no longer deleted
            Ok(id.clone())
        })();

        match store_result {
            Ok(stored) => {
                self.commit(plaintext_len)?;
                Ok(PutOutcome::Stored { id: stored })
            }
            Err(e) => {
                self.release(plaintext_len)?;
                Err(e)
            }
        }
    }

    pub fn read_file(&self, id: &str) -> Result<Option<FileData>> {
        let id = normalize(id);
        let ver: Option<(String, i64, Vec<u8>)> = self
            .conn
            .query_row(
                "SELECT v.id, v.size_plain, v.wrapped_ck
                 FROM fs_object o JOIN version v ON v.id = o.current_version_id
                 WHERE o.id = ?1 AND o.kind = 'file'",
                [&id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;

        let Some((version_id, size_plain, wrapped_ck)) = ver else {
            return Ok(None);
        };

        let mut stmt = self
            .conn
            .prepare("SELECT chunk_hash FROM object_chunk WHERE version_id = ?1 ORDER BY seq ASC")?;
        let hashes = stmt.query_map([&version_id], |r| r.get::<_, Vec<u8>>(0))?;
        let mut ciphertext = Vec::new();
        for h in hashes {
            let h = h?;
            ciphertext.extend_from_slice(&self.load_chunk(&h)?);
        }

        Ok(Some(FileData {
            wrapped_ck,
            plaintext_len: size_plain as u64,
            ciphertext,
        }))
    }

    // ---- chunked/streamed upload + download ----

    /// Begin a chunked upload: reserve quota and open a pending session.
    pub fn begin_upload(
        &self,
        parent: &str,
        name: &str,
        plaintext_len: u64,
        wrapped_ck: &[u8],
    ) -> Result<UploadBeginOutcome> {
        let parent = normalize(parent);
        self.ensure_dir(&parent)?;
        let info = self.quota()?;
        if plaintext_len > info.available_bytes() {
            return Ok(UploadBeginOutcome::QuotaExceeded { needed: plaintext_len, available: info.available_bytes() });
        }
        if !self.reserve(plaintext_len)? {
            return Ok(UploadBeginOutcome::QuotaExceeded { needed: plaintext_len, available: self.quota()?.available_bytes() });
        }
        let upload_id = new_id("up");
        self.pending.borrow_mut().insert(
            upload_id.clone(),
            PendingUpload { parent, name: name.to_string(), plaintext_len, wrapped_ck: wrapped_ck.to_vec(), chunks: Vec::new() },
        );
        Ok(UploadBeginOutcome::Started { upload_id })
    }

    /// Store one ciphertext chunk of a pending upload (content-addressed, deduped).
    pub fn upload_chunk(&self, upload_id: &str, ciphertext: &[u8]) -> Result<()> {
        let hash = blake3::hash(ciphertext);
        let hb = hash.as_bytes().as_slice();
        self.store_chunk(hb, ciphertext)?;
        let mut pending = self.pending.borrow_mut();
        let up = pending.get_mut(upload_id).ok_or_else(|| anyhow!("unknown upload {upload_id}"))?;
        up.chunks.push((hb.to_vec(), ciphertext.len()));
        Ok(())
    }

    /// Materialize the file from a pending upload's chunks and commit the quota.
    pub fn commit_upload(&self, upload_id: &str) -> Result<String> {
        let up = self
            .pending
            .borrow_mut()
            .remove(upload_id)
            .ok_or_else(|| anyhow!("unknown upload {upload_id}"))?;
        let id = join(&up.parent, &up.name);

        if let Some(existing) = self.stat(&id)? {
            if existing.kind == Kind::Dir {
                for (h, _) in &up.chunks {
                    self.deref_chunk(h)?;
                }
                self.release(up.plaintext_len)?;
                return Err(anyhow!("{id} is a directory"));
            }
            self.delete(&id)?;
        }

        let version_id = new_id("v");
        let size_cipher: usize = up.chunks.iter().map(|(_, l)| *l).sum();
        self.conn.execute(
            "INSERT INTO version (id, object_id, size_plain, size_cipher, wrapped_ck, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![version_id, id, up.plaintext_len as i64, size_cipher as i64, up.wrapped_ck, now_millis()],
        )?;
        for (seq, (hash, len)) in up.chunks.iter().enumerate() {
            self.conn.execute(
                "INSERT INTO object_chunk (version_id, seq, chunk_hash, len) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![version_id, seq as i64, hash, *len as i64],
            )?;
        }
        self.conn.execute(
            "INSERT INTO fs_object (id, parent_id, name, kind, size_plain, mtime, current_version_id) VALUES (?1, ?2, ?3, 'file', ?4, ?5, ?6)",
            rusqlite::params![id, up.parent, up.name, up.plaintext_len as i64, now_millis(), version_id],
        )?;
        self.clear_tombstone(&id)?; // re-created → no longer deleted
        self.commit(up.plaintext_len)?;
        Ok(id)
    }

    /// Discard a pending upload: deref its chunks and release the reservation.
    pub fn abort_upload(&self, upload_id: &str) -> Result<()> {
        if let Some(up) = self.pending.borrow_mut().remove(upload_id) {
            for (h, _) in &up.chunks {
                self.deref_chunk(h)?;
            }
            self.release(up.plaintext_len)?;
        }
        Ok(())
    }

    /// Metadata to begin a chunked download.
    pub fn begin_read(&self, id: &str) -> Result<Option<ReadInfo>> {
        let id = normalize(id);
        let ver: Option<(String, i64, Vec<u8>)> = self
            .conn
            .query_row(
                "SELECT v.id, v.size_plain, v.wrapped_ck
                 FROM fs_object o JOIN version v ON v.id = o.current_version_id
                 WHERE o.id = ?1 AND o.kind = 'file'",
                [&id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        let Some((version_id, size_plain, wrapped_ck)) = ver else {
            return Ok(None);
        };
        let chunk_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM object_chunk WHERE version_id = ?1",
            [&version_id],
            |r| r.get(0),
        )?;
        Ok(Some(ReadInfo { wrapped_ck, plaintext_len: size_plain as u64, chunk_count: chunk_count as u64 }))
    }

    /// Return the ciphertext of chunk `seq` of a file's current version.
    pub fn read_chunk(&self, id: &str, seq: u64) -> Result<Option<Vec<u8>>> {
        let id = normalize(id);
        let hash: Option<Vec<u8>> = self
            .conn
            .query_row(
                "SELECT oc.chunk_hash FROM fs_object o JOIN object_chunk oc ON oc.version_id = o.current_version_id
                 WHERE o.id = ?1 AND oc.seq = ?2",
                rusqlite::params![id, seq as i64],
                |r| r.get(0),
            )
            .optional()?;
        match hash {
            Some(h) => Ok(Some(self.load_chunk(&h)?)),
            None => Ok(None),
        }
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        let id = normalize(id);
        let Some(entry) = self.stat(&id)? else {
            return Ok(());
        };
        if entry.kind == Kind::Dir {
            // recursively delete children — ALL of them, trashed or not, so purging a
            // trashed subtree (empty_trash) removes its hidden descendants too.
            for cid in self.child_ids(&id)? {
                self.delete(&cid)?;
            }
            self.conn.execute("DELETE FROM fs_object WHERE id = ?1", [&id])?;
            self.set_tombstone(&id, now_millis())?;
            return Ok(());
        }

        // file: drop versions + chunk refs, free quota
        let versions: Vec<String> = {
            let mut stmt = self.conn.prepare("SELECT id FROM version WHERE object_id = ?1")?;
            let rows = stmt.query_map([&id], |r| r.get::<_, String>(0))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        for vid in &versions {
            let chunk_hashes: Vec<Vec<u8>> = {
                let mut stmt = self
                    .conn
                    .prepare("SELECT chunk_hash FROM object_chunk WHERE version_id = ?1")?;
                let rows = stmt.query_map([vid], |r| r.get::<_, Vec<u8>>(0))?;
                rows.collect::<std::result::Result<_, _>>()?
            };
            for h in chunk_hashes {
                self.deref_chunk(&h)?;
            }
            self.conn
                .execute("DELETE FROM object_chunk WHERE version_id = ?1", [vid])?;
        }
        self.conn.execute("DELETE FROM version WHERE object_id = ?1", [&id])?;
        self.conn.execute("DELETE FROM fs_object WHERE id = ?1", [&id])?;
        self.uncommit(entry.size_plain)?;
        self.set_tombstone(&id, now_millis())?;
        Ok(())
    }

    // ---- star + soft-trash (recoverable delete) ----

    /// All child ids of `parent`, trashed or not — the recursion helper for delete/trash
    /// (unlike `list`, which hides trashed rows).
    fn child_ids(&self, parent: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT id FROM fs_object WHERE parent_id = ?1")?;
        let rows = stmt.query_map([parent], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Set or clear an entry's starred flag. Deliberately does NOT touch `mtime` — that
    /// is the mirror last-writer-wins key, and starring must not trigger re-replication.
    pub fn set_star(&self, id: &str, on: bool) -> Result<()> {
        let id = normalize(id);
        self.conn.execute(
            "UPDATE fs_object SET starred = ?2 WHERE id = ?1",
            rusqlite::params![id, on as i64],
        )?;
        Ok(())
    }

    /// Move an entry (and its whole subtree) to the trash: hidden from listings, quota
    /// still charged, recoverable via [`restore`](Self::restore). Unlike [`delete`](Self::delete)
    /// this writes NO tombstone and frees NO quota — trashing is host-local and reversible.
    pub fn trash(&self, id: &str) -> Result<()> {
        let id = normalize(id);
        if id == "/" {
            return Err(anyhow!("cannot trash the root"));
        }
        if self.stat(&id)?.is_none() {
            return Ok(());
        }
        self.set_trashed_subtree(&id, Some(now_millis()))
    }

    /// Restore a trashed entry (and its subtree) back into normal listings.
    pub fn restore(&self, id: &str) -> Result<()> {
        let id = normalize(id);
        self.set_trashed_subtree(&id, None)
    }

    fn set_trashed_subtree(&self, id: &str, value: Option<i64>) -> Result<()> {
        self.conn.execute(
            "UPDATE fs_object SET trashed_at = ?2 WHERE id = ?1",
            rusqlite::params![id, value],
        )?;
        for cid in self.child_ids(id)? {
            self.set_trashed_subtree(&cid, value)?;
        }
        Ok(())
    }

    /// The trash roots — the top of each trashed subtree (a trashed entry whose parent is
    /// not itself trashed). The trash view lists these.
    pub fn list_trash(&self) -> Result<Vec<EntryRow>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {ENTRY_COLS} FROM fs_object o
             WHERE o.trashed_at IS NOT NULL
               AND (o.parent_id IS NULL
                    OR (SELECT p.trashed_at FROM fs_object p WHERE p.id = o.parent_id) IS NULL)
             ORDER BY o.trashed_at DESC, o.name ASC",
        ))?;
        let rows = stmt.query_map([], row_to_entry)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Permanently delete everything in the trash — frees quota + blobs and writes
    /// tombstones (so the deletions converge across a mirror), via [`delete`](Self::delete).
    pub fn empty_trash(&self) -> Result<()> {
        let roots: Vec<String> = self.list_trash()?.into_iter().map(|e| e.id).collect();
        for id in roots {
            self.delete(&id)?;
        }
        Ok(())
    }

    // ---- global views (search / starred / recent) ----

    /// Recursive case-insensitive substring search over all LIVE entries (max 500).
    pub fn search(&self, query: &str) -> Result<Vec<EntryRow>> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let pat = format!("%{}%", escape_like(q));
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {ENTRY_COLS} FROM fs_object
             WHERE id != '/' AND trashed_at IS NULL AND name LIKE ?1 ESCAPE '\\'
             ORDER BY (kind = 'dir') DESC, name ASC LIMIT 500",
        ))?;
        let rows = stmt.query_map([pat], row_to_entry)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// All starred LIVE entries, newest first.
    pub fn list_starred(&self) -> Result<Vec<EntryRow>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {ENTRY_COLS} FROM fs_object WHERE starred = 1 AND trashed_at IS NULL ORDER BY mtime DESC",
        ))?;
        let rows = stmt.query_map([], row_to_entry)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// The most recently modified LIVE files, newest first.
    pub fn list_recent(&self, limit: u64) -> Result<Vec<EntryRow>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {ENTRY_COLS} FROM fs_object
             WHERE kind = 'file' AND trashed_at IS NULL ORDER BY mtime DESC LIMIT ?1",
        ))?;
        let rows = stmt.query_map([limit as i64], row_to_entry)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    // ---- activity log ----

    /// Append an activity event (upload/download/delete/…).
    pub fn log_activity(&self, kind: &str, actor: &str, detail: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO activity (id, ts, kind, actor, detail) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![new_id("act"), now_millis(), kind, actor, detail],
        )?;
        Ok(())
    }

    /// The most recent activity events, newest first.
    pub fn list_activity(&self, limit: u64) -> Result<Vec<ActivityRow>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, ts, kind, actor, detail FROM activity ORDER BY ts DESC, id DESC LIMIT ?1")?;
        let rows = stmt.query_map([limit as i64], |r| {
            Ok(ActivityRow {
                id: r.get(0)?,
                ts: r.get(1)?,
                kind: r.get(2)?,
                actor: r.get(3)?,
                detail: r.get(4)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Set an object's star + trash state to replicated values (mirror sync); no mtime or
    /// content change. Used by `apply_import` so star/trash converge across a mirror.
    pub fn apply_star_trash(&self, id: &str, starred: bool, trashed_at: Option<i64>) -> Result<()> {
        let id = normalize(id);
        self.conn.execute(
            "UPDATE fs_object SET starred = ?2, trashed_at = ?3 WHERE id = ?1",
            rusqlite::params![id, starred as i64, trashed_at],
        )?;
        Ok(())
    }

    // ---- deletion tombstones (mirror replication) ----

    fn set_tombstone(&self, id: &str, deleted_at: i64) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO tombstone (id, deleted_at) VALUES (?1, ?2)",
            rusqlite::params![id, deleted_at],
        )?;
        Ok(())
    }

    fn clear_tombstone(&self, id: &str) -> Result<()> {
        self.conn.execute("DELETE FROM tombstone WHERE id = ?1", [id])?;
        Ok(())
    }

    /// All recorded deletions as `(id, deleted_at)` — merged into the mirror manifest so
    /// anti-entropy propagates deletes.
    pub fn tombstones(&self) -> Result<Vec<(String, i64)>> {
        let mut stmt = self.conn.prepare("SELECT id, deleted_at FROM tombstone")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// The current known state of `id`: `(mtime, deleted)` — a live object's mtime, or a
    /// tombstone's deleted_at, or `None` if never seen. The mtime-LWW comparison key.
    pub fn object_state(&self, id: &str) -> Result<Option<(i64, bool)>> {
        let id = normalize(id);
        if let Some(e) = self.stat(&id)? {
            return Ok(Some((e.mtime, false)));
        }
        let ts: Option<i64> = self
            .conn
            .query_row("SELECT deleted_at FROM tombstone WHERE id = ?1", [&id], |r| r.get(0))
            .optional()?;
        Ok(ts.map(|t| (t, true)))
    }

    /// Apply a peer's delete at `deleted_at` (mirror). Records the tombstone at the
    /// SOURCE's time and removes the object. A non-empty directory is deferred (returns
    /// `false`) — its children carry their own tombstones and a later pass removes the
    /// now-empty dir.
    pub fn apply_remote_delete(&self, id: &str, deleted_at: i64) -> Result<bool> {
        let id = normalize(id);
        match self.stat(&id)? {
            None => {
                self.set_tombstone(&id, deleted_at)?;
                Ok(true)
            }
            Some(e) if e.kind == Kind::File => {
                self.delete(&id)?; // frees chunks + quota (records a now() tombstone)
                self.set_tombstone(&id, deleted_at)?; // override to the source's delete time
                Ok(true)
            }
            Some(_) => {
                if self.list(&id)?.is_empty() {
                    self.conn.execute("DELETE FROM fs_object WHERE id = ?1", [&id])?;
                    self.set_tombstone(&id, deleted_at)?;
                    Ok(true)
                } else {
                    Ok(false) // defer until children are removed
                }
            }
        }
    }

    // ---- chunk blob store (content-addressed, refcounted) ----

    fn blob_path(&self, hash: &[u8]) -> PathBuf {
        self.blobs.join(hex(hash))
    }

    fn store_chunk(&self, hash: &[u8], bytes: &[u8]) -> Result<()> {
        let existing: Option<i64> = self
            .conn
            .query_row("SELECT refcount FROM chunk WHERE hash = ?1", [hash], |r| r.get(0))
            .optional()?;
        match existing {
            Some(_) => {
                self.conn
                    .execute("UPDATE chunk SET refcount = refcount + 1 WHERE hash = ?1", [hash])?;
            }
            None => {
                std::fs::write(self.blob_path(hash), bytes)?;
                self.conn.execute(
                    "INSERT INTO chunk (hash, len_cipher, refcount) VALUES (?1, ?2, 1)",
                    rusqlite::params![hash, bytes.len() as i64],
                )?;
            }
        }
        Ok(())
    }

    fn load_chunk(&self, hash: &[u8]) -> Result<Vec<u8>> {
        std::fs::read(self.blob_path(hash)).with_context(|| format!("missing blob {}", hex(hash)))
    }

    fn deref_chunk(&self, hash: &[u8]) -> Result<()> {
        self.conn
            .execute("UPDATE chunk SET refcount = refcount - 1 WHERE hash = ?1", [hash])?;
        let rc: Option<i64> = self
            .conn
            .query_row("SELECT refcount FROM chunk WHERE hash = ?1", [hash], |r| r.get(0))
            .optional()?;
        if let Some(rc) = rc {
            if rc <= 0 {
                let _ = std::fs::remove_file(self.blob_path(hash));
                self.conn.execute("DELETE FROM chunk WHERE hash = ?1", [hash])?;
            }
        }
        Ok(())
    }

    /// Count of distinct stored chunk blobs (for tests / diagnostics).
    pub fn chunk_count(&self) -> Result<u64> {
        Ok(self
            .conn
            .query_row("SELECT COUNT(*) FROM chunk", [], |r| r.get::<_, i64>(0))? as u64)
    }

    /// Number of files (not directories) across the partition.
    pub fn file_count(&self) -> Result<u64> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*) FROM fs_object WHERE kind = 'file'",
            [],
            |r| r.get::<_, i64>(0),
        )? as u64)
    }

    /// Move/rename an entry to `to_parent/to_name`. Because ids ARE normalized
    /// paths, this rewrites the id (and, for a directory, every descendant id) in
    /// the metadata DB; content blobs are never touched. An existing entry at the
    /// destination is replaced (WebDAV MOVE overwrite semantics). Quota is
    /// unchanged (same content, same plaintext length).
    pub fn rename(&self, from_id: &str, to_parent: &str, to_name: &str) -> Result<()> {
        let from = normalize(from_id);
        let to_parent = normalize(to_parent);
        let to = join(&to_parent, to_name);
        if from == "/" {
            return Err(anyhow!("cannot move the root"));
        }
        if from == to {
            return Ok(());
        }
        if to.starts_with(&format!("{from}/")) {
            return Err(anyhow!("cannot move {from} into itself"));
        }
        if self.stat(&from)?.is_none() {
            return Err(anyhow!("{from} does not exist"));
        }
        self.ensure_dir(&to_parent)?;
        if self.stat(&to)?.is_some() {
            self.delete(&to)?;
        }
        self.rename_subtree(&from, &to)
    }

    /// Re-point one entry (and, for a dir, its whole subtree) from path `from` to
    /// path `to`. Assumes `to`'s parent exists and nothing lives at `to`.
    fn rename_subtree(&self, from: &str, to: &str) -> Result<()> {
        let Some(entry) = self.stat(from)? else {
            return Ok(());
        };
        let (to_parent, to_name) = match to.rsplit_once('/') {
            Some(("", name)) => ("/".to_string(), name.to_string()),
            Some((parent, name)) => (parent.to_string(), name.to_string()),
            None => ("/".to_string(), to.to_string()),
        };
        // Re-point the node itself to its new path.
        self.conn.execute(
            "UPDATE fs_object SET id = ?1, parent_id = ?2, name = ?3 WHERE id = ?4",
            rusqlite::params![to, to_parent, to_name, from],
        )?;
        match entry.kind {
            Kind::Dir => {
                // Children still reference the OLD parent id; moving each subtree
                // re-points its parent_id to the new id.
                let children: Vec<String> = {
                    let mut stmt =
                        self.conn.prepare("SELECT id FROM fs_object WHERE parent_id = ?1")?;
                    let rows = stmt.query_map([from], |r| r.get::<_, String>(0))?;
                    rows.collect::<std::result::Result<_, _>>()?
                };
                for child_old in children {
                    let name = child_old.rsplit('/').next().unwrap_or(&child_old).to_string();
                    let child_new = join(to, &name);
                    self.rename_subtree(&child_old, &child_new)?;
                }
            }
            Kind::File => {
                // Versions are keyed by object_id = the file's path id; keep delete
                // (which frees chunks via object_id) correct after the move.
                self.conn.execute(
                    "UPDATE version SET object_id = ?1 WHERE object_id = ?2",
                    rusqlite::params![to, from],
                )?;
            }
        }
        Ok(())
    }
}

fn row_to_entry(r: &rusqlite::Row<'_>) -> rusqlite::Result<EntryRow> {
    Ok(EntryRow {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: Kind::parse(&r.get::<_, String>(2)?),
        size_plain: r.get::<_, i64>(3)? as u64,
        mtime: r.get(4)?,
        starred: r.get::<_, i64>(5)? != 0,
        trashed_at: r.get::<_, Option<i64>>(6)?,
    })
}

/// Idempotently add columns introduced after the initial schema (star + soft-trash)
/// to a pre-existing DB. Fresh DBs already have them via SCHEMA, so these no-op.
fn migrate(conn: &Connection) -> Result<()> {
    let cols = table_columns(conn, "fs_object")?;
    if !cols.iter().any(|c| c == "starred") {
        conn.execute_batch("ALTER TABLE fs_object ADD COLUMN starred INTEGER NOT NULL DEFAULT 0")?;
    }
    if !cols.iter().any(|c| c == "trashed_at") {
        conn.execute_batch("ALTER TABLE fs_object ADD COLUMN trashed_at INTEGER")?;
    }
    Ok(())
}

fn table_columns(conn: &Connection, table: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(1))?; // col 1 = name
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Escape `%` / `_` / `\` for a SQL `LIKE ... ESCAPE '\'` pattern so a literal search
/// term isn't interpreted as wildcards.
fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

fn normalize(path: &str) -> String {
    if path.is_empty() || path == "/" {
        return "/".to_string();
    }
    let joined = path.split('/').filter(|s| !s.is_empty()).collect::<Vec<_>>().join("/");
    format!("/{joined}")
}

fn join(parent: &str, name: &str) -> String {
    let p = normalize(parent);
    if p == "/" {
        format!("/{name}")
    } else {
        format!("{p}/{name}")
    }
}

fn hex(b: &[u8]) -> String {
    let mut s = String::with_capacity(b.len() * 2);
    for x in b {
        s.push_str(&format!("{x:02x}"));
    }
    s
}

static COUNTER: AtomicU64 = AtomicU64::new(1);
fn new_id(prefix: &str) -> String {
    format!("{prefix}_{}_{}", now_millis(), COUNTER.fetch_add(1, Ordering::Relaxed))
}

fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store() -> Store {
        let dir = std::env::temp_dir().join(format!(
            "pc-fs-test-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        Store::open_in_memory(&dir.join("blobs")).unwrap()
    }

    #[test]
    fn put_read_roundtrip() {
        let s = temp_store();
        s.set_quota(10_000).unwrap();
        let cipher = vec![7u8; 2500];
        let out = s.put_file("/", "a.bin", 2000, b"wrapped-key", &cipher).unwrap();
        assert!(matches!(out, PutOutcome::Stored { .. }));

        let got = s.read_file("/a.bin").unwrap().unwrap();
        assert_eq!(got.ciphertext, cipher);
        assert_eq!(got.wrapped_ck, b"wrapped-key");
        assert_eq!(got.plaintext_len, 2000);
        assert_eq!(s.quota().unwrap().committed_bytes, 2000);
    }

    #[test]
    fn quota_rejects_overshoot() {
        let s = temp_store();
        s.set_quota(1000).unwrap();
        let out = s.put_file("/", "big.bin", 2000, b"k", &[0u8; 2000]).unwrap();
        assert!(matches!(out, PutOutcome::QuotaExceeded { .. }));
        // nothing stored, no bytes charged
        assert!(s.read_file("/big.bin").unwrap().is_none());
        assert_eq!(s.quota().unwrap().used_bytes(), 0);
    }

    #[test]
    fn delete_frees_quota_and_blobs() {
        let s = temp_store();
        s.set_quota(10_000).unwrap();
        s.put_file("/", "a.bin", 1000, b"k", &[1u8; 1500]).unwrap();
        assert_eq!(s.chunk_count().unwrap(), 1);
        s.delete("/a.bin").unwrap();
        assert_eq!(s.quota().unwrap().committed_bytes, 0);
        assert_eq!(s.chunk_count().unwrap(), 0);
        assert!(s.read_file("/a.bin").unwrap().is_none());
    }

    #[test]
    fn dedup_shares_chunks_by_content() {
        let s = temp_store();
        s.set_quota(100_000).unwrap();
        let cipher = vec![9u8; 3000];
        s.put_file("/", "one.bin", 3000, b"k1", &cipher).unwrap();
        s.put_file("/", "two.bin", 3000, b"k2", &cipher).unwrap();
        // identical ciphertext -> same chunk hash -> one blob, refcount 2
        assert_eq!(s.chunk_count().unwrap(), 1);
        // deleting one keeps the shared blob
        s.delete("/one.bin").unwrap();
        assert_eq!(s.chunk_count().unwrap(), 1);
        assert_eq!(s.read_file("/two.bin").unwrap().unwrap().ciphertext, cipher);
    }

    #[test]
    fn mkdir_and_list() {
        let s = temp_store();
        s.set_quota(100_000).unwrap();
        s.mkdir("/", "Docs").unwrap();
        s.put_file("/Docs", "note.txt", 10, b"k", &[0u8; 12]).unwrap();
        let root = s.list("/").unwrap();
        assert_eq!(root.len(), 1);
        assert_eq!(root[0].name, "Docs");
        assert_eq!(root[0].kind, Kind::Dir);
        let docs = s.list("/Docs").unwrap();
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].name, "note.txt");
    }

    #[test]
    fn chunked_upload_download_roundtrip() {
        let s = temp_store();
        s.set_quota(100_000).unwrap();
        let id = match s.begin_upload("/", "big.bin", 5000, b"wk").unwrap() {
            UploadBeginOutcome::Started { upload_id } => upload_id,
            _ => panic!("unexpected quota rejection"),
        };
        s.upload_chunk(&id, &vec![1u8; 2000]).unwrap();
        s.upload_chunk(&id, &vec![2u8; 2000]).unwrap();
        s.upload_chunk(&id, &vec![3u8; 1500]).unwrap();
        assert_eq!(s.commit_upload(&id).unwrap(), "/big.bin");

        let info = s.begin_read("/big.bin").unwrap().unwrap();
        assert_eq!(info.wrapped_ck, b"wk");
        assert_eq!(info.plaintext_len, 5000);
        assert_eq!(info.chunk_count, 3);
        assert_eq!(s.read_chunk("/big.bin", 0).unwrap().unwrap(), vec![1u8; 2000]);
        assert_eq!(s.read_chunk("/big.bin", 1).unwrap().unwrap(), vec![2u8; 2000]);
        assert_eq!(s.read_chunk("/big.bin", 2).unwrap().unwrap(), vec![3u8; 1500]);
        assert_eq!(s.quota().unwrap().committed_bytes, 5000);
    }

    #[test]
    fn chunked_upload_abort_frees_quota() {
        let s = temp_store();
        s.set_quota(10_000).unwrap();
        let id = match s.begin_upload("/", "x.bin", 3000, b"k").unwrap() {
            UploadBeginOutcome::Started { upload_id } => upload_id,
            _ => panic!(),
        };
        s.upload_chunk(&id, &vec![9u8; 3000]).unwrap();
        assert_eq!(s.quota().unwrap().reserved_bytes, 3000);
        s.abort_upload(&id).unwrap();
        let q = s.quota().unwrap();
        assert_eq!(q.reserved_bytes, 0);
        assert_eq!(q.committed_bytes, 0);
        assert_eq!(s.chunk_count().unwrap(), 0);
    }

    #[test]
    fn multichunk_file_roundtrips() {
        let s = temp_store();
        s.set_quota(50 << 20).unwrap();
        // 2.5 MiB ciphertext -> 3 chunks
        let cipher: Vec<u8> = (0..(2_500_000u32)).map(|i| (i % 251) as u8).collect();
        s.put_file("/", "big.bin", 2_400_000, b"k", &cipher).unwrap();
        assert_eq!(s.chunk_count().unwrap(), 3);
        assert_eq!(s.read_file("/big.bin").unwrap().unwrap().ciphertext, cipher);
    }

    #[test]
    fn rename_moves_file_and_dir() {
        let s = temp_store();
        s.set_quota(100_000).unwrap();
        s.mkdir("/", "a").unwrap();
        s.put_file("/a", "f.txt", 5, b"k", &[1u8; 8]).unwrap();

        // file rename within a directory
        s.rename("/a/f.txt", "/a", "g.txt").unwrap();
        assert!(s.read_file("/a/f.txt").unwrap().is_none());
        assert_eq!(s.read_file("/a/g.txt").unwrap().unwrap().plaintext_len, 5);

        // directory rename carries its children to the new prefix
        s.rename("/a", "/", "b").unwrap();
        assert!(s.stat("/a").unwrap().is_none());
        assert_eq!(s.stat("/b").unwrap().unwrap().kind, Kind::Dir);
        assert_eq!(s.read_file("/b/g.txt").unwrap().unwrap().ciphertext, vec![1u8; 8]);

        // deleting after the move still frees quota + blobs (version.object_id was rewritten)
        assert_eq!(s.quota().unwrap().committed_bytes, 5);
        s.delete("/b/g.txt").unwrap();
        assert_eq!(s.quota().unwrap().committed_bytes, 0);
        assert_eq!(s.chunk_count().unwrap(), 0);
    }

    #[test]
    fn rename_into_self_is_rejected() {
        let s = temp_store();
        s.set_quota(100_000).unwrap();
        s.mkdir("/", "a").unwrap();
        assert!(s.rename("/a", "/a", "b").is_err());
    }

    #[test]
    fn star_toggles_without_changing_mtime() {
        let s = temp_store();
        s.set_quota(100_000).unwrap();
        s.put_file("/", "a.txt", 10, b"k", &[0u8; 12]).unwrap();
        let m0 = s.stat("/a.txt").unwrap().unwrap().mtime;
        s.set_star("/a.txt", true).unwrap();
        let e = s.stat("/a.txt").unwrap().unwrap();
        assert!(e.starred);
        assert_eq!(e.mtime, m0, "starring must not change mtime (mirror LWW key)");
        let row = s.list("/").unwrap().into_iter().find(|r| r.name == "a.txt").unwrap();
        assert!(row.starred);
        s.set_star("/a.txt", false).unwrap();
        assert!(!s.stat("/a.txt").unwrap().unwrap().starred);
    }

    #[test]
    fn trash_hides_from_list_but_stat_resolves_then_restore() {
        let s = temp_store();
        s.set_quota(100_000).unwrap();
        s.mkdir("/", "d").unwrap();
        s.put_file("/d", "f.txt", 10, b"k", &[1u8; 12]).unwrap();
        s.put_file("/", "top.txt", 5, b"k", &[2u8; 6]).unwrap();

        s.trash("/d").unwrap();
        assert!(s.list("/").unwrap().iter().all(|r| r.name != "d"), "trashed dir hidden");
        assert!(s.stat("/d").unwrap().is_some(), "stat still resolves trashed paths");
        assert_eq!(s.read_file("/d/f.txt").unwrap().unwrap().plaintext_len, 10, "preview works");
        assert!(s.list("/d").unwrap().is_empty(), "trashed subtree hidden");
        let trash = s.list_trash().unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].name, "d");
        assert_eq!(s.quota().unwrap().committed_bytes, 15, "trash still charges quota");

        s.restore("/d").unwrap();
        assert!(s.list("/").unwrap().iter().any(|r| r.name == "d"), "restored");
        assert_eq!(s.list("/d").unwrap().len(), 1, "subtree restored");
        assert!(s.list_trash().unwrap().is_empty());
    }

    #[test]
    fn empty_trash_frees_quota_and_tombstones() {
        let s = temp_store();
        s.set_quota(100_000).unwrap();
        s.mkdir("/", "d").unwrap();
        s.put_file("/d", "f.bin", 1000, b"k", &[7u8; 1500]).unwrap();
        assert_eq!(s.chunk_count().unwrap(), 1);
        s.trash("/d").unwrap();
        assert_eq!(s.quota().unwrap().committed_bytes, 1000);

        s.empty_trash().unwrap();
        assert_eq!(s.quota().unwrap().committed_bytes, 0, "empty_trash frees quota");
        assert_eq!(s.chunk_count().unwrap(), 0, "empty_trash frees blobs");
        assert!(s.stat("/d").unwrap().is_none());
        let (_, deleted) = s.object_state("/d/f.bin").unwrap().unwrap();
        assert!(deleted, "purged files must be tombstoned for mirror convergence");
    }

    #[test]
    fn migration_adds_columns_to_existing_db() {
        // A pre-star/trash DB: fs_object WITHOUT the new columns. Opening must migrate it.
        let dir = std::env::temp_dir().join(format!(
            "pc-fs-migrate-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("meta.db");
        {
            let conn = Connection::open(&db).unwrap();
            conn.execute_batch(
                "CREATE TABLE fs_object (id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL,
                 kind TEXT NOT NULL, size_plain INTEGER NOT NULL DEFAULT 0, mtime INTEGER NOT NULL,
                 current_version_id TEXT);
                 INSERT INTO fs_object (id, parent_id, name, kind, size_plain, mtime)
                 VALUES ('/', NULL, '', 'dir', 0, 1), ('/old.txt', '/', 'old.txt', 'file', 5, 2);",
            )
            .unwrap();
        }
        let s = Store::open(&db, &dir.join("blobs")).unwrap();
        let rows = s.list("/").unwrap();
        let old = rows.iter().find(|r| r.name == "old.txt").expect("legacy row lists");
        assert!(!old.starred, "migrated rows default to unstarred");
        s.set_star("/old.txt", true).unwrap();
        assert!(s.stat("/old.txt").unwrap().unwrap().starred);
        s.trash("/old.txt").unwrap();
        assert!(s.list("/").unwrap().iter().all(|r| r.name != "old.txt"), "trash column usable");
    }

    #[test]
    fn search_starred_recent_views() {
        let s = temp_store();
        s.set_quota(100_000).unwrap();
        s.mkdir("/", "Docs").unwrap();
        s.put_file("/Docs", "report.pdf", 10, b"k", &[1u8; 12]).unwrap();
        s.put_file("/", "photo.jpg", 5, b"k", &[2u8; 6]).unwrap();
        s.put_file("/Docs", "notes.txt", 3, b"k", &[3u8; 4]).unwrap();

        // recursive search by name substring
        let hits = s.search("report").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "report.pdf");
        assert!(s.search("nomatch").unwrap().is_empty());
        // wildcard chars are treated literally (escaped)
        assert!(s.search("%").unwrap().is_empty());

        // global starred
        s.set_star("/Docs/report.pdf", true).unwrap();
        s.set_star("/photo.jpg", true).unwrap();
        let starred = s.list_starred().unwrap();
        assert_eq!(starred.len(), 2);
        assert!(starred.iter().all(|e| e.starred));

        // recent files (limit), files only
        let recent = s.list_recent(2).unwrap();
        assert_eq!(recent.len(), 2);
        assert!(recent.iter().all(|e| e.kind == Kind::File));

        // trashed items drop out of all three global views
        s.trash("/photo.jpg").unwrap();
        assert!(s.list_starred().unwrap().iter().all(|e| e.name != "photo.jpg"));
        assert!(s.search("photo").unwrap().is_empty());
        assert!(s.list_recent(10).unwrap().iter().all(|e| e.name != "photo.jpg"));
    }

    #[test]
    fn activity_log_records_newest_first() {
        let s = temp_store();
        s.log_activity("upload", "client", "a.bin").unwrap();
        s.log_activity("delete", "client", "b.bin").unwrap();
        let events = s.list_activity(10).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].detail, "b.bin");
        assert_eq!(events[0].kind, "delete");
        assert_eq!(s.list_activity(1).unwrap().len(), 1);
    }
}

// ---------------------------------------------------------------------------------------
// Private files
// ---------------------------------------------------------------------------------------

/// Write `bytes` to `path` so that only this user can read it back: mode 0600 on unix; on
/// Windows an ACL of the owner plus SYSTEM and Administrators with inheritance removed (the
/// shape OpenSSH uses for private keys — SYSTEM and Administrators can take ownership of any
/// file regardless, so excluding them buys nothing and breaks backup tools). Every piece of
/// key material on disk goes through here: the host's identity key, a client's device key, a
/// dev-mode account root key.
///
/// The write itself must succeed. Tightening the permissions is best-effort with a warning,
/// because a legitimate store can sit on a filesystem with no permissions to tighten (a
/// FAT-formatted external drive), and refusing to run there helps nobody.
pub fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::write(path, bytes)?;
    if let Err(e) = restrict_to_owner(path) {
        eprintln!(
            "[core-fs] could not restrict {} to this user ({e}); it is readable by other local accounts",
            path.display()
        );
    }
    Ok(())
}

#[cfg(unix)]
fn restrict_to_owner(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(windows)]
fn restrict_to_owner(path: &Path) -> std::io::Result<()> {
    use std::io::{Error, ErrorKind};
    use std::os::windows::process::CommandExt;

    let user = std::env::var("USERNAME")
        .map_err(|_| Error::new(ErrorKind::Other, "USERNAME is not set"))?;
    let mut cmd = std::process::Command::new("icacls");
    cmd.arg(path).args(["/inheritance:r", "/grant:r"]);
    // A service account's USERNAME is the machine account (`HOST$`), which icacls cannot
    // resolve locally; the SYSTEM grant below already covers it.
    if !user.ends_with('$') {
        cmd.arg(format!("{user}:F"));
    }
    // Well-known SIDs rather than names: "Administrators" is localized, S-1-5-32-544 is not.
    cmd.args(["*S-1-5-18:F", "*S-1-5-32-544:F"]);
    // CREATE_NO_WINDOW — a GUI app must not flash a console for this.
    let out = cmd.creation_flags(0x0800_0000).output()?;
    if out.status.success() {
        return Ok(());
    }
    // icacls reports its errors on stdout as often as stderr.
    let msg = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout).trim(),
        String::from_utf8_lossy(&out.stderr).trim()
    );
    Err(Error::new(ErrorKind::Other, msg))
}

#[cfg(not(any(unix, windows)))]
fn restrict_to_owner(_path: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "no permission model on this target"))
}

#[cfg(test)]
mod private_file_tests {
    use super::write_private;

    fn scratch(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("core-fs-private-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d.join(name)
    }

    #[test]
    fn contents_round_trip() {
        let p = scratch("key");
        write_private(&p, b"secret").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"secret");
    }

    #[cfg(unix)]
    #[test]
    fn unix_mode_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let p = scratch("mode");
        write_private(&p, b"k").unwrap();
        assert_eq!(std::fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600);
    }

    /// The property that matters on Windows: no inherited ACE survives, so the file does not
    /// pick up the "Users can read" entry every file under a profile directory starts with.
    /// `(I)` marks an inherited entry in `icacls` output in every language.
    #[cfg(windows)]
    #[test]
    fn windows_acl_has_no_inherited_entries() {
        let p = scratch("acl");
        write_private(&p, b"k").unwrap();
        let out = std::process::Command::new("icacls").arg(&p).output().unwrap();
        let listing = String::from_utf8_lossy(&out.stdout);
        assert!(!listing.contains("(I)"), "inherited ACE present:\n{listing}");
        // The listing prints the account's display casing, which need not match USERNAME.
        let user = std::env::var("USERNAME").unwrap().to_lowercase();
        assert!(listing.to_lowercase().contains(&user), "owner missing:\n{listing}");
    }
}
