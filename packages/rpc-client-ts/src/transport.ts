// Browser WebSocket client to the relay. Does the Hello handshake, then strict
// request/response over AEAD-sealed session frames. Requests are serialized so
// responses map FIFO (the host answers one request at a time).
//
// Robustness: a WebSocket close OR any frame that fails to decrypt (a session
// desync) is treated as FATAL — all pending + future requests reject and the
// `onClose` hook fires, so the UI surfaces a clear disconnected state instead of
// silently showing stale data.

import { fromHex, randomKey, sealTo, Session, sign, toB64 } from "./crypto";

const enc = new TextEncoder();
const dec = new TextDecoder();

// If the host stops responding (e.g. it died but the relay is still up, so frames
// are silently dropped), fail rather than hang forever.
const REQUEST_TIMEOUT_MS = 20000;

// Session-frame tags (must match core-net). The tag is OUTSIDE the AEAD; chunk
// bodies are raw E2EE content-ciphertext (one crypto pass, worker-offloaded).
const TAG_JSON = 0;
const TAG_UPLOAD_CHUNK = 1;
const TAG_CHUNK_RESP = 2;
const TAG_NOTIFY = 3; // unsolicited host push: "the account changed, re-list"

/** The surface `RealDriveApi` needs from a transport. The relay `RelayTransport` and the
 *  desktop's native (Iroh) transport both implement it, so the drive is transport-agnostic. */
export interface DriveTransport {
  /** Send one session RPC (wire JSON) and resolve its response. */
  request(req: unknown): Promise<any>;
  /** Upload one raw content-ciphertext chunk for an in-flight upload. */
  requestUploadChunk(uploadId: string, ciphertext: Uint8Array): Promise<any>;
  close(): void;
  /** Fires once when the connection dies (surface a disconnected state). */
  onClose?: (err: Error) => void;
  /** Fires on a host live-sync notification (relay only; native is request/response). */
  onChange?: () => void;
}

export class RelayTransport implements DriveTransport {
  private ws!: WebSocket;
  private session!: Session;
  private queue: Array<{ resolve: (v: any) => void; reject: (e: any) => void }> = [];
  private sendLock: Promise<unknown> = Promise.resolve();
  private closed = false;
  /** Fires once when the connection dies (close or session desync). */
  onClose?: (err: Error) => void;
  /** Fires on each host live-sync notification (a file changed on the account). */
  onChange?: () => void;

  constructor(private edPriv: Uint8Array, private edPub: Uint8Array) {}

  async connect(relayUrl: string, account: string, hostPubHex: string, token?: string): Promise<void> {
    const base = relayUrl.replace(/\/+$/, "");
    // Production relays gate admission on a short-lived token; the dev relay admits
    // tokenless connections, so `token` is optional.
    const tokenQs = token ? `&token=${encodeURIComponent(token)}` : "";
    const url = `${base}/signal?account=${encodeURIComponent(account)}&role=client${tokenQs}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("relay connection failed"));
    });
    ws.onmessage = (ev) => this.onMessage(ev);
    ws.onclose = () => this.fail(new Error("connection closed"));
    ws.onerror = () => this.fail(new Error("connection error"));

    const sessionKey = randomKey();
    const sealed = sealTo(fromHex(hostPubHex), sessionKey);
    const sig = sign(this.edPriv, sealed);
    const hello = { client_id: toB64(this.edPub), sealed_session: toB64(sealed), sig: toB64(sig) };
    this.session = new Session(sessionKey);
    ws.send(enc.encode(JSON.stringify(hello))); // sent raw (binary); not session-sealed
  }

  private onMessage(ev: MessageEvent): void {
    const bytes = new Uint8Array(ev.data as ArrayBuffer);
    // A live-sync notification is an unsolicited host push — handle it BEFORE the
    // request queue so it never consumes a pending response slot. It carries no
    // session bytes, so there's nothing to decrypt and the counter stays aligned.
    if (bytes.length >= 1 && bytes[0] === TAG_NOTIFY) {
      this.onChange?.();
      return;
    }
    const pending = this.queue.shift();
    if (!pending) return;
    try {
      const tag = bytes[0];
      if (tag === TAG_CHUNK_RESP) {
        // raw content-ciphertext; not session-sealed → no counter advance
        pending.resolve({ chunk: { ciphertext: bytes.subarray(1) } });
      } else {
        // TAG_JSON: the payload after the tag byte is session-sealed
        const json = this.session.open(bytes.subarray(1));
        pending.resolve(JSON.parse(dec.decode(json)));
      }
    } catch (e) {
      // a decrypt/parse failure means the session desynced — fatal
      pending.reject(e instanceof Error ? e : new Error(String(e)));
      this.fail(new Error("session desynced"));
    }
  }

  private fail(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.queue) p.reject(err);
    this.queue = [];
    try {
      this.ws.close();
    } catch {
      // ignore
    }
    const cb = this.onClose;
    this.onClose = undefined; // fire at most once
    cb?.(err);
  }

  // `build` runs inside the send lock so the session seal (and its counter)
  // happens in strict send order.
  private send(build: () => Uint8Array): Promise<any> {
    const run = this.sendLock.then(
      () =>
        new Promise<any>((resolve, reject) => {
          if (this.closed) {
            reject(new Error("not connected"));
            return;
          }
          let timer: ReturnType<typeof setTimeout> | undefined;
          const entry = {
            resolve: (v: any) => {
              if (timer) clearTimeout(timer);
              resolve(v);
            },
            reject: (e: any) => {
              if (timer) clearTimeout(timer);
              reject(e);
            },
          };
          this.queue.push(entry);
          try {
            this.ws.send(build());
          } catch (e) {
            this.queue.pop();
            reject(e);
            return;
          }
          // start the response clock only after the (possibly slow) send
          timer = setTimeout(() => this.fail(new Error("host not responding (timeout)")), REQUEST_TIMEOUT_MS);
        }),
    );
    this.sendLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  request(reqJson: unknown): Promise<any> {
    return this.send(() => {
      const sealed = this.session.seal(enc.encode(JSON.stringify(reqJson)));
      const msg = new Uint8Array(1 + sealed.length);
      msg[0] = TAG_JSON;
      msg.set(sealed, 1);
      return msg;
    });
  }

  /** One upload chunk: [1][u16 sealed-uid-len][seal(uploadId)][raw ciphertext]. */
  requestUploadChunk(uploadId: string, ciphertext: Uint8Array): Promise<any> {
    return this.send(() => {
      const sealedUid = this.session.seal(enc.encode(uploadId));
      const msg = new Uint8Array(1 + 2 + sealedUid.length + ciphertext.length);
      msg[0] = TAG_UPLOAD_CHUNK;
      msg[1] = (sealedUid.length >> 8) & 0xff;
      msg[2] = sealedUid.length & 0xff;
      msg.set(sealedUid, 3);
      msg.set(ciphertext, 3 + sealedUid.length);
      return msg;
    });
  }

  close(): void {
    this.fail(new Error("closed by client"));
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
