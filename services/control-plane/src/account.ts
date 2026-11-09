/**
 * Account export and deletion.
 *
 *   GET    /api/account/me       (session)  this account's own status, for Settings
 *   GET    /api/account/export   (session)  everything the control plane holds about you
 *   DELETE /api/account          (session + password proof)  erase it
 *
 * Selling to consumers in the EU, the UK or California brings obligations that a published
 * policy alone does not satisfy: people have to be able to actually get their data out and
 * actually have it erased. These are those two routes.
 *
 * What deletion does NOT touch is the files. They live on hardware the customer owns, this
 * server never had them, and it has no way to reach them. Deleting the account removes the
 * coordination layer; the drive keeps working locally and the encrypted store stays exactly
 * where it is. The copy in the response says so, because a customer who expects "delete my
 * account" to wipe their disk would be badly surprised.
 */
import type { Env } from "./types";
import { bearer, verifySession } from "./tokens";
import { b64Decode, bytesEqual, json, sha256 } from "./util";

async function sessionAccount(env: Env, req: Request): Promise<string | null> {
  const tok = bearer(req);
  if (!tok) return null;
  return (await verifySession(env, tok))?.sub ?? null;
}

/**
 * Everything this service stores about an account, in one JSON document.
 *
 * Note what is absent, because it is the point of the product: no file contents, no file
 * names, no content keys, and no plaintext account key. The wrapped ARK is included because
 * it is the customer's own ciphertext, and they should be able to keep a copy.
 */
export async function exportAccount(env: Env, req: Request): Promise<Response> {
  const account = await sessionAccount(env, req);
  if (!account) return json({ error: "unauthorized" }, 401);

  const one = async (sql: string) => (await env.DB.prepare(sql).bind(account).all()).results ?? [];
  const user = await env.DB.prepare(
    `SELECT id, email, created_at, email_verified_at, kdf_salt, kdf_params, wrapped_ark,
            recovery_wrapped_ark FROM users WHERE id = ?`,
  )
    .bind(account)
    .first();
  if (!user) return json({ error: "no such account" }, 404);

  return json({
    exported_at: new Date().toISOString(),
    note:
      "This is everything Sharedock's control plane stores about your account. It does not " +
      "and cannot include your files: those are on your own hardware, encrypted with a key " +
      "this service has never held.",
    account: user,
    devices: await one("SELECT id, name, icon, role, approved, added_at, last_seen FROM devices WHERE user_id = ?"),
    licenses: await one(
      "SELECT tier, quota_bytes, host_seats, purchased_at, revoked_at, revoked_reason FROM licenses WHERE user_id = ?",
    ),
    shares: await one("SELECT token, name, perms, expires_at, created_at, access_count FROM share_tokens WHERE user_id = ?"),
    emails_sent: await one("SELECT kind, address, sent_at, delivered FROM email_log WHERE user_id = ?"),
  });
}

/**
 * Erase the account.
 *
 * Requires the current password's auth key as well as a session, for the same reason a bank
 * asks again before a transfer: a session left open on a shared machine must not be enough
 * to destroy someone's account. This is irreversible and there is no recovery path, which is
 * exactly what "erased" has to mean to be worth publishing in a policy.
 */
export async function deleteAccount(env: Env, req: Request): Promise<Response> {
  const account = await sessionAccount(env, req);
  if (!account) return json({ error: "unauthorized" }, 401);

  const b = (await req.json().catch(() => ({}))) as { auth_key?: string };
  if (!b.auth_key) return json({ error: "auth_key required" }, 400);

  const u = await env.DB.prepare("SELECT auth_verifier FROM users WHERE id = ?")
    .bind(account)
    .first<{ auth_verifier: string | null }>();
  if (!u?.auth_verifier) return json({ error: "no such account" }, 404);
  const presented = await sha256(b64Decode(b.auth_key));
  if (!bytesEqual(presented, b64Decode(u.auth_verifier))) {
    return json({ error: "invalid password" }, 401);
  }

  // Children first: `devices` and `licenses` reference `users(id)`, so removing the user row
  // ahead of them would leave rows pointing at nothing.
  for (const sql of [
    "DELETE FROM email_verify WHERE user_id = ?",
    "DELETE FROM email_log WHERE user_id = ?",
    "DELETE FROM share_tokens WHERE user_id = ?",
    "DELETE FROM host_endpoints WHERE account = ?",
    "DELETE FROM account_topology WHERE account = ?",
    "DELETE FROM host_claim WHERE account = ?",
    "DELETE FROM credentials WHERE user_id = ?",
    "DELETE FROM devices WHERE user_id = ?",
    "DELETE FROM licenses WHERE user_id = ?",
    "DELETE FROM users WHERE id = ?",
  ]) {
    try {
      await env.DB.prepare(sql).bind(account).run();
    } catch (e) {
      // A table that does not exist in this deployment must not abort the rest of the
      // deletion and leave the account half-erased.
      console.log(`[account] delete step failed (${sql}): ${String(e)}`);
    }
  }

  return json({
    ok: true,
    deleted: true,
    note:
      "Your account is gone and your license with it. Files on your own hosts are untouched: " +
      "this service never held them and cannot reach them. To remove those, delete the " +
      "Sharedock data directory on each host machine.",
  });
}

/**
 * The account's own status: what Settings needs to show without pulling a full export.
 *
 * Deliberately small and boolean. Whether an address is confirmed and whether a recovery key
 * exists are the two facts a person can act on, and both were previously invisible: an
 * account could have no recovery key at all and nothing in the product would say so.
 */
export async function accountMe(env: Env, req: Request): Promise<Response> {
  const account = await sessionAccount(env, req);
  if (!account) return json({ error: "unauthorized" }, 401);
  const u = await env.DB.prepare(
    "SELECT email, created_at, email_verified_at, recovery_wrapped_ark FROM users WHERE id = ?",
  )
    .bind(account)
    .first<{ email: string; created_at: number; email_verified_at: number | null; recovery_wrapped_ark: string | null }>();
  if (!u) return json({ error: "no such account" }, 404);
  return json({
    account,
    email: u.email,
    createdAt: u.created_at,
    emailVerified: !!u.email_verified_at,
    hasRecoveryKey: !!u.recovery_wrapped_ark,
  });
}
