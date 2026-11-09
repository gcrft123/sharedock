// Web Worker: per-chunk content encrypt/decrypt off the main thread so large
// transfers don't jank the UI. Stateless — keys arrive per message. The session
// (transport) layer stays on the main thread, so no counter coordination here.

import { decryptChunk, encryptChunk } from "./crypto";

const ctx = self as unknown as Worker;

ctx.onmessage = (e: MessageEvent) => {
  const { id, op, contentKey, seq, data } = e.data as {
    id: number;
    op: "encrypt" | "decrypt";
    contentKey: Uint8Array;
    seq: number;
    data: Uint8Array;
  };
  try {
    const result = op === "encrypt" ? encryptChunk(contentKey, seq, data) : decryptChunk(contentKey, seq, data);
    ctx.postMessage({ id, ok: true, result }, [result.buffer]);
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
