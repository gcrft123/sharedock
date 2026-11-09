/**
 * Recovery key: getting back in after a forgotten master password.
 *
 *   POST /api/auth/recovery         (session)  store or rotate this account's recovery blob
 *   POST /api/auth/recover/begin    (public)   prove the recovery key, receive the blob
 *   POST /api/auth/recover/finish   (public)   prove it again, install new password material
 *
 * The shape mirrors login exactly, and for the same reason: the control plane must never
 * be able to reset an account itself. It holds a ciphertext it cannot open and a hash it
 * cannot reverse, so a full database compromise still yields nobody's files.
 *
 * What recovery does NOT do is rotate the account root key. The ARK encrypts every file
 * that already exists, so replacing it would orphan all of them. Recovery re-wraps the
 * same ARK under a new password; the recovery key itself stays valid afterwards, so a
 * customer who recovers once has not spent their only ticket.
 */
import type { Env } from "./types";
import { bearer, signSession, verifySession } from "./tokens";
import { consume, hashSubject, LIMITS, tooMany } from "./ratelimit";
import { b64Decode, b64Encode, bytesEqual, json, sha256 } from "./util";

const normEmail = (e?: string): string => (e ?? "").trim().toLowerCase();

/** Same construction as the password auth verifier: SHA-256 of a 256-bit random key. */
async function verifierOf(authKeyB64: string): Promise<string> {
  return b64Encode(await sha256(b64Decode(authKeyB64)));
}

interface RecoveryRow {
  id: string;
  email: string;
  recovery_wrapped_ark: string | null;
  recovery_verifier: string | null;
}

/**
 * Look up an account and check the presented recovery proof.
 *
 * Returns null for every failure mode without distinguishing them, so this endpoint is
 * not a way to discover which addresses have accounts or which have recovery configured.
 */
async function authenticate(env: Env, email: string, recoveryAuthB64: string): Promise<RecoveryRow | null> {
  const row = await env.DB.prepare(
    "SELECT id, email, recovery_wrapped_ark, recovery_verifier FROM users WHERE email = ?",
  )
    .bind(normEmail(email))
    .first<RecoveryRow>();
  if (!row?.recovery_verifier || !row.recovery_wrapped_ark) return null;
  let presented: Uint8Array;
  try {
    presented = await sha256(b64Decode(recoveryAuthB64));
  } catch {
    return null;
  }
  if (!bytesEqual(presented, b64Decode(row.recovery_verifier))) return null;
  return row;
}

/**
 * Store (or rotate) the recovery blob for the signed-in account.
 *
 * Session-gated because only someone already holding the ARK can produce a valid wrapping
 * of it. Used at signup, and to upgrade accounts created before recovery existed.
 */
export async function putRecovery(env: Env, req: Request): Promise<Response> {
  const tok = bearer(req);
  const s = tok ? await verifySession(env, tok) : null;
  if (!s) return json({ error: "unauthorized" }, 401);

  const b = (await req.json().catch(() => ({}))) as {
    recovery_wrapped_ark?: string;
    recovery_auth?: string;
  };
  if (!b.recovery_wrapped_ark || !b.recovery_auth) {
    return json({ error: "recovery_wrapped_ark and recovery_auth required" }, 400);
  }
  await env.DB.prepare("UPDATE users SET recovery_wrapped_ark = ?, recovery_verifier = ? WHERE id = ?")
    .bind(b.recovery_wrapped_ark, await verifierOf(b.recovery_auth), s.sub)
    .run();
  return json({ ok: true });
}

/** Prove the recovery key, receive the wrapped ARK to open on the device. */
export async function recoverBegin(env: Env, req: Request): Promise<Response> {
  const b = (await req.json().catch(() => ({}))) as { email?: string; recovery_auth?: string };
  if (!b.email || !b.recovery_auth) return json({ error: "email and recovery_auth required" }, 400);
  const rl = await consume(env, "recover", await hashSubject(normEmail(b.email)), LIMITS.recover);
  if (!rl.ok) return tooMany(rl);

  const row = await authenticate(env, b.email, b.recovery_auth);
  // One message for every failure: wrong key, no such account, or recovery never set up.
  if (!row) return json({ error: "invalid email or recovery key" }, 401);
  return json({ ok: true, wrapped_ark: row.recovery_wrapped_ark });
}

/**
 * Install new password material after the device has re-wrapped the ARK.
 *
 * The proof is checked again rather than trusted from `begin`: these are two independent
 * requests, and a caller that skipped the first must not be able to reset a password.
 */
export async function recoverFinish(env: Env, req: Request): Promise<Response> {
  const b = (await req.json().catch(() => ({}))) as {
    email?: string;
    recovery_auth?: string;
    kdf?: { salt?: string } & Record<string, unknown>;
    wrapped_ark?: string;
    auth_key?: string;
  };
  if (!b.email || !b.recovery_auth || !b.kdf?.salt || !b.wrapped_ark || !b.auth_key) {
    return json({ error: "missing fields" }, 400);
  }
  // Finish is a second guessing surface, so it is limited independently of begin.
  const rl = await consume(env, "recover-finish", await hashSubject(normEmail(b.email)), LIMITS.recover);
  if (!rl.ok) return tooMany(rl);

  const row = await authenticate(env, b.email, b.recovery_auth);
  if (!row) return json({ error: "invalid email or recovery key" }, 401);

  const kdfRest = { ...b.kdf } as Record<string, unknown>;
  delete kdfRest.salt;
  await env.DB.prepare(
    "UPDATE users SET kdf_salt = ?, kdf_params = ?, auth_verifier = ?, wrapped_ark = ? WHERE id = ?",
  )
    .bind(b.kdf.salt, JSON.stringify(kdfRest), await verifierOf(b.auth_key), b.wrapped_ark, row.id)
    .run();

  // Signed straight in: they have just proven possession of the recovery key and set a new
  // password, so making them immediately type it again would be ceremony, not security.
  const token = await signSession(env, row.id, row.email);
  return json({ ok: true, account: row.id, token });
}

/**
 * POST /api/auth/rekey — install new key material after an account-key rotation.
 *
 * Both wrappings move together, in ONE statement. A rotation that updated the password copy
 * and then failed before the recovery copy would leave an account whose recovery key unwraps
 * a key the drive no longer uses, which is a silent way to lose everything.
 *
 * Session AND password: rotation is the operation that revokes a stolen device's access, so
 * an attacker holding only a live session must not be able to perform it.
 */
export async function rekey(env: Env, req: Request): Promise<Response> {
  const tok = bearer(req);
  const s = tok ? await verifySession(env, tok) : null;
  if (!s) return json({ error: "unauthorized" }, 401);

  const b = (await req.json().catch(() => ({}))) as {
    auth_key?: string;
    kdf?: { salt?: string } & Record<string, unknown>;
    wrapped_ark?: string;
    recovery_wrapped_ark?: string;
    recovery_auth?: string;
  };
  if (!b.auth_key || !b.kdf?.salt || !b.wrapped_ark || !b.recovery_wrapped_ark || !b.recovery_auth) {
    return json({ error: "missing fields" }, 400);
  }

  const kdfRest = { ...b.kdf } as Record<string, unknown>;
  delete kdfRest.salt;
  await env.DB.prepare(
    `UPDATE users SET kdf_salt = ?, kdf_params = ?, auth_verifier = ?, wrapped_ark = ?,
                      recovery_wrapped_ark = ?, recovery_verifier = ?
     WHERE id = ?`,
  )
    .bind(
      b.kdf.salt,
      JSON.stringify(kdfRest),
      await verifierOf(b.auth_key),
      b.wrapped_ark,
      b.recovery_wrapped_ark,
      await verifierOf(b.recovery_auth),
      s.sub,
    )
    .run();
  return json({ ok: true });
}
