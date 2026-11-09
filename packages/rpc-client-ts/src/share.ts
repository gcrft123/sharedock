// Sharing client: create / list / revoke public share links. Zero-knowledge — the
// file's content key is wrapped to a random SHARE SECRET carried only in the URL
// fragment, so the control plane (which stores the ciphertext + wrapped key) can never
// decrypt. Small files only (the control plane caps stored ciphertext size).

import { encryptFile, decryptFile, randomKey, toB64, fromB64, toHex, fromHex } from "./crypto";

export interface ShareInfo {
  token: string;
  name: string;
  perms: "view" | "edit";
  createdAt: number;
  expiresAt: number | null;
  accessCount: number;
  sizeBytes: number;
}

export interface CreatedShare {
  token: string;
  /** The full shareable URL (the secret lives in the fragment). */
  url: string;
}

export interface ShareClientOptions {
  /** Control-plane origin. */
  baseUrl: string;
  session?: () => string | null | undefined;
  /** Where the redeem page lives (defaults to the current web app origin). */
  appOrigin?: string;
}

/**
 * Fallback cap, used until the server says otherwise. A deployment with blob storage allows
 * far more, so ask before refusing (see `shareLimits`).
 */
/** The largest decrypted file that may be shared as a link (kept small — the ciphertext
 *  is stored inline in the control-plane DB, not blob storage). */
export const MAX_SHARE_BYTES = 8 * 1024 * 1024;

export class ShareClient {
  /** Cached server limits; configuration, so fetched at most once per session. */
  private cachedLimits: { maxBytes: number } | null = null;

  private base: string;
  constructor(private opts: ShareClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, "");
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    const tok = this.opts.session?.();
    if (tok) headers.authorization = `Bearer ${tok}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* non-JSON */
    }
    if (!res.ok) throw new Error((json.error as string) || `${method} ${path} → ${res.status}`);
    return json as T;
  }

  /** Create a share link for a file. `bytes` is the DECRYPTED content (the caller gets it
   *  via `DriveApi.downloadFile`). Throws if the file is too large to share as a link. */
  /**
   * What this deployment will actually accept. Cached: it is configuration, not state, and
   * asking on every share would add a round trip to every link.
   */
  async limits(): Promise<{ maxBytes: number }> {
    if (this.cachedLimits) return this.cachedLimits;
    try {
      const r = await this.req<{ maxBytes: number }>("GET", "/api/share-limits");
      // Never trust it below the built-in floor: a malformed answer must not make sharing
      // look broken for files that have always worked.
      this.cachedLimits = { maxBytes: Math.max(r.maxBytes ?? 0, MAX_SHARE_BYTES) };
    } catch {
      this.cachedLimits = { maxBytes: MAX_SHARE_BYTES };
    }
    return this.cachedLimits;
  }

  async create(
    objectId: string,
    name: string,
    perms: "view" | "edit",
    bytes: Uint8Array,
  ): Promise<CreatedShare> {
    const { maxBytes } = await this.limits();
    if (bytes.length > maxBytes) {
      throw new Error(`File is too large to share as a link (max ${Math.round(maxBytes / (1024 * 1024))} MB).`);
    }
    const secret = randomKey();
    const payload = encryptFile(secret, bytes); // { wrapped_ck, plaintext_len, ciphertext }
    const r = await this.req<{ token: string }>("POST", "/api/share", {
      object_id: objectId,
      name,
      perms,
      wrapped_key: toB64(payload.wrapped_ck),
      ciphertext: toB64(payload.ciphertext),
      plaintext_len: payload.plaintext_len,
    });
    const origin = (this.opts.appOrigin ?? (typeof window !== "undefined" ? window.location.origin : "")).replace(
      /\/+$/,
      "",
    );
    return { token: r.token, url: `${origin}/#share=${r.token}&k=${toHex(secret)}` };
  }

  async list(): Promise<ShareInfo[]> {
    const r = await this.req<{ shares: ShareInfo[] }>("GET", "/api/shares");
    return r.shares ?? [];
  }

  async revoke(token: string): Promise<void> {
    await this.req("DELETE", `/api/share/${encodeURIComponent(token)}`);
  }
}

/** Redeem a share link (the public redeem view): fetch + decrypt with the fragment secret. */
export async function redeemShare(
  baseUrl: string,
  token: string,
  secretHex: string,
): Promise<{ name: string; bytes: Uint8Array }> {
  const base = baseUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/share/${encodeURIComponent(token)}`);
  if (!res.ok) {
    throw new Error(res.status === 404 ? "This link is invalid or has been revoked." : `Share unavailable (${res.status}).`);
  }
  const r = (await res.json()) as {
    name: string;
    wrapped_key: string;
    ciphertext: string;
    blob?: boolean;
    plaintext_len: number;
  };
  // Large shares keep their ciphertext in blob storage rather than inside this JSON, so
  // fetch it separately. Small ones are still one round trip.
  let ciphertext = r.ciphertext;
  if (r.blob) {
    const b = await fetch(`${base}/api/share/${encodeURIComponent(token)}/blob`);
    if (!b.ok) throw new Error("This link's file could not be fetched.");
    ciphertext = await b.text();
  }
  const bytes = decryptFile(fromHex(secretHex), fromB64(r.wrapped_key), fromB64(ciphertext));
  return { name: r.name, bytes };
}

export function createShareClient(opts: ShareClientOptions): ShareClient {
  return new ShareClient(opts);
}
