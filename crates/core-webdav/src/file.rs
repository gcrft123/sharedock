//! Streaming `DavFile` implementations over a [`Drive`].
//!
//! Reads decrypt only the 4 MiB chunk under the cursor (seekable, so a whole file
//! never sits in memory). Writes stream: incoming bytes are buffered up to one
//! chunk, sealed, and uploaded as they fill; the final partial chunk + commit land
//! on `flush`. If the client sends no `Content-Length` (`OpenOptions.size == None`)
//! we can't reserve quota up front, so we fall back to buffering the whole body and
//! chunk it on `flush`.

use std::io::SeekFrom;
use std::sync::Arc;

use bytes::{Buf, Bytes};
use dav_server::fs::{DavFile, DavMetaData, FsError, FsFuture, FsResult};
use futures_util::future;

use crate::drive::{Drive, ReadHandle, WriteHandle, CHUNK};
use crate::fs::map_drive_err;
use crate::meta::Meta;

/// A read-only, seekable view over a file — one decrypted chunk cached at a time.
pub struct ReadFile {
    drive: Arc<dyn Drive>,
    handle: ReadHandle,
    pos: u64,
    cached_seq: Option<u32>,
    cached: Vec<u8>,
}

impl ReadFile {
    pub fn new(drive: Arc<dyn Drive>, handle: ReadHandle) -> Self {
        Self { drive, handle, pos: 0, cached_seq: None, cached: Vec::new() }
    }
}

impl std::fmt::Debug for ReadFile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "ReadFile {{ len: {}, pos: {} }}", self.handle.len, self.pos)
    }
}

impl DavFile for ReadFile {
    fn metadata(&mut self) -> FsFuture<'_, Box<dyn DavMetaData>> {
        let m = Meta::file(self.handle.len, 0);
        Box::pin(future::ready(Ok(Box::new(m) as Box<dyn DavMetaData>)))
    }
    fn read_bytes(&mut self, count: usize) -> FsFuture<'_, Bytes> {
        Box::pin(async move {
            if self.pos >= self.handle.len {
                return Ok(Bytes::new());
            }
            let seq = (self.pos / CHUNK as u64) as u32;
            if self.cached_seq != Some(seq) {
                let pt = self.drive.read_chunk(&self.handle, seq).await.map_err(map_drive_err)?;
                self.cached = pt;
                self.cached_seq = Some(seq);
            }
            let off = (self.pos % CHUNK as u64) as usize;
            if off >= self.cached.len() {
                return Ok(Bytes::new());
            }
            let n = count.min(self.cached.len() - off);
            let out = Bytes::copy_from_slice(&self.cached[off..off + n]);
            self.pos += n as u64;
            Ok(out)
        })
    }
    fn seek(&mut self, pos: SeekFrom) -> FsFuture<'_, u64> {
        let len = self.handle.len as i64;
        let target = match pos {
            SeekFrom::Start(n) => n as i64,
            SeekFrom::End(d) => len + d,
            SeekFrom::Current(d) => self.pos as i64 + d,
        };
        let target = target.clamp(0, len) as u64;
        self.pos = target;
        Box::pin(future::ready(Ok(target)))
    }
    fn write_bytes(&mut self, _buf: Bytes) -> FsFuture<'_, ()> {
        Box::pin(future::ready(Err(FsError::Forbidden)))
    }
    fn write_buf(&mut self, _buf: Box<dyn Buf + Send>) -> FsFuture<'_, ()> {
        Box::pin(future::ready(Err(FsError::Forbidden)))
    }
    fn flush(&mut self) -> FsFuture<'_, ()> {
        Box::pin(future::ready(Ok(())))
    }
}

/// A write handle that streams 4 MiB chunks. Writes must be sequential (as WebDAV
/// PUT delivers them); a non-sequential seek is rejected.
pub struct WriteFile {
    drive: Arc<dyn Drive>,
    /// Present in streaming mode (size known up front).
    handle: Option<WriteHandle>,
    /// Present in buffering mode (size unknown): where to write on flush.
    target: Option<(String, String)>,
    /// Streaming: the unflushed tail (< CHUNK). Buffering: the whole body.
    buf: Vec<u8>,
    seq: u32,
    written: u64,
    done: bool,
}

impl WriteFile {
    /// Size known: reserve + stream chunks as they fill.
    pub fn streaming(drive: Arc<dyn Drive>, handle: WriteHandle) -> Self {
        Self { drive, handle: Some(handle), target: None, buf: Vec::new(), seq: 0, written: 0, done: false }
    }
    /// Size unknown: buffer the whole body, chunk it on flush.
    pub fn buffering(drive: Arc<dyn Drive>, parent: String, name: String) -> Self {
        Self {
            drive,
            handle: None,
            target: Some((parent, name)),
            buf: Vec::new(),
            seq: 0,
            written: 0,
            done: false,
        }
    }

    async fn append(&mut self, bytes: &[u8]) -> FsResult<()> {
        if self.done {
            return Err(FsError::Forbidden);
        }
        self.written += bytes.len() as u64;
        self.buf.extend_from_slice(bytes);
        // Streaming mode: flush any full chunks immediately.
        if self.handle.is_some() {
            while self.buf.len() >= CHUNK {
                let chunk: Vec<u8> = self.buf.drain(..CHUNK).collect();
                let seq = self.seq;
                self.seq += 1;
                let handle = self.handle.as_ref().unwrap();
                self.drive.write_chunk(handle, seq, &chunk).await.map_err(map_drive_err)?;
            }
        }
        Ok(())
    }

    async fn finish(&mut self) -> FsResult<()> {
        if self.done {
            return Ok(());
        }
        self.done = true;
        match self.handle.take() {
            // Streaming: upload the final partial chunk, then commit.
            Some(handle) => {
                if !self.buf.is_empty() {
                    let chunk = std::mem::take(&mut self.buf);
                    self.drive.write_chunk(&handle, self.seq, &chunk).await.map_err(map_drive_err)?;
                    self.seq += 1;
                }
                self.drive.write_commit(&handle).await.map_err(map_drive_err)?;
            }
            // Buffering fallback: now that we know the size, begin + upload + commit.
            None => {
                let (parent, name) = self.target.take().ok_or(FsError::GeneralFailure)?;
                let body = std::mem::take(&mut self.buf);
                let handle = self
                    .drive
                    .write_begin(&parent, &name, body.len() as u64)
                    .await
                    .map_err(map_drive_err)?;
                let mut seq = 0u32;
                for chunk in body.chunks(CHUNK) {
                    self.drive.write_chunk(&handle, seq, chunk).await.map_err(map_drive_err)?;
                    seq += 1;
                }
                self.drive.write_commit(&handle).await.map_err(map_drive_err)?;
            }
        }
        Ok(())
    }
}

impl std::fmt::Debug for WriteFile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "WriteFile {{ written: {}, seq: {}, done: {} }}", self.written, self.seq, self.done)
    }
}

/// A write handle that accepts everything and stores nothing — for OS-junk paths
/// (AppleDouble `._*`, `.DS_Store`, …). macOS insists on writing these sidecars over
/// WebDAV because the protocol gives it no xattr/resource-fork channel; rather than
/// persist a 4 KiB `._foo` next to every real `foo`, we let the PUT "succeed" and drop
/// the bytes. Reads report an empty file, but the FS layer answers `metadata`/`read_dir`
/// for these paths as NotFound anyway, so a `NullFile` never actually surfaces.
pub struct NullFile {
    written: u64,
}

impl NullFile {
    pub fn new() -> Self {
        Self { written: 0 }
    }
}

impl Default for NullFile {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for NullFile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "NullFile {{ written: {} }}", self.written)
    }
}

impl DavFile for NullFile {
    fn metadata(&mut self) -> FsFuture<'_, Box<dyn DavMetaData>> {
        let m = Meta::file(self.written, 0);
        Box::pin(future::ready(Ok(Box::new(m) as Box<dyn DavMetaData>)))
    }
    fn write_bytes(&mut self, buf: Bytes) -> FsFuture<'_, ()> {
        self.written += buf.len() as u64;
        Box::pin(future::ready(Ok(())))
    }
    fn write_buf(&mut self, buf: Box<dyn Buf + Send>) -> FsFuture<'_, ()> {
        self.written += buf.remaining() as u64;
        Box::pin(future::ready(Ok(())))
    }
    fn read_bytes(&mut self, _count: usize) -> FsFuture<'_, Bytes> {
        Box::pin(future::ready(Ok(Bytes::new())))
    }
    fn seek(&mut self, _pos: SeekFrom) -> FsFuture<'_, u64> {
        let written = self.written;
        Box::pin(future::ready(Ok(written)))
    }
    fn flush(&mut self) -> FsFuture<'_, ()> {
        Box::pin(future::ready(Ok(())))
    }
}

impl DavFile for WriteFile {
    fn metadata(&mut self) -> FsFuture<'_, Box<dyn DavMetaData>> {
        let m = Meta::file(self.written, 0);
        Box::pin(future::ready(Ok(Box::new(m) as Box<dyn DavMetaData>)))
    }
    fn write_bytes(&mut self, buf: Bytes) -> FsFuture<'_, ()> {
        Box::pin(async move { self.append(&buf).await })
    }
    fn write_buf(&mut self, mut buf: Box<dyn Buf + Send>) -> FsFuture<'_, ()> {
        Box::pin(async move {
            let mut v = Vec::with_capacity(buf.remaining());
            while buf.has_remaining() {
                let c = buf.chunk().to_vec();
                buf.advance(c.len());
                v.extend_from_slice(&c);
            }
            self.append(&v).await
        })
    }
    fn read_bytes(&mut self, _count: usize) -> FsFuture<'_, Bytes> {
        Box::pin(future::ready(Err(FsError::Forbidden)))
    }
    fn seek(&mut self, pos: SeekFrom) -> FsFuture<'_, u64> {
        // Sequential writes only (WebDAV PUT streams in order): a seek to the
        // current end is a no-op; anything else is unsupported for streaming.
        let written = self.written;
        Box::pin(async move {
            match pos {
                SeekFrom::Start(n) if n == written => Ok(written),
                SeekFrom::Current(0) => Ok(written),
                SeekFrom::End(0) => Ok(written),
                _ => Err(FsError::NotImplemented),
            }
        })
    }
    fn flush(&mut self) -> FsFuture<'_, ()> {
        Box::pin(async move { self.finish().await })
    }
}
