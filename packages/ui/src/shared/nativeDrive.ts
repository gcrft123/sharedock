// Desktop-only: route the console's DriveApi over the app's NATIVE transport — a direct
// Iroh (QUIC) connection to the host, relay fallback — instead of the webview's WebSocket
// relay. A webview can't open a raw QUIC socket, so same-network transfers over the relay
// pay a cloud round-trip (capped by your upload bandwidth); the native path runs at LAN
// speed. Content E2EE stays entirely in the TS client (RealDriveApi wraps content keys with
// the ARK); only the SESSION transport moves to native — `drive_rpc` carries the same wire
// JSON the relay used, and the Rust side never sees plaintext or the ARK.

import { RealDriveApi, loadOrCreateIdentity } from "@app/rpc-client";
import type { DriveApi, DriveTransport, HostConnConfig } from "@app/rpc-client";
import { invoke, invokeRaw } from "./tauri";
import { cp } from "./cp";

const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** The exact ArrayBuffer backing `b` (no copy when `b` spans its whole buffer). */
const asArrayBuffer = (b: Uint8Array): ArrayBuffer =>
  b.byteOffset === 0 && b.byteLength === b.buffer.byteLength
    ? (b.buffer as ArrayBuffer)
    : (b.slice().buffer as ArrayBuffer);

/** A DriveTransport that forwards each session RPC to the native `drive_rpc` command. */
class NativeTransport implements DriveTransport {
  private closed = false;
  onClose?: (err: Error) => void;
  onChange?: () => void; // native is strict request/response — no live-sync push

  async request(req: unknown): Promise<any> {
    if (this.closed) throw new Error("not connected");
    try {
      const json = await invoke<string>("drive_rpc", { requestJson: JSON.stringify(req) });
      return JSON.parse(json);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.fail(err);
      throw err;
    }
  }

  async requestUploadChunk(uploadId: string, ciphertext: Uint8Array): Promise<any> {
    if (this.closed) throw new Error("not connected");
    // Raw binary over the native IPC: the ciphertext is the request BODY (no char-by-char
    // base64, no multi-MB JSON string), the upload id a header. The Rust side builds the
    // TAG_UPLOAD_CHUNK frame directly — one crypto pass, no re-base64/JSON/double-seal.
    try {
      const json = await invokeRaw<string>("drive_upload_chunk", asArrayBuffer(ciphertext), {
        "upload-id": uploadId,
      });
      return JSON.parse(json);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.fail(err);
      throw err;
    }
  }

  close(): void {
    this.fail(new Error("closed by client"));
    void invoke("drive_disconnect").catch(() => {});
  }

  private fail(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    const cb = this.onClose;
    this.onClose = undefined; // fire at most once
    cb?.(err);
  }
}

/**
 * Connect the console over the native (Iroh-direct, relay-fallback) transport. Discovers the
 * host's Iroh endpoint from the control plane, hands the console's identity to the native
 * side for the session, and returns a RealDriveApi. Throws if the native connect fails — the
 * caller falls back to the relay transport, so there's no regression.
 */
export async function connectNativeApi(
  cfg: HostConnConfig,
  onClose: (err: Error) => void,
  onChange: () => void,
  token: string | undefined,
): Promise<{ api: DriveApi; path: string }> {
  const id = loadOrCreateIdentity();
  const hosts = await cp()
    .listHosts(cfg.account)
    .catch((e) => {
      // Don't hide a discovery failure (auth/network) as "no hosts" — that's exactly what
      // silently starves the iroh dial (empty host → drive_connect skips direct → relay).
      // Surface it; the relay fallback below still runs, so there's no regression.
      console.warn("[pc] host discovery failed; native P2P path unavailable, using relay:", e);
      return [];
    });
  const host = hosts.find((h) => h.agreement_pub === cfg.hostPub) ?? hosts[0];

  const path = await invoke<string>("drive_connect", {
    args: {
      relayUrl: cfg.relayUrl,
      account: cfg.account,
      hostPub: cfg.hostPub,
      edPriv: toHex(id.edPriv),
      token,
      hostEid: host?.endpoint_id ?? null,
      hostAddrs: host?.direct_addrs ?? [],
      irohRelay: host?.relay_url ?? null,
    },
  });

  const t = new NativeTransport();
  t.onClose = onClose;
  t.onChange = onChange;
  return { api: new RealDriveApi(t, id.ark), path };
}
