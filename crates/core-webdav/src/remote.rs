//! `Drive` over a remote host reached via the relay/QUIC (`client_core::RemoteDrive`).
//!
//! The connection is a single, strict request/response stream, so calls are
//! serialized. Crucially they are also **cancellation-safe**: macOS webdavfs freely
//! cancels slow or concurrent requests, which drops our handler future mid-request —
//! and a request abandoned mid-stream would leave its response unread, so the NEXT
//! request would read the stale response and every reply would shift by one (Finder
//! then shows a folder nested inside itself, forever). To prevent that, each op runs
//! on a DETACHED task via [`RemoteDrive::run`]: even if the caller is cancelled, the
//! round-trip completes and the stream stays aligned.
//!
//! The Account Root Key lives here (client side); the host only ever sees ciphertext.
//! Files stream in 4 MiB chunks over the chunked RPC, so a whole file never sits in
//! memory on either side.

use std::future::Future;
use std::sync::Arc;

use anyhow::anyhow;
use async_trait::async_trait;
use client_core::RemoteDrive as RemoteClient;
use core_crypto::{AccountRootKey, SymKey};
use core_proto::{EntryKind, FileEntry};
use tokio::sync::{Mutex, OwnedMutexGuard};

use crate::drive::{Drive, DriveError, DriveResult, Entry, HandleRoute, ReadHandle, Usage, WriteHandle};

/// A drive backed by a remote host over the relay/QUIC.
pub struct RemoteDrive {
    client: Arc<Mutex<RemoteClient>>,
    ark: Arc<AccountRootKey>,
}

impl RemoteDrive {
    pub fn new(client: RemoteClient, ark: AccountRootKey) -> Self {
        Self { client: Arc::new(Mutex::new(client)), ark: Arc::new(ark) }
    }

    /// Run one client operation on a **detached** task so that cancelling the caller
    /// (e.g. macOS aborting a WebDAV request) never abandons a request mid-stream —
    /// the task holds the lock, completes the round-trip, and releases it, keeping the
    /// strict req/resp connection aligned. Ops still serialize (one lock at a time).
    async fn run<T, F, Fut>(&self, f: F) -> DriveResult<T>
    where
        T: Send + 'static,
        F: FnOnce(OwnedMutexGuard<RemoteClient>) -> Fut + Send + 'static,
        Fut: Future<Output = DriveResult<T>> + Send,
    {
        let client = self.client.clone();
        tokio::spawn(async move {
            let guard = client.lock_owned().await;
            f(guard).await
        })
        .await
        .map_err(|e| DriveError::Other(anyhow!("drive task failed: {e}")))?
    }
}

fn entry_from_file(e: &FileEntry) -> Entry {
    Entry {
        name: e.name.clone(),
        is_dir: matches!(e.kind, EntryKind::Dir),
        len: e.size_bytes,
        mtime_ms: e.modified as i64,
    }
}

#[async_trait]
impl Drive for RemoteDrive {
    async fn stat(&self, path: &str) -> DriveResult<Option<Entry>> {
        let path = path.to_string();
        self.run(move |mut c| async move {
            let e = c.stat(&path).await?;
            Ok(e.as_ref().map(entry_from_file))
        })
        .await
    }
    async fn list(&self, path: &str) -> DriveResult<Vec<Entry>> {
        let path = path.to_string();
        self.run(move |mut c| async move {
            let entries = c.list(&path).await?;
            Ok(entries.iter().map(entry_from_file).collect())
        })
        .await
    }
    async fn mkdir(&self, parent: &str, name: &str) -> DriveResult<()> {
        let (parent, name) = (parent.to_string(), name.to_string());
        self.run(move |mut c| async move { Ok(c.mkdir(&parent, &name).await?) }).await
    }
    async fn delete(&self, path: &str) -> DriveResult<()> {
        let path = path.to_string();
        self.run(move |mut c| async move { Ok(c.delete(&path).await?) }).await
    }
    async fn rename(&self, from: &str, to_parent: &str, to_name: &str) -> DriveResult<()> {
        let (from, to_parent, to_name) =
            (from.to_string(), to_parent.to_string(), to_name.to_string());
        self.run(move |mut c| async move { Ok(c.rename(&from, &to_parent, &to_name).await?) }).await
    }
    async fn usage(&self) -> DriveResult<Usage> {
        let q = self.run(move |mut c| async move { Ok(c.quota().await?) }).await?;
        Ok(Usage { used: q.used_bytes, total: q.quota_bytes })
    }

    async fn read_begin(&self, path: &str) -> DriveResult<Option<ReadHandle>> {
        let p = path.to_string();
        let Some(info) = self.run(move |mut c| async move { Ok(c.read_begin(&p).await?) }).await?
        else {
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
        let path = handle.path.clone();
        let ct = self
            .run(move |mut c| async move { Ok(c.read_chunk(&path, seq as u64).await?) })
            .await?;
        Ok(core_crypto::open_chunk(&handle.ck, seq, &ct).map_err(|_| anyhow!("decrypt chunk {seq}"))?)
    }

    async fn write_begin(&self, parent: &str, name: &str, total_len: u64) -> DriveResult<WriteHandle> {
        let ck = SymKey::generate();
        let wrapped = self.ark.wrap_content_key(&ck);
        let (parent, name) = (parent.to_string(), name.to_string());
        let id = self
            .run(move |mut c| async move {
                c.upload_begin(&parent, &name, total_len, wrapped).await.map_err(|e| {
                    if e.to_string().contains("quota exceeded") {
                        DriveError::QuotaExceeded
                    } else {
                        DriveError::Other(e)
                    }
                })
            })
            .await?;
        Ok(WriteHandle { id, ck, route: HandleRoute::Direct })
    }
    async fn write_chunk(&self, handle: &WriteHandle, seq: u32, plaintext: &[u8]) -> DriveResult<()> {
        let ct = core_crypto::seal_chunk(&handle.ck, seq, plaintext);
        let id = handle.id.clone();
        self.run(move |mut c| async move { Ok(c.upload_chunk(&id, ct).await?) }).await
    }
    async fn write_commit(&self, handle: &WriteHandle) -> DriveResult<()> {
        let id = handle.id.clone();
        self.run(move |mut c| async move { Ok(c.upload_commit(&id).await?) }).await
    }
    async fn write_abort(&self, handle: &WriteHandle) -> DriveResult<()> {
        let id = handle.id.clone();
        self.run(move |mut c| async move { Ok(c.upload_abort(&id).await?) }).await
    }
}
