/**
 * Control-plane signing material.
 *
 *  - `tokenSecret` — HMAC-SHA256 secret for tokens the Worker issues AND verifies
 *    itself (session + relay-admission). Symmetric is sufficient and simplest.
 *  - `licenseKey` — the Ed25519 keypair whose PUBLIC half the Rust host pins to
 *    verify perpetual license tokens offline. The private seed never leaves the
 *    control plane.
 *
 * Production supplies both via `wrangler secret put` (CP_TOKEN_SECRET,
 * CP_LICENSE_SEED — base64url). Absent a secret we fall back to a FIXED dev value
 * so local `wrangler dev` has a stable license pubkey the dev host can trust.
 * These constants are public, so a production deployment refuses to start without
 * its own secrets rather than silently signing with them.
 */
import type { Env } from "./types";
import { b64uDecode } from "./util";
import { ed25519ImportSeed, ed25519PublicRaw } from "./webcrypto";

// Dev-only, non-secret constants (exactly 32 bytes, base64url). Override in prod.
const DEV_TOKEN_SECRET = "cGVyc29uYWwtY2xvdWQtREVWLXRva2VuLXNlY3JldCE"; // "personal-cloud-DEV-token-secret!"
const DEV_LICENSE_SEED = "cGVyc29uYWwtY2xvdWQtREVWLWxpY2Vuc2Utc2VlZCE"; // "personal-cloud-DEV-license-seed!"

function secretOrDev(env: Env, name: "CP_TOKEN_SECRET" | "CP_LICENSE_SEED", dev: string): string {
  const value = env[name];
  if (value) return value;
  if (env.ENVIRONMENT === "production") {
    throw new Error(`${name} is not set. Run \`wrangler secret put ${name}\` before deploying.`);
  }
  return dev;
}

export function tokenSecret(env: Env): Uint8Array {
  return b64uDecode(secretOrDev(env, "CP_TOKEN_SECRET", DEV_TOKEN_SECRET));
}

let cachedSeed: string | null = null;
let cachedKey: { priv: CryptoKey; pubRaw: Uint8Array } | null = null;

export async function licenseKey(env: Env): Promise<{ priv: CryptoKey; pubRaw: Uint8Array }> {
  const seedB64 = secretOrDev(env, "CP_LICENSE_SEED", DEV_LICENSE_SEED);
  if (cachedKey && cachedSeed === seedB64) return cachedKey;
  const seed = b64uDecode(seedB64);
  const priv = await ed25519ImportSeed(seed);
  const pubRaw = await ed25519PublicRaw(priv);
  cachedSeed = seedB64;
  cachedKey = { priv, pubRaw };
  return cachedKey;
}
