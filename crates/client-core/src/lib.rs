//! Client role: device identity, client-side file E2EE, and a typed drive API
//! over the relay transport. Shared by the Tauri desktop app (native) and, via a
//! WASM build later, the browser. The host never sees plaintext or content keys.

use anyhow::{anyhow, Result};
use core_crypto::{AccountRootKey, AgreementPublic, DeviceId, DeviceKeypair, SymKey};
use core_net::relay::RelayClient;
use core_proto::{FileEntry, FilePayload, ManifestEntry, ObjectExport, Quota, Request, Response};

/// Identity holder for a client device.
pub struct ClientCore {
    device: DeviceKeypair,
}

impl ClientCore {
    pub fn new() -> Self {
        Self { device: DeviceKeypair::generate() }
    }
    pub fn device_id(&self) -> DeviceId {
        self.device.id
    }
    pub fn keypair(&self) -> &DeviceKeypair {
        &self.device
    }
}

impl Default for ClientCore {
    fn default() -> Self {
        Self::new()
    }
}

/// Encrypt a plaintext file for storage: a fresh per-file content key seals the
/// bytes, and the content key is wrapped to the ARK. The returned payload is what
/// travels to (and is stored by) the host, which can decrypt none of it.
pub fn encrypt_file(ark: &AccountRootKey, plaintext: &[u8]) -> FilePayload {
    let ck = SymKey::generate();
    let ciphertext = ck.seal(b"file", plaintext);
    FilePayload {
        wrapped_ck: ark.wrap_content_key(&ck),
        plaintext_len: plaintext.len() as u64,
        ciphertext,
    }
}

/// Reverse of [`encrypt_file`]: unwrap the content key with the ARK, decrypt.
pub fn decrypt_file(ark: &AccountRootKey, payload: &FilePayload) -> Result<Vec<u8>> {
    let ck = ark
        .unwrap_content_key(&payload.wrapped_ck)
        .map_err(|_| anyhow!("unwrap content key"))?;
    ck.open(b"file", &payload.ciphertext).map_err(|_| anyhow!("decrypt file"))
}

/// Metadata returned when beginning a chunked read: the wrapped content key, the
/// total plaintext length, and how many ciphertext chunks the file has.
#[derive(Clone, Debug)]
pub struct ReadInfo {
    pub wrapped_ck: Vec<u8>,
    pub plaintext_len: u64,
    pub chunk_count: u64,
}

/// How long a single RPC may take before we treat the host as unreachable. The
/// relay/QUIC `request` primitives otherwise block indefinitely on a dead peer —
/// and since a Finder WebDAV op is one RPC, an unbounded wait freezes Finder. One
/// RPC is at most a 4 MiB chunk, so this is generous even on a slow link.
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// The transport under a [`RemoteDrive`]: the relay WebSocket, or (with the `iroh`
/// feature) a direct QUIC connection. Both speak the identical session + tagged-RPC
/// protocol, so every drive method is transport-agnostic.
enum WireKind {
    Ws(RelayClient),
    #[cfg(feature = "iroh")]
    Iroh(core_net::iroh::IrohClient),
}

/// The transport plus a liveness latch. A single stream is strict request/response,
/// so a request cancelled by timeout would desync it — once one times out we mark
/// the whole wire dead and fail every later call immediately (fast, no reuse of a
/// desynced stream, no infinite Finder hang).
struct Wire {
    kind: WireKind,
    dead: bool,
}

impl Wire {
    fn new(kind: WireKind) -> Self {
        Self { kind, dead: false }
    }

    async fn request(&mut self, req: &Request) -> Result<Response> {
        if self.dead {
            return Err(anyhow!("connection is dead (a previous request timed out)"));
        }
        let kind = &mut self.kind;
        let res = tokio::time::timeout(REQUEST_TIMEOUT, async move {
            match kind {
                WireKind::Ws(c) => c.request(req).await,
                #[cfg(feature = "iroh")]
                WireKind::Iroh(c) => c.request(req).await,
            }
        })
        .await;
        match res {
            Ok(inner) => inner,
            Err(_) => {
                self.dead = true;
                Err(anyhow!(
                    "request timed out after {}s (host unreachable?)",
                    REQUEST_TIMEOUT.as_secs()
                ))
            }
        }
    }

    /// Upload one content-ciphertext chunk. Over a direct iroh connection this uses the raw
    /// binary `TAG_UPLOAD_CHUNK` frame (no base64/JSON/double-seal); over the relay fallback it
    /// stays on the generic JSON `UploadChunk` request (relay is the slow path anyway, and this
    /// keeps the relay client untouched).
    async fn upload_chunk(&mut self, upload_id: &str, ciphertext: &[u8]) -> Result<Response> {
        if self.dead {
            return Err(anyhow!("connection is dead (a previous request timed out)"));
        }
        let kind = &mut self.kind;
        let res = tokio::time::timeout(REQUEST_TIMEOUT, async move {
            match kind {
                WireKind::Ws(c) => {
                    c.request(&Request::UploadChunk {
                        upload_id: upload_id.to_string(),
                        ciphertext: ciphertext.to_vec(),
                    })
                    .await
                }
                #[cfg(feature = "iroh")]
                WireKind::Iroh(c) => c.upload_chunk(upload_id, ciphertext).await,
            }
        })
        .await;
        match res {
            Ok(inner) => inner,
            Err(_) => {
                self.dead = true;
                Err(anyhow!(
                    "upload chunk timed out after {}s (host unreachable?)",
                    REQUEST_TIMEOUT.as_secs()
                ))
            }
        }
    }

    async fn close(self) -> Result<()> {
        match self.kind {
            WireKind::Ws(c) => c.close().await,
            #[cfg(feature = "iroh")]
            WireKind::Iroh(_) => Ok(()),
        }
    }
}

/// A connected, typed view of a remote drive. Every call is a signed, AEAD-sealed
/// RPC; the transport (relay or direct QUIC) only ever sees ciphertext.
pub struct RemoteDrive {
    wire: Wire,
}

impl RemoteDrive {
    /// Connect over the WebSocket relay.
    pub async fn connect(
        base_url: &str,
        account: &str,
        device: &DeviceKeypair,
        host_pub: &AgreementPublic,
        host: Option<&str>,
        token: Option<&str>,
    ) -> Result<Self> {
        Ok(Self {
            wire: Wire::new(WireKind::Ws(
                RelayClient::connect(base_url, account, device, host_pub, host, token).await?,
            )),
        })
    }

    /// Connect directly over Iroh QUIC (the LAN fast path).
    #[cfg(feature = "iroh")]
    pub async fn connect_iroh(
        endpoint: &core_net::iroh::Endpoint,
        host_addr: core_net::iroh::EndpointAddr,
        device: &DeviceKeypair,
        host_pub: &AgreementPublic,
    ) -> Result<Self> {
        Ok(Self {
            wire: Wire::new(WireKind::Iroh(
                core_net::iroh::IrohClient::connect(endpoint, host_addr, device, host_pub).await?,
            )),
        })
    }

    /// Prefer the direct-QUIC (Iroh) fast path, falling back to the relay. Pass the
    /// bound iroh endpoint + the host's `EndpointAddr` (from control-plane discovery,
    /// e.g. via `core_net::iroh::endpoint_addr`) to attempt the direct path; on any
    /// failure — or when `iroh` is `None` — the relay is used.
    #[cfg(feature = "iroh")]
    pub async fn connect_auto(
        iroh: Option<(&core_net::iroh::Endpoint, core_net::iroh::EndpointAddr)>,
        relay_url: &str,
        account: &str,
        device: &DeviceKeypair,
        host_pub: &AgreementPublic,
        host: Option<&str>,
        token: Option<&str>,
    ) -> Result<Self> {
        if let Some((endpoint, host_addr)) = iroh {
            match Self::connect_iroh(endpoint, host_addr, device, host_pub).await {
                Ok(drive) => return Ok(drive),
                Err(e) => tracing::warn!("iroh connect failed ({e}); falling back to relay"),
            }
        }
        Self::connect(relay_url, account, device, host_pub, host, token).await
    }

    /// Raw session RPC — send a pre-built `Request` and return the `Response`. Content E2EE
    /// is the caller's responsibility (the request already carries content-ciphertext), so
    /// the desktop console can proxy its transport through this to ride the direct-QUIC
    /// (Iroh) fast path with the relay as fallback, keeping all its client-side crypto.
    pub async fn request_raw(&mut self, req: Request) -> Result<Response> {
        self.wire.request(&req).await
    }

    /// Upload one already-encrypted content chunk over the fast binary frame (direct iroh: raw
    /// ciphertext, one crypto pass, no base64/JSON; relay: JSON fallback). The ciphertext is the
    /// caller's content-AEAD output, so the transport still never sees plaintext. Lets the
    /// desktop console proxy uploads without the base64+JSON+double-seal tax of `request_raw`.
    pub async fn upload_chunk_raw(&mut self, upload_id: &str, ciphertext: &[u8]) -> Result<Response> {
        self.wire.upload_chunk(upload_id, ciphertext).await
    }

    pub async fn list(&mut self, path: &str) -> Result<Vec<FileEntry>> {
        match self.wire.request(&Request::ListDir { path: path.to_string() }).await? {
            Response::DirListing(d) => Ok(d.entries),
            Response::Error { message } => Err(anyhow!(message)),
            other => Err(anyhow!("unexpected response: {other:?}")),
        }
    }

    pub async fn mkdir(&mut self, parent: &str, name: &str) -> Result<()> {
        self.expect_ok(Request::Mkdir { parent: parent.into(), name: name.into() }).await
    }

    /// Look up a single entry; `None` if it doesn't exist.
    pub async fn stat(&mut self, id: &str) -> Result<Option<FileEntry>> {
        match self.wire.request(&Request::Stat { id: id.into() }).await? {
            Response::Entry(e) => Ok(Some(e)),
            Response::Error { message } if message.contains("not found") => Ok(None),
            Response::Error { message } => Err(anyhow!(message)),
            other => Err(anyhow!("unexpected response: {other:?}")),
        }
    }

    /// Move/rename an entry to `to_parent/to_name`.
    pub async fn rename(&mut self, from: &str, to_parent: &str, to_name: &str) -> Result<()> {
        self.expect_ok(Request::Rename {
            from: from.into(),
            to_parent: to_parent.into(),
            to_name: to_name.into(),
        })
        .await
    }

    pub async fn put(&mut self, parent: &str, name: &str, payload: FilePayload) -> Result<()> {
        match self
            .wire
            .request(&Request::PutFile { parent: parent.into(), name: name.into(), payload })
            .await?
        {
            Response::Entry(_) | Response::Ok => Ok(()),
            Response::QuotaExceeded { needed, available } => {
                Err(anyhow!("quota exceeded: need {needed}, {available} available"))
            }
            Response::Error { message } => Err(anyhow!(message)),
            other => Err(anyhow!("unexpected response: {other:?}")),
        }
    }

    pub async fn read(&mut self, id: &str) -> Result<FilePayload> {
        match self.wire.request(&Request::ReadFile { id: id.to_string() }).await? {
            Response::File(f) => Ok(f),
            Response::Error { message } => Err(anyhow!(message)),
            other => Err(anyhow!("unexpected response: {other:?}")),
        }
    }

    pub async fn delete(&mut self, id: &str) -> Result<()> {
        self.expect_ok(Request::Delete { id: id.to_string() }).await
    }

    pub async fn quota(&mut self) -> Result<Quota> {
        match self.wire.request(&Request::GetQuota).await? {
            Response::Quota(q) => Ok(q),
            Response::Error { message } => Err(anyhow!(message)),
            other => Err(anyhow!("unexpected response: {other:?}")),
        }
    }

    // --- host-to-host mirror replication (the calling side is a peer host) ---

    /// Fetch the peer host's object manifest (for anti-entropy diffing).
    pub async fn list_manifest(&mut self) -> Result<Vec<ManifestEntry>> {
        match self.wire.request(&Request::ListManifest).await? {
            Response::Manifest { entries } => Ok(entries),
            Response::Error { message } => Err(anyhow!(message)),
            other => Err(anyhow!("unexpected response: {other:?}")),
        }
    }

    /// Push one object to the peer host (it keeps the newer copy, mtime-LWW).
    pub async fn import_object(&mut self, export: ObjectExport) -> Result<()> {
        match self.wire.request(&Request::ImportObject { export }).await? {
            Response::Ok => Ok(()),
            Response::QuotaExceeded { needed, available } => {
                Err(anyhow!("peer quota exceeded: need {needed}, {available} available"))
            }
            Response::Error { message } => Err(anyhow!(message)),
            other => Err(anyhow!("unexpected response: {other:?}")),
        }
    }

    // --- chunked/streamed transfer (host stores ciphertext chunks opaquely) ---

    /// Begin a chunked upload, reserving quota for `plaintext_len`.
    pub async fn upload_begin(
        &mut self,
        parent: &str,
        name: &str,
        plaintext_len: u64,
        wrapped_ck: Vec<u8>,
    ) -> Result<String> {
        match self
            .wire
            .request(&Request::UploadBegin {
                parent: parent.into(),
                name: name.into(),
                plaintext_len,
                wrapped_ck,
            })
            .await?
        {
            Response::UploadStarted { upload_id } => Ok(upload_id),
            Response::QuotaExceeded { needed, available } => {
                Err(anyhow!("quota exceeded: need {needed}, {available} available"))
            }
            Response::Error { message } => Err(anyhow!(message)),
            other => Err(anyhow!("unexpected response: {other:?}")),
        }
    }

    /// Send one already-sealed ciphertext chunk.
    pub async fn upload_chunk(&mut self, upload_id: &str, ciphertext: Vec<u8>) -> Result<()> {
        self.expect_ok(Request::UploadChunk { upload_id: upload_id.into(), ciphertext }).await
    }

    pub async fn upload_commit(&mut self, upload_id: &str) -> Result<()> {
        self.expect_ok(Request::UploadCommit { upload_id: upload_id.into() }).await
    }

    pub async fn upload_abort(&mut self, upload_id: &str) -> Result<()> {
        self.expect_ok(Request::UploadAbort { upload_id: upload_id.into() }).await
    }

    /// Begin a chunked read; `None` if the file does not exist.
    pub async fn read_begin(&mut self, id: &str) -> Result<Option<ReadInfo>> {
        match self.wire.request(&Request::ReadBegin { id: id.into() }).await? {
            Response::FileInfo { wrapped_ck, plaintext_len, chunk_count } => {
                Ok(Some(ReadInfo { wrapped_ck, plaintext_len, chunk_count }))
            }
            Response::Error { message } if message.contains("not found") => Ok(None),
            Response::Error { message } => Err(anyhow!(message)),
            other => Err(anyhow!("unexpected response: {other:?}")),
        }
    }

    /// Fetch the raw ciphertext of chunk `seq`.
    pub async fn read_chunk(&mut self, id: &str, seq: u64) -> Result<Vec<u8>> {
        match self.wire.request(&Request::ReadChunk { id: id.into(), seq }).await? {
            Response::Chunk { ciphertext } => Ok(ciphertext),
            Response::Error { message } => Err(anyhow!(message)),
            other => Err(anyhow!("unexpected response: {other:?}")),
        }
    }

    async fn expect_ok(&mut self, req: Request) -> Result<()> {
        match self.wire.request(&req).await? {
            Response::Ok | Response::Entry(_) => Ok(()),
            Response::Error { message } => Err(anyhow!(message)),
            other => Err(anyhow!("unexpected response: {other:?}")),
        }
    }

    pub async fn close(self) -> Result<()> {
        self.wire.close().await
    }
}
