//! The drive abstraction the WebDAV layer targets, plus the local (in-process)
//! implementation.
//!
//! A `Drive` presents a **streaming, plaintext** view of an encrypted store:
//! metadata ops pass through; file bytes are transferred in fixed 4 MiB plaintext
//! chunks, each AEAD-sealed under a per-file content key with a sequence-bound AAD
//! (byte-compatible with the TS client — see `core_crypto::seal_chunk`). All crypto
//! (content-key generation + ARK wrap/unwrap) lives in the impl, so callers only
//! ever handle plaintext and never hold a whole file in memory.
//!
//! W1.1 provides [`LocalDrive`] (in-process `core-fs` store). W2 adds a second impl
//! over the relay.

use std::sync::{Arc, Mutex, MutexGuard};

use anyhow::anyhow;
use async_trait::async_trait;
use core_crypto::{AccountRootKey, SymKey};
use core_fs::{EntryRow, Kind, Store, UploadBeginOutcome};

/// Plaintext bytes per chunk. MUST match the TS client's `UPLOAD_CHUNK` so files
/// stream-interoperate between the WebDAV mount and the browser.
pub const CHUNK: usize = 4 * 1024 * 1024;

/// A directory entry, in plaintext terms.
#[derive(Clone, Debug)]
pub struct Entry {
    pub name: String,
    pub is_dir: bool,
    pub len: u64,
    pub mtime_ms: i64,
}

/// Partition usage.
#[derive(Clone, Copy, Debug)]
pub struct Usage {
    pub used: u64,
    pub total: u64,
}

/// How a handle finds its way back to the backend that issued it.
///
/// A concrete single-backend drive ([`LocalDrive`], `RemoteDrive`) tags every handle
/// `Direct` — there is only one place a chunk can go. The composite `MultiHostDrive`
/// (see `multi.rs`) hands the WebDAV layer a *token* handle tagged `Member(id)` and
/// keeps the real per-host handle(s) in its registry, so each chunk op is routed to the
/// host that issued them.
#[derive(Clone, Copy, Debug)]
pub(crate) enum HandleRoute {
    Direct,
    Member(u64),
}

/// An open read session: total plaintext length, chunk count, and the unwrapped
/// content key (used internally by the impl to decrypt chunks).
#[derive(Clone)]
pub struct ReadHandle {
    pub len: u64,
    pub chunk_count: u32,
    pub(crate) path: String,
    pub(crate) ck: SymKey,
    pub(crate) route: HandleRoute,
}

/// An open write session: the backend upload id and the fresh content key.
#[derive(Clone)]
pub struct WriteHandle {
    pub(crate) id: String,
    pub(crate) ck: SymKey,
    pub(crate) route: HandleRoute,
}

/// Drive-level errors the WebDAV layer maps onto WebDAV/HTTP statuses.
#[derive(Debug)]
pub enum DriveError {
    NotFound,
    QuotaExceeded,
    Other(anyhow::Error),
}

impl From<anyhow::Error> for DriveError {
    fn from(e: anyhow::Error) -> Self {
        DriveError::Other(e)
    }
}

pub type DriveResult<T> = std::result::Result<T, DriveError>;

/// Streaming, plaintext-facing view of an encrypted drive.
#[async_trait]
pub trait Drive: Send + Sync {
    async fn stat(&self, path: &str) -> DriveResult<Option<Entry>>;
    async fn list(&self, path: &str) -> DriveResult<Vec<Entry>>;
    async fn mkdir(&self, parent: &str, name: &str) -> DriveResult<()>;
    async fn delete(&self, path: &str) -> DriveResult<()>;
    async fn rename(&self, from: &str, to_parent: &str, to_name: &str) -> DriveResult<()>;
    async fn usage(&self) -> DriveResult<Usage>;

    /// Open a file for streaming reads. `None` if the path is not a file.
    async fn read_begin(&self, path: &str) -> DriveResult<Option<ReadHandle>>;
    /// Fetch + decrypt chunk `seq`, returning its plaintext.
    async fn read_chunk(&self, handle: &ReadHandle, seq: u32) -> DriveResult<Vec<u8>>;

    /// Begin a streaming write of `total_len` plaintext bytes to `parent/name`.
    async fn write_begin(&self, parent: &str, name: &str, total_len: u64) -> DriveResult<WriteHandle>;
    /// Encrypt + append one plaintext chunk (`seq`) to the session.
    async fn write_chunk(&self, handle: &WriteHandle, seq: u32, plaintext: &[u8]) -> DriveResult<()>;
    async fn write_commit(&self, handle: &WriteHandle) -> DriveResult<()>;
    async fn write_abort(&self, handle: &WriteHandle) -> DriveResult<()>;
}

fn entry_from_row(e: &EntryRow) -> Entry {
    Entry { name: e.name.clone(), is_dir: e.kind == Kind::Dir, len: e.size_plain, mtime_ms: e.mtime }
}

/// In-process drive over a local encrypted `core-fs` `Store` + the Account Root Key.
#[derive(Clone)]
pub struct LocalDrive {
    store: Arc<Mutex<Store>>,
    ark: Arc<AccountRootKey>,
}

impl LocalDrive {
    pub fn new(store: Store, ark: AccountRootKey) -> Self {
        Self { store: Arc::new(Mutex::new(store)), ark: Arc::new(ark) }
    }
    fn store(&self) -> MutexGuard<'_, Store> {
        self.store.lock().expect("store mutex poisoned")
    }
}

#[async_trait]
impl Drive for LocalDrive {
    async fn stat(&self, path: &str) -> DriveResult<Option<Entry>> {
        Ok(self.store().stat(path)?.as_ref().map(entry_from_row))
    }
    async fn list(&self, path: &str) -> DriveResult<Vec<Entry>> {
        Ok(self.store().list(path)?.iter().map(entry_from_row).collect())
    }
    async fn mkdir(&self, parent: &str, name: &str) -> DriveResult<()> {
        self.store().mkdir(parent, name)?;
        Ok(())
    }
    async fn delete(&self, path: &str) -> DriveResult<()> {
        Ok(self.store().delete(path)?)
    }
    async fn rename(&self, from: &str, to_parent: &str, to_name: &str) -> DriveResult<()> {
        Ok(self.store().rename(from, to_parent, to_name)?)
    }
    async fn usage(&self) -> DriveResult<Usage> {
        let q = self.store().quota()?;
        Ok(Usage { used: q.used_bytes(), total: q.quota_bytes })
    }

    async fn read_begin(&self, path: &str) -> DriveResult<Option<ReadHandle>> {
        let Some(info) = self.store().begin_read(path)? else {
            return Ok(None);
        };
        let ck = self
            .ark
            .unwrap_content_key(&info.wrapped_ck)
            .map_err(|_| anyhow!("unwrap content key"))?;
        Ok(Some(ReadHandle {
            len: info.plaintext_len,
            chunk_count: info.chunk_count as u32,
            path: path.to_string(),
            ck,
            route: HandleRoute::Direct,
        }))
    }
    async fn read_chunk(&self, handle: &ReadHandle, seq: u32) -> DriveResult<Vec<u8>> {
        let ct = self
            .store()
            .read_chunk(&handle.path, seq as u64)?
            .ok_or(DriveError::NotFound)?;
        Ok(core_crypto::open_chunk(&handle.ck, seq, &ct).map_err(|_| anyhow!("decrypt chunk {seq}"))?)
    }

    async fn write_begin(&self, parent: &str, name: &str, total_len: u64) -> DriveResult<WriteHandle> {
        let ck = SymKey::generate();
        let wrapped = self.ark.wrap_content_key(&ck);
        match self.store().begin_upload(parent, name, total_len, &wrapped)? {
            UploadBeginOutcome::Started { upload_id } => {
                Ok(WriteHandle { id: upload_id, ck, route: HandleRoute::Direct })
            }
            UploadBeginOutcome::QuotaExceeded { .. } => Err(DriveError::QuotaExceeded),
        }
    }
    async fn write_chunk(&self, handle: &WriteHandle, seq: u32, plaintext: &[u8]) -> DriveResult<()> {
        let ct = core_crypto::seal_chunk(&handle.ck, seq, plaintext);
        Ok(self.store().upload_chunk(&handle.id, &ct)?)
    }
    async fn write_commit(&self, handle: &WriteHandle) -> DriveResult<()> {
        self.store().commit_upload(&handle.id)?;
        Ok(())
    }
    async fn write_abort(&self, handle: &WriteHandle) -> DriveResult<()> {
        Ok(self.store().abort_upload(&handle.id)?)
    }
}
