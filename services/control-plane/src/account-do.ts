/**
 * AccountDO — one Durable Object per account.
 *
 * The production stand-in for the dev relay (`core-net::relay::run_server`): it
 * fans **opaque AEAD frames** between the account's host and its clients, never
 * decrypting payloads.
 *
 * **Multiplexing (multi-client).** The DO serves ONE host but many clients. To keep
 * them from cross-talking it puts an 8-byte connection id on the host↔DO hop:
 *   client → host:  [conn_id][client frame]   (which client sent it)
 *   host → client:  [conn_id][host frame]      (which client to reply to)
 * `conn_id == BROADCAST` (all-0xFF) fans a frame (a live-sync notification) to every
 * client; a zero-length payload for an id tells the host that client disconnected.
 * The client↔DO hop is UNCHANGED — clients never see the id — so the browser/CLI
 * transports need no changes. The client transport handles the one class of
 * unsolicited host frame (a NOTIFY) out-of-band, so it never desyncs the request
 * queue.
 *
 * The conn_id is stored in the socket's **tag**, so routing survives WebSocket
 * **hibernation** (`acceptWebSocket`) with no in-memory state — the key to the
 * one-time-purchase economics: an idle account with open sockets costs nothing.
 */
import type { Env } from "./types";

type Role = "host" | "client";

const HOST_TAG = "role:host";
const CLIENT_TAG = "role:client";
const CONN_PREFIX = "conn:";
const CONN_ID_LEN = 8;

function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
function fromHex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function isBroadcast(id: Uint8Array): boolean {
  return id.length === CONN_ID_LEN && id.every((b) => b === 0xff);
}

export class AccountDO implements DurableObject {
  constructor(
    private state: DurableObjectState,
    _env: Env,
  ) {}

  private connId(ws: WebSocket): Uint8Array | null {
    const tag = this.state.getTags(ws).find((t) => t.startsWith(CONN_PREFIX));
    return tag ? fromHex(tag.slice(CONN_PREFIX.length)) : null;
  }
  private isHost(ws: WebSocket): boolean {
    return this.state.getTags(ws).includes(HOST_TAG);
  }
  private hosts(): WebSocket[] {
    return this.state.getWebSockets().filter((w) => this.isHost(w));
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const url = new URL(req.url);
    const role: Role = url.searchParams.get("role") === "host" ? "host" : "client";

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const tags: string[] = [role === "host" ? HOST_TAG : CLIENT_TAG];
    if (role === "client") {
      // A per-client id so the host can keep an isolated session and reply only to
      // this client. Random (collisions are ~2^-64); never all-0xFF (the broadcast id).
      const id = new Uint8Array(CONN_ID_LEN);
      crypto.getRandomValues(id);
      if (isBroadcast(id)) id[0] = 0;
      tags.push(CONN_PREFIX + toHex(id));
    }
    this.state.acceptWebSocket(server, tags);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === "string") return; // our protocol is binary only
    const data = new Uint8Array(message);

    if (this.isHost(ws)) {
      // [conn_id][payload]: route the reply to that client, or fan a broadcast out.
      if (data.length < CONN_ID_LEN) return;
      const target = data.slice(0, CONN_ID_LEN);
      const payload = data.slice(CONN_ID_LEN);
      const broadcast = isBroadcast(target);
      for (const peer of this.state.getWebSockets()) {
        if (peer === ws || this.isHost(peer)) continue;
        if (broadcast) {
          try {
            peer.send(payload);
          } catch {
            /* peer going away */
          }
        } else {
          const cid = this.connId(peer);
          if (cid && bytesEq(cid, target)) {
            try {
              peer.send(payload);
            } catch {
              /* peer going away */
            }
          }
        }
      }
    } else {
      // client → host: tag with THIS client's id so the host can reply to the right one.
      const id = this.connId(ws);
      if (!id) return;
      const framed = new Uint8Array(CONN_ID_LEN + data.length);
      framed.set(id, 0);
      framed.set(data, CONN_ID_LEN);
      for (const host of this.hosts()) {
        try {
          host.send(framed);
        } catch {
          /* host going away */
        }
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, _reason: string, _wasClean: boolean): Promise<void> {
    // If a client left, tell the host (empty payload) so it drops that session.
    if (!this.isHost(ws)) {
      const id = this.connId(ws);
      if (id) {
        for (const host of this.hosts()) {
          try {
            host.send(id);
          } catch {
            /* host going away */
          }
        }
      }
    }
    try {
      // 1000 (and any code ≥ 3000) are valid to echo; some transports send 1006
      // (abnormal) which is NOT allowed as a close code we initiate.
      ws.close(code >= 1000 && code < 5000 ? code : 1000);
    } catch {
      // already closed
    }
  }

  async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    // A socket errored; nothing to forward. The peer will time out or close.
  }
}
