/**
 * Master-password auth against D1. Zero-knowledge: the control plane stores only a
 * hash of the client's auth key and the ciphertext-wrapped ARK — never the password
 * or the ARK. All key derivation + ARK (un)wrapping happen on the client (see
 * rpc-client-ts `crypto.ts` / `password.ts`). This replaces the WebAuthn flow.
 *
 *   POST /api/auth/register     {email, kdf:{salt,algo,m,t,p}, wrapped_ark, auth_key} → {account, token}
 *   POST /api/auth/login/params {email}                       → {salt, algo, m, t, p}  (public KDF params)
 *   POST /api/auth/login        {email, auth_key}             → {account, token, wrapped_ark}
 */
import type { Env } from "./types";
import { issueVerification } from "./mailer";
import { clientIp, consume, hashSubject, LIMITS, tooMany } from "./ratelimit";
import { bearer, signSession, verifySession } from "./tokens";
import { b64Decode, b64Encode, bytesEqual, json, randomId, sha256 } from "./util";

const nowSec = (): number => Math.floor(Date.now() / 1000);
const normEmail = (e?: string): string => (e ?? "").trim().toLowerCase();

/** Server-side verifier from the client's auth key: a plain SHA-256 (the auth key is
 * already a 256-bit high-entropy Argon2id output, so no per-verifier salt is needed). */
async function verifierOf(authKeyB64: string): Promise<string> {
  return b64Encode(await sha256(b64Decode(authKeyB64)));
}

export async function registerPassword(env: Env, req: Request): Promise<Response> {
  const b = (await req.json().catch(() => ({}))) as {
    email?: string;
    kdf?: { salt?: string } & Record<string, unknown>;
    wrapped_ark?: string;
    auth_key?: string;
  };
  const email = normEmail(b.email);
  if (!email || !b.kdf?.salt || !b.wrapped_ark || !b.auth_key) {
    return json({ error: "missing fields" }, 400);
  }
  // Per address, so one host cannot mint accounts in bulk.
  const rl = await consume(env, "register", clientIp(req), LIMITS.register);
  if (!rl.ok) return tooMany(rl);
  const verifier = await verifierOf(b.auth_key);
  // Store the KDF params opaquely (salt is its own column) — the server never runs the KDF.
  const kdfRest = { ...b.kdf } as Record<string, unknown>;
  delete kdfRest.salt;
  const kdfParams = JSON.stringify(kdfRest);

  const existing = await env.DB.prepare("SELECT id, wrapped_ark FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; wrapped_ark: string | null }>();

  let id: string;
  if (existing) {
    // A legacy row with no password material → adopt it. A real account → conflict.
    if (existing.wrapped_ark) return json({ error: "account already exists — sign in instead" }, 409);
    id = existing.id;
    await env.DB.prepare(
      "UPDATE users SET kdf_salt = ?, kdf_params = ?, auth_verifier = ?, wrapped_ark = ? WHERE id = ?",
    )
      .bind(b.kdf.salt, kdfParams, verifier, b.wrapped_ark, id)
      .run();
  } else {
    id = randomId(16);
    await env.DB.prepare(
      "INSERT INTO users (id, email, created_at, kdf_salt, kdf_params, auth_verifier, wrapped_ark) VALUES (?,?,?,?,?,?,?)",
    )
      .bind(id, email, nowSec(), b.kdf.salt, kdfParams, verifier, b.wrapped_ark)
      .run();
  }
  const token = await signSession(env, id, email);
  // Best-effort and deliberately not awaited for correctness: an address we cannot mail is
  // not a reason to fail account creation.
  try {
    await issueVerification(env, id, email);
  } catch (e) {
    console.log(`[email] verification for ${email} failed: ${String(e)}`);
  }
  return json({ ok: true, account: id, token });
}

export async function loginParams(env: Env, req: Request): Promise<Response> {
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  const em = normEmail(email);
  if (!em) return json({ error: "email required" }, 400);
  const u = await env.DB.prepare("SELECT kdf_salt, kdf_params FROM users WHERE email = ? AND wrapped_ark IS NOT NULL")
    .bind(em)
    .first<{ kdf_salt: string; kdf_params: string }>();
  if (!u || !u.kdf_params) return json({ error: "no such account" }, 404);
  return json({ salt: u.kdf_salt, ...(JSON.parse(u.kdf_params) as Record<string, unknown>) });
}

export async function loginPassword(env: Env, req: Request): Promise<Response> {
  const b = (await req.json().catch(() => ({}))) as { email?: string; auth_key?: string };
  const em = normEmail(b.email);
  if (!em || !b.auth_key) return json({ error: "missing fields" }, 400);

  // Throttle by account AND by source. Per-account alone lets one attacker work through many
  // accounts; per-address alone lets a botnet grind a single account.
  const byEmail = await consume(env, "login", await hashSubject(em), LIMITS.login);
  if (!byEmail.ok) return tooMany(byEmail);
  const byIp = await consume(env, "login-ip", clientIp(req), { limit: 30, windowSec: 300 });
  if (!byIp.ok) return tooMany(byIp);

  const u = await env.DB.prepare(
    "SELECT id, email, auth_verifier, wrapped_ark, recovery_wrapped_ark FROM users WHERE email = ?",
  )
    .bind(em)
    .first<{
      id: string;
      email: string;
      auth_verifier: string | null;
      wrapped_ark: string | null;
      recovery_wrapped_ark: string | null;
    }>();
  if (!u || !u.auth_verifier || !u.wrapped_ark) return json({ error: "no such account" }, 404);
  const got = await sha256(b64Decode(b.auth_key));
  if (!bytesEqual(got, b64Decode(u.auth_verifier))) return json({ error: "invalid email or password" }, 401);
  const token = await signSession(env, u.id, u.email);
  // `has_recovery` lets the client upgrade accounts created before recovery keys existed:
  // it can mint one on the spot, while it still holds the unwrapped ARK.
  return json({
    ok: true,
    account: u.id,
    token,
    wrapped_ark: u.wrapped_ark,
    has_recovery: !!u.recovery_wrapped_ark,
  });
}

/**
 * POST /api/auth/refresh — trade a still-valid session for a fresh one.
 *
 * Sessions last an hour. Without this, the console silently degraded when one lapsed: calls
 * began 401ing and the UI carried on showing stale data rather than saying "sign in again".
 * That is how a lapsed session once presented as the wrong transport path instead of as a
 * login prompt, which took a day to diagnose.
 *
 * Sliding, not unlimited: refreshing requires a token that has NOT yet expired, so an
 * abandoned session still dies on schedule and a stolen one cannot be renewed forever once
 * its window closes.
 */
export async function refreshSession(env: Env, req: Request): Promise<Response> {
  const tok = bearer(req);
  const s = tok ? await verifySession(env, tok) : null;
  if (!s) return json({ error: "session expired" }, 401);

  // The account must still exist: a refresh is not a way to keep using a deleted account.
  const u = await env.DB.prepare("SELECT id, email FROM users WHERE id = ?")
    .bind(s.sub)
    .first<{ id: string; email: string }>();
  if (!u) return json({ error: "no such account" }, 404);

  const token = await signSession(env, u.id, u.email);
  return json({ ok: true, account: u.id, email: u.email, token, expiresInSec: 3600 });
}
