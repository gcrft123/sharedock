// JSON request builders + response helpers matching the Rust `Request`/`Response`
// enums (externally tagged, snake_case). Unit variants are bare strings; data
// variants are `{ variant: {...} }`.

import { toB64 } from "./crypto";
import type { WirePayload } from "./crypto";

export const req = {
  listDir: (path: string) => ({ list_dir: { path } }),
  stat: (id: string) => ({ stat: { id } }),
  mkdir: (parent: string, name: string) => ({ mkdir: { parent, name } }),
  delete: (id: string) => ({ delete: { id } }),
  rename: (from: string, to_parent: string, to_name: string) => ({
    rename: { from, to_parent, to_name },
  }),
  star: (id: string, on: boolean) => ({ star: { id, on } }),
  trash: (id: string) => ({ trash: { id } }),
  restore: (id: string) => ({ restore: { id } }),
  emptyTrash: () => "empty_trash",
  listTrash: () => "list_trash",
  search: (query: string) => ({ search: { query } }),
  listStarred: () => "list_starred",
  listRecent: (limit: number) => ({ list_recent: { limit } }),
  getActivity: (limit: number) => ({ get_activity: { limit } }),
  getQuota: () => "get_quota",
  setQuota: (quota_bytes: number) => ({ set_quota: { quota_bytes } }),
  getHostStatus: () => "get_host_status",
  putFile: (parent: string, name: string, p: WirePayload) => ({
    put_file: {
      parent,
      name,
      payload: {
        wrapped_ck: toB64(p.wrapped_ck),
        plaintext_len: p.plaintext_len,
        ciphertext: toB64(p.ciphertext),
      },
    },
  }),
  readFile: (id: string) => ({ read_file: { id } }),

  // chunked/streamed
  uploadBegin: (parent: string, name: string, plaintext_len: number, wrapped_ck: Uint8Array) => ({
    upload_begin: { parent, name, plaintext_len, wrapped_ck: toB64(wrapped_ck) },
  }),
  uploadChunk: (upload_id: string, ciphertext: Uint8Array) => ({
    upload_chunk: { upload_id, ciphertext: toB64(ciphertext) },
  }),
  uploadCommit: (upload_id: string) => ({ upload_commit: { upload_id } }),
  uploadAbort: (upload_id: string) => ({ upload_abort: { upload_id } }),
  readBegin: (id: string) => ({ read_begin: { id } }),
  /** Replace an object's wrapped content key (account-key rotation). */
  rewrapKey: (id: string, wrappedCk: Uint8Array) => ({ rewrap_key: { id, wrapped_ck: toB64(wrappedCk) } }),
  readChunk: (id: string, seq: number) => ({ read_chunk: { id, seq } }),
};

export type RawResponse = string | Record<string, any>;

export function respTag(r: RawResponse): string {
  return typeof r === "string" ? r : Object.keys(r)[0];
}
export function respBody(r: RawResponse): any {
  return typeof r === "string" ? {} : r[Object.keys(r)[0]];
}

/** Throw on `{ error }` / `{ quota_exceeded }`; otherwise return the raw response. */
export function ensureOk(r: RawResponse): RawResponse {
  const tag = respTag(r);
  if (tag === "error") throw new Error(respBody(r).message || "host error");
  if (tag === "quota_exceeded") {
    const b = respBody(r);
    throw new Error(`quota exceeded: need ${b.needed}, ${b.available} available`);
  }
  return r;
}
