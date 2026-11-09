/**
 * Fixed-window rate limiting.
 *
 * Applied where an attacker gets unlimited free guesses at something valuable: passwords,
 * recovery keys, pairing codes, share tokens. Also to relay admission, which is the only
 * endpoint that costs real money per use.
 *
 * A fixed window, not a sliding one: it admits a burst at a window boundary, which for
 * "slow down a guessing attack" is an acceptable trade for a single indexed row per bucket
 * and no background sweeping. The limits below are far below what a human ever hits and far
 * above what makes brute force viable.
 *
 * FAILURE MODE: if the limiter itself errors, the request is ALLOWED. A broken counter
 * table must not lock every customer out of their own account; the exposure is a window of
 * unthrottled attempts, which is where we already were.
 */
import type { Env } from "./types";
import { hexEncode, json } from "./util";

export interface Limit {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
}

/** Tuned so a person never notices and a script gives up. */
export const LIMITS = {
  /** Password attempts for one email. Six is more than anyone types correctly-eventually. */
  login: { limit: 6, windowSec: 300 },
  /** Account creation from one address. Deliberately loose: households, offices and
   *  universities all share a NAT, so a tight limit locks out a family setting up together
   *  while barely inconveniencing a spammer, who wants thousands rather than tens. */
  register: { limit: 30, windowSec: 3600 },
  /** Recovery-key attempts. Tighter than login: the key is not something you half-remember. */
  recover: { limit: 5, windowSec: 900 },
  /** Pairing-code redemption. A 12-character code from a 31-letter alphabet, so this is only
   *  a backstop; the real defence is the code's entropy and its 10-minute life. */
  claim: { limit: 10, windowSec: 300 },
  /** Share-link reads from one address, to make token enumeration pointless. */
  share: { limit: 60, windowSec: 300 },
  /** Relay admissions per account. Generous: a busy client legitimately reconnects. */
  relay: { limit: 120, windowSec: 3600 },
} as const satisfies Record<string, Limit>;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** The caller's address, or a constant when Cloudflare did not supply one (local dev). */
export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "local";
}

/** Hash a subject that is itself a secret, so the table never stores guessable material. */
export async function hashSubject(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return hexEncode(new Uint8Array(d)).slice(0, 32);
}

export interface Verdict {
  ok: boolean;
  /** Seconds until the window resets. Only meaningful when `ok` is false. */
  retryAfterSec: number;
}

/**
 * Count one request against `action:subject`. Returns whether it is permitted.
 *
 * The upsert is a single statement so two concurrent requests cannot both read a stale
 * count and each write `count = 1`.
 */
export async function consume(env: Env, action: string, subject: string, cfg: Limit): Promise<Verdict> {
  const bucket = `${action}:${subject}`;
  const now = nowSec();
  try {
    await env.DB.prepare(
      `INSERT INTO rate_limit (bucket, count, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT(bucket) DO UPDATE SET
         count = CASE WHEN rate_limit.window_start <= ?2 - ?3 THEN 1 ELSE rate_limit.count + 1 END,
         window_start = CASE WHEN rate_limit.window_start <= ?2 - ?3 THEN ?2 ELSE rate_limit.window_start END`,
    )
      .bind(bucket, now, cfg.windowSec)
      .run();

    const row = await env.DB.prepare("SELECT count, window_start FROM rate_limit WHERE bucket = ?")
      .bind(bucket)
      .first<{ count: number; window_start: number }>();
    if (!row) return { ok: true, retryAfterSec: 0 };
    if (row.count > cfg.limit) {
      return { ok: false, retryAfterSec: Math.max(1, row.window_start + cfg.windowSec - now) };
    }
    return { ok: true, retryAfterSec: 0 };
  } catch (e) {
    // See FAILURE MODE above: allow, and say so, rather than locking everyone out.
    console.log(`[ratelimit] ${bucket} check failed, allowing: ${String(e)}`);
    return { ok: true, retryAfterSec: 0 };
  }
}

/** The 429 every limited endpoint returns, with the header clients actually honour. */
export function tooMany(v: Verdict): Response {
  const res = json({ error: "too many requests", retryAfterSec: v.retryAfterSec }, 429);
  res.headers.set("retry-after", String(v.retryAfterSec));
  return res;
}
