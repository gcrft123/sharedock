// The real transport adapter: implements the same `DriveApi` the UI depends on,
// but backed by the encrypted relay RPC to a live host. Dashboard surfaces the
// host RPC doesn't cover yet (transfers/devices/shares/activity) return empty for
// now; browse + quota + host status + upload/download are real.

import type {
  ActivityEvent,
  Connection,
  Device,
  DirListing,
  DriveApi,
  FileEntry,
  HostStatus,
  Quota,
  Share,
  SharePerm,
  Transfer,
} from "./types";
import { RelayTransport, type DriveTransport } from "./transport";
import { ensureOk, req, respBody } from "./wire";
import { fromB64, fromHex, randomKey, unwrapContentKeyAny, wrapContentKey } from "./crypto";
import { cryptoWorker } from "./crypto-worker-client";
import { transfers } from "./transfers";
import { getKeyringHex, loadOrCreateIdentity, type HostConnConfig } from "./config";

const UPLOAD_CHUNK = 4 * 1024 * 1024; // 4 MiB plaintext per chunk

function categoryFromName(name: string): FileEntry["category"] {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "raw", "heic", "svg"].includes(ext)) return "image";
  if (["mp4", "mov", "mkv", "webm", "avi"].includes(ext)) return "video";
  if (["mp3", "wav", "flac", "aac", "ogg"].includes(ext)) return "audio";
  if (["zip", "tar", "gz", "zst", "7z", "rar"].includes(ext)) return "archive";
  if (["ts", "tsx", "js", "jsx", "rs", "py", "go", "md", "json", "css", "html"].includes(ext)) return "code";
  if (["pdf", "doc", "docx", "xls", "xlsx", "txt", "csv"].includes(ext)) return "document";
  return "other";
}

function mapEntry(e: any): FileEntry {
  const kind: "file" | "dir" = e.kind === "dir" ? "dir" : "file";
  return {
    id: e.id,
    name: e.name,
    kind,
    sizeBytes: e.size_bytes ?? 0,
    modified: e.modified ?? Date.now(),
    starred: e.starred ?? false,
    // Older hosts send nothing here; the UI falls back to its previous behaviour rather
    // than showing actions that cannot work.
    path: typeof e.path === "string" && e.path ? e.path : undefined,
    category: kind === "dir" ? "folder" : categoryFromName(e.name),
  };
}

export class RealDriveApi implements DriveApi {
  /**
   * `keyring` is newest-first. New files are wrapped under `keyring[0]`; reads try every
   * entry, so a half-finished rotation still opens every file.
   */
  constructor(
    private t: DriveTransport,
    private ark: Uint8Array,
    private keyring: Uint8Array[] = [ark],
  ) {}

  /** Replace an object's wrapped content key, for account-key rotation. */
  async rewrapKey(id: string, wrappedCk: Uint8Array): Promise<void> {
    ensureOk(await this.t.request(req.rewrapKey(id, wrappedCk)));
  }

  /** The stored wrapped content key and which keyring entry opens it. */
  async inspectKey(id: string): Promise<{ ck: Uint8Array; keyIndex: number; wrapped: Uint8Array }> {
    const info = respBody(ensureOk(await this.t.request(req.readBegin(id)))) as { wrapped_ck: string };
    const wrapped = fromB64(info.wrapped_ck);
    const { ck, keyIndex } = unwrapContentKeyAny(this.keyring, wrapped);
    return { ck, keyIndex, wrapped };
  }

  async getHostStatus(): Promise<HostStatus> {
    const h = respBody(ensureOk(await this.t.request(req.getHostStatus())));
    return {
      hostId: h.host_id,
      machineName: h.machine_name,
      os: h.os,
      appVersion: h.app_version,
      online: h.online,
      uptimeSecs: h.uptime_secs,
      diskFreeBytes: h.disk_free_bytes,
      diskTotalBytes: h.disk_total_bytes,
    };
  }

  async getConnection(): Promise<Connection> {
    // The web console reaches the host over the relay (direct-P2P is the native path).
    // Live up/down + relay bytes are derived from the in-flight transfers store.
    let up = 0;
    let down = 0;
    let moved = 0;
    for (const t of transfers.getSnapshot()) {
      moved += t.transferredBytes;
      if (t.state === "active") {
        if (t.direction === "up") up += t.bytesPerSec;
        else down += t.bytesPerSec;
      }
    }
    return {
      path: "RELAY",
      latencyMs: 0, // callers measure RTT with a timed RPC
      upBytesPerSec: up,
      downBytesPerSec: down,
      relayBytesUsed: moved,
      relayBytesIncluded: 0,
    };
  }

  async getQuota(): Promise<Quota> {
    const q = respBody(ensureOk(await this.t.request(req.getQuota())));
    return { usedBytes: q.used_bytes, quotaBytes: q.quota_bytes, fileCount: q.file_count };
  }

  /** Set the partition quota cap (the owner's allocation). The host clamps to the licensed
   *  ceiling and returns the resulting quota. */
  async setQuota(quotaBytes: number): Promise<Quota> {
    const q = respBody(ensureOk(await this.t.request(req.setQuota(quotaBytes))));
    return { usedBytes: q.used_bytes, quotaBytes: q.quota_bytes, fileCount: q.file_count };
  }

  async listDir(path: string): Promise<DirListing> {
    const d = respBody(ensureOk(await this.t.request(req.listDir(path))));
    return { path: d.path, entries: (d.entries ?? []).map(mapEntry) };
  }
  async search(query: string): Promise<DirListing> {
    const d = respBody(ensureOk(await this.t.request(req.search(query))));
    return { path: d.path, entries: (d.entries ?? []).map(mapEntry) };
  }
  async listStarred(): Promise<DirListing> {
    const d = respBody(ensureOk(await this.t.request(req.listStarred())));
    return { path: d.path, entries: (d.entries ?? []).map(mapEntry) };
  }
  async listRecent(): Promise<DirListing> {
    const d = respBody(ensureOk(await this.t.request(req.listRecent(100))));
    return { path: d.path, entries: (d.entries ?? []).map(mapEntry) };
  }

  async getTransfers(): Promise<Transfer[]> {
    return transfers.getSnapshot();
  }
  async listDevices(): Promise<Device[]> {
    // Devices come from the control plane (CpClient), not the host RPC.
    return [];
  }
  async listShares(): Promise<Share[]> {
    // Shares come from the control plane (ShareClient), not the host RPC.
    return [];
  }
  async getActivity(): Promise<ActivityEvent[]> {
    const b = respBody(ensureOk(await this.t.request(req.getActivity(50))));
    return ((b.events ?? []) as any[]).map((e) => ({
      id: e.id,
      ts: e.ts,
      kind: e.kind,
      actor: e.actor,
      detail: e.detail,
    }));
  }

  async createFolder(parentPath: string, name: string): Promise<void> {
    ensureOk(await this.t.request(req.mkdir(parentPath, name)));
  }
  async deleteEntry(id: string): Promise<void> {
    ensureOk(await this.t.request(req.delete(id)));
  }

  async move(id: string, toParent: string, toName: string): Promise<void> {
    ensureOk(await this.t.request(req.rename(id, toParent, toName)));
  }
  async star(id: string, on: boolean): Promise<void> {
    ensureOk(await this.t.request(req.star(id, on)));
  }
  async trash(id: string): Promise<void> {
    ensureOk(await this.t.request(req.trash(id)));
  }
  async restore(id: string): Promise<void> {
    ensureOk(await this.t.request(req.restore(id)));
  }
  async emptyTrash(): Promise<void> {
    ensureOk(await this.t.request(req.emptyTrash()));
  }
  async listTrash(): Promise<DirListing> {
    const d = respBody(ensureOk(await this.t.request(req.listTrash())));
    return { path: d.path, entries: (d.entries ?? []).map(mapEntry) };
  }

  async createShare(_entryId: string, _perms: SharePerm): Promise<Share> {
    throw new Error("sharing lands in Phase 4");
  }
  async revokeShare(): Promise<void> {}
  async approveDevice(): Promise<void> {}
  async revokeDevice(): Promise<void> {}

  async uploadFile(parentPath: string, name: string, bytes: Uint8Array): Promise<void> {
    // per-file content key, wrapped to the ARK; the host never learns it
    const ck = randomKey();
    const wrapped = wrapContentKey(this.ark, ck);
    const started = respBody(ensureOk(await this.t.request(req.uploadBegin(parentPath, name, bytes.length, wrapped))));
    const uploadId: string = started.upload_id;

    const tid = transfers.start(name, "up", bytes.length);
    try {
      let seq = 0;
      for (let off = 0; off < bytes.length; off += UPLOAD_CHUNK, seq++) {
        const end = Math.min(off + UPLOAD_CHUNK, bytes.length);
        const chunk = bytes.slice(off, end); // own buffer so the worker transfer is safe
        const ct = await cryptoWorker.encrypt(ck, seq, chunk); // XChaCha off the main thread
        ensureOk(await this.t.requestUploadChunk(uploadId, ct)); // raw binary frame, no base64
        transfers.update(tid, end);
      }
      // a zero-byte file still needs a committed (empty) version
      ensureOk(await this.t.request(req.uploadCommit(uploadId)));
      transfers.finish(tid);
    } catch (e) {
      transfers.fail(tid);
      try {
        await this.t.request(req.uploadAbort(uploadId));
      } catch {
        // best-effort
      }
      throw e;
    }
  }

  async downloadFile(id: string): Promise<Uint8Array> {
    const info = respBody(ensureOk(await this.t.request(req.readBegin(id))));
    // Try every keyring entry: during a rotation some files are still under an older key.
    const { ck } = unwrapContentKeyAny(this.keyring, fromB64(info.wrapped_ck));
    const count: number = info.chunk_count;
    const name = id.split("/").pop() || id;

    const tid = transfers.start(name, "down", info.plaintext_len);
    const parts: Uint8Array[] = [];
    let got = 0;
    try {
      for (let seq = 0; seq < count; seq++) {
        const body = respBody(ensureOk(await this.t.request(req.readChunk(id, seq))));
        // binary framing resolves ciphertext as raw bytes; JSON fallback is base64
        const raw = body.ciphertext instanceof Uint8Array ? body.ciphertext : fromB64(body.ciphertext);
        const ct = new Uint8Array(raw); // own buffer for the worker transfer
        const pt = await cryptoWorker.decrypt(ck, seq, ct);
        parts.push(pt);
        got += pt.length;
        transfers.update(tid, got);
      }
      transfers.finish(tid);
    } catch (e) {
      transfers.fail(tid);
      throw e;
    }
    const out = new Uint8Array(got);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }

  close(): void {
    this.t.close();
  }
}

/**
 * Connect to a live host over the relay and return a ready DriveApi.
 * `onClose` fires if the connection later dies (close or session desync).
 * `onChange` fires on each host live-sync notification (a file changed on the
 * account, by this or another client) — the UI re-lists in response.
 */
export async function connectRealApi(
  cfg: HostConnConfig,
  onClose?: (err: Error) => void,
  onChange?: () => void,
  /** Relay admission token (production relays only; omit for the dev relay). */
  token?: string,
): Promise<DriveApi> {
  const id = loadOrCreateIdentity();
  // Newest-first. During a rotation the ring holds the old key too, so files not yet
  // re-wrapped still open.
  const keyring = getKeyringHex().map((h) => fromHex(h));
  const t = new RelayTransport(id.edPriv, id.edPub);
  await t.connect(cfg.relayUrl, cfg.account, cfg.hostPub, token);
  t.onClose = onClose;
  t.onChange = onChange;
  return new RealDriveApi(t, id.ark, keyring);
}
