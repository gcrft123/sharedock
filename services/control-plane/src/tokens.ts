/**
 * Compact signed tokens: `base64url(JSON(claims)) + "." + base64url(sig)`.
 *
 * The signed message is the ASCII of the payload segment (the part before the
 * dot) — chosen so the Rust host can reconstruct it trivially: split on ".",
 * verify sig over segment[0]'s bytes, then base64url-decode segment[0] for the
 * claims. See `core-crypto::verify_license`.
 *
 *  - session / relay tokens → HMAC-SHA256 (Worker issues + verifies)
 *  - license token → Ed25519 (host verifies offline with the pinned CP pubkey)
 */
import type { Env } from "./types";
import { licenseKey, tokenSecret } from "./keys";
import { b64uDecode, b64uEncode, fromUtf8, utf8 } from "./util";
import { ed25519Sign, ed25519VerifyRaw, hmacSign, hmacVerify } from "./webcrypto";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// --- HMAC tokens (session, relay) ------------------------------------------

async function signHmac(env: Env, claims: Record<string, unknown>): Promise<string> {
  const payload = b64uEncode(utf8(JSON.stringify(claims)));
  const sig = await hmacSign(tokenSecret(env), utf8(payload));
  return `${payload}.${b64uEncode(sig)}`;
}

async function verifyHmac(env: Env, token: string): Promise<Record<string, unknown> | null> {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let ok: boolean;
  try {
    ok = await hmacVerify(tokenSecret(env), utf8(payload), b64uDecode(sig));
  } catch {
    return null;
  }
  if (!ok) return null;
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(fromUtf8(b64uDecode(payload)));
  } catch {
    return null;
  }
  if (typeof claims.exp === "number" && claims.exp < nowSec()) return null;
  return claims;
}

export interface SessionClaims {
  typ: "session";
  sub: string; // user id
  email: string;
  exp: number;
}
export function signSession(env: Env, userId: string, email: string, ttlSec = 3600): Promise<string> {
  return signHmac(env, { typ: "session", sub: userId, email, exp: nowSec() + ttlSec });
}
export async function verifySession(env: Env, token: string): Promise<SessionClaims | null> {
  const c = await verifyHmac(env, token);
  return c && c.typ === "session" ? (c as unknown as SessionClaims) : null;
}

export interface RelayClaims {
  typ: "relay";
  account: string;
  role: "host" | "client";
  host: string; // per-host room id (multi-host); "" = the legacy account room
  device: string; // device id (hex), for audit
  exp: number;
}
export function signRelay(
  env: Env,
  account: string,
  role: "host" | "client",
  device: string,
  host = "",
  ttlSec = 300,
): Promise<string> {
  return signHmac(env, { typ: "relay", account, role, host, device, exp: nowSec() + ttlSec });
}
export async function verifyRelay(env: Env, token: string): Promise<RelayClaims | null> {
  const c = await verifyHmac(env, token);
  return c && c.typ === "relay" ? (c as unknown as RelayClaims) : null;
}

// --- Host token (onboarding: identifies an enrolling host post-claim) ----------

export interface HostTokenClaims {
  typ: "host";
  account: string;
  device: string; // the host's endpoint id (= device pubkey hex)
  exp: number;
}
export function signHostToken(
  env: Env,
  account: string,
  device: string,
  ttlSec = 3600,
): Promise<string> {
  return signHmac(env, { typ: "host", account, device, exp: nowSec() + ttlSec });
}
export async function verifyHostToken(env: Env, token: string): Promise<HostTokenClaims | null> {
  const c = await verifyHmac(env, token);
  return c && c.typ === "host" ? (c as unknown as HostTokenClaims) : null;
}

// --- License token (Ed25519, perpetual — NO exp) ---------------------------

export interface LicenseClaims {
  v: 1;
  typ: "license";
  account: string;
  tier: string;
  quota_bytes: number;
  /**
   * Host machines this license allows. Optional because licenses minted before seats
   * existed do not carry it; absent means unenforced (see `seatsFor` in tiers.ts).
   * Signed rather than looked up client-side, so the entitlement travels with the token
   * and a host can check it offline.
   */
  host_seats?: number;
  payment_ref: string;
  iat: number;
}

export async function signLicense(
  env: Env,
  account: string,
  tier: string,
  quotaBytes: number,
  paymentRef: string,
  hostSeats?: number,
): Promise<string> {
  const claims: LicenseClaims = {
    v: 1,
    typ: "license",
    account,
    tier,
    quota_bytes: quotaBytes,
    ...(typeof hostSeats === "number" ? { host_seats: hostSeats } : {}),
    payment_ref: paymentRef,
    iat: nowSec(),
  };
  const payload = b64uEncode(utf8(JSON.stringify(claims)));
  const { priv } = await licenseKey(env);
  const sig = await ed25519Sign(priv, utf8(payload));
  return `${payload}.${b64uEncode(sig)}`;
}

/** Verify a license token with the control plane's own public key (self-check / tests). */
export async function verifyLicense(env: Env, token: string): Promise<LicenseClaims | null> {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const { pubRaw } = await licenseKey(env);
  let ok: boolean;
  try {
    ok = await ed25519VerifyRaw(pubRaw, utf8(payload), b64uDecode(sig));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const c = JSON.parse(fromUtf8(b64uDecode(payload))) as LicenseClaims;
    return c.typ === "license" ? c : null;
  } catch {
    return null;
  }
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}
