//! `DavFileSystem` over a [`Drive`] (local or remote). Path handling maps directly
//! onto the store (ids ARE normalized paths). Metadata ops pass straight through;
//! file `open` returns a streaming read/write handle (see `file.rs`).

use std::sync::Arc;

use dav_server::davpath::DavPath;
use dav_server::fs::{
    DavDirEntry, DavFile, DavFileSystem, DavMetaData, FsError, FsFuture, FsResult, FsStream,
    OpenOptions, ReadDirMeta,
};
use futures_util::{stream, FutureExt, StreamExt};

use crate::drive::{Drive, DriveError};
use crate::file::{NullFile, ReadFile, WriteFile};
use crate::meta::{DirEntry, Meta};

/// WebDAV filesystem backed by any [`Drive`].
#[derive(Clone)]
pub struct WebdavFs {
    drive: Arc<dyn Drive>,
}

impl WebdavFs {
    pub fn new(drive: Arc<dyn Drive>) -> Box<WebdavFs> {
        Box::new(WebdavFs { drive })
    }
}

pub(crate) fn map_drive_err(e: DriveError) -> FsError {
    match e {
        DriveError::NotFound => FsError::NotFound,
        DriveError::QuotaExceeded => FsError::InsufficientStorage,
        DriveError::Other(_) => FsError::GeneralFailure,
    }
}

/// The WebDAV request path (percent-decoded, absolute) as a UTF-8 string.
fn path_str(p: &DavPath) -> FsResult<String> {
    std::str::from_utf8(p.as_bytes()).map(|s| s.to_string()).map_err(|_| FsError::GeneralFailure)
}

/// macOS treats a WebDAV mount as a "foreign" volume and, having no xattr or
/// resource-fork channel in the protocol, scatters filesystem-metadata files across it:
/// AppleDouble `._*` sidecars (a 4 KiB copy of the xattrs/resource fork for *every* file
/// it touches), plus `.DS_Store`, Spotlight/FSEvents/Trash markers, and friends.
///
/// We treat all of them as if they neither exist nor can be created. Stats and reads
/// answer NotFound, directory listings omit them, writes are accepted-then-discarded
/// (see [`NullFile`]), and a `remove` of one is a delete-if-present no-op. The upshot:
///  * no `._foo` is ever stored next to a real `foo` (the duplicates the user sees), and
///  * on a REMOTE mount, none of these probes becomes a network round-trip — a storm of
///    them on cold start is what makes webdavfs give up with "host not responding".
///
/// `is_os_junk_name` matches a bare filename; `is_os_junk` matches the last component of
/// a path.
fn is_os_junk_name(name: &str) -> bool {
    if name.starts_with("._") {
        return true;
    }
    matches!(
        name,
        ".DS_Store"
            | ".localized"
            | ".hidden"
            | ".metadata_never_index"
            | ".metadata_never_index_unless_rootfs"
            | ".Spotlight-V100"
            | ".fseventsd"
            | ".TemporaryItems"
            | ".Trashes"
            | ".apdisk"
            | ".VolumeIcon.icns"
            | ".DocumentRevisions-V100"
            | ".com.apple.timemachine.donotpresent"
            | ".autodiskmounted"
    )
}

fn is_os_junk(path: &str) -> bool {
    let name = path.trim_end_matches('/').rsplit('/').next().unwrap_or("");
    is_os_junk_name(name)
}

/// Split a path into `(parent, name)`, e.g. `/a/b -> ("/a","b")`, `/x -> ("/","x")`.
fn split_parent_name(path: &str) -> (String, String) {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rsplit_once('/') {
        Some(("", name)) => ("/".to_string(), name.to_string()),
        Some((parent, name)) => (parent.to_string(), name.to_string()),
        None => ("/".to_string(), trimmed.to_string()),
    }
}

impl DavFileSystem for WebdavFs {
    fn metadata<'a>(&'a self, path: &'a DavPath) -> FsFuture<'a, Box<dyn DavMetaData>> {
        async move {
            let p = path_str(path)?;
            if is_os_junk(&p) {
                return Err(FsError::NotFound);
            }
            match self.drive.stat(&p).await.map_err(map_drive_err)? {
                Some(e) => Ok(Box::new(Meta::from_entry(&e)) as Box<dyn DavMetaData>),
                None => Err(FsError::NotFound),
            }
        }
        .boxed()
    }

    fn read_dir<'a>(
        &'a self,
        path: &'a DavPath,
        _meta: ReadDirMeta,
    ) -> FsFuture<'a, FsStream<Box<dyn DavDirEntry>>> {
        async move {
            let p = path_str(path)?;
            if is_os_junk(&p) {
                return Err(FsError::NotFound);
            }
            match self.drive.stat(&p).await.map_err(map_drive_err)? {
                Some(e) if e.is_dir => {}
                Some(_) => return Err(FsError::Forbidden),
                None => return Err(FsError::NotFound),
            }
            let entries = self.drive.list(&p).await.map_err(map_drive_err)?;
            // Hide OS-junk from listings — including any `._*` stored by an older build,
            // before we started discarding them on write.
            let items: Vec<Box<dyn DavDirEntry>> = entries
                .iter()
                .filter(|e| !is_os_junk_name(&e.name))
                .map(|e| Box::new(DirEntry::from_entry(e)) as Box<dyn DavDirEntry>)
                .collect();
            let s = stream::iter(items).map(Ok);
            Ok(Box::pin(s) as FsStream<Box<dyn DavDirEntry>>)
        }
        .boxed()
    }

    fn open<'a>(
        &'a self,
        path: &'a DavPath,
        options: OpenOptions,
    ) -> FsFuture<'a, Box<dyn DavFile>> {
        async move {
            let p = path_str(path)?;
            let writing = options.write || options.append || options.truncate || options.create;
            // OS-junk (AppleDouble `._*`, `.DS_Store`, …): swallow writes into a NullFile so
            // nothing is stored; reads never find one (they were never stored).
            if is_os_junk(&p) {
                return if writing {
                    Ok(Box::new(NullFile::new()) as Box<dyn DavFile>)
                } else {
                    Err(FsError::NotFound)
                };
            }
            if writing {
                let existing = self.drive.stat(&p).await.map_err(map_drive_err)?;
                if let Some(e) = &existing {
                    if e.is_dir {
                        return Err(FsError::Forbidden);
                    }
                }
                if options.create_new && existing.is_some() {
                    return Err(FsError::Exists);
                }
                if existing.is_none() && !options.create {
                    return Err(FsError::NotFound);
                }
                let (parent, name) = split_parent_name(&p);
                if name.is_empty() {
                    return Err(FsError::Forbidden);
                }
                // Parent must exist and be a directory (else WebDAV 409-ish).
                let parent_ok = self
                    .drive
                    .stat(&parent)
                    .await
                    .map_err(map_drive_err)?
                    .map(|e| e.is_dir)
                    .unwrap_or(false);
                if !parent_ok {
                    return Err(FsError::NotFound);
                }
                match options.size {
                    Some(n) => {
                        let handle =
                            self.drive.write_begin(&parent, &name, n).await.map_err(map_drive_err)?;
                        Ok(Box::new(WriteFile::streaming(self.drive.clone(), handle))
                            as Box<dyn DavFile>)
                    }
                    None => Ok(Box::new(WriteFile::buffering(self.drive.clone(), parent, name))
                        as Box<dyn DavFile>),
                }
            } else {
                match self.drive.stat(&p).await.map_err(map_drive_err)? {
                    None => Err(FsError::NotFound),
                    Some(e) if e.is_dir => Err(FsError::Forbidden),
                    Some(_) => {
                        let handle = self
                            .drive
                            .read_begin(&p)
                            .await
                            .map_err(map_drive_err)?
                            .ok_or(FsError::NotFound)?;
                        Ok(Box::new(ReadFile::new(self.drive.clone(), handle)) as Box<dyn DavFile>)
                    }
                }
            }
        }
        .boxed()
    }

    fn create_dir<'a>(&'a self, path: &'a DavPath) -> FsFuture<'a, ()> {
        async move {
            let p = path_str(path)?;
            // e.g. `.Trashes`, `.TemporaryItems`: pretend we made it, store nothing.
            if is_os_junk(&p) {
                return Ok(());
            }
            let (parent, name) = split_parent_name(&p);
            if name.is_empty() {
                return Err(FsError::Forbidden);
            }
            let parent_ok = self
                .drive
                .stat(&parent)
                .await
                .map_err(map_drive_err)?
                .map(|e| e.is_dir)
                .unwrap_or(false);
            if !parent_ok {
                return Err(FsError::NotFound);
            }
            if self.drive.stat(&p).await.map_err(map_drive_err)?.is_some() {
                return Err(FsError::Exists);
            }
            self.drive.mkdir(&parent, &name).await.map_err(map_drive_err)
        }
        .boxed()
    }

    fn remove_file<'a>(&'a self, path: &'a DavPath) -> FsFuture<'a, ()> {
        async move {
            let p = path_str(path)?;
            // OS-junk: it was never really stored, so removal must always "succeed"
            // (Finder deletes `._foo` right after `foo`). If an older build DID store one,
            // clean it up now — this is how pre-existing `._*` orphans get swept.
            if is_os_junk(&p) {
                if self.drive.stat(&p).await.map_err(map_drive_err)?.is_some() {
                    let _ = self.drive.delete(&p).await;
                }
                return Ok(());
            }
            if self.drive.stat(&p).await.map_err(map_drive_err)?.is_none() {
                return Err(FsError::NotFound);
            }
            self.drive.delete(&p).await.map_err(map_drive_err)
        }
        .boxed()
    }

    fn remove_dir<'a>(&'a self, path: &'a DavPath) -> FsFuture<'a, ()> {
        async move {
            let p = path_str(path)?;
            if is_os_junk(&p) {
                if self.drive.stat(&p).await.map_err(map_drive_err)?.is_some() {
                    let _ = self.drive.delete(&p).await;
                }
                return Ok(());
            }
            if self.drive.stat(&p).await.map_err(map_drive_err)?.is_none() {
                return Err(FsError::NotFound);
            }
            self.drive.delete(&p).await.map_err(map_drive_err)
        }
        .boxed()
    }

    fn rename<'a>(&'a self, from: &'a DavPath, to: &'a DavPath) -> FsFuture<'a, ()> {
        async move {
            let f = path_str(from)?;
            let t = path_str(to)?;
            // A junk source never existed, and a junk destination is discarded — either
            // way there is nothing real to move, so don't error the operation.
            if is_os_junk(&f) || is_os_junk(&t) {
                return Ok(());
            }
            let (to_parent, to_name) = split_parent_name(&t);
            if to_name.is_empty() {
                return Err(FsError::Forbidden);
            }
            self.drive.rename(&f, &to_parent, &to_name).await.map_err(map_drive_err)
        }
        .boxed()
    }

    fn get_quota(&self) -> FsFuture<'_, (u64, Option<u64>)> {
        async move {
            let u = self.drive.usage().await.map_err(map_drive_err)?;
            Ok((u.used, Some(u.total)))
        }
        .boxed()
    }
}

#[cfg(test)]
mod tests {
    use super::{is_os_junk, is_os_junk_name};

    #[test]
    fn os_junk_paths_are_short_circuited() {
        // macOS junk that must NOT be stored / reach the network on a remote mount.
        for p in [
            "/.DS_Store",
            "/Docs/.DS_Store",
            "/._resume.pdf",
            "/Docs/._photo.jpg",
            "/.Spotlight-V100",
            "/.fseventsd",
            "/.metadata_never_index",
            "/.Trashes",
            "/Docs/.Trashes/",
        ] {
            assert!(is_os_junk(p), "should short-circuit {p}");
        }
        // Real user paths must pass through to the drive.
        for p in ["/", "/Docs", "/Docs/report.pdf", "/photo.jpg", "/.config", "/notes.txt"] {
            assert!(!is_os_junk(p), "should NOT short-circuit {p}");
        }
    }

    #[test]
    fn junk_is_matched_by_bare_name_too() {
        // Used to filter directory listings, where we only have the entry name.
        assert!(is_os_junk_name("._photo.jpg"));
        assert!(is_os_junk_name(".DS_Store"));
        assert!(!is_os_junk_name("photo.jpg"));
        assert!(!is_os_junk_name("report.pdf"));
        // A real file that merely starts with a dot is NOT junk.
        assert!(!is_os_junk_name(".config"));
        // A real file whose name legitimately contains "._" mid-string is NOT junk.
        assert!(!is_os_junk_name("v1._final.txt"));
    }
}
