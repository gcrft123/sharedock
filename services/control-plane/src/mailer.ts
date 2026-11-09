/**
 * The routes and side effects that use `email.ts`.
 *
 *   GET  /api/auth/verify?token=      (public)   confirm an address, single-use
 *   POST /api/auth/verify/resend      (session)  send the confirmation link again
 *   POST /api/license/resend          (session)  mail another copy of the license
 *
 * Plus `sendReceipt`, which the Stripe webhook calls after minting.
 *
 * Everything here is best-effort by design: no caller's correctness depends on a message
 * being delivered (see the rules at the top of email.ts).
 */
import type { Env } from "./types";
import { licenseCopy, receipt, send, verifyEmail } from "./email";
import { seatsFor, tierById } from "./tiers";
import { bearer, verifySession } from "./tokens";
import { hexEncode, json, randomBytes } from "./util";

const VERIFY_TTL_SEC = 86400; // 24 hours
/** Floor between re-delivery requests for one account, so the endpoint is not a mail cannon. */
const RESEND_COOLDOWN_SEC = 300;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return hexEncode(new Uint8Array(digest));
}

async function sessionAccount(env: Env, req: Request): Promise<{ sub: string; email: string } | null> {
  const tok = bearer(req);
  if (!tok) return null;
  const s = await verifySession(env, tok);
  return s ? { sub: s.sub, email: s.email } : null;
}

/** Record what went out. Never throws: logging a send must not fail the send's caller. */
async function logSend(env: Env, userId: string | null, kind: string, address: string, delivered: boolean) {
  try {
    await env.DB.prepare(
      "INSERT INTO email_log (id, user_id, kind, address, sent_at, delivered) VALUES (?,?,?,?,?,?)",
    )
      .bind(hexEncode(randomBytes(16)), userId, kind, address, nowSec(), delivered ? 1 : 0)
      .run();
  } catch (e) {
    console.log(`[email] could not log ${kind} to ${address}: ${String(e)}`);
  }
}

/** Seconds remaining before this account may request `kind` again, or 0. */
async function cooldownLeft(env: Env, userId: string, kind: string): Promise<number> {
  try {
    const row = await env.DB.prepare(
      "SELECT MAX(sent_at) AS last FROM email_log WHERE user_id = ? AND kind = ?",
    )
      .bind(userId, kind)
      .first<{ last: number | null }>();
    if (!row?.last) return 0;
    return Math.max(0, row.last + RESEND_COOLDOWN_SEC - nowSec());
  } catch {
    return 0; // a broken log must not block a legitimate request
  }
}

/**
 * Mint a verification link and mail it. Called on registration and on explicit resend.
 * Returns the token only so tests can exercise the flow without reading mail.
 */
export async function issueVerification(env: Env, userId: string, address: string): Promise<string> {
  const token = hexEncode(randomBytes(32));
  const origin = env.RP_ORIGIN ?? "http://localhost:5173";
  await env.DB.prepare("INSERT INTO email_verify (token_hash, user_id, expires_at, used_at) VALUES (?,?,?,NULL)")
    .bind(await sha256Hex(token), userId, nowSec() + VERIFY_TTL_SEC)
    .run();
  const url = `${origin}/api/auth/verify?token=${token}`;
  const delivered = await send(env, { to: address, ...verifyEmail(url) });
  await logSend(env, userId, "verify", address, delivered);
  return token;
}

/** Confirm an address. Public by necessity: the link is opened from a mail client. */
export async function verifyAddress(env: Env, req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return json({ error: "token required" }, 400);
  const now = nowSec();

  // Single-use and atomic, the same shape as a pairing code: consume only if still valid.
  const upd = await env.DB.prepare(
    "UPDATE email_verify SET used_at = ?1 WHERE token_hash = ?2 AND used_at IS NULL AND expires_at > ?1",
  )
    .bind(now, await sha256Hex(token))
    .run();
  if (((upd.meta as { changes?: number } | undefined)?.changes ?? 0) === 0) {
    return json({ error: "this link is invalid, already used, or expired" }, 400);
  }
  const row = await env.DB.prepare("SELECT user_id FROM email_verify WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .first<{ user_id: string }>();
  if (!row) return json({ error: "this link is invalid" }, 400);

  await env.DB.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").bind(now, row.user_id).run();
  return json({ ok: true, verified: true });
}

/** Send the confirmation link again. */
export async function resendVerification(env: Env, req: Request): Promise<Response> {
  const s = await sessionAccount(env, req);
  if (!s) return json({ error: "unauthorized" }, 401);

  const user = await env.DB.prepare("SELECT email, email_verified_at FROM users WHERE id = ?")
    .bind(s.sub)
    .first<{ email: string; email_verified_at: number | null }>();
  if (!user) return json({ error: "no such account" }, 404);
  if (user.email_verified_at) return json({ ok: true, alreadyVerified: true });

  const wait = await cooldownLeft(env, s.sub, "verify");
  if (wait > 0) return json({ error: "too many requests", retryAfterSec: wait }, 429);

  await issueVerification(env, s.sub, user.email);
  return json({ ok: true });
}

/**
 * Mail the account's license again.
 *
 * Session-gated: someone who can still sign in can already read the license in the
 * console, so this is about getting a durable copy into an inbox, not about recovering
 * access. Recovering an account with no session at all is the recovery-key problem, which
 * is a separate and still-open piece of work.
 */
export async function resendLicense(env: Env, req: Request): Promise<Response> {
  const s = await sessionAccount(env, req);
  if (!s) return json({ error: "unauthorized" }, 401);

  const row = await env.DB.prepare(
    `SELECT l.signed_token, l.tier, l.host_seats, u.email
     FROM licenses l JOIN users u ON u.id = l.user_id
     WHERE l.user_id = ? AND l.revoked_at IS NULL ORDER BY l.purchased_at DESC, l.rowid DESC LIMIT 1`,
  )
    .bind(s.sub)
    .first<{ signed_token: string; tier: string; host_seats: number | null; email: string }>();
  if (!row) return json({ error: "no license on this account" }, 404);

  const wait = await cooldownLeft(env, s.sub, "license_copy");
  if (wait > 0) return json({ error: "too many requests", retryAfterSec: wait }, 429);

  const seats = seatsFor(row.tier, row.host_seats);
  const delivered = await send(env, {
    to: row.email,
    ...licenseCopy({
      tierName: tierById(row.tier)?.name ?? row.tier,
      hostSeats: seats ?? 0,
      license: row.signed_token,
    }),
  });
  await logSend(env, s.sub, "license_copy", row.email, delivered);
  // `sent:false` is honest rather than a failure: mail may simply not be configured.
  return json({ ok: true, sent: delivered, to: row.email });
}

/**
 * Mail the receipt after a purchase. Called by the Stripe webhook, which must succeed
 * whether or not this does.
 */
export async function sendReceipt(
  env: Env,
  account: string,
  o: { tierId: string; hostSeats: number; license: string; paymentRef: string },
): Promise<void> {
  try {
    const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?")
      .bind(account)
      .first<{ email: string }>();
    if (!user?.email) return;
    const delivered = await send(env, {
      to: user.email,
      ...receipt({
        tierName: tierById(o.tierId)?.name ?? o.tierId,
        hostSeats: o.hostSeats,
        license: o.license,
        paymentRef: o.paymentRef,
      }),
    });
    await logSend(env, account, "receipt", user.email, delivered);
  } catch (e) {
    console.log(`[email] receipt for ${account} failed: ${String(e)}`);
  }
}
