/**
 * Sharedock — control plane (Cloudflare Worker).
 *
 * Zero-knowledge for file data: the Worker never sees plaintext bytes or content
 * keys. It provides:
 *   - master-password auth + device pairing/registry             (D1)
 *   - one-time-purchase billing → perpetual signed license        (Stripe + D1)
 *   - relay admission tokens                                       (HMAC)
 *   - /signal → per-account Durable Object (rendezvous + E2EE relay)
 *
 * The relay forwards only AEAD ciphertext frames (see account-do.ts).
 */
import type { Env } from "./types";
import { CORS_HEADERS, json } from "./util";
import { loginParams, loginPassword, refreshSession, registerPassword } from "./password";
import { resendLicense, resendVerification, verifyAddress } from "./mailer";
import { putRecovery, recoverBegin, recoverFinish, rekey } from "./recovery";
import { checkUpdate, publishRelease } from "./updates";
import { accountMe, deleteAccount, exportAccount } from "./account";
import { report, reportList, status } from "./health";
import { authorizedClients, deviceApprove, deviceList, deviceRegister, deviceRevoke } from "./pairing";
import { hostEndpointGet, hostEndpointPut } from "./endpoint";
import { claimCheck, claimCreate, claimRedeem, hostCredential } from "./claim";
import { peersGet, topologyGet, topologyPut } from "./topology";
import { shareBlob, shareCreate, shareGet, shareLimits, shareList, shareRevoke } from "./share";
import { checkout, devComplete, devLicense, getLicense, licensePubkey, webhook } from "./billing";
import { admitSignal, relayToken } from "./relay";

export { AccountDO } from "./account-do";

type Handler = (env: Env, req: Request) => Promise<Response>;

// method + path → handler
const ROUTES: Record<string, Handler> = {
  "POST /api/auth/register": registerPassword,
  "POST /api/auth/login/params": loginParams,
  "POST /api/auth/login": loginPassword,
  "POST /api/auth/refresh": refreshSession,
  "POST /api/auth/recovery": putRecovery,
  "POST /api/auth/rekey": rekey,
  "POST /api/auth/recover/begin": recoverBegin,
  "POST /api/auth/recover/finish": recoverFinish,
  "GET /api/auth/verify": verifyAddress,
  "POST /api/auth/verify/resend": resendVerification,
  "POST /api/license/resend": resendLicense,
  "POST /api/devices": deviceRegister,
  "GET /api/devices": deviceList,
  "POST /api/devices/approve": deviceApprove,
  "POST /api/devices/revoke": deviceRevoke,
  "GET /api/account/authorized": authorizedClients,
  "GET /api/status": status,
  "POST /api/report": report,
  "GET /api/reports": reportList,
  "GET /api/account/me": accountMe,
  "GET /api/account/export": exportAccount,
  "DELETE /api/account": deleteAccount,
  "POST /api/host/claim": claimCreate,
  "POST /api/host/claim/redeem": claimRedeem,
  "POST /api/host/claim/check": claimCheck, // non-destructive code validation for the host UI
  "GET /api/host/credential": hostCredential,
  "POST /api/host/endpoint": hostEndpointPut,
  "GET /api/host/endpoint": hostEndpointGet,
  "GET /api/account/topology": topologyGet,
  "GET /api/account/peers": peersGet,
  "POST /api/account/topology": topologyPut,
  "POST /api/share": shareCreate,
  "GET /api/shares": shareList,
  "GET /api/share-limits": shareLimits,
  "POST /api/relay/token": relayToken,
  "POST /api/billing/checkout": checkout,
  "POST /api/billing/webhook": webhook,
  "POST /api/updates": publishRelease,
  "POST /api/billing/dev-complete": devComplete,
  "POST /api/billing/dev-license": devLicense, // guarded (DEV_LICENSE_TOKEN) testing bypass
  "GET /api/license": getLicense,
  "GET /api/license/pubkey": licensePubkey,
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/health") {
      return json({ ok: true, service: "personal-cloud-control-plane", env: env.ENVIRONMENT }, 200, CORS_HEADERS);
    }

    // Signaling + relay: admit, then hand off to the account's Durable Object. Multi-host:
    // a `host` param keys a per-host room `account:host` so several hosts of one account
    // stay isolated (each room still serves ONE host + its clients); absent → the legacy
    // account-only room.
    if (url.pathname === "/signal") {
      const admit = await admitSignal(env, url);
      if (!admit.ok) return json({ error: admit.error }, 403);
      const account = url.searchParams.get("account")!;
      const host = url.searchParams.get("host");
      const id = env.ACCOUNT.idFromName(host ? `${account}:${host}` : account);
      return env.ACCOUNT.get(id).fetch(req);
    }

    // The updater polls /api/updates/<target>/<current-version>; the ROUTES table is
    // exact-match, so this one is routed by prefix.
    if (url.pathname.startsWith("/api/updates/") && req.method === "GET") {
      const parts = url.pathname.slice("/api/updates/".length).split("/");
      const resp = await checkUpdate(env, req, decodeURIComponent(parts[0] ?? ""), decodeURIComponent(parts[1] ?? ""));
      for (const [k, v] of Object.entries(CORS_HEADERS)) resp.headers.set(k, v);
      return resp;
    }

    // Path-param share routes (the ROUTES table is exact-match, so special-case these):
    //   GET    /api/share/:token  → public redeem
    //   DELETE /api/share/:token  → owner revoke
    // The exact paths /api/share (POST) and /api/shares (GET) are handled by ROUTES below.
    if (url.pathname.startsWith("/api/share/")) {
      const token = decodeURIComponent(url.pathname.slice("/api/share/".length));
      try {
        let resp: Response;
        if (req.method === "GET" && token.endsWith("/blob")) {
          resp = await shareBlob(env, req, token.slice(0, -"/blob".length));
        } else if (req.method === "GET") resp = await shareGet(env, req, token);
        else if (req.method === "DELETE") resp = await shareRevoke(env, req, token);
        else resp = json({ error: "method not allowed" }, 405);
        for (const [k, v] of Object.entries(CORS_HEADERS)) resp.headers.set(k, v);
        return resp;
      } catch (e) {
        return json({ error: "internal error", detail: String(e) }, 500, CORS_HEADERS);
      }
    }

    const handler = ROUTES[`${req.method} ${url.pathname}`];
    if (handler) {
      try {
        const resp = await handler(env, req);
        for (const [k, v] of Object.entries(CORS_HEADERS)) resp.headers.set(k, v);
        return resp;
      } catch (e) {
        return json({ error: "internal error", detail: String(e) }, 500, CORS_HEADERS);
      }
    }

    // Unmatched API paths are 404s; everything else is the web app. Serving the SPA from
    // the same origin means one deploy/tunnel covers the API + relay + the client + the
    // WebAuthn RP origin (passkeys) + share-redeem links.
    if (url.pathname.startsWith("/api/")) {
      return json({ error: "not found" }, 404, CORS_HEADERS);
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(req); // static asset, or index.html (SPA fallback)
    }
    return json({ error: "not found" }, 404, CORS_HEADERS);
  },
};
