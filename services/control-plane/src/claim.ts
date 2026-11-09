/**
 * Host onboarding — pairing codes ("add a storage device" from the client).
 *
 *   POST /api/host/claim         (session)   owner mints a single-use pairing code
 *   POST /api/host/claim/redeem  (no auth)   a new host redeems it → self-enrolls PENDING
 *   GET  /api/host/credential    (host token) after approval, the host fetches its license
 *
 * A fresh host machine has no owner session, so it can't use `POST /api/devices` (which is
 * session-gated). The code is the bearer proof instead. Redeeming only ever creates a
 * *pending* host device and returns a scoped **host token** — NOT the account license. The
 * license (the serving credential) is handed over only AFTER the owner approves, via
 * `/api/host/credential`, so a leaked/guessed code can never obtain the account credential.
 */
import type { Env } from "./types";
import { licenseKey } from "./keys";
import { bearer, signHostToken, verifyHostToken, verifySession } from "./tokens";
import { clientIp, consume, LIMITS, tooMany } from "./ratelimit";
import { ensureSelfHostedLicense } from "./billing";
import { countApprovedHosts, seatsForAccount } from "./tiers";
import { hexEncode, json, randomBytes } from "./util";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// Unambiguous code alphabet (no 0/O/1/I/L). 12 chars ≈ 59 bits — plenty for a single-use,
// 10-minute, account-scoped code.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 12;
const CLAIM_TTL_SEC = 600; // 10 minutes

function generateCode(): string {
  const bytes = randomBytes(CODE_LEN);
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

/** Uppercase + drop anything outside the alphabet (tolerates dashes/spaces the UI adds). */
function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .split("")
    .filter((c) => CODE_ALPHABET.includes(c))
    .join("");
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return hexEncode(new Uint8Array(digest));
}

async function sessionAccount(env: Env, req: Request): Promise<string | null> {
  const tok = bearer(req);
  if (!tok) return null;
  const s = await verifySession(env, tok);
  return s?.sub ?? null;
}

/** Owner mints a single-use pairing code for their account. */
export async function claimCreate(env: Env, req: Request): Promise<Response> {
  const account = await sessionAccount(env, req);
  if (!account) return json({ error: "unauthorized" }, 401);
  const body = (await req.json().catch(() => ({}))) as { name?: string };

  const code = generateCode();
  const codeHash = await sha256Hex(code);
  const expiresAt = nowSec() + CLAIM_TTL_SEC;
  await env.DB.prepare(
    "INSERT INTO host_claim (code_hash, account, name, expires_at, used_at) VALUES (?,?,?,?,NULL)",
  )
    .bind(codeHash, account, body.name ?? null, expiresAt)
    .run();
  return json({ code, expiresAt, ttl: CLAIM_TTL_SEC });
}

/** A new host redeems a code: self-enroll as a PENDING host device, get a host token. */
export async function claimRedeem(env: Env, req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    code?: string;
    endpoint_id?: string; // the host's device pubkey hex
    agreement_pub?: string;
    name?: string;
    icon?: string; // glyph the owner picked on the host name+icon screen
  };
  if (!body.code || !body.endpoint_id) {
    return json({ error: "code and endpoint_id required" }, 400);
  }
  const rl = await consume(env, "claim", clientIp(req), LIMITS.claim);
  if (!rl.ok) return tooMany(rl);

  const codeHash = await sha256Hex(normalizeCode(body.code));
  const now = nowSec();

  // Read the claim BEFORE consuming it, so a rejection below leaves the owner's
  // single-use code still usable. Consumption stays atomic, just later.
  const claim = await env.DB.prepare(
    "SELECT account, name FROM host_claim WHERE code_hash = ?1 AND used_at IS NULL AND expires_at > ?2",
  )
    .bind(codeHash, now)
    .first<{ account: string; name: string | null }>();
  if (!claim) return json({ error: "invalid or expired code" }, 400);
  const account = claim.account;
  const hostName = body.name ?? claim.name ?? "host";
  const hostIcon = body.icon ?? null;

  // Early seat check, so a host on a full account is told now instead of sitting on
  // "waiting for approval" forever. The binding gate is in deviceApprove — this redeem
  // only creates a PENDING host, which serves nothing. Seats are counted over APPROVED
  // hosts, so retiring one frees its seat straight away.
  const seats = await seatsForAccount(env, account);
  if (seats !== null) {
    const used = await countApprovedHosts(env, account, body.endpoint_id);
    if (used >= seats) {
      return json(
        {
          error: "no host seats left",
          detail: `This license covers ${seats} host${seats === 1 ? "" : "s"}, and ${used} are already active. Retire a host, or move to a larger tier.`,
          seats,
          used,
        },
        409,
      );
    }
  }

  // Device ids are global (they are public keys), so a row may already exist under a
  // DIFFERENT account. The upsert below never reassigns `user_id`, so without this the
  // redeem would return 200 and a host token for a device that stays invisible to the
  // redeeming account. Refuse instead of handing back a credential that cannot work.
  const owner = await env.DB.prepare("SELECT user_id FROM devices WHERE id = ?")
    .bind(body.endpoint_id)
    .first<{ user_id: string }>();
  if (owner && owner.user_id !== account) {
    return json({ error: "this device is already registered to another account" }, 409);
  }

  // Single-use, atomic: mark used only if STILL unexpired + unused. This is the race
  // gate — two hosts redeeming the same code concurrently, only one wins here.
  const upd = await env.DB.prepare(
    "UPDATE host_claim SET used_at = ?1 WHERE code_hash = ?2 AND used_at IS NULL AND expires_at > ?1",
  )
    .bind(now, codeHash)
    .run();
  if (((upd.meta as { changes?: number } | undefined)?.changes ?? 0) === 0) {
    return json({ error: "invalid or expired code" }, 400);
  }

  // Register the host device as PENDING (approved = 0). Never downgrade an existing row's
  // approval — re-pairing needs a fresh code, which the owner minted.
  await env.DB.prepare(
    `INSERT INTO devices (id, user_id, name, icon, role, pubkey, agreement_pub, approved, added_at, last_seen)
     VALUES (?,?,?,?, 'host', ?, ?, 0, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, icon=excluded.icon, role='host',
       agreement_pub=excluded.agreement_pub, last_seen=excluded.last_seen`,
  )
    .bind(body.endpoint_id, account, hostName, hostIcon, body.endpoint_id, body.agreement_pub ?? null, now, now)
    .run();

  const { pubRaw } = await licenseKey(env);
  const hostToken = await signHostToken(env, account, body.endpoint_id);
  return json({ account, cp_pubkey: hexEncode(pubRaw), host_token: hostToken, approved: false });
}

/** Validate a pairing code WITHOUT redeeming it, so the host UI can reject a wrong code up front
 *  instead of starting the daemon and spinning on "waiting for approval". Non-destructive: it
 *  never marks the code used. Returns {valid} — true iff the code exists, is unused, unexpired. */
export async function claimCheck(env: Env, req: Request): Promise<Response> {
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  if (!code) return json({ valid: false });
  const codeHash = await sha256Hex(normalizeCode(code));
  const row = await env.DB.prepare("SELECT used_at, expires_at FROM host_claim WHERE code_hash = ?")
    .bind(codeHash)
    .first<{ used_at: number | null; expires_at: number }>();
  return json({ valid: !!row && row.used_at === null && row.expires_at > nowSec() });
}

/** The host polls this with its host token; it gets the license only once approved. */
export async function hostCredential(env: Env, req: Request): Promise<Response> {
  const tok = bearer(req);
  const claims = tok ? await verifyHostToken(env, tok) : null;
  if (!claims) return json({ error: "unauthorized" }, 401);

  const dev = await env.DB.prepare(
    "SELECT approved FROM devices WHERE id = ? AND user_id = ? AND role = 'host'",
  )
    .bind(claims.device, claims.account)
    .first<{ approved: number }>();
  if (!dev) return json({ error: "unknown host" }, 404);
  if (dev.approved !== 1) return json({ approved: false });

  await ensureSelfHostedLicense(env, claims.account);

  const lic = await env.DB.prepare(
    `SELECT signed_token FROM licenses
     WHERE user_id = ? AND revoked_at IS NULL ORDER BY purchased_at DESC, rowid DESC LIMIT 1`,
  )
    .bind(claims.account)
    .first<{ signed_token: string }>();
  return json({ approved: true, account: claims.account, license: lic?.signed_token ?? null });
}
