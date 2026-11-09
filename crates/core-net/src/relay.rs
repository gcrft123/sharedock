//! Relay data path: opaque AEAD frames forwarded between a host and its clients.
//!
//! - [`RelayClient`] — the client side: connect, handshake, send Requests, await
//!   Responses.
//! - [`serve`] — the host side: connect, accept a client handshake, answer
//!   Requests, and re-handshake gracefully if a client reconnects.
//! - [`run_server`] — a local relay that fans frames host↔client by role, the
//!   dev stand-in for the Cloudflare Durable Object (same protocol).

use crate::session::{client_hello, host_accept, Hello, ReplayGuard, Session};
use anyhow::{anyhow, Result};
use core_crypto::{AgreementPublic, CryptoError, DeviceId, DeviceKeypair, SymKey};
use core_proto::{decode, encode, Request, Response};
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::handshake::server::{
    ErrorResponse, Request as HandshakeRequest, Response as HandshakeResponse,
};
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;

/// Large-file headroom: a single encrypted file travels as one frame today, so
/// the message cap bounds the max file size. (Chunked/streamed transfer is the
/// scalable P2 follow-up; until then this cap is the ceiling.)
pub(crate) const MAX_MESSAGE: usize = 256 * 1024 * 1024;

fn ws_config() -> WebSocketConfig {
    let mut c = WebSocketConfig::default();
    c.max_message_size = Some(MAX_MESSAGE);
    c.max_frame_size = Some(MAX_MESSAGE);
    c
}

fn signal_url(base: &str, account: &str, role: &str, host: Option<&str>, token: Option<&str>) -> String {
    let mut u = format!("{base}/signal?account={account}&role={role}");
    if let Some(h) = host {
        // Multi-host: the room is keyed by (account, host) so an account's several hosts
        // each keep their own isolated room. `None` = the legacy account-only room.
        u.push_str("&host=");
        u.push_str(h);
    }
    if let Some(t) = token {
        // Browser WebSockets can't set headers, so relay admission uses a
        // short-lived token in the query string (see control-plane relay.ts).
        u.push_str("&token=");
        u.push_str(t);
    }
    u
}

// ---- session-frame tagging ------------------------------------------------
// A 1-byte tag (OUTSIDE the AEAD, a plaintext discriminator) says how to read a
// message. Chunk bodies are raw E2EE content-ciphertext — NOT session-sealed —
// so they cost one crypto pass, not two, and carry no base64/JSON overhead. Only
// the tiny routing header (the upload id) and JSON control frames are sealed.
//   tag 0: [0] ++ seal(json)
//   tag 1: [1] ++ u16(sealed_uid_len) ++ seal(upload_id) ++ raw_ciphertext
//   tag 2: [2] ++ raw_ciphertext
// Integrity of bodies is preserved by the content AEAD (each chunk is bound to
// its sequence), so tampering/reorder is caught at decrypt time.
pub(crate) const TAG_JSON: u8 = 0;
pub(crate) const TAG_UPLOAD_CHUNK: u8 = 1;
pub(crate) const TAG_CHUNK_RESP: u8 = 2;
/// Unsolicited host→client "the account changed, re-list" notification (live sync).
/// A bare 1-byte frame: no body, so it carries NO counter change and leaks NO path
/// to the zero-knowledge relay — it just says *something* changed. Clients that
/// can't act on it (the WebDAV mount) skip it; the browser console re-lists.
pub(crate) const TAG_NOTIFY: u8 = 3;

pub(crate) fn is_session_tag(t: u8) -> bool {
    t == TAG_JSON || t == TAG_UPLOAD_CHUNK || t == TAG_CHUNK_RESP
}

// ---- host↔relay multiplexing envelope (multi-client) ----------------------
// The relay serves ONE host per account but many clients. To keep them from
// cross-talking, the host↔relay hop carries an 8-byte little-endian connection id:
//   relay → host:  [conn_id][client frame]      (which client sent it)
//   host → relay:  [conn_id][host frame]         (which client to reply to)
// `BROADCAST_ID` fans a frame (a live-sync notify) to every client; a zero-length
// payload for an id tells the host that client disconnected. The client↔relay hop is
// UNCHANGED — clients never see the id — so browser/CLI clients need no changes.
pub(crate) const CONN_ID_LEN: usize = 8;
pub(crate) const BROADCAST_ID: u64 = u64::MAX;

pub(crate) fn msg_json(session: &mut Session, json: &[u8]) -> Vec<u8> {
    let sealed = session.seal(json);
    let mut m = Vec::with_capacity(1 + sealed.len());
    m.push(TAG_JSON);
    m.extend_from_slice(&sealed);
    m
}
pub(crate) fn msg_chunk_resp(ciphertext: &[u8]) -> Vec<u8> {
    let mut m = Vec::with_capacity(1 + ciphertext.len());
    m.push(TAG_CHUNK_RESP);
    m.extend_from_slice(ciphertext);
    m
}
/// Build an UploadChunk binary frame (the inverse of [`parse_upload_chunk_frame`]):
/// `[TAG_UPLOAD_CHUNK][u16 be sealed_uid_len][seal(upload_id)][raw ciphertext]`. The body
/// ciphertext travels RAW (already content-AEAD'd by the caller) — one crypto pass, no
/// base64/JSON — so only the tiny upload id is session-sealed. Mirrors the browser client's
/// fast path so a Rust client (iroh/relay) can send it too.
pub(crate) fn msg_upload_chunk(session: &mut Session, upload_id: &str, ciphertext: &[u8]) -> Vec<u8> {
    let sealed_uid = session.seal(upload_id.as_bytes());
    let mut m = Vec::with_capacity(1 + 2 + sealed_uid.len() + ciphertext.len());
    m.push(TAG_UPLOAD_CHUNK);
    m.extend_from_slice(&(sealed_uid.len() as u16).to_be_bytes());
    m.extend_from_slice(&sealed_uid);
    m.extend_from_slice(ciphertext);
    m
}
/// Parse an UploadChunk frame body (bytes after the tag): [u16 be sealed_uid_len][sealed_uid][ciphertext].
pub(crate) fn parse_upload_chunk_frame(session: &mut Session, payload: &[u8]) -> Option<Request> {
    if payload.len() < 2 {
        return None;
    }
    let len = u16::from_be_bytes([payload[0], payload[1]]) as usize;
    if payload.len() < 2 + len {
        return None;
    }
    let upload_id = String::from_utf8(session.open(&payload[2..2 + len]).ok()?).ok()?;
    Some(Request::UploadChunk { upload_id, ciphertext: payload[2 + len..].to_vec() })
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

pub struct RelayClient {
    ws: tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>>,
    session: Session,
}

impl RelayClient {
    pub async fn connect(
        base_url: &str,
        account: &str,
        client: &DeviceKeypair,
        host_pub: &AgreementPublic,
        host: Option<&str>,
        token: Option<&str>,
    ) -> Result<Self> {
        let url = signal_url(base_url, account, "client", host, token);
        let (mut ws, _) =
            tokio_tungstenite::connect_async_with_config(url.as_str(), Some(ws_config()), false)
                .await?;
        let (hello, session) = client_hello(client, host_pub);
        ws.send(Message::Binary(encode(&hello))).await?;
        Ok(Self { ws, session })
    }

    /// Send one request and await its response (client drives; strict req/resp).
    /// The Rust client always sends JSON (tag 0); it accepts JSON or binary-chunk
    /// responses.
    pub async fn request(&mut self, req: &Request) -> Result<Response> {
        let msg = msg_json(&mut self.session, &encode(req));
        self.ws.send(Message::Binary(msg)).await?;
        while let Some(m) = self.ws.next().await {
            match m? {
                Message::Binary(b) => {
                    if b.is_empty() {
                        return Err(anyhow!("empty frame"));
                    }
                    let (tag, payload) = (b[0], &b[1..]);
                    // A live-sync notification can arrive between our request and its
                    // response; skip it (this client — the WebDAV mount — can't act on
                    // it) and keep reading. It carries no session bytes, so nothing to
                    // decrypt and the counter stays aligned.
                    if tag == TAG_NOTIFY {
                        continue;
                    }
                    return match tag {
                        // JSON response: the payload is session-sealed
                        TAG_JSON => {
                            let pt = self.session.open(payload).map_err(|_| anyhow!("session decrypt failed"))?;
                            Ok(decode(&pt)?)
                        }
                        // chunk response: raw content-ciphertext, no session layer
                        TAG_CHUNK_RESP => Ok(Response::Chunk { ciphertext: payload.to_vec() }),
                        _ => Err(anyhow!("unknown frame tag {tag}")),
                    };
                }
                Message::Close(_) => return Err(anyhow!("relay closed")),
                _ => continue,
            }
        }
        Err(anyhow!("no response"))
    }

    pub async fn close(mut self) -> Result<()> {
        self.ws.close(None).await.ok();
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

/// Serve clients over the relay. Establishes a session from the first Hello and
/// answers each request via `handler`. If a frame can't be decrypted under the
/// current session, it is tried as a fresh Hello — so a client that reconnects
/// (page reload, new tab) re-handshakes seamlessly instead of wedging the host.
#[allow(clippy::too_many_arguments)]
pub async fn serve(
    base_url: &str,
    account: &str,
    host: Option<&str>,
    token: Option<&str>,
    // This host's X25519 public key. Bound into the Hello signature, so a captured Hello
    // cannot be presented to a different host.
    host_pub: AgreementPublic,
    open_sealed: impl Fn(&[u8]) -> Result<SymKey, CryptoError>,
    is_authorized: impl Fn(&DeviceId) -> bool,
    mut handler: impl FnMut(Request) -> Response,
    mut notify: tokio::sync::broadcast::Receiver<()>,
) -> Result<()> {
    use tokio::sync::broadcast::error::RecvError;
    let url = signal_url(base_url, account, "host", host, token);
    let (mut ws, _) =
        tokio_tungstenite::connect_async_with_config(url.as_str(), Some(ws_config()), false).await?;

    // Recently accepted Hello nonces, so one cannot be replayed inside the freshness window.
    // One guard for the whole loop: this task owns every handshake on this connection.
    let mut replay = ReplayGuard::new();

    // One session per connected client, keyed by the relay's connection id — so
    // multiple clients (e.g. several browser consoles) never cross-talk.
    let mut sessions: HashMap<u64, Session> = HashMap::new();
    let mut notify_open = true;

    loop {
        tokio::select! {
            // Live-sync: the store changed → fan a notify to EVERY connected client.
            n = notify.recv(), if notify_open => match n {
                Ok(()) | Err(RecvError::Lagged(_)) => {
                    if !sessions.is_empty() {
                        let mut m = BROADCAST_ID.to_le_bytes().to_vec();
                        m.push(TAG_NOTIFY);
                        if ws.send(Message::Binary(m)).await.is_err() {
                            break;
                        }
                    }
                }
                Err(RecvError::Closed) => notify_open = false,
            },
            msg = ws.next() => {
                let Some(msg) = msg else { break };
                let msg = match msg {
                    Ok(m) => m,
                    Err(_) => break, // relay vanished / oversize frame; end cleanly
                };
                let bytes = match msg {
                    Message::Binary(b) => b,
                    Message::Close(_) => break,
                    _ => continue,
                };
                // Frames from the relay are [conn_id][payload]; an empty payload means
                // that client disconnected — drop its session.
                if bytes.len() < CONN_ID_LEN {
                    continue;
                }
                let conn_id = u64::from_le_bytes(bytes[..CONN_ID_LEN].try_into().unwrap());
                let payload = &bytes[CONN_ID_LEN..];
                if payload.is_empty() {
                    sessions.remove(&conn_id);
                    continue;
                }
                let tag = payload[0];

                // 1) a tagged session frame (needs THIS client's established session)
                if is_session_tag(tag) {
                    if let Some(s) = sessions.get_mut(&conn_id) {
                        let body = &payload[1..];
                        let req = match tag {
                            TAG_JSON => s.open(body).ok().and_then(|pt| decode::<Request>(&pt).ok()),
                            TAG_UPLOAD_CHUNK => parse_upload_chunk_frame(s, body),
                            _ => None, // clients never send TAG_CHUNK_RESP
                        };
                        if let Some(req) = req {
                            let resp = handler(req);
                            let out = match &resp {
                                Response::Chunk { ciphertext } => msg_chunk_resp(ciphertext),
                                _ => msg_json(s, &encode(&resp)),
                            };
                            // Reply prefixed with the client's id so the relay routes
                            // it back to the right client (not broadcast to all).
                            let mut framed = conn_id.to_le_bytes().to_vec();
                            framed.extend_from_slice(&out);
                            ws.send(Message::Binary(framed)).await?;
                        }
                    }
                    continue;
                }

                // 2) otherwise a (re)handshake Hello (raw JSON, untagged) for this client
                if let Ok(hello) = decode::<Hello>(payload) {
                    if let Ok((_id, s)) = host_accept(&hello, &host_pub, &mut replay, &open_sealed, &is_authorized) {
                        sessions.insert(conn_id, s);
                    }
                }
                // 3) neither: ignore (stray/garbage frame)
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Relay server (dev stand-in for the Cloudflare Durable Object)
// ---------------------------------------------------------------------------

type Tx = UnboundedSender<Message>;

#[derive(Default)]
struct Room {
    host: Option<Tx>,
    clients: HashMap<u64, Tx>,
}

type Rooms = Arc<Mutex<HashMap<String, Room>>>;

/// Run the relay accept loop. Forwards frames between the host and clients of the
/// same account by opposite role — it never inspects or decrypts payloads.
pub async fn run_server(listener: TcpListener) -> Result<()> {
    let rooms: Rooms = Arc::new(Mutex::new(HashMap::new()));
    let mut next_id: u64 = 0;
    loop {
        let (stream, _) = listener.accept().await?;
        next_id += 1;
        let conn_id = next_id;
        let rooms = rooms.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_conn(stream, rooms, conn_id).await {
                tracing::debug!("relay conn {conn_id} ended: {e}");
            }
        });
    }
}

async fn handle_conn(stream: TcpStream, rooms: Rooms, conn_id: u64) -> Result<()> {
    let uri = Arc::new(std::sync::Mutex::new(String::new()));
    let uc = uri.clone();
    let ws = tokio_tungstenite::accept_hdr_async_with_config(
        stream,
        move |req: &HandshakeRequest, resp: HandshakeResponse| -> Result<HandshakeResponse, ErrorResponse> {
            *uc.lock().unwrap() = req.uri().to_string();
            Ok(resp)
        },
        Some(ws_config()),
    )
    .await?;
    let uri = uri.lock().unwrap().clone();
    let (account, role, host) = parse_account_role_host(&uri);
    // Rooms are keyed by (account, host): an account's several hosts each get an
    // isolated room. `host` absent → the legacy account-only room (single-host).
    let room_key = match &host {
        Some(h) => format!("{account}:{h}"),
        None => account.clone(),
    };

    let (tx, mut rx) = unbounded_channel::<Message>();
    {
        let mut g = rooms.lock().await;
        let room = g.entry(room_key.clone()).or_default();
        if role == "host" {
            room.host = Some(tx);
        } else {
            room.clients.insert(conn_id, tx);
        }
    }

    let (mut write, mut read) = ws.split();
    let writer = tokio::spawn(async move {
        while let Some(m) = rx.recv().await {
            if write.send(m).await.is_err() {
                break;
            }
        }
    });

    while let Some(msg) = read.next().await {
        let msg = match msg {
            Ok(m) => m,
            Err(_) => break,
        };
        if msg.is_close() {
            break;
        }
        if !(msg.is_binary() || msg.is_text()) {
            continue;
        }
        let data = msg.into_data();
        let g = rooms.lock().await;
        let Some(room) = g.get(&room_key) else { continue };
        if role == "host" {
            // Host frames are [conn_id][payload]: route the reply to that client, or
            // fan out to all clients when the id is BROADCAST (a live-sync notify).
            if data.len() < CONN_ID_LEN {
                continue;
            }
            let target = u64::from_le_bytes(data[..CONN_ID_LEN].try_into().unwrap());
            let payload = data[CONN_ID_LEN..].to_vec();
            if target == BROADCAST_ID {
                for c in room.clients.values() {
                    let _ = c.send(Message::Binary(payload.clone()));
                }
            } else if let Some(c) = room.clients.get(&target) {
                let _ = c.send(Message::Binary(payload));
            }
        } else if let Some(h) = &room.host {
            // Client → host: tag with THIS connection's id so the host can keep a
            // per-client session and reply to the right one.
            let mut framed = conn_id.to_le_bytes().to_vec();
            framed.extend_from_slice(&data);
            let _ = h.send(Message::Binary(framed));
        }
    }

    {
        let mut g = rooms.lock().await;
        if let Some(room) = g.get_mut(&room_key) {
            if role == "host" {
                room.host = None;
            } else {
                // Tell the host this client is gone (empty payload) so it drops the
                // session, then remove it from the room.
                if let Some(h) = &room.host {
                    let _ = h.send(Message::Binary(conn_id.to_le_bytes().to_vec()));
                }
                room.clients.remove(&conn_id);
            }
        }
    }
    writer.abort();
    Ok(())
}

fn parse_account_role_host(uri: &str) -> (String, String, Option<String>) {
    let mut account = String::new();
    let mut role = "client".to_string();
    let mut host = None;
    if let Some(q) = uri.split('?').nth(1) {
        for pair in q.split('&') {
            let mut it = pair.splitn(2, '=');
            match (it.next(), it.next()) {
                (Some("account"), Some(v)) => account = v.to_string(),
                (Some("role"), Some(v)) => role = v.to_string(),
                (Some("host"), Some(v)) => host = Some(v.to_string()),
                _ => {}
            }
        }
    }
    (account, role, host)
}
