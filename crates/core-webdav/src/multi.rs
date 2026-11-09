//! `MultiHostDrive` — a composite [`Drive`] that fans one WebDAV mount out across N
//! per-host drives.
//!
//! It slots in at the single `WebdavFs` → `Arc<dyn Drive>` seam, so the WebDAV layer,
//! Finder, downloads and edits are unchanged — all the multi-host behaviour lives here.
//! The Account Root Key is *not* held here: it lives inside each member drive
//! ([`LocalDrive`]/`RemoteDrive`), which already does the crypto, so the composite only
//! ever routes plaintext-facing calls.
//!
//! ## Modes
//! - **Single** — one member; a pure passthrough (the regression-safe base case).
//! - **Pool** — capacity adds up: each *file* lives on one host, the *directory tree* is
//!   replicated to every host, and listings are the union across hosts. A write is placed
//!   on one host by a [`Strategy`] (balanced = least-full, or sequential).
//! - **Mirror** — every file on every host. The client writes to ONE best-connected host
//!   (`first_healthy`); a separate host-to-host mesh (the daemon) replicates the exact
//!   ciphertext to the others, so reads/failover can hit any host. Reads, listings and
//!   directory ops behave as in Pool; `usage` reports the smallest host (a byte lands on
//!   all of them).
//!
//! ## Health & reconnect
//! Each member has a health flag. A supervisor task (see [`MultiHostDrive::new_supervised`])
//! periodically pings each host; a host that fails is marked unhealthy so ops route around
//! it (the pool keeps serving the survivors), and — if the member was given a reconnector —
//! its dropped connection is rebuilt and the member rejoins. Ops skip unhealthy members
//! *unless none are healthy*, so a transient all-down still gets retried.
//!
//! ## Handle routing
//! The `Drive` handles carry no host id, so `read_begin`/`write_begin` stash the real
//! per-host handle(s) in a registry and hand back a *token* handle tagged
//! `HandleRoute::Member(id)`. `read_chunk`/`write_chunk`/commit/abort look the id up and
//! dispatch to the owning host. (Registry entries drop on commit/abort; a TTL sweep for
//! abandoned reads is a later refinement.)

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::anyhow;
use async_trait::async_trait;
use tokio::task::JoinHandle;

use crate::drive::{
    Drive, DriveError, DriveResult, Entry, HandleRoute, ReadHandle, Usage, WriteHandle,
};

/// A host's stable identity (its endpoint id / device pubkey hex). Used for discovery,
/// health reporting, and logging; the routing itself is by member index.
pub type HostId = String;

/// Rebuilds a dropped member's connection. Returns a fresh drive to swap in. The client
/// `Wire` is one-shot (dead-latches on timeout), so recovery means a full re-dial.
pub type Reconnector =
    Arc<dyn Fn() -> Pin<Box<dyn Future<Output = anyhow::Result<Arc<dyn Drive>>> + Send>> + Send + Sync>;

/// Where a pool write is placed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Strategy {
    /// Least-full host first — machines fill evenly (default).
    Balanced,
    /// Fill the first host, then the next, and so on.
    Sequential,
}

/// How the mount fans out across its hosts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Single,
    Pool(Strategy),
    Mirror,
}

struct Member {
    /// Stable host id (endpoint id). Consumed by discovery/health reporting.
    id: HostId,
    /// The current drive; swapped out by the supervisor on reconnect.
    drive: Mutex<Arc<dyn Drive>>,
    healthy: AtomicBool,
    reconnect: Option<Reconnector>,
}

impl Member {
    fn current(&self) -> Arc<dyn Drive> {
        self.drive.lock().unwrap().clone()
    }
    fn is_healthy(&self) -> bool {
        self.healthy.load(Ordering::Relaxed)
    }
}

/// Ping a member; on failure mark it unhealthy and, if it has a reconnector, try to
/// rebuild its connection and rejoin.
async fn refresh_member(m: &Member) {
    if m.current().usage().await.is_ok() {
        m.healthy.store(true, Ordering::Relaxed);
        return;
    }
    m.healthy.store(false, Ordering::Relaxed);
    if let Some(rc) = &m.reconnect {
        if let Ok(fresh) = rc().await {
            *m.drive.lock().unwrap() = fresh;
            m.healthy.store(true, Ordering::Relaxed);
        }
    }
}

/// The real per-host read handle behind a token, plus which member issued it.
struct ReadSession {
    member: usize,
    inner: ReadHandle,
}

/// The real per-host write handle(s) behind a token (one for pool, N for mirror).
struct WriteSession {
    targets: Vec<(usize, WriteHandle)>,
}

/// A drive that presents N per-host drives as one, per [`Mode`].
pub struct MultiHostDrive {
    members: Vec<Arc<Member>>,
    mode: Mode,
    reads: Mutex<HashMap<u64, ReadSession>>,
    writes: Mutex<HashMap<u64, WriteSession>>,
    next_id: AtomicU64,
    supervisor: Option<JoinHandle<()>>,
}

impl Drop for MultiHostDrive {
    fn drop(&mut self) {
        if let Some(h) = self.supervisor.take() {
            h.abort();
        }
    }
}

impl MultiHostDrive {
    /// Build a composite over `members` (at least one), with no health supervision.
    pub fn new(members: Vec<(HostId, Arc<dyn Drive>)>, mode: Mode) -> Self {
        Self::build(
            members.into_iter().map(|(id, drive)| (id, drive, None)).collect(),
            mode,
            None,
        )
    }

    /// Build a composite that supervises host health: every `health_interval` it pings
    /// each host, routes around unhealthy ones, and rebuilds any that have a reconnector.
    pub fn new_supervised(
        members: Vec<(HostId, Arc<dyn Drive>, Option<Reconnector>)>,
        mode: Mode,
        health_interval: Duration,
    ) -> Self {
        Self::build(members, mode, Some(health_interval))
    }

    fn build(
        members: Vec<(HostId, Arc<dyn Drive>, Option<Reconnector>)>,
        mode: Mode,
        health_interval: Option<Duration>,
    ) -> Self {
        assert!(!members.is_empty(), "MultiHostDrive needs at least one member");
        let members: Vec<Arc<Member>> = members
            .into_iter()
            .map(|(id, drive, reconnect)| {
                Arc::new(Member {
                    id,
                    drive: Mutex::new(drive),
                    healthy: AtomicBool::new(true),
                    reconnect,
                })
            })
            .collect();
        let supervisor = health_interval.map(|interval| {
            let members = members.clone();
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(interval).await;
                    for m in &members {
                        refresh_member(m).await;
                    }
                }
            })
        });
        Self {
            members,
            mode,
            reads: Mutex::new(HashMap::new()),
            writes: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            supervisor,
        }
    }

    /// One host — a pure passthrough, behaviourally identical to the wrapped drive.
    pub fn single(drive: Arc<dyn Drive>) -> Self {
        Self::new(vec![("local".to_string(), drive)], Mode::Single)
    }

    /// Number of hosts currently considered healthy (for status / the UI).
    pub fn healthy_hosts(&self) -> usize {
        self.members.iter().filter(|m| m.is_healthy()).count()
    }

    /// Total number of hosts.
    pub fn host_count(&self) -> usize {
        self.members.len()
    }

    /// Each host's id and current health — for status / the UI Hosts panel.
    pub fn host_health(&self) -> Vec<(HostId, bool)> {
        self.members.iter().map(|m| (m.id.clone(), m.is_healthy())).collect()
    }

    /// Ping every host once, updating health and reconnecting where possible. The
    /// supervisor calls this on a timer; exposed so callers (and tests) can force a pass.
    pub async fn check_health(&self) {
        for m in &self.members {
            refresh_member(m).await;
        }
    }

    fn next_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    fn any_healthy(&self) -> bool {
        self.members.iter().any(|m| m.is_healthy())
    }

    /// True if member `idx` should be used this op: healthy, or (if every host is down)
    /// tried anyway so a transient all-down still gets a chance.
    fn usable(&self, idx: usize, any_healthy: bool) -> bool {
        self.members[idx].is_healthy() || !any_healthy
    }

    /// The first usable host — the mirror write target ("best-connected" proxy; a
    /// latency-ranked choice is a later refinement). The host-to-host mesh replicates
    /// the write onward to the others.
    fn first_healthy(&self) -> DriveResult<usize> {
        let any = self.any_healthy();
        (0..self.members.len())
            .find(|&i| self.usable(i, any))
            .ok_or_else(|| DriveError::Other(anyhow!("no host available")))
    }

    /// Choose the host for a pool write of `need` plaintext bytes.
    async fn place(&self, need: u64, strategy: Strategy) -> DriveResult<usize> {
        let any = self.any_healthy();
        let mut usages: Vec<(usize, u64)> = Vec::new();
        for idx in 0..self.members.len() {
            if !self.usable(idx, any) {
                continue;
            }
            if let Ok(u) = self.members[idx].current().usage().await {
                usages.push((idx, u.total.saturating_sub(u.used)));
            }
        }
        if usages.is_empty() {
            return Err(DriveError::Other(anyhow!("no host reachable for placement")));
        }
        let choice = match strategy {
            Strategy::Sequential => usages.iter().find(|(_, avail)| *avail >= need).map(|(i, _)| *i),
            Strategy::Balanced => usages.iter().max_by_key(|(_, avail)| *avail).map(|(i, _)| *i),
        };
        choice.ok_or(DriveError::QuotaExceeded)
    }

    /// Ensure every ancestor of `parent` exists as a directory on member `idx`, so a
    /// pooled file can land there even if this host missed the original `mkdir`.
    async fn ensure_parent(&self, idx: usize, parent: &str) -> DriveResult<()> {
        if parent == "/" || parent.is_empty() {
            return Ok(());
        }
        let drive = self.members[idx].current();
        let mut cur = String::new();
        for comp in parent.trim_matches('/').split('/') {
            let p = if cur.is_empty() { "/".to_string() } else { cur.clone() };
            let full = if cur.is_empty() { format!("/{comp}") } else { format!("{cur}/{comp}") };
            let exists = matches!(drive.stat(&full).await, Ok(Some(e)) if e.is_dir);
            if !exists {
                let _ = drive.mkdir(&p, comp).await; // ignore already-exists races
            }
            cur = full;
        }
        Ok(())
    }
}

fn as_member(route: HandleRoute) -> DriveResult<u64> {
    match route {
        HandleRoute::Member(id) => Ok(id),
        HandleRoute::Direct => {
            Err(DriveError::Other(anyhow!("multi-host op on a non-member handle")))
        }
    }
}

#[async_trait]
impl Drive for MultiHostDrive {
    async fn stat(&self, path: &str) -> DriveResult<Option<Entry>> {
        // First host that has it wins (a file lives on one host; a dir on all). Only
        // report "not found" if every host we consulted agreed it's absent.
        let any = self.any_healthy();
        let mut all_reachable = true;
        let mut last_err = None;
        for idx in 0..self.members.len() {
            if !self.usable(idx, any) {
                continue;
            }
            match self.members[idx].current().stat(path).await {
                Ok(Some(e)) => return Ok(Some(e)),
                Ok(None) => {}
                Err(e) => {
                    all_reachable = false;
                    last_err = Some(e);
                }
            }
        }
        if all_reachable {
            Ok(None)
        } else {
            Err(last_err.unwrap_or(DriveError::NotFound))
        }
    }

    async fn list(&self, path: &str) -> DriveResult<Vec<Entry>> {
        // Union across hosts, first occurrence of a name wins (dirs are replicated, so
        // they appear on every host; a pooled file appears on exactly one).
        let any = self.any_healthy();
        let mut out: Vec<Entry> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        let mut any_ok = false;
        let mut last_err = None;
        for idx in 0..self.members.len() {
            if !self.usable(idx, any) {
                continue;
            }
            match self.members[idx].current().list(path).await {
                Ok(entries) => {
                    any_ok = true;
                    for e in entries {
                        if seen.insert(e.name.clone()) {
                            out.push(e);
                        }
                    }
                }
                Err(e) => last_err = Some(e),
            }
        }
        if any_ok {
            Ok(out)
        } else {
            Err(last_err.unwrap_or(DriveError::NotFound))
        }
    }

    async fn mkdir(&self, parent: &str, name: &str) -> DriveResult<()> {
        // Replicate the directory tree to every healthy host. Succeeds if at least one
        // host now has it (a lagging host is reconciled later).
        let any = self.any_healthy();
        let full = if parent == "/" { format!("/{name}") } else { format!("{parent}/{name}") };
        let mut made_any = false;
        let mut last_err = None;
        for idx in 0..self.members.len() {
            if !self.usable(idx, any) {
                continue;
            }
            let d = self.members[idx].current();
            if matches!(d.stat(&full).await, Ok(Some(_))) {
                made_any = true; // already present on this host
                continue;
            }
            match d.mkdir(parent, name).await {
                Ok(()) => made_any = true,
                Err(e) => last_err = Some(e),
            }
        }
        if made_any {
            Ok(())
        } else {
            Err(last_err.unwrap_or(DriveError::NotFound))
        }
    }

    async fn delete(&self, path: &str) -> DriveResult<()> {
        // Delete wherever it lives: the owning host (a pooled file) or every host (a dir,
        // or a mirrored file). NotFound on a host that never had it is fine.
        let any = self.any_healthy();
        let mut ok = false;
        let mut last_err = None;
        for idx in 0..self.members.len() {
            if !self.usable(idx, any) {
                continue;
            }
            match self.members[idx].current().delete(path).await {
                Ok(()) => ok = true,
                Err(DriveError::NotFound) => {}
                Err(e) => last_err = Some(e),
            }
        }
        match last_err {
            Some(e) if !ok => Err(e),
            _ => Ok(()),
        }
    }

    async fn rename(&self, from: &str, to_parent: &str, to_name: &str) -> DriveResult<()> {
        // Each host renames its own slice: the owning host moves a pooled file (its dst
        // dir exists everywhere), and every host renames a shared directory subtree.
        let any = self.any_healthy();
        let mut ok = false;
        let mut last_err = None;
        for idx in 0..self.members.len() {
            if !self.usable(idx, any) {
                continue;
            }
            match self.members[idx].current().rename(from, to_parent, to_name).await {
                Ok(()) => ok = true,
                Err(DriveError::NotFound) => {}
                Err(e) => last_err = Some(e),
            }
        }
        match last_err {
            Some(e) if !ok => Err(e),
            _ => Ok(()),
        }
    }

    async fn usage(&self) -> DriveResult<Usage> {
        let any = self.any_healthy();
        match self.mode {
            Mode::Single => self.members[0].current().usage().await,
            // Pool: capacity and use are the SUM across healthy hosts (sum-of-disks).
            Mode::Pool(_) => {
                let (mut used, mut total, mut ok) = (0u64, 0u64, false);
                for idx in 0..self.members.len() {
                    if !self.usable(idx, any) {
                        continue;
                    }
                    if let Ok(u) = self.members[idx].current().usage().await {
                        used = used.saturating_add(u.used);
                        total = total.saturating_add(u.total);
                        ok = true;
                    }
                }
                if ok {
                    Ok(Usage { used, total })
                } else {
                    Err(DriveError::Other(anyhow!("no host reachable for usage")))
                }
            }
            // Mirror: a byte lands on every host, so capacity is the smallest host and
            // `used` is a representative (first reachable) host.
            Mode::Mirror => {
                let (mut used, mut total, mut ok) = (0u64, u64::MAX, false);
                for idx in 0..self.members.len() {
                    if !self.usable(idx, any) {
                        continue;
                    }
                    if let Ok(u) = self.members[idx].current().usage().await {
                        if !ok {
                            used = u.used;
                        }
                        total = total.min(u.total);
                        ok = true;
                    }
                }
                if ok {
                    Ok(Usage { used, total })
                } else {
                    Err(DriveError::Other(anyhow!("no host reachable for usage")))
                }
            }
        }
    }

    async fn read_begin(&self, path: &str) -> DriveResult<Option<ReadHandle>> {
        let any = self.any_healthy();
        let mut all_reachable = true;
        let mut last_err = None;
        for idx in 0..self.members.len() {
            if !self.usable(idx, any) {
                continue;
            }
            match self.members[idx].current().read_begin(path).await {
                Ok(Some(inner)) => {
                    let rid = self.next_id();
                    // Token mirrors the real handle's shape; its ck/path are unused
                    // (read_chunk routes via the registry) but harmless to copy.
                    let token = ReadHandle {
                        len: inner.len,
                        chunk_count: inner.chunk_count,
                        path: path.to_string(),
                        ck: inner.ck.clone(),
                        route: HandleRoute::Member(rid),
                    };
                    self.reads.lock().unwrap().insert(rid, ReadSession { member: idx, inner });
                    return Ok(Some(token));
                }
                Ok(None) => {}
                Err(e) => {
                    all_reachable = false;
                    last_err = Some(e);
                }
            }
        }
        if all_reachable {
            Ok(None)
        } else {
            Err(last_err.unwrap_or(DriveError::NotFound))
        }
    }

    async fn read_chunk(&self, handle: &ReadHandle, seq: u32) -> DriveResult<Vec<u8>> {
        let rid = as_member(handle.route)?;
        let (member, inner) = {
            let reads = self.reads.lock().unwrap();
            let s = reads.get(&rid).ok_or(DriveError::NotFound)?;
            (s.member, s.inner.clone())
        };
        self.members[member].current().read_chunk(&inner, seq).await
    }

    async fn write_begin(&self, parent: &str, name: &str, total_len: u64) -> DriveResult<WriteHandle> {
        let targets: Vec<usize> = match self.mode {
            Mode::Single => vec![0],
            Mode::Pool(strategy) => vec![self.place(total_len, strategy).await?],
            // Host-driven mirror: the client writes to ONE best-connected host; the
            // host-to-host mesh replicates the exact ciphertext to the others.
            Mode::Mirror => vec![self.first_healthy()?],
        };
        let mut handles: Vec<(usize, WriteHandle)> = Vec::new();
        let mut last_err = None;
        for idx in targets {
            if let Err(e) = self.ensure_parent(idx, parent).await {
                last_err = Some(e);
                continue;
            }
            match self.members[idx].current().write_begin(parent, name, total_len).await {
                Ok(h) => handles.push((idx, h)),
                Err(e) => last_err = Some(e),
            }
        }
        if handles.is_empty() {
            return Err(last_err.unwrap_or(DriveError::Other(anyhow!("no target host for write"))));
        }
        let wid = self.next_id();
        // Token id/ck are placeholders; write_chunk routes via the registry.
        let ck = handles[0].1.ck.clone();
        self.writes.lock().unwrap().insert(wid, WriteSession { targets: handles });
        Ok(WriteHandle { id: wid.to_string(), ck, route: HandleRoute::Member(wid) })
    }

    async fn write_chunk(&self, handle: &WriteHandle, seq: u32, plaintext: &[u8]) -> DriveResult<()> {
        let wid = as_member(handle.route)?;
        let targets = {
            let w = self.writes.lock().unwrap();
            w.get(&wid).ok_or(DriveError::NotFound)?.targets.clone()
        };
        let mut ok = false;
        let mut last_err = None;
        for (idx, wh) in &targets {
            match self.members[*idx].current().write_chunk(wh, seq, plaintext).await {
                Ok(()) => ok = true,
                Err(e) => last_err = Some(e),
            }
        }
        if ok {
            Ok(())
        } else {
            Err(last_err.unwrap_or(DriveError::NotFound))
        }
    }

    async fn write_commit(&self, handle: &WriteHandle) -> DriveResult<()> {
        let wid = as_member(handle.route)?;
        let targets = self
            .writes
            .lock()
            .unwrap()
            .remove(&wid)
            .ok_or(DriveError::NotFound)?
            .targets;
        let mut ok = false;
        let mut last_err = None;
        for (idx, wh) in &targets {
            match self.members[*idx].current().write_commit(wh).await {
                Ok(()) => ok = true,
                Err(e) => last_err = Some(e),
            }
        }
        if ok {
            Ok(())
        } else {
            Err(last_err.unwrap_or(DriveError::NotFound))
        }
    }

    async fn write_abort(&self, handle: &WriteHandle) -> DriveResult<()> {
        let wid = as_member(handle.route)?;
        let targets = match self.writes.lock().unwrap().remove(&wid) {
            Some(s) => s.targets,
            None => return Ok(()),
        };
        for (idx, wh) in &targets {
            let _ = self.members[*idx].current().write_abort(wh).await;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drive::{LocalDrive, CHUNK};
    use core_crypto::AccountRootKey;
    use core_fs::Store;

    fn host(dir: &std::path::Path, quota: u64) -> Arc<dyn Drive> {
        let store = Store::open(&dir.join("meta.db"), &dir.join("blobs")).unwrap();
        store.set_quota(quota).unwrap();
        Arc::new(LocalDrive::new(store, AccountRootKey::generate()))
    }

    async fn put(d: &dyn Drive, parent: &str, name: &str, data: &[u8]) -> DriveResult<()> {
        let h = d.write_begin(parent, name, data.len() as u64).await?;
        for (i, chunk) in data.chunks(CHUNK).enumerate() {
            d.write_chunk(&h, i as u32, chunk).await?;
        }
        d.write_commit(&h).await
    }

    async fn read_all(d: &dyn Drive, path: &str) -> DriveResult<Vec<u8>> {
        let Some(h) = d.read_begin(path).await? else {
            return Err(DriveError::NotFound);
        };
        let mut out = Vec::new();
        for seq in 0..h.chunk_count {
            out.extend_from_slice(&d.read_chunk(&h, seq).await?);
        }
        Ok(out)
    }

    fn names(entries: &[Entry]) -> Vec<String> {
        let mut v: Vec<String> = entries.iter().map(|e| e.name.clone()).collect();
        v.sort();
        v
    }

    #[tokio::test]
    async fn single_mode_is_a_passthrough() {
        let tmp = tempfile::tempdir().unwrap();
        let inner = host(tmp.path(), 1 << 30);
        let d = MultiHostDrive::single(inner);

        d.mkdir("/", "docs").await.unwrap();
        put(&d, "/docs", "a.txt", b"hello world").await.unwrap();
        assert_eq!(read_all(&d, "/docs/a.txt").await.unwrap(), b"hello world");
        assert_eq!(names(&d.list("/docs").await.unwrap()), vec!["a.txt"]);
        assert!(d.stat("/docs/a.txt").await.unwrap().is_some());
        assert!(d.stat("/docs/missing").await.unwrap().is_none());
        d.delete("/docs/a.txt").await.unwrap();
        assert!(d.stat("/docs/a.txt").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn pool_distributes_files_and_merges_listings() {
        let t0 = tempfile::tempdir().unwrap();
        let t1 = tempfile::tempdir().unwrap();
        let h0 = host(t0.path(), 1 << 30);
        let h1 = host(t1.path(), 1 << 30);
        let pool = MultiHostDrive::new(
            vec![("h0".into(), h0.clone()), ("h1".into(), h1.clone())],
            Mode::Pool(Strategy::Balanced),
        );

        // A directory replicates to BOTH hosts.
        pool.mkdir("/", "shared").await.unwrap();
        assert!(h0.stat("/shared").await.unwrap().is_some());
        assert!(h1.stat("/shared").await.unwrap().is_some());

        // Balanced placement should spread distinct files across the two hosts.
        for i in 0..6 {
            let body = vec![i as u8; 1000];
            put(&pool, "/shared", &format!("f{i}.bin"), &body).await.unwrap();
        }
        let on_h0 = h0.list("/shared").await.unwrap().len();
        let on_h1 = h1.list("/shared").await.unwrap().len();
        assert_eq!(on_h0 + on_h1, 6, "every file lands on exactly one host");
        assert!(on_h0 > 0 && on_h1 > 0, "balanced should use both hosts (got {on_h0}/{on_h1})");

        // The pool presents the UNION as one directory, and each file reads back intact.
        let listing = names(&pool.list("/shared").await.unwrap());
        assert_eq!(listing, vec!["f0.bin", "f1.bin", "f2.bin", "f3.bin", "f4.bin", "f5.bin"]);
        for i in 0..6 {
            assert_eq!(read_all(&pool, &format!("/shared/f{i}.bin")).await.unwrap(), vec![i as u8; 1000]);
        }

        // Capacity is the SUM of the two hosts.
        let u = pool.usage().await.unwrap();
        assert_eq!(u.total, (1u64 << 30) * 2);
        assert!(u.used > 0);

        // Delete routes to the owning host and clears it from the union.
        pool.delete("/shared/f3.bin").await.unwrap();
        assert!(!names(&pool.list("/shared").await.unwrap()).contains(&"f3.bin".to_string()));
    }

    #[tokio::test]
    async fn pool_rename_moves_the_owning_hosts_file() {
        let t0 = tempfile::tempdir().unwrap();
        let t1 = tempfile::tempdir().unwrap();
        let pool = MultiHostDrive::new(
            vec![("h0".into(), host(t0.path(), 1 << 30)), ("h1".into(), host(t1.path(), 1 << 30))],
            Mode::Pool(Strategy::Balanced),
        );
        pool.mkdir("/", "a").await.unwrap();
        pool.mkdir("/", "b").await.unwrap();
        put(&pool, "/a", "x.txt", b"payload").await.unwrap();
        pool.rename("/a/x.txt", "/b", "y.txt").await.unwrap();
        assert!(pool.stat("/a/x.txt").await.unwrap().is_none());
        assert_eq!(read_all(&pool, "/b/y.txt").await.unwrap(), b"payload");
    }

    #[tokio::test]
    async fn mirror_routes_write_to_one_host_and_reports_min_capacity() {
        let t0 = tempfile::tempdir().unwrap();
        let t1 = tempfile::tempdir().unwrap();
        let h0 = host(t0.path(), 3 << 30);
        let h1 = host(t1.path(), 1 << 30); // smaller
        let mirror = MultiHostDrive::new(
            vec![("h0".into(), h0.clone()), ("h1".into(), h1.clone())],
            Mode::Mirror,
        );

        // Directories replicate to both hosts (as in pool).
        mirror.mkdir("/", "m").await.unwrap();
        assert!(h0.stat("/m").await.unwrap().is_some());
        assert!(h1.stat("/m").await.unwrap().is_some());

        // A write lands on ONE host (first healthy) — the mesh replicates onward later.
        put(&mirror, "/m", "a.bin", b"mirrored payload").await.unwrap();
        let on0 = h0.stat("/m/a.bin").await.unwrap().is_some();
        let on1 = h1.stat("/m/a.bin").await.unwrap().is_some();
        assert!(on0 ^ on1, "mirror write should hit exactly one host (mesh does the rest)");
        assert_eq!(read_all(&mirror, "/m/a.bin").await.unwrap(), b"mirrored payload");

        // Capacity is the SMALLEST host (a mirrored byte lands on every host).
        let u = mirror.usage().await.unwrap();
        assert_eq!(u.total, 1 << 30, "mirror capacity = smallest host");
    }

    /// A drive that can be toggled "down": every op errors while down. Models a host
    /// dropping off the network so we can exercise health/skip/reconnect deterministically.
    struct FlakyDrive {
        inner: Arc<dyn Drive>,
        up: Arc<AtomicBool>,
    }
    impl FlakyDrive {
        fn down(&self) -> DriveError {
            let _ = &self.up;
            DriveError::Other(anyhow!("host down"))
        }
    }
    #[async_trait]
    impl Drive for FlakyDrive {
        async fn stat(&self, p: &str) -> DriveResult<Option<Entry>> {
            if !self.up.load(Ordering::Relaxed) { return Err(self.down()); }
            self.inner.stat(p).await
        }
        async fn list(&self, p: &str) -> DriveResult<Vec<Entry>> {
            if !self.up.load(Ordering::Relaxed) { return Err(self.down()); }
            self.inner.list(p).await
        }
        async fn mkdir(&self, parent: &str, name: &str) -> DriveResult<()> {
            if !self.up.load(Ordering::Relaxed) { return Err(self.down()); }
            self.inner.mkdir(parent, name).await
        }
        async fn delete(&self, p: &str) -> DriveResult<()> {
            if !self.up.load(Ordering::Relaxed) { return Err(self.down()); }
            self.inner.delete(p).await
        }
        async fn rename(&self, f: &str, tp: &str, tn: &str) -> DriveResult<()> {
            if !self.up.load(Ordering::Relaxed) { return Err(self.down()); }
            self.inner.rename(f, tp, tn).await
        }
        async fn usage(&self) -> DriveResult<Usage> {
            if !self.up.load(Ordering::Relaxed) { return Err(self.down()); }
            self.inner.usage().await
        }
        async fn read_begin(&self, p: &str) -> DriveResult<Option<ReadHandle>> {
            if !self.up.load(Ordering::Relaxed) { return Err(self.down()); }
            self.inner.read_begin(p).await
        }
        async fn read_chunk(&self, h: &ReadHandle, seq: u32) -> DriveResult<Vec<u8>> {
            if !self.up.load(Ordering::Relaxed) { return Err(self.down()); }
            self.inner.read_chunk(h, seq).await
        }
        async fn write_begin(&self, parent: &str, name: &str, len: u64) -> DriveResult<WriteHandle> {
            if !self.up.load(Ordering::Relaxed) { return Err(self.down()); }
            self.inner.write_begin(parent, name, len).await
        }
        async fn write_chunk(&self, h: &WriteHandle, seq: u32, pt: &[u8]) -> DriveResult<()> {
            if !self.up.load(Ordering::Relaxed) { return Err(self.down()); }
            self.inner.write_chunk(h, seq, pt).await
        }
        async fn write_commit(&self, h: &WriteHandle) -> DriveResult<()> {
            if !self.up.load(Ordering::Relaxed) { return Err(self.down()); }
            self.inner.write_commit(h).await
        }
        async fn write_abort(&self, h: &WriteHandle) -> DriveResult<()> {
            if !self.up.load(Ordering::Relaxed) { return Err(self.down()); }
            self.inner.write_abort(h).await
        }
    }

    #[tokio::test]
    async fn pool_survives_a_host_going_down_and_reconnects() {
        let tg = tempfile::tempdir().unwrap();
        let tf = tempfile::tempdir().unwrap();
        let good = host(tg.path(), 1 << 30);
        let up = Arc::new(AtomicBool::new(true));
        let allow_reconnect = Arc::new(AtomicBool::new(false));
        let flaky: Arc<dyn Drive> = Arc::new(FlakyDrive { inner: host(tf.path(), 1 << 30), up: up.clone() });

        // Reconnector: only succeeds once allowed; on success it "heals" the host (up=true)
        // and hands the same drive back.
        let reconnect: Reconnector = {
            let up = up.clone();
            let allow = allow_reconnect.clone();
            let flaky = flaky.clone();
            Arc::new(move || {
                let up = up.clone();
                let allow = allow.clone();
                let flaky = flaky.clone();
                Box::pin(async move {
                    if !allow.load(Ordering::Relaxed) {
                        return Err(anyhow!("still down"));
                    }
                    up.store(true, Ordering::Relaxed);
                    Ok(flaky)
                })
            })
        };

        let pool = MultiHostDrive::new_supervised(
            vec![
                ("good".into(), good.clone(), None),
                ("flaky".into(), flaky.clone(), Some(reconnect)),
            ],
            Mode::Pool(Strategy::Balanced),
            Duration::from_secs(3600), // long; we drive check_health() manually
        );

        // Seed files across both hosts, then find one that lives on the flaky host.
        pool.mkdir("/", "d").await.unwrap();
        for i in 0..6u8 {
            put(&pool, "/d", &format!("f{i}.bin"), &vec![i; 2048]).await.unwrap();
        }
        let flaky_files = names(&flaky.list("/d").await.unwrap());
        assert!(!flaky_files.is_empty(), "expected some files on the flaky host");
        let victim = flaky_files[0].clone();
        assert_eq!(pool.healthy_hosts(), 2);

        // The flaky host drops. Health check marks it unhealthy; reconnect not yet allowed.
        up.store(false, Ordering::Relaxed);
        pool.check_health().await;
        assert_eq!(pool.healthy_hosts(), 1, "flaky host should be marked down");

        // The pool keeps serving: listing still returns the good host's files, and new
        // writes still succeed (placed on the surviving host).
        let live = names(&pool.list("/d").await.unwrap());
        assert!(!live.is_empty());
        put(&pool, "/d", "after.bin", b"still working").await.unwrap();
        assert_eq!(read_all(&pool, "/d/after.bin").await.unwrap(), b"still working");

        // Allow recovery; the next health pass reconnects the flaky host and it rejoins.
        allow_reconnect.store(true, Ordering::Relaxed);
        pool.check_health().await;
        assert_eq!(pool.healthy_hosts(), 2, "flaky host should have reconnected");

        // Its original file is reachable through the pool again.
        assert_eq!(read_all(&pool, &format!("/d/{victim}")).await.unwrap().len(), 2048);
    }
}
