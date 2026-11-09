//! Wire types shared between the host agent and every client (web + desktop).
//!
//! These are the *plaintext* RPC payloads that exist only at the two trusted ends
//! (client + host). On the wire they travel inside an AEAD envelope (see
//! `core-net`), so the relay only ever forwards ciphertext. File bytes inside
//! `FilePayload` are themselves already E2EE ciphertext (encrypted client-side
//! with a content key the host never learns).

use serde::{de::DeserializeOwned, Deserialize, Serialize};

pub type Bytes = u64;
pub type UnixMillis = i64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    File,
    Dir,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FileEntry {
    pub id: String,
    pub name: String,
    pub kind: EntryKind,
    pub size_bytes: Bytes,
    pub modified: UnixMillis,
    /// Whether the entry is starred. `#[serde(default)]` keeps the wire
    /// backward-compatible with hosts/clients that predate starring.
    #[serde(default)]
    pub starred: bool,
    /// Full path of this entry, e.g. "/Docs/report.pdf".
    ///
    /// Carried explicitly rather than parsed out of `id`. The id happens to BE the path on
    /// this host, but that is an implementation detail a client must not depend on: the mock
    /// adapter encodes ids differently, and a client that parsed one would break against the
    /// other. Without this field, an entry found in a global view (Recent, Starred, Search)
    /// could not be renamed, opened in its folder, or downloaded recursively, because nothing
    /// knew which folder it came from.
    ///
    /// `#[serde(default)]` keeps older hosts wire-compatible; they send nothing and clients
    /// fall back to the previous behaviour.
    #[serde(default)]
    pub path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DirListing {
    pub path: String,
    pub entries: Vec<FileEntry>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Quota {
    pub used_bytes: Bytes,
    pub quota_bytes: Bytes,
    pub file_count: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkPath {
    DirectP2p,
    Relay,
    Offline,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HostStatus {
    pub host_id: String,
    pub machine_name: String,
    pub os: String,
    pub app_version: String,
    pub online: bool,
    pub uptime_secs: u64,
    pub disk_free_bytes: Bytes,
    pub disk_total_bytes: Bytes,
}

/// One entry in the host's activity log (uploads/downloads/deletes/etc.). `kind` is a
/// lowercase tag the client maps to an icon; `detail` is a short human line.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ActivityEvent {
    pub id: String,
    pub ts: UnixMillis,
    pub kind: String,
    pub actor: String,
    pub detail: String,
}

/// A file's transferable body: the wrapped content key + the E2EE ciphertext +
/// the declared plaintext length (what quota is charged against). The host never
/// sees plaintext or the unwrapped content key. Binary fields are base64 on the
/// wire so the JSON codec stays browser-interoperable.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FilePayload {
    #[serde(with = "b64")]
    pub wrapped_ck: Vec<u8>,
    pub plaintext_len: Bytes,
    #[serde(with = "b64")]
    pub ciphertext: Vec<u8>,
}

/// One entry in a host's replication manifest: the object's path, kind, last-modified
/// time (the mtime-LWW comparison key), and plaintext size. Used by anti-entropy to
/// decide what a peer is missing or has an older copy of. A **tombstone** (a recorded
/// deletion) is a manifest entry with `deleted = true` whose `mtime` is the delete time.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ManifestEntry {
    pub id: String,
    pub kind: EntryKind,
    pub mtime: UnixMillis,
    pub size_bytes: Bytes,
    #[serde(default)]
    pub deleted: bool,
    /// Star + soft-trash state, replicated so a mirror converges on them too.
    #[serde(default)]
    pub starred: bool,
    #[serde(default)]
    pub trashed_at: Option<UnixMillis>,
}

/// A whole object shipped host-to-host for mirroring. The `file` payload is the exact
/// E2EE ciphertext + wrapped key (opaque to both hosts), so a replicated copy is
/// byte-identical and decryptable by the same account ARK. `None` for a directory or a
/// tombstone. A tombstone (`deleted = true`) tells the peer to delete `id` if its copy is
/// older than `mtime` (the delete time).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ObjectExport {
    pub id: String,
    pub parent: String,
    pub name: String,
    pub kind: EntryKind,
    pub mtime: UnixMillis,
    pub file: Option<FilePayload>,
    #[serde(default)]
    pub deleted: bool,
    /// Star + soft-trash state carried to the peer so they converge too.
    #[serde(default)]
    pub starred: bool,
    #[serde(default)]
    pub trashed_at: Option<UnixMillis>,
}

/// One request in the host RPC. Signed + AEAD-sealed before it hits the wire.
/// Externally tagged (no `tag=`) so the compact `bincode` wire codec can decode it.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Request {
    ListDir { path: String },
    Stat { id: String },
    Mkdir { parent: String, name: String },
    Rename { from: String, to_parent: String, to_name: String },
    Delete { id: String },

    // --- star + soft-trash (recoverable delete) ---
    /// Set or clear an entry's starred flag.
    Star { id: String, on: bool },
    /// Move an entry (and its subtree) to the trash — hidden from listings, quota
    /// still charged, recoverable via `Restore`. Not a mirror-propagating delete.
    Trash { id: String },
    /// Restore a trashed entry (and its subtree) back into normal listings.
    Restore { id: String },
    /// Permanently delete everything in the trash (frees quota, writes tombstones).
    EmptyTrash,
    /// List the trash roots (the top of each trashed subtree).
    ListTrash,

    // --- global views (span the whole partition, not one directory) ---
    /// Recursive name search across all live (non-trashed) entries.
    Search { query: String },
    /// All starred live entries, newest first.
    ListStarred,
    /// The most recently modified live files, newest first.
    ListRecent { limit: u64 },
    /// The host's activity log, newest first.
    GetActivity { limit: u64 },

    /// Replace an object's wrapped content key, for account-key rotation. The host stores
    /// the blob opaquely; it has never held either key and cannot validate the rewrap.
    RewrapKey {
        id: String,
        #[serde(with = "b64")]
        wrapped_ck: Vec<u8>,
    },

    GetQuota,
    /// Set the partition quota cap (the owner's allocation). The host clamps it to the
    /// license ceiling and persists it in the store; replies with the resulting `Quota`.
    SetQuota { quota_bytes: Bytes },
    GetHostStatus,
    PutFile { parent: String, name: String, payload: FilePayload },
    ReadFile { id: String },

    // --- chunked/streamed transfer ---
    UploadBegin {
        parent: String,
        name: String,
        plaintext_len: Bytes,
        #[serde(with = "b64")]
        wrapped_ck: Vec<u8>,
    },
    UploadChunk {
        upload_id: String,
        #[serde(with = "b64")]
        ciphertext: Vec<u8>,
    },
    UploadCommit { upload_id: String },
    UploadAbort { upload_id: String },
    ReadBegin { id: String },
    ReadChunk { id: String, seq: u64 },

    // --- host-to-host mirror replication (peer hosts only) ---
    /// Return this host's full object manifest (for anti-entropy diffing).
    ListManifest,
    /// Store a peer's object verbatim (mtime-LWW: keep the newer copy).
    ImportObject { export: ObjectExport },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Response {
    DirListing(DirListing),
    Entry(FileEntry),
    Quota(Quota),
    HostStatus(HostStatus),
    File(FilePayload),
    Ok,
    QuotaExceeded { needed: Bytes, available: Bytes },
    Error { message: String },

    // --- chunked/streamed transfer ---
    UploadStarted { upload_id: String },
    FileInfo {
        #[serde(with = "b64")]
        wrapped_ck: Vec<u8>,
        plaintext_len: Bytes,
        chunk_count: u64,
    },
    Chunk {
        #[serde(with = "b64")]
        ciphertext: Vec<u8>,
    },

    // --- host-to-host mirror replication ---
    Manifest { entries: Vec<ManifestEntry> },

    // --- activity log ---
    Activity { events: Vec<ActivityEvent> },
}

impl Response {
    pub fn error(msg: impl Into<String>) -> Self {
        Response::Error { message: msg.into() }
    }
}

/// Wire encoding for RPC frames + the handshake: JSON (browser-interoperable).
/// The bytes are then AEAD-sealed by the session, so the relay sees only
/// ciphertext regardless of the payload format.
pub fn encode<T: Serialize>(v: &T) -> Vec<u8> {
    serde_json::to_vec(v).expect("json serialize")
}
pub fn decode<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, serde_json::Error> {
    serde_json::from_slice(bytes)
}

/// serde helper: `Vec<u8>` <-> base64 string (keeps binary compact + JSON-safe).
pub mod b64 {
    use base64::Engine;
    use serde::{Deserialize, Deserializer, Serializer};

    const ENGINE: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;

    pub fn serialize<S: Serializer>(v: &[u8], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&ENGINE.encode(v))
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        let s = String::deserialize(d)?;
        ENGINE.decode(s.as_bytes()).map_err(serde::de::Error::custom)
    }
}
