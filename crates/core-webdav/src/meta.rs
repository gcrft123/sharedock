//! `DavMetaData` + `DavDirEntry` adapters over the drive's plaintext `Entry`.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use dav_server::fs::{DavDirEntry, DavMetaData, FsFuture, FsResult};
use futures_util::future;

use crate::drive::Entry;

/// File/dir metadata surfaced to WebDAV clients (plaintext length + mtime).
#[derive(Clone, Debug)]
pub struct Meta {
    len: u64,
    is_dir: bool,
    mtime_ms: i64,
}

impl Meta {
    pub fn from_entry(e: &Entry) -> Self {
        Self { len: e.len, is_dir: e.is_dir, mtime_ms: e.mtime_ms }
    }
    pub fn file(len: u64, mtime_ms: i64) -> Self {
        Self { len, is_dir: false, mtime_ms }
    }
}

impl DavMetaData for Meta {
    fn len(&self) -> u64 {
        self.len
    }
    fn is_dir(&self) -> bool {
        self.is_dir
    }
    fn is_symlink(&self) -> bool {
        false
    }
    fn modified(&self) -> FsResult<SystemTime> {
        Ok(UNIX_EPOCH + Duration::from_millis(self.mtime_ms.max(0) as u64))
    }
}

/// One entry in a directory listing.
pub struct DirEntry {
    name: Vec<u8>,
    meta: Meta,
}

impl DirEntry {
    pub fn from_entry(e: &Entry) -> Self {
        Self { name: e.name.clone().into_bytes(), meta: Meta::from_entry(e) }
    }
}

impl DavDirEntry for DirEntry {
    fn name(&self) -> Vec<u8> {
        self.name.clone()
    }
    fn metadata(&self) -> FsFuture<'_, Box<dyn DavMetaData>> {
        let m = self.meta.clone();
        Box::pin(future::ready(Ok(Box::new(m) as Box<dyn DavMetaData>)))
    }
    fn is_dir(&self) -> FsFuture<'_, bool> {
        let is_dir = self.meta.is_dir;
        Box::pin(future::ready(Ok(is_dir)))
    }
}
