// Client for the crypto Web Worker. Transfers chunk buffers (zero-copy) to keep
// the per-chunk XChaCha off the main thread. Falls back to inline crypto if
// Workers aren't available (e.g. SSR), so correctness never depends on the worker.

import { decryptChunk, encryptChunk } from "./crypto";

interface Job {
  resolve: (r: Uint8Array) => void;
  reject: (e: Error) => void;
}

class CryptoWorkerClient {
  private worker: Worker | null = null;
  private tried = false;
  private pending = new Map<number, Job>();
  private id = 0;

  private ensure(): Worker | null {
    if (this.worker) return this.worker;
    if (this.tried || typeof Worker === "undefined") return null;
    this.tried = true;
    try {
      this.worker = new Worker(new URL("./crypto.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (e: MessageEvent) => {
        const { id, ok, result, error } = e.data;
        const job = this.pending.get(id);
        if (!job) return;
        this.pending.delete(id);
        if (ok) job.resolve(new Uint8Array(result));
        else job.reject(new Error(error));
      };
      return this.worker;
    } catch {
      return null;
    }
  }

  private run(op: "encrypt" | "decrypt", contentKey: Uint8Array, seq: number, data: Uint8Array): Promise<Uint8Array> {
    const w = this.ensure();
    if (!w) {
      return Promise.resolve(op === "encrypt" ? encryptChunk(contentKey, seq, data) : decryptChunk(contentKey, seq, data));
    }
    const id = ++this.id;
    return new Promise<Uint8Array>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // `data` must own its buffer (caller slices) so transferring it doesn't
      // detach a larger file buffer.
      w.postMessage({ id, op, contentKey, seq, data }, [data.buffer]);
    });
  }

  encrypt(contentKey: Uint8Array, seq: number, plaintext: Uint8Array): Promise<Uint8Array> {
    return this.run("encrypt", contentKey, seq, plaintext);
  }
  decrypt(contentKey: Uint8Array, seq: number, ciphertext: Uint8Array): Promise<Uint8Array> {
    return this.run("decrypt", contentKey, seq, ciphertext);
  }
}

export const cryptoWorker = new CryptoWorkerClient();
