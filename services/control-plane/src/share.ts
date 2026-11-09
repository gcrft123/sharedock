/**
 * E2EE share links (zero-knowledge).
 *
 *   POST   /api/share          (session)  owner creates a share for one object
 *   GET    /api/shares         (session)  owner lists their shares (no ciphertext)
 *   GET    /api/share/:token   (PUBLIC)   redeem: metadata + wrapped key (+ inline ciphertext)
 *   GET    /api/share/:token/blob (PUBLIC) the ciphertext, streamed, for large shares
 *   DELETE /api/share/:token   (session)  owner revokes a share they own
 *
 * The Worker stores the ciphertext and the WRAPPED content key verbatim, plus policy
 * metadata. The decryption secret is never sent here — it rides only in the client's URL
 * fragment — so the control plane can hold a share yet never read it. `plaintext_len` is
 * the caller-declared decrypted size (surfaced to owners as `sizeBytes`).
 */
import type { Env } from "./types";
import { bearer, verifySession } from "./tokens";
import { clientIp, consume, LIMITS, tooMany } from "./ratelimit";
import { json, randomId } from "./util";

// Two storage paths for one share.
//
// Small shares stay inline in D1, which keeps a link to a screenshot a single round trip.
// Anything larger goes to R2 and is streamed on redeem, which is what lifts the old ~8 MB
// ceiling. Without an R2 binding the second path does not exist and the old cap stands, so
// a deployment with no bucket keeps working exactly as before instead of failing oddly.
const MAX_INLINE_CHARS = 1_000_000; // ~750 KB of ciphertext, comfortably inside a D1 row
const MAX_BLOB_CHARS = 2_000_000_000; // ~1.5 GB, bounded by what a browser will hold in memory

/** The largest share this deployment can accept, in base64 characters. */
function maxCiphertextChars(env: Env): number {
  return env.SHARES ? MAX_BLOB_CHARS : MAX_INLINE_CHARS;
}

/** Object key for a share's ciphertext in R2. */
const blobKey = (token: string): string => `share/${token}`;

/**
 * The effective share limit, so the client can say "too large" before spending time
 * encrypting a file this deployment will refuse. Public: it reveals a configuration size,
 * not anything about anyone's data.
 */
export async function shareLimits(env: Env, _req: Request): Promise<Response> {
  // base64 is 4/3 of the raw bytes, and the ciphertext carries a nonce and tag on top.
  const maxBytes = Math.floor((maxCiphertextChars(env) * 3) / 4) - 4096;
  return json({ maxBytes, blobStorage: !!env.SHARES });
}

/** POST /api/share — owner mints a share token for one encrypted object. */
export async function shareCreate(env: Env, req: Request): Promise<Response> {
  const tok = bearer(req);
  const session = tok ? await verifySession(env, tok) : null;
  if (!session) return json({ error: "unauthorized" }, 401);

  const body = (await req.json().catch(() => ({}))) as {
    object_id?: string;
    name?: string;
    perms?: string;
    wrapped_key?: string;
    ciphertext?: string;
    plaintext_len?: number;
  };

  const objectId = body.object_id;
  const name = body.name;
  const perms = body.perms === "edit" ? "edit" : "view";
  const wrappedKey = body.wrapped_key;
  const ciphertext = body.ciphertext;
  const plaintextLen = body.plaintext_len;

  if (typeof objectId !== "string" || !objectId) return json({ error: "object_id required" }, 400);
  if (typeof name !== "string" || !name) return json({ error: "name required" }, 400);
  if (typeof wrappedKey !== "string" || !wrappedKey) return json({ error: "wrapped_key required" }, 400);
  if (typeof ciphertext !== "string" || !ciphertext) return json({ error: "ciphertext required" }, 400);
  if (typeof plaintextLen !== "number" || !Number.isFinite(plaintextLen) || plaintextLen < 0) {
    return json({ error: "plaintext_len required" }, 400);
  }

  if (ciphertext.length > maxCiphertextChars(env)) {
    return json({ error: "file too large to share as a link" }, 413);
  }

  const token = randomId(16); // URL-safe base64url of 16 random bytes

  // Large ciphertext goes to R2, and D1 keeps only the metadata. Written BEFORE the row so a
  // share never exists pointing at an object that does not, which would redeem as a 404 the
  // owner could not explain.
  const inline = ciphertext.length <= MAX_INLINE_CHARS;
  if (!inline) {
    if (!env.SHARES) return json({ error: "file too large to share as a link" }, 413);
    await env.SHARES.put(blobKey(token), ciphertext);
  }

  await env.DB.prepare(
    `INSERT INTO share_tokens
       (token, user_id, name, object_id, wrapped_key, ciphertext, plaintext_len, size_bytes, perms, expires_at, created_at, access_count)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,0)`,
  )
    .bind(
      token,
      session.sub,
      name,
      objectId,
      wrappedKey,
      inline ? ciphertext : null, // null marks "the bytes are in R2 under this token"
      plaintextLen,
      plaintextLen, // size_bytes mirrors plaintext_len
      perms,
      null, // expires_at: no expiry
      Date.now(),
    )
    .run();

  return json({ token });
}

interface ShareListRow {
  token: string;
  name: string | null;
  perms: string;
  created_at: number;
  expires_at: number | null;
  access_count: number;
  size_bytes: number | null;
}

/** GET /api/shares — the caller's shares (metadata only, never ciphertext). */
export async function shareList(env: Env, req: Request): Promise<Response> {
  const tok = bearer(req);
  const session = tok ? await verifySession(env, tok) : null;
  if (!session) return json({ error: "unauthorized" }, 401);

  const rows = await env.DB.prepare(
    `SELECT token, name, perms, created_at, expires_at, access_count, size_bytes
     FROM share_tokens WHERE user_id = ? ORDER BY created_at DESC`,
  )
    .bind(session.sub)
    .all<ShareListRow>();

  const shares = (rows.results ?? []).map((r) => ({
    token: r.token,
    name: r.name ?? "",
    perms: r.perms,
    createdAt: r.created_at,
    expiresAt: r.expires_at ?? null,
    accessCount: r.access_count,
    sizeBytes: r.size_bytes ?? 0,
  }));
  return json({ shares });
}

interface SharePublicRow {
  name: string | null;
  perms: string;
  wrapped_key: string | null;
  ciphertext: string | null;
  plaintext_len: number | null;
  expires_at: number | null;
}

/** GET /api/share/:token — PUBLIC redeem. Returns the sealed payload; bumps access_count. */
export async function shareGet(env: Env, _req: Request, token: string): Promise<Response> {
  if (!token) return json({ error: "not found" }, 404);

  // Share tokens are the one bearer secret that travels in a URL, so an unthrottled reader
  // could walk the keyspace. Limited by source rather than by token: limiting per token
  // would let an attacker rotate guesses forever.
  const rl = await consume(env, "share", clientIp(_req), LIMITS.share);
  if (!rl.ok) return tooMany(rl);

  const row = await env.DB.prepare(
    `SELECT name, perms, wrapped_key, ciphertext, plaintext_len, expires_at
     FROM share_tokens WHERE token = ?`,
  )
    .bind(token)
    .first<SharePublicRow>();

  if (!row) return json({ error: "not found" }, 404);
  if (typeof row.expires_at === "number" && row.expires_at <= Date.now()) {
    return json({ error: "not found" }, 404);
  }

  await env.DB.prepare("UPDATE share_tokens SET access_count = access_count + 1 WHERE token = ?")
    .bind(token)
    .run();

  return json({
    name: row.name ?? "",
    perms: row.perms,
    wrapped_key: row.wrapped_key ?? "",
    // Inline for small shares. For large ones the row holds no ciphertext and the client
    // fetches /blob instead, so a 1 GB share does not arrive base64-wrapped inside JSON.
    ciphertext: row.ciphertext ?? "",
    blob: row.ciphertext === null,
    plaintext_len: row.plaintext_len ?? 0,
  });
}

/**
 * GET /api/share/:token/blob — the ciphertext for a large share, streamed.
 *
 * Still only ciphertext: the decryption secret rides in the URL fragment and never reaches
 * this server, so streaming the body changes nothing about what we can read.
 */
export async function shareBlob(env: Env, req: Request, token: string): Promise<Response> {
  if (!token) return json({ error: "not found" }, 404);
  const rl = await consume(env, "share", clientIp(req), LIMITS.share);
  if (!rl.ok) return tooMany(rl);

  const row = await env.DB.prepare("SELECT expires_at FROM share_tokens WHERE token = ?")
    .bind(token)
    .first<{ expires_at: number | null }>();
  if (!row) return json({ error: "not found" }, 404);
  if (typeof row.expires_at === "number" && row.expires_at <= Date.now()) {
    return json({ error: "not found" }, 404);
  }
  if (!env.SHARES) return json({ error: "not found" }, 404);

  const obj = await env.SHARES.get(blobKey(token));
  if (!obj) return json({ error: "not found" }, 404);
  return new Response(obj.body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" },
  });
}

/** DELETE /api/share/:token — owner revokes. Only the owning session may delete. */
export async function shareRevoke(env: Env, req: Request, token: string): Promise<Response> {
  const tok = bearer(req);
  const session = tok ? await verifySession(env, tok) : null;
  if (!session) return json({ error: "unauthorized" }, 401);
  if (!token) return json({ error: "not found" }, 404);

  const row = await env.DB.prepare("SELECT user_id FROM share_tokens WHERE token = ?")
    .bind(token)
    .first<{ user_id: string }>();
  if (!row) return json({ error: "not found" }, 404);
  // Delete the bytes as well as the row. A revoked share whose ciphertext lingers in a
  // bucket is exactly the kind of thing a privacy policy is later found to be wrong about.
  if (env.SHARES) await env.SHARES.delete(blobKey(token)).catch(() => {});
  if (row.user_id !== session.sub) return json({ error: "not found" }, 404);

  await env.DB.prepare("DELETE FROM share_tokens WHERE token = ?").bind(token).run();
  return json({ ok: true });
}
