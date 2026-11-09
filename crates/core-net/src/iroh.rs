//! Direct P2P QUIC transport (Iroh) — the LAN fast path.
//!
//! Carries the SAME session handshake + tagged RPC frames as the relay (`session`
//! + `relay` modules), but over an Iroh QUIC **bi-stream** with a u32-BE length
//! prefix (QUIC streams are byte streams, not message-framed). The device's
//! **Ed25519 key is the Iroh EndpointId**, so peers dial each other by key, not IP
//! — and discovery/authorization reuse the identity already paired + stored.
//!
//! Feature-gated (`iroh`) so the heavy QUIC/rustls tree stays out of default builds.

use std::sync::Arc;

use anyhow::{anyhow, Result};
use core_crypto::{AgreementPublic, CryptoError, DeviceId, DeviceKeypair, SymKey};
use core_proto::{decode, encode, Request, Response};
use std::str::FromStr;

use iroh::endpoint::{Connection, RecvStream, SendStream, TransportAddrUsage};
use iroh::RelayMode;
// Re-export the iroh handles callers (tests, client-core, daemon) need, so
// core-net is the single facade for the Iroh transport.
pub use iroh::{Endpoint, EndpointAddr, EndpointId, SecretKey};

use crate::relay::{
    is_session_tag, msg_chunk_resp, msg_json, msg_upload_chunk, parse_upload_chunk_frame,
    MAX_MESSAGE, TAG_CHUNK_RESP, TAG_JSON, TAG_NOTIFY, TAG_UPLOAD_CHUNK,
};
use crate::session::{client_hello, host_accept, Hello, ReplayGuard, Session};

/// ALPN for personal-cloud RPC over Iroh.
pub const ALPN: &[u8] = b"personal-cloud/rpc/1";

/// Derive the Iroh secret key from the device's Ed25519 signing key, so the
/// resulting EndpointId equals the device id (the first 32 bytes of the device
/// keypair are the Ed25519 seed).
pub fn secret_from_device(device: &DeviceKeypair) -> SecretKey {
    let all = device.to_bytes();
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&all[..32]);
    SecretKey::from_bytes(&seed)
}

/// Bind an Iroh endpoint keyed by `secret`. `offline` disables relays + discovery
/// (LAN/loopback, dial by explicit `EndpointAddr`); otherwise n0 relays are used.
pub async fn bind_endpoint(secret: SecretKey, offline: bool) -> Result<Endpoint> {
    let relay = if offline { RelayMode::Disabled } else { RelayMode::Default };
    iroh::Endpoint::builder(iroh::endpoint::presets::Minimal)
        .secret_key(secret)
        .alpns(vec![ALPN.to_vec()])
        .relay_mode(relay)
        .bind()
        .await
        .map_err(|e| anyhow!("iroh bind: {e}"))
}

/// Build an [`EndpointAddr`] from control-plane discovery fields (the host's
/// EndpointId, its direct `"ip:port"` addresses, and an optional relay URL) — the
/// client side of discovery, used by `RemoteDrive::connect_auto`.
pub fn endpoint_addr(
    endpoint_id: &str,
    direct_addrs: &[String],
    relay_url: Option<&str>,
) -> Result<EndpointAddr> {
    let id = EndpointId::from_str(endpoint_id).map_err(|e| anyhow!("bad endpoint id: {e}"))?;
    let mut addr = EndpointAddr::new(id);
    for s in direct_addrs {
        if let Ok(sa) = s.parse::<std::net::SocketAddr>() {
            addr = addr.with_ip_addr(sa);
        }
    }
    if let Some(u) = relay_url {
        if let Ok(url) = iroh::RelayUrl::from_str(u) {
            addr = addr.with_relay_url(url);
        }
    }
    Ok(addr)
}

// ---- honest path-type reporting --------------------------------------------

/// What a live Iroh connection is *actually* using. A successful QUIC dial does NOT
/// mean the link is direct: iroh happily establishes a session over the n0 DERP relay
/// (hole-punching failed or hasn't completed), and that session runs at relay speed.
/// This lets the console report "Direct P2P" only when it's true.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PathType {
    /// A hole-punched direct IP path is active — true LAN/P2P speed.
    Direct,
    /// Both a direct IP and a relay path are active (usually a transient while the
    /// direct path settles); data prefers the direct one, so we treat it as direct.
    Mixed,
    /// Only a relay (n0 DERP) path is active — QUIC works, but every byte is relayed.
    Relay,
    /// No path info yet (too early after connect, or the peer aged out of the map).
    Unknown,
}

impl PathType {
    /// The string the desktop console reports up to the dashboard. Only a genuinely
    /// direct path is `"direct"`; a relayed QUIC session is honestly `"relay-iroh"`
    /// (distinct from the WebSocket cloud relay's `"relay"`), so the UI stops showing
    /// "Direct P2P" for traffic that's really going through a relay.
    pub fn wire_str(self) -> &'static str {
        match self {
            PathType::Direct | PathType::Mixed => "direct",
            PathType::Relay => "relay-iroh",
            PathType::Unknown => "unknown",
        }
    }
}

/// Classify the current transport path to `peer` from the endpoint's live remote-info.
/// A point-in-time snapshot: right after connect the direct path may not be punched yet
/// (returns `Relay`/`Unknown`, then upgrades to `Direct` seconds later once traffic has
/// flowed) — use [`settled_path_type`] when you want to wait for it to settle.
pub async fn path_type(endpoint: &Endpoint, peer: EndpointId) -> PathType {
    let Some(info) = endpoint.remote_info(peer).await else {
        return PathType::Unknown;
    };
    let (mut ip, mut relay) = (false, false);
    for a in info.addrs() {
        // Only paths actively carrying traffic count; iroh keeps stale/candidate
        // addresses around in the list too.
        if !matches!(a.usage(), TransportAddrUsage::Active) {
            continue;
        }
        if a.addr().is_ip() {
            ip = true;
        } else if a.addr().is_relay() {
            relay = true;
        }
    }
    match (ip, relay) {
        (true, true) => PathType::Mixed,
        (true, false) => PathType::Direct,
        (false, true) => PathType::Relay,
        (false, false) => PathType::Unknown,
    }
}

/// Poll [`path_type`] until a direct path appears or `wait` elapses, returning the best
/// path observed. Hole-punching needs real traffic to have flowed and a moment to
/// complete, so callers should warm the connection (one round-trip) first, then give
/// this a few seconds to catch a `Relay`→`Direct` upgrade. Returns as soon as a direct
/// path is seen; otherwise waits out the deadline and reports the relay it's stuck on.
pub async fn settled_path_type(
    endpoint: &Endpoint,
    peer: EndpointId,
    wait: std::time::Duration,
) -> PathType {
    let deadline = tokio::time::Instant::now() + wait;
    let mut best = PathType::Unknown;
    loop {
        let now = path_type(endpoint, peer).await;
        if matches!(now, PathType::Direct | PathType::Mixed) {
            return now;
        }
        if now == PathType::Relay {
            best = PathType::Relay; // remember the relay, but keep waiting for an upgrade
        }
        if tokio::time::Instant::now() >= deadline {
            return best;
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
}

// ---- length-prefix framing over a QUIC byte stream --------------------------

async fn write_frame(send: &mut SendStream, bytes: &[u8]) -> Result<()> {
    let len = bytes.len() as u32;
    send.write_all(&len.to_be_bytes()).await.map_err(|e| anyhow!("iroh write: {e}"))?;
    send.write_all(bytes).await.map_err(|e| anyhow!("iroh write: {e}"))?;
    Ok(())
}

async fn read_frame(recv: &mut RecvStream) -> Result<Vec<u8>> {
    let mut len_buf = [0u8; 4];
    recv.read_exact(&mut len_buf).await.map_err(|e| anyhow!("iroh read: {e}"))?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > MAX_MESSAGE {
        return Err(anyhow!("frame too large: {len}"));
    }
    let mut buf = vec![0u8; len];
    recv.read_exact(&mut buf).await.map_err(|e| anyhow!("iroh read: {e}"))?;
    Ok(buf)
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/// A direct QUIC connection to a host. One bi-stream carries the whole session
/// (strict request/response), exactly like [`crate::relay::RelayClient`].
pub struct IrohClient {
    _conn: Connection,
    send: SendStream,
    recv: RecvStream,
    session: Session,
}

impl IrohClient {
    pub async fn connect(
        endpoint: &Endpoint,
        host_addr: EndpointAddr,
        client: &DeviceKeypair,
        host_pub: &AgreementPublic,
    ) -> Result<Self> {
        let conn =
            endpoint.connect(host_addr, ALPN).await.map_err(|e| anyhow!("iroh connect: {e}"))?;
        // The opener must send first for the peer's accept_bi to fire.
        let (mut send, recv) = conn.open_bi().await.map_err(|e| anyhow!("open_bi: {e}"))?;
        let (hello, session) = client_hello(client, host_pub);
        write_frame(&mut send, &encode(&hello)).await?;
        Ok(Self { _conn: conn, send, recv, session })
    }

    /// Send one request, await its response (mirrors `RelayClient::request`).
    pub async fn request(&mut self, req: &Request) -> Result<Response> {
        let msg = msg_json(&mut self.session, &encode(req));
        write_frame(&mut self.send, &msg).await?;
        self.read_response().await
    }

    /// Upload one content chunk as a raw binary frame (`TAG_UPLOAD_CHUNK`): the ciphertext
    /// travels RAW (already content-AEAD'd by the caller — one crypto pass, no base64/JSON)
    /// and only the tiny upload id is session-sealed. The host already accepts this frame over
    /// iroh; this is the client half of that fast path, so the desktop console stops paying the
    /// base64+JSON+double-seal tax the generic `request(UploadChunk{..})` path incurs.
    pub async fn upload_chunk(&mut self, upload_id: &str, ciphertext: &[u8]) -> Result<Response> {
        let msg = msg_upload_chunk(&mut self.session, upload_id, ciphertext);
        write_frame(&mut self.send, &msg).await?;
        self.read_response().await
    }

    /// Read one response frame, skipping a possible live-sync NOTIFY (a bare frame that
    /// carries no session bytes, so the counter stays aligned).
    async fn read_response(&mut self) -> Result<Response> {
        loop {
            let b = read_frame(&mut self.recv).await?;
            if b.is_empty() {
                return Err(anyhow!("empty frame"));
            }
            let (tag, payload) = (b[0], &b[1..]);
            if tag == TAG_NOTIFY {
                continue;
            }
            return match tag {
                TAG_JSON => {
                    let pt =
                        self.session.open(payload).map_err(|_| anyhow!("session decrypt failed"))?;
                    Ok(decode(&pt)?)
                }
                TAG_CHUNK_RESP => Ok(Response::Chunk { ciphertext: payload.to_vec() }),
                _ => Err(anyhow!("unknown frame tag {tag}")),
            };
        }
    }
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

/// Accept + serve direct QUIC clients. Each connection is served on its own task;
/// the closures are shared (`Arc`) across connections, so the caller wraps any
/// non-`Sync` state (e.g. the host `Store`) in a mutex, matching the relay path's
/// single-writer model.
pub async fn serve_iroh<OS, IA, H>(
    endpoint: Endpoint,
    // This host's X25519 public key, bound into the Hello signature.
    host_pub: AgreementPublic,
    open_sealed: OS,
    is_authorized: IA,
    handler: H,
) -> Result<()>
where
    OS: Fn(&[u8]) -> Result<SymKey, CryptoError> + Send + Sync + 'static,
    IA: Fn(&DeviceId) -> bool + Send + Sync + 'static,
    H: Fn(Request) -> Response + Send + Sync + 'static,
{
    let open_sealed = Arc::new(open_sealed);
    let is_authorized = Arc::new(is_authorized);
    let handler = Arc::new(handler);
    // Shared across connections: each is served on its own task, and a replayed Hello would
    // otherwise just be presented on a fresh connection with its own private guard.
    let replay = Arc::new(std::sync::Mutex::new(ReplayGuard::new()));
    while let Some(incoming) = endpoint.accept().await {
        let os = open_sealed.clone();
        let ia = is_authorized.clone();
        let h = handler.clone();
        let rg = replay.clone();
        tokio::spawn(async move {
            if let Ok(conn) = incoming.await {
                let _ = serve_conn(conn, host_pub, rg, os, ia, h).await;
            }
        });
    }
    Ok(())
}

async fn serve_conn<OS, IA, H>(
    conn: Connection,
    host_pub: AgreementPublic,
    replay: Arc<std::sync::Mutex<ReplayGuard>>,
    open_sealed: Arc<OS>,
    is_authorized: Arc<IA>,
    handler: Arc<H>,
) -> Result<()>
where
    OS: Fn(&[u8]) -> Result<SymKey, CryptoError>,
    IA: Fn(&DeviceId) -> bool,
    H: Fn(Request) -> Response,
{
    let (mut send, mut recv) = conn.accept_bi().await.map_err(|e| anyhow!("accept_bi: {e}"))?;

    // First frame is the client Hello (raw JSON, untagged).
    let hello_bytes = read_frame(&mut recv).await?;
    let hello: Hello = decode(&hello_bytes)?;
    let (_id, mut session) =
        {
            let mut guard = replay.lock().expect("replay guard poisoned");
            host_accept(&hello, &host_pub, &mut guard, |b| open_sealed(b), |id| is_authorized(id))
                .map_err(|e| anyhow!("handshake rejected: {e:?}"))?
        };

    loop {
        let b = match read_frame(&mut recv).await {
            Ok(b) => b,
            Err(_) => break, // stream closed
        };
        if b.is_empty() {
            continue;
        }
        let tag = b[0];
        if !is_session_tag(tag) {
            continue;
        }
        let payload = &b[1..];
        let req = match tag {
            TAG_JSON => session.open(payload).ok().and_then(|pt| decode::<Request>(&pt).ok()),
            TAG_UPLOAD_CHUNK => parse_upload_chunk_frame(&mut session, payload),
            _ => None, // clients never send TAG_CHUNK_RESP
        };
        if let Some(req) = req {
            let resp = handler(req);
            let out = match &resp {
                Response::Chunk { ciphertext } => msg_chunk_resp(ciphertext),
                _ => msg_json(&mut session, &encode(&resp)),
            };
            write_frame(&mut send, &out).await?;
        }
    }
    Ok(())
}
