/**
 * Relay admission.
 *
 * Browser WebSockets can't send Authorization headers, so admission to the DO
 * relay uses a short-lived signed **relay token** in the query string
 * (`/signal?...&token=`). A device first exchanges a session (client) or license
 * (host) for a relay token at `/api/relay/token`, then opens the socket.
 *
 * DEV: when ENVIRONMENT !== "production", a tokenless `/signal` is admitted, so
 * the local demo + the Rust processes work without the full auth flow. Production
 * requires a valid, unexpired, role/account-matching token.
 */
import type { Env } from "./types";
import { bearer, signRelay, verifyLicense, verifyRelay, verifySession } from "./tokens";
import { consume, LIMITS, tooMany } from "./ratelimit";
import { json } from "./util";

export async function relayToken(env: Env, req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    account?: string;
    role?: string;
    device?: string;
    host?: string;
  };
  const account = body.account;
  const role = body.role === "host" ? "host" : "client";
  const device = body.device ?? "";
  const host = body.host ?? ""; // per-host room; "" = the account room
  if (!account) return json({ error: "account required" }, 400);

  // The only endpoint that costs real money per use: every admission is a relay connection,
  // and relay bandwidth is the sole recurring cost behind a one-time price. Generous enough
  // that a client reconnecting all day never notices.
  const rl = await consume(env, "relay", account, LIMITS.relay);
  if (!rl.ok) return tooMany(rl);

  const tok = bearer(req);
  let ok = false;
  if (tok) {
    const s = await verifySession(env, tok);
    if (s?.sub === account) ok = true; // a logged-in owner can admit either role
    if (!ok && role === "host") {
      const lic = await verifyLicense(env, tok);
      if (lic?.account === account) ok = true; // the host admits itself with its license
    }
  }
  if (!ok) return json({ error: "unauthorized" }, 401);

  const token = await signRelay(env, account, role, device, host);
  return json({ token, ttl: 300 });
}

/** Decide whether a `/signal` upgrade may proceed. */
export async function admitSignal(env: Env, url: URL): Promise<{ ok: boolean; error?: string }> {
  const account = url.searchParams.get("account");
  const role = url.searchParams.get("role") === "host" ? "host" : "client";
  const host = url.searchParams.get("host") ?? ""; // per-host room; "" = the account room
  if (!account) return { ok: false, error: "missing account" };

  const token = url.searchParams.get("token");
  if (token) {
    const claims = await verifyRelay(env, token);
    if (!claims) return { ok: false, error: "invalid relay token" };
    if (claims.account !== account || claims.role !== role || (claims.host ?? "") !== host) {
      return { ok: false, error: "relay token scope mismatch" };
    }
    return { ok: true };
  }

  // No token: only permitted outside production (local dev / the Rust demo).
  if (env.ENVIRONMENT !== "production") return { ok: true };
  return { ok: false, error: "relay token required" };
}
