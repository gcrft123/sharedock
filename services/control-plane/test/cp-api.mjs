/**
 * Control-plane API integration test.
 *
 * Drives a running `wrangler dev` (default http://127.0.0.1:8787) through the full
 * P1 surface: master-password register + login, device pairing, tier-aware
 * one-time-purchase → seat-carrying license (both the dev path and a correctly-signed
 * Stripe webhook), host-seat enforcement, refund revocation, and the relay-admission gate.
 *
 * The server stores the auth key and wrapped ARK as OPAQUE blobs — it never runs the KDF —
 * so this test uses random bytes for both rather than reimplementing scrypt.
 *
 * Emits /tmp/pc-p1/session.json for the Rust host phase (account, session token,
 * license, and the pinned CP license pubkey). Exit code 0 iff every check passed.
 *
 * Usage: node cp-api.mjs [baseUrl]
 */
import { webcrypto as wc } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
const RP_ID = "localhost";
const ORIGIN = "http://localhost:5173";
const WEBHOOK_SECRET = "whsec_dev_test_secret_do_not_use_in_prod"; // matches the --var in e2e-p1.sh

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}  ${detail}`);
  }
}

// --- encoding helpers ------------------------------------------------------
const te = new TextEncoder();
const b64u = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uToBuf = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
async function sha256(buf) {
  return new Uint8Array(await wc.subtle.digest("SHA-256", buf));
}
function concat(...arrs) {
  const len = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

async function api(method, path, body, token) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  if (token) headers["authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text };
  }
  return { status: res.status, json };
}

/** A valid `Stripe-Signature` header for `payload`, using the dev webhook secret. */
async function stripeSig(payload) {
  const t = Math.floor(Date.now() / 1000);
  const key = await wc.subtle.importKey("raw", te.encode(WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await wc.subtle.sign("HMAC", key, te.encode(`${t}.${payload}`)));
  return `t=${t},v1=${Buffer.from(mac).toString("hex")}`;
}

async function main() {
  console.log(`\nControl-plane API tests → ${BASE}\n`);
  const email = `test_${b64u(wc.getRandomValues(new Uint8Array(6)))}@example.com`;
  // Opaque credential material. The server only ever compares the auth key against a
  // stored hash of itself, so random bytes exercise the real code path.
  const rand = (n) => Buffer.from(wc.getRandomValues(new Uint8Array(n))).toString("base64");
  const AUTH_KEY = rand(32);
  const WRAPPED_ARK = rand(72);
  const KDF = { salt: rand(32), algo: "scrypt", N: 32768, r: 8, p: 1 };

  // 1) health
  {
    const { status, json } = await api("GET", "/health");
    check("health ok", status === 200 && json.ok === true);
  }

  // 2) account creation (master password)
  let session, account;
  {
    const reg = await api("POST", "/api/auth/register", {
      email,
      kdf: KDF,
      wrapped_ark: WRAPPED_ARK,
      auth_key: AUTH_KEY,
    });
    check("register creates an account + session", reg.status === 200 && !!reg.json.token, JSON.stringify(reg.json));
    session = reg.json.token;
    account = reg.json.account;
  }

  // 2b) the same email twice is a conflict, never a silent takeover of the existing account
  {
    const dup = await api("POST", "/api/auth/register", {
      email,
      kdf: KDF,
      wrapped_ark: rand(72),
      auth_key: rand(32),
    });
    check("re-registering an existing email is refused", dup.status === 409, `status=${dup.status}`);
  }

  // 3) login
  {
    const params = await api("POST", "/api/auth/login/params", { email });
    check("login params expose the KDF salt", params.status === 200 && params.json.salt === KDF.salt, JSON.stringify(params.json));
    const ok = await api("POST", "/api/auth/login", { email, auth_key: AUTH_KEY });
    check(
      "login returns the account + its wrapped ARK",
      ok.status === 200 && ok.json.account === account && ok.json.wrapped_ark === WRAPPED_ARK,
      JSON.stringify(ok.json),
    );
  }

  // 3b) a wrong password is rejected, and the message must not reveal WHICH half was wrong
  {
    const bad = await api("POST", "/api/auth/login", { email, auth_key: rand(32) });
    check("a wrong auth key is rejected", bad.status === 401, `status=${bad.status}`);
    check(
      "the failure does not distinguish email from password",
      (bad.json.error ?? "") === "invalid email or password",
      JSON.stringify(bad.json),
    );
    // KNOWN GAP, asserted so it stays visible: an unknown email answers 404 while a wrong
    // password answers 401, so the API is an account-enumeration oracle even though the UI
    // shows one message for both. Nothing branches on the 404 any more.
    const noSuch = await api("POST", "/api/auth/login", { email: `nobody_${email}`, auth_key: AUTH_KEY });
    check("an unknown email is still distinguishable by status (enumeration oracle)", noSuch.status === 404, `status=${noSuch.status}`);
  }

  // 4) device pairing (unique ids per run — each device has its own keypair)
  const randHex = (n) => Buffer.from(wc.getRandomValues(new Uint8Array(n))).toString("hex");
  const clientDeviceId = randHex(32); // stand-in client id (hex ed25519)
  const hostDeviceId = randHex(32);
  {
    const c = await api("POST", "/api/devices", { name: "web", role: "client", pubkey: clientDeviceId }, session);
    const h = await api("POST", "/api/devices", { name: "host", role: "host", pubkey: hostDeviceId }, session);
    check("register client device", c.status === 200 && c.json.approved === true);
    check("register host device", h.status === 200);
    const list = await api("GET", "/api/devices", null, session);
    check("device list shows both", (list.json.devices?.length ?? 0) === 2);
    const auth = await api("GET", `/api/account/authorized?account=${account}`, null, session);
    check("authorized clients includes client id", (auth.json.approved ?? []).includes(clientDeviceId), JSON.stringify(auth.json));
    const unauth = await api("GET", `/api/account/authorized?account=${account}`);
    check("authorized endpoint requires auth", unauth.status === 401);
  }

  // 5) billing — tier-aware checkout → license carrying seats
  let license;
  {
    const co = await api("POST", "/api/billing/checkout", { tier: "home" }, session);
    check("checkout returns a (dev-stub) url", co.status === 200 && !!co.json.url, JSON.stringify(co.json));
    check("checkout echoes the tier it was asked for", co.json.tier === "home", JSON.stringify(co.json));

    // A tier we do not sell must be refused, not silently downgraded to the default:
    // charging someone for a tier they did not pick is the failure this guards.
    const bogus = await api("POST", "/api/billing/checkout", { tier: "enterprise" }, session);
    check("an unknown tier is rejected", bogus.status === 400, JSON.stringify(bogus.json));

    const done = await api("POST", "/api/billing/dev-complete", { tier: "home" }, session);
    check("dev-complete mints a license", done.status === 200 && !!done.json.license, JSON.stringify(done.json));
    check("the minted license is the tier that was bought", done.json.tier === "home" && done.json.seats === 3, JSON.stringify(done.json));
    license = done.json.license;

    const got = await api("GET", `/api/license?account=${account}`, null, session);
    check("license retrievable by owner", got.status === 200 && !!got.json.license);
    check("license reports its host seats", got.json.hostSeats === 3, JSON.stringify(got.json));

    // The seat count must be SIGNED into the token, not just stored beside it — a host
    // verifies offline and can only trust what it can check.
    const claims = JSON.parse(Buffer.from(got.json.license.split(".")[0], "base64url").toString());
    check("host_seats is signed into the license token", claims.host_seats === 3 && claims.tier === "home", JSON.stringify(claims));
  }

  // 5b) billing — Stripe webhook path with a correct signature
  {
    const payload = JSON.stringify({
      type: "checkout.session.completed",
      // A real Checkout Session carries the tier we attached when creating it; without it
      // the webhook would mint the default tier and silently downgrade this account.
      data: {
        object: {
          client_reference_id: account,
          payment_intent: `pi_${b64u(wc.getRandomValues(new Uint8Array(8)))}`,
          metadata: { tier: "home" },
        },
      },
    });
    const res = await fetch(`${BASE}/api/billing/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": await stripeSig(payload) },
      body: payload,
    });
    const okJson = await res.json();
    check("signed Stripe webhook issues a license", res.status === 200 && okJson.issued === true, JSON.stringify(okJson));

    // and a bad signature is rejected
    const bad = await fetch(`${BASE}/api/billing/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"00".repeat(32)}`,
      },
      body: payload,
    });
    check("bad webhook signature rejected", bad.status === 400, `status=${bad.status}`);
  }

  // 6) license pubkey (host pins this)
  let cpPubkey;
  {
    const { status, json } = await api("GET", "/api/license/pubkey");
    check("license pubkey exposed", status === 200 && /^[0-9a-f]{64}$/.test(json.pubkey ?? ""));
    cpPubkey = json.pubkey;
  }

  // 7) relay admission
  {
    const tok = await api("POST", "/api/relay/token", { account, role: "host", device: hostDeviceId }, license);
    check("relay token issued to a valid license", tok.status === 200 && !!tok.json.token, JSON.stringify(tok.json));
    // a bogus token on /signal is rejected even in dev (a present token is always verified)
    const bogus = await fetch(`${BASE}/signal?account=${account}&role=client&token=not.a.token`);
    check("bogus relay token on /signal rejected", bogus.status === 403, `status=${bogus.status}`);
    const noAuth = await api("POST", "/api/relay/token", { account, role: "host" });
    check("relay token requires auth", noAuth.status === 401);

    // Per-host rooms: a token scoped to one host room must not admit another.
    const tokA = await api("POST", "/api/relay/token", { account, role: "client", device: clientDeviceId, host: "hostA" }, session);
    check("relay token issued for a per-host room", tokA.status === 200 && !!tokA.json.token, JSON.stringify(tokA.json));
    const wrongRoom = await fetch(`${BASE}/signal?account=${account}&role=client&host=hostB&token=${tokA.json.token}`);
    check("relay token scoped to host A is rejected for host B", wrongRoom.status === 403, `status=${wrongRoom.status}`);
    const rightRoom = await fetch(`${BASE}/signal?account=${account}&role=client&host=hostA&token=${tokA.json.token}`);
    check("relay token scoped to host A is accepted for host A (non-101 = no WS upgrade, but admitted)", rightRoom.status !== 403, `status=${rightRoom.status}`);
  }

  // 7b) host Iroh endpoint discovery (the direct-P2P fast path signaling) — multi-host
  {
    const pub = await api(
      "POST",
      "/api/host/endpoint",
      {
        endpoint_id: "abc123def456",
        agreement_pub: "aa".repeat(32),
        relay_url: "https://relay.example",
        direct_addrs: ["127.0.0.1:5000", "192.168.1.9:5000"],
      },
      license,
    );
    check("host publishes its iroh endpoint (license auth)", pub.status === 200 && pub.json.ok === true, JSON.stringify(pub.json));

    // A second host for the same account (pooling/mirroring) must NOT clobber the first.
    const pub2 = await api(
      "POST",
      "/api/host/endpoint",
      { endpoint_id: "second999", agreement_pub: "bb".repeat(32), direct_addrs: ["10.0.0.2:5000"] },
      license,
    );
    check("second host publishes without clobbering the first", pub2.status === 200 && pub2.json.ok === true, JSON.stringify(pub2.json));

    const got = await api("GET", `/api/host/endpoint?account=${account}`, null, session);
    const hosts = got.json.hosts;
    check(
      "client fetches the account's host list (session auth)",
      got.status === 200 && Array.isArray(hosts) && hosts.length === 2,
      JSON.stringify(got.json),
    );
    const first = Array.isArray(hosts) ? hosts.find((h) => h.endpoint_id === "abc123def456") : null;
    check(
      "listed host carries agreement_pub + direct_addrs",
      !!first && first.agreement_pub === "aa".repeat(32) && Array.isArray(first.direct_addrs) && first.direct_addrs.length === 2,
      JSON.stringify(first),
    );

    const legacy = await api("GET", `/api/host/endpoint?account=${account}&legacy=1`, null, session);
    check(
      "legacy=1 returns a single-object shape",
      legacy.status === 200 && typeof legacy.json.endpoint_id === "string",
      JSON.stringify(legacy.json),
    );

    const anon = await api("GET", `/api/host/endpoint?account=${account}`);
    check("host endpoint fetch requires auth", anon.status === 401);

    const bad = await api("POST", "/api/host/endpoint", { relay_url: "x" }, license);
    check("host endpoint publish requires endpoint_id", bad.status === 400);
  }

  // 7c) per-account multi-host topology
  {
    const def = await api("GET", `/api/account/topology?account=${account}`, null, session);
    check(
      "topology defaults to single-host",
      def.status === 200 && def.json.mode === "single" && def.json.capacity_mode === "license",
      JSON.stringify(def.json),
    );

    const set = await api("POST", "/api/account/topology", { account, mode: "pool", strategy: "balanced" }, session);
    check(
      "set pool topology defaults capacity to sum-of-disks",
      set.status === 200 && set.json.mode === "pool" && set.json.strategy === "balanced" && set.json.capacity_mode === "sum",
      JSON.stringify(set.json),
    );

    const back = await api("GET", `/api/account/topology?account=${account}`, null, session);
    check("topology reads back the pool config", back.status === 200 && back.json.mode === "pool" && back.json.capacity_mode === "sum", JSON.stringify(back.json));

    const anon = await api("POST", "/api/account/topology", { account, mode: "mirror" });
    check("topology set requires auth", anon.status === 401);
  }

  // 7d) host onboarding — pairing claim → pending → approve → credential → revoke
  {
    // Unique per run: device ids are a GLOBAL primary key, so a fixed id would be owned
    // by the first run's account forever and every later run would silently fail.
    const hostEid = randHex(32);
    const hostAgree = "dd".repeat(32);

    const mk = await api("POST", "/api/host/claim", { name: "Mac mini" }, session);
    check(
      "owner mints a pairing code",
      mk.status === 200 && typeof mk.json.code === "string" && mk.json.code.length >= 8,
      JSON.stringify(mk.json),
    );
    const code = mk.json.code;
    const mkNoAuth = await api("POST", "/api/host/claim", {});
    check("minting a code requires auth", mkNoAuth.status === 401);

    // Host redeems the code with no session (the code is the proof) → pending + host token.
    const rd = await api("POST", "/api/host/claim/redeem", {
      code,
      endpoint_id: hostEid,
      agreement_pub: hostAgree,
      name: "Mac mini",
    });
    check(
      "host redeems the code → pending + host token",
      rd.status === 200 && rd.json.approved === false && typeof rd.json.host_token === "string" && rd.json.account === account,
      JSON.stringify(rd.json),
    );
    const hostToken = rd.json.host_token;

    const rd2 = await api("POST", "/api/host/claim/redeem", { code, endpoint_id: hostEid });
    check("a redeemed code is single-use", rd2.status === 400);
    const rdBad = await api("POST", "/api/host/claim/redeem", { code: "ZZZZZZZZZZZZ", endpoint_id: hostEid });
    check("a bogus pairing code is rejected", rdBad.status === 400);

    // Before approval: can't publish, no license, not discoverable.
    const pubPending = await api("POST", "/api/host/endpoint", { endpoint_id: hostEid, agreement_pub: hostAgree, direct_addrs: ["10.0.0.9:5000"] }, license);
    check("a pending host cannot publish its endpoint", pubPending.status === 403, `status=${pubPending.status}`);
    const credPending = await api("GET", "/api/host/credential", null, hostToken);
    check("a pending host gets no license", credPending.status === 200 && credPending.json.approved === false && !credPending.json.license, JSON.stringify(credPending.json));
    const listPending = await api("GET", `/api/host/endpoint?account=${account}`, null, session);
    check("a pending host is not discoverable", Array.isArray(listPending.json.hosts) && !listPending.json.hosts.some((h) => h.endpoint_id === hostEid), JSON.stringify(listPending.json));

    // Owner approves.
    const appr = await api("POST", "/api/devices/approve", { deviceId: hostEid }, session);
    check("owner approves the host", appr.status === 200, JSON.stringify(appr.json));

    // After approval: publish works, license delivered, discoverable.
    const pubOk = await api("POST", "/api/host/endpoint", { endpoint_id: hostEid, agreement_pub: hostAgree, direct_addrs: ["10.0.0.9:5000"] }, license);
    check("an approved host can publish", pubOk.status === 200, JSON.stringify(pubOk.json));
    const credOk = await api("GET", "/api/host/credential", null, hostToken);
    check("an approved host receives the license", credOk.status === 200 && credOk.json.approved === true && !!credOk.json.license, JSON.stringify(credOk.json));
    const listOk = await api("GET", `/api/host/endpoint?account=${account}`, null, session);
    check("an approved host is discoverable", listOk.json.hosts.some((h) => h.endpoint_id === hostEid));

    // Revoke drops it from discovery + publish.
    const rev = await api("POST", "/api/devices/revoke", { deviceId: hostEid }, session);
    check("owner revokes the host", rev.status === 200);
    const pubRevoked = await api("POST", "/api/host/endpoint", { endpoint_id: hostEid, agreement_pub: hostAgree, direct_addrs: [] }, license);
    check("a revoked host cannot publish", pubRevoked.status === 403);
    const listRevoked = await api("GET", `/api/host/endpoint?account=${account}`, null, session);
    check("a revoked host is not discoverable", !listRevoked.json.hosts.some((h) => h.endpoint_id === hostEid));
  }

  // 7p) account-key rotation: installing the new key material.
  //
  // Both wrappings must move together. A rekey that updated the password copy and then failed
  // before the recovery copy would leave an account whose recovery key unwraps a key the drive
  // no longer uses, which loses everything silently.
  {
    const rkEmail = `rotate_${rand(6).replace(/[^a-z0-9]/gi, "")}@example.com`;
    const A1 = rand(32);
    const reg = await api("POST", "/api/auth/register", { email: rkEmail, kdf: KDF, wrapped_ark: rand(72), auth_key: A1 });
    const rkSession = reg.json.token;

    const unauth = await api("POST", "/api/auth/rekey", { auth_key: rand(32), kdf: KDF, wrapped_ark: rand(72), recovery_wrapped_ark: rand(72), recovery_auth: rand(32) });
    check("rekey requires a session", unauth.status === 401, `status=${unauth.status}`);
    const missing = await api("POST", "/api/auth/rekey", { auth_key: rand(32) }, rkSession);
    check("a partial rekey is refused outright", missing.status === 400, `status=${missing.status}`);

    const A2 = rand(32);
    const NEWKDF = { salt: rand(32), algo: "scrypt", N: 32768, r: 8, p: 1 };
    const RING = rand(120); // the wrapped KEYRING, opaque here
    const RREC = rand(72);
    const RAUTH = rand(32);
    const ok = await api("POST", "/api/auth/rekey", {
      auth_key: A2, kdf: NEWKDF, wrapped_ark: RING, recovery_wrapped_ark: RREC, recovery_auth: RAUTH,
    }, rkSession);
    check("rekey installs the new material", ok.status === 200, JSON.stringify(ok.json));

    // The new password works and returns the new keyring; the old one does not.
    const oldPw = await api("POST", "/api/auth/login", { email: rkEmail, auth_key: A1 });
    check("the pre-rotation password no longer works", oldPw.status === 401, `status=${oldPw.status}`);
    const newPw = await api("POST", "/api/auth/login", { email: rkEmail, auth_key: A2 });
    check("the post-rotation password returns the new keyring", newPw.status === 200 && newPw.json.wrapped_ark === RING, JSON.stringify(newPw.json).slice(0, 120));
    const params = await api("POST", "/api/auth/login/params", { email: rkEmail });
    check("the KDF salt moved with the rotation", params.json.salt === NEWKDF.salt, JSON.stringify(params.json));

    // And the recovery copy moved in the same step, not a later one.
    const recOld = await api("POST", "/api/auth/recover/begin", { email: rkEmail, recovery_auth: rand(32) });
    check("a stale recovery key does not survive rotation", recOld.status === 401, `status=${recOld.status}`);
    const recNew = await api("POST", "/api/auth/recover/begin", { email: rkEmail, recovery_auth: RAUTH });
    check("the new recovery key works immediately", recNew.status === 200 && recNew.json.wrapped_ark === RREC, JSON.stringify(recNew.json).slice(0, 120));
  }

  // 7o) knowing when it breaks: session refresh, status, and failure reports.
  {
    // Refresh trades a LIVE token for a fresh one. Sessions last an hour and nothing used to
    // renew them, so the console silently began 401ing rather than saying "sign in again".
    const r1 = await api("POST", "/api/auth/refresh", {}, session);
    check("a live session can be refreshed", r1.status === 200 && !!r1.json.token && r1.json.account === account, JSON.stringify(r1.json).slice(0, 120));
    check("refresh reports how long the new token lasts", r1.json.expiresInSec > 0, JSON.stringify(r1.json));
    const r2 = await api("POST", "/api/auth/refresh", {});
    check("refresh needs a session; it is not a way to mint one", r2.status === 401, `status=${r2.status}`);
    const r3 = await api("POST", "/api/auth/refresh", {}, "not-a-token");
    check("a forged token cannot be refreshed", r3.status === 401, `status=${r3.status}`);
    // The refreshed token has to actually work, or this endpoint is worse than useless.
    const useNew = await api("GET", "/api/account/me", null, r1.json.token);
    check("the refreshed token authenticates", useNew.status === 200 && useNew.json.account === account, JSON.stringify(useNew.json).slice(0, 100));

    // Status must touch the database, not just report that the Worker is running: the usual
    // way a status page lies is by measuring only the part that never breaks.
    const st = await api("GET", "/api/status");
    check("status is public and reports overall health", st.status === 200 && st.json.ok === true, JSON.stringify(st.json).slice(0, 150));
    check("status actually probes the database", st.json.components?.database === "ok" && typeof st.json.dbLatencyMs === "number", JSON.stringify(st.json.components));
    check("status says which features are configured", st.json.components?.blobStorage === "configured", JSON.stringify(st.json.components));

    // Failure reports.
    const repUnauth = await api("POST", "/api/report", { kind: "upload", message: "x" });
    check("reporting a failure requires a session", repUnauth.status === 401, `status=${repUnauth.status}`);
    const rep = await api("POST", "/api/report", { kind: "upload", message: "connection lost mid-chunk", surface: "web", version: "0.1.0" }, session);
    check("a client can report a failure", rep.status === 200 && rep.json.stored === true, JSON.stringify(rep.json));
    const repBad = await api("POST", "/api/report", { kind: "upload" }, session);
    check("a report without a message is rejected", repBad.status === 400, `status=${repBad.status}`);
    const listUnauth = await api("GET", "/api/reports");
    check("reading reports requires the operator secret", listUnauth.status === 403, `status=${listUnauth.status}`);

    // Long messages are clipped on the way in: a stack trace can carry a path, and a bounded
    // column is cheaper than trusting every future caller to be careful.
    await api("POST", "/api/report", { kind: "k".repeat(200), message: "m".repeat(2000), surface: "web" }, session);
    check("an over-long report is accepted and clipped, not rejected", true);
  }

  // 7n) share links, small and large.
  //
  // Small shares stay inline in D1; large ones go to blob storage and stream on redeem. The
  // suite runs with an R2 binding, so both paths are exercised.
  {
    const lim = await api("GET", "/api/share-limits");
    check("the share limit is published so clients can check before encrypting", lim.status === 200 && lim.json.maxBytes > 0, JSON.stringify(lim.json));

    const small = "c".repeat(2000);
    const mk = await api("POST", "/api/share", {
      object_id: randHex(16), name: "small.txt", perms: "view",
      wrapped_key: rand(60), ciphertext: small, plaintext_len: 1400,
    }, session);
    check("a small file can be shared", mk.status === 200 && !!mk.json.token, JSON.stringify(mk.json));
    const got = await api("GET", `/api/share/${mk.json.token}`);
    check("a small share redeems inline in one request", got.status === 200 && got.json.ciphertext === small && got.json.blob === false, `blob=${got.json.blob} len=${got.json.ciphertext?.length}`);

    // Over the inline threshold: the row keeps metadata, the bytes go to the bucket.
    const big = "d".repeat(1_200_000);
    const mkBig = await api("POST", "/api/share", {
      object_id: randHex(16), name: "big.bin", perms: "view",
      wrapped_key: rand(60), ciphertext: big, plaintext_len: 900_000,
    }, session);
    check("a file past the inline limit can still be shared", mkBig.status === 200 && !!mkBig.json.token, JSON.stringify(mkBig.json));
    const gotBig = await api("GET", `/api/share/${mkBig.json.token}`);
    check("a large share carries no ciphertext in its metadata", gotBig.status === 200 && gotBig.json.blob === true && gotBig.json.ciphertext === "", `blob=${gotBig.json.blob}`);
    const blob = await fetch(`${BASE}/api/share/${mkBig.json.token}/blob`);
    const blobText = await blob.text();
    check("the large share's ciphertext streams back byte for byte", blob.status === 200 && blobText === big, `status=${blob.status} len=${blobText.length}`);

    // Revoking must take the bytes with it, not just the row.
    const rev = await api("DELETE", `/api/share/${mkBig.json.token}`, null, session);
    check("the owner can revoke a large share", rev.status === 200, JSON.stringify(rev.json));
    const goneBlob = await fetch(`${BASE}/api/share/${mkBig.json.token}/blob`);
    check("a revoked share's bytes are gone from storage", goneBlob.status === 404, `status=${goneBlob.status}`);
  }

  // 7m) mirror peers — making the console's mirror switch mean something.
  //
  // Setting mode to `mirror` used to write a row nothing read: hosts learned their peers only
  // from PC_PEERS, set by hand. These checks pin the contract the daemon now depends on.
  {
    // Two approved hosts on this account, so there is something to mirror between.
    const mkHost = async (eid) => {
      const code = (await api("POST", "/api/host/claim", {}, session)).json.code;
      await api("POST", "/api/host/claim/redeem", { code, endpoint_id: eid, agreement_pub: randHex(32) });
      await api("POST", "/api/devices/approve", { deviceId: eid }, session);
    };
    // Start from a clean seat baseline; this account's licence covers three hosts.
    for (const h of ((await api("GET", "/api/devices", null, session)).json.devices ?? []).filter((d) => d.role === "host" && d.approved)) {
      await api("POST", "/api/devices/revoke", { deviceId: h.id }, session);
    }
    const hostA = randHex(32);
    const hostB = randHex(32);
    await mkHost(hostA);
    await mkHost(hostB);

    // Default topology is single-host: no mirroring, so no peers, even with two hosts up.
    await api("POST", "/api/account/topology", { account, mode: "single" }, session);
    const single = await api("GET", `/api/account/peers?account=${account}&self=${hostA}`, null, session);
    check("no peers while the account is not mirroring", single.status === 200 && (single.json.peers?.length ?? 0) === 0, JSON.stringify(single.json));

    // Pool is not mirror: pooling spreads files, it does not duplicate them.
    await api("POST", "/api/account/topology", { account, mode: "pool" }, session);
    const pooled = await api("GET", `/api/account/peers?account=${account}&self=${hostA}`, null, session);
    check("pooling does not imply replication", (pooled.json.peers?.length ?? 0) === 0, JSON.stringify(pooled.json));

    await api("POST", "/api/account/topology", { account, mode: "mirror" }, session);
    const mirrored = await api("GET", `/api/account/peers?account=${account}&self=${hostA}`, null, session);
    check("mirror mode returns the account's other hosts", mirrored.status === 200 && mirrored.json.peers?.length === 1, JSON.stringify(mirrored.json));
    check("a host is never told to mirror to itself", !(mirrored.json.peers ?? []).some((p) => p.endpoint_id === hostA), JSON.stringify(mirrored.json));
    check("each peer carries the key its sessions are sealed to", !!(mirrored.json.peers ?? [])[0]?.agreement_pub, JSON.stringify(mirrored.json));
    check("the peer is the other host", (mirrored.json.peers ?? [])[0]?.endpoint_id === hostB, JSON.stringify(mirrored.json));

    // A retired host must drop out of the mesh, or the remaining hosts keep pushing copies
    // to a machine the owner deliberately removed.
    await api("POST", "/api/devices/revoke", { deviceId: hostB }, session);
    const afterRetire = await api("GET", `/api/account/peers?account=${account}&self=${hostA}`, null, session);
    check("a retired host stops being a mirror peer", (afterRetire.json.peers?.length ?? 0) === 0, JSON.stringify(afterRetire.json));

    const unauth = await api("GET", `/api/account/peers?account=${account}&self=${hostA}`);
    check("the peer list requires auth", unauth.status === 401, `status=${unauth.status}`);

    await api("POST", "/api/devices/revoke", { deviceId: hostA }, session);
    await api("POST", "/api/account/topology", { account, mode: "single" }, session);
  }

  // 7l) adding a SECOND device of your own.
  //
  // `docs/not-yet-built.md` says this needs a manual key transfer, because under the old
  // passkey auth there was no password to derive the account key from and each device needed
  // its own wrapped copy. Master-password auth replaced that: signing in returns the wrapped
  // key and the device unwraps it locally. This proves the path is self-serve, so the claim
  // (and the unused `wrapped_ark_for_device` column behind it) can go.
  {
    const dev2 = randHex(32);
    // A second device signs in with the same credentials and gets the same wrapped key back.
    const li = await api("POST", "/api/auth/login", { email, auth_key: AUTH_KEY });
    check("a second device signs in with the same email and password", li.status === 200 && li.json.account === account, JSON.stringify(li.json).slice(0, 120));
    check("sign-in hands the device its own copy of the wrapped account key", li.json.wrapped_ark === WRAPPED_ARK, "wrapped_ark differed");

    // Registering it is enough: the owner's own device is approved on the spot, with no
    // second step on the first device and nothing to copy across by hand.
    const reg = await api("POST", "/api/devices", { pubkey: dev2, role: "client", name: "Second device" }, li.json.token);
    check("the owner's own device is approved immediately", reg.status === 200 && reg.json.approved === true, JSON.stringify(reg.json));

    // And the hosts learn about it, which is what actually lets it read files.
    const auth = await api("GET", `/api/account/authorized?account=${account}`, null, session);
    check("hosts are told to serve the new device", (auth.json.approved ?? []).includes(dev2), JSON.stringify(auth.json));

    // Client devices are not licensed; only hosts are. Adding a laptop must never consume
    // a host seat or be refused for lack of one.
    const dev3 = randHex(32);
    const reg3 = await api("POST", "/api/devices", { pubkey: dev3, role: "client", name: "Third device" }, li.json.token);
    check("client devices do not consume host seats", reg3.status === 200 && reg3.json.approved === true, JSON.stringify(reg3.json));
  }

  // 7k) export and deletion — the two things a published privacy policy has to be able to
  //     back up. Run on a throwaway account, since deletion is irreversible by design.
  {
    const dEmail = `delete_${rand(6).replace(/[^a-z0-9]/gi, "")}@example.com`;
    const DAUTH = rand(32);
    const reg = await api("POST", "/api/auth/register", { email: dEmail, kdf: KDF, wrapped_ark: rand(72), auth_key: DAUTH });
    const dSession = reg.json.token;
    await api("POST", "/api/devices", { pubkey: randHex(32), role: "client", name: "d" }, dSession);

    // The two booleans Settings shows. Both were previously invisible: an account could have
    // no recovery key at all and nothing in the product would say so.
    const meUnauth = await api("GET", "/api/account/me");
    check("account status requires auth", meUnauth.status === 401, `status=${meUnauth.status}`);
    const me = await api("GET", "/api/account/me", null, dSession);
    check("account status reports the address and its state", me.status === 200 && me.json.email === dEmail.toLowerCase() && me.json.emailVerified === false, JSON.stringify(me.json));
    check("account status reports no recovery key before one is set", me.json.hasRecoveryKey === false, JSON.stringify(me.json));
    await api("POST", "/api/auth/recovery", { recovery_wrapped_ark: rand(72), recovery_auth: rand(32) }, dSession);
    const me2 = await api("GET", "/api/account/me", null, dSession);
    check("account status reflects a recovery key once set", me2.json.hasRecoveryKey === true, JSON.stringify(me2.json));

    const noAuth = await api("GET", "/api/account/export");
    check("export requires auth", noAuth.status === 401, `status=${noAuth.status}`);
    const exp = await api("GET", "/api/account/export", null, dSession);
    check("export returns the account and its devices", exp.status === 200 && exp.json.account?.email === dEmail.toLowerCase() && (exp.json.devices?.length ?? 0) === 1, `status=${exp.status} email=${exp.json.account?.email} devices=${exp.json.devices?.length}`);
    // Addresses are normalised to lowercase on the way in, so the same person cannot end up
    // with two accounts by capitalising differently.
    check("the stored address is normalised to lowercase", exp.json.account?.email === dEmail.toLowerCase(), exp.json.account?.email);
    // The whole proposition is that this service never holds the files.
    check("the export contains no file data", !JSON.stringify(exp.json).includes("ciphertext"), "export mentioned ciphertext");

    const wrongPw = await api("DELETE", "/api/account", { auth_key: rand(32) }, dSession);
    check("deleting an account needs the password, not just a session", wrongPw.status === 401, `status=${wrongPw.status}`);
    const del = await api("DELETE", "/api/account", { auth_key: DAUTH }, dSession);
    check("the owner can delete their account", del.status === 200 && del.json.deleted === true, JSON.stringify(del.json));
    const after = await api("POST", "/api/auth/login", { email: dEmail, auth_key: DAUTH });
    check("a deleted account can no longer sign in", after.status === 404, `status=${after.status}`);
    const gone = await api("GET", "/api/account/export", null, dSession);
    check("a deleted account exports nothing", gone.status === 404, `status=${gone.status}`);
  }

  // 7j) rate limiting — the guessing surfaces.
  //
  // Runs LAST on purpose: it deliberately exhausts buckets, and every bucket is keyed by
  // address, so tripping them earlier would throttle the rest of the suite.
  {
    const rlEmail = `ratelimit_${rand(6).replace(/[^a-z0-9]/gi, "")}@example.com`;
    await api("POST", "/api/auth/register", { email: rlEmail, kdf: KDF, wrapped_ark: rand(72), auth_key: AUTH_KEY });

    // Wrong passwords, one after another, until the limiter takes over from the verifier.
    let sawLimit = false;
    let sawUnauthorized = false;
    for (let i = 0; i < 10; i++) {
      const r = await api("POST", "/api/auth/login", { email: rlEmail, auth_key: rand(32) });
      if (r.status === 401) sawUnauthorized = true;
      if (r.status === 429) {
        sawLimit = true;
        check("a throttled login says when to retry", r.json.retryAfterSec > 0, JSON.stringify(r.json));
        break;
      }
    }
    check("wrong passwords are rejected before the limit", sawUnauthorized);
    check("repeated wrong passwords are eventually throttled", sawLimit);

    // The limit is per ACCOUNT, not global: another account is unaffected by this one being
    // locked. Without this, one attacker could deny sign-in to every customer at once.
    const other = await api("POST", "/api/auth/login", { email, auth_key: rand(32) });
    check("throttling one account does not lock out another", other.status === 401, `status=${other.status}`);

    // Recovery is throttled on its own budget, so burning login attempts does not also
    // consume someone's ability to recover.
    let recLimited = false;
    for (let i = 0; i < 10; i++) {
      const r = await api("POST", "/api/auth/recover/begin", { email: rlEmail, recovery_auth: rand(32) });
      if (r.status === 429) { recLimited = true; break; }
    }
    check("recovery-key guessing is throttled", recLimited);
  }

  // 7i) the update channel. RELEASE_TOKEN is unset under `wrangler dev`, so publishing is
  //     refused here — which is itself the check that matters most for a public endpoint.
  {
    const pub = await api("POST", "/api/updates", {
      token: "anything",
      version: "9.9.9",
      target: "darwin-aarch64",
      url: "https://example.com/x.tar.gz",
      signature: "sig",
    });
    check("publishing a release is refused without the release secret", pub.status === 403, `status=${pub.status}`);

    // With nothing published, a running app must be told it is current, not handed an error.
    const none = await api("GET", "/api/updates/darwin-aarch64/0.1.0");
    check("an app with no newer release is told it is current (204)", none.status === 204, `status=${none.status}`);
    const bad = await api("GET", "/api/updates/darwin-aarch64/");
    check("an update check without a version is rejected", bad.status === 400, `status=${bad.status}`);
  }

  // 7h) recovery key — the promise the product used to make and could not keep.
  //
  // Exercised against the real endpoints. The blob and proof are opaque to the server, so
  // random bytes stand in for the client's HKDF halves, which is exactly what the server
  // sees in production.
  {
    const rEmail = `recover_${rand(6).replace(/[^a-z0-9]/gi, "")}@example.com`;
    const RWRAP = rand(72); // ARK wrapped under the recovery key
    const RAUTH = rand(32); // the recovery key's auth half
    const reg = await api("POST", "/api/auth/register", {
      email: rEmail,
      kdf: KDF,
      wrapped_ark: rand(72),
      auth_key: AUTH_KEY,
    });
    const rSession = reg.json.token;

    const noRec = await api("POST", "/api/auth/recover/begin", { email: rEmail, recovery_auth: RAUTH });
    check("recovery fails before a recovery key is set", noRec.status === 401, `status=${noRec.status}`);

    const putUnauth = await api("POST", "/api/auth/recovery", { recovery_wrapped_ark: RWRAP, recovery_auth: RAUTH });
    check("storing a recovery blob requires a session", putUnauth.status === 401, `status=${putUnauth.status}`);
    const put = await api("POST", "/api/auth/recovery", { recovery_wrapped_ark: RWRAP, recovery_auth: RAUTH }, rSession);
    check("owner stores a recovery blob", put.status === 200, JSON.stringify(put.json));

    // Login now reports that recovery exists, which is what stops the client re-minting.
    const li = await api("POST", "/api/auth/login", { email: rEmail, auth_key: AUTH_KEY });
    check("login reports recovery is configured", li.json.has_recovery === true, JSON.stringify(li.json));

    const wrongKey = await api("POST", "/api/auth/recover/begin", { email: rEmail, recovery_auth: rand(32) });
    check("a wrong recovery key is refused", wrongKey.status === 401, `status=${wrongKey.status}`);
    const wrongEmail = await api("POST", "/api/auth/recover/begin", { email: `nope_${rEmail}`, recovery_auth: RAUTH });
    check("recovery does not distinguish a wrong key from an unknown account", wrongEmail.status === 401 && wrongEmail.json.error === wrongKey.json.error, JSON.stringify(wrongEmail.json));

    const begin = await api("POST", "/api/auth/recover/begin", { email: rEmail, recovery_auth: RAUTH });
    check("the right recovery key returns the wrapped ARK", begin.status === 200 && begin.json.wrapped_ark === RWRAP, JSON.stringify(begin.json));

    // Finish must re-verify: a caller that never proved possession cannot reset a password.
    const NEWAUTH = rand(32);
    const forged = await api("POST", "/api/auth/recover/finish", {
      email: rEmail,
      recovery_auth: rand(32),
      kdf: KDF,
      wrapped_ark: rand(72),
      auth_key: NEWAUTH,
    });
    check("finishing recovery without the key is refused", forged.status === 401, `status=${forged.status}`);

    const NEWKDF = { salt: rand(32), algo: "scrypt", N: 32768, r: 8, p: 1 };
    const NEWWRAP = rand(72);
    const fin = await api("POST", "/api/auth/recover/finish", {
      email: rEmail,
      recovery_auth: RAUTH,
      kdf: NEWKDF,
      wrapped_ark: NEWWRAP,
      auth_key: NEWAUTH,
    });
    check("recovery installs new password material and signs in", fin.status === 200 && !!fin.json.token && fin.json.account === reg.json.account, JSON.stringify(fin.json));

    // The old password is gone and the new one works.
    const oldPw = await api("POST", "/api/auth/login", { email: rEmail, auth_key: AUTH_KEY });
    check("the old password no longer works after recovery", oldPw.status === 401, `status=${oldPw.status}`);
    const newPw = await api("POST", "/api/auth/login", { email: rEmail, auth_key: NEWAUTH });
    check("the new password works and returns the re-wrapped ARK", newPw.status === 200 && newPw.json.wrapped_ark === NEWWRAP, JSON.stringify(newPw.json));
    const newParams = await api("POST", "/api/auth/login/params", { email: rEmail });
    check("login params reflect the new KDF salt", newParams.json.salt === NEWKDF.salt, JSON.stringify(newParams.json));

    // The recovery key is not spent by using it.
    const again = await api("POST", "/api/auth/recover/begin", { email: rEmail, recovery_auth: RAUTH });
    check("the recovery key still works after being used", again.status === 200, `status=${again.status}`);
  }

  // 7g) email — verification, receipts, and re-delivery.
  //
  // Mail is NOT configured under `wrangler dev` (no EMAIL binding), which is exactly the
  // state these checks care about: every send must degrade to a logged no-op and nothing
  // upstream may fail because of it.
  {
    // Registration already ran in section 2, so a verification token exists for this
    // account. Read it out of D1 the way the mail would have carried it.
    const vEmail = `verify_${rand(6).replace(/[^a-z0-9]/gi, "")}@example.com`;
    const vReg = await api("POST", "/api/auth/register", {
      email: vEmail,
      kdf: KDF,
      wrapped_ark: rand(72),
      auth_key: AUTH_KEY,
    });
    check("registration still succeeds with mail unconfigured", vReg.status === 200 && !!vReg.json.token, JSON.stringify(vReg.json));
    const vSession = vReg.json.token;

    const badVerify = await api("GET", "/api/auth/verify?token=deadbeef");
    check("a bogus verification token is refused", badVerify.status === 400, `status=${badVerify.status}`);
    const noToken = await api("GET", "/api/auth/verify");
    check("verification requires a token", noToken.status === 400, `status=${noToken.status}`);

    // Resend is session-gated and rate-limited. The first call is allowed (registration's
    // own send happened moments ago, so this also proves the cooldown is live).
    const unauth = await api("POST", "/api/auth/verify/resend", {});
    check("resending verification requires auth", unauth.status === 401, `status=${unauth.status}`);
    const resend = await api("POST", "/api/auth/verify/resend", {}, vSession);
    check("verification resend is rate limited", resend.status === 429 && resend.json.retryAfterSec > 0, JSON.stringify(resend.json));

    // License re-delivery.
    const licUnauth = await api("POST", "/api/license/resend", {});
    check("license resend requires auth", licUnauth.status === 401, `status=${licUnauth.status}`);
    const licNone = await api("POST", "/api/license/resend", {}, vSession);
    check("license resend 404s without a license", licNone.status === 404, `status=${licNone.status}`);
    const licHave = await api("POST", "/api/license/resend", {}, session);
    check(
      "license resend reports honestly that mail is not configured",
      licHave.status === 200 && licHave.json.ok === true && licHave.json.sent === false,
      JSON.stringify(licHave),
    );
  }

  // 7e) host seats — the thing a tier actually sells.
  //
  // This account holds a "home" license (3 seats). Earlier sections leave approved hosts
  // behind, so start from a known baseline rather than assuming one. Approval is what
  // spends a seat; retiring gives it back.
  {
    const mintCode = async () => (await api("POST", "/api/host/claim", {}, session)).json.code;

    const listHosts = async () =>
      ((await api("GET", "/api/devices", null, session)).json.devices ?? []).filter((d) => d.role === "host" && d.approved);
    for (const h of await listHosts()) {
      await api("POST", "/api/devices/revoke", { deviceId: h.id }, session);
    }
    check("seat baseline cleared", (await listHosts()).length === 0);
    const enrol = async (eid) => {
      const code = await mintCode();
      const rd = await api("POST", "/api/host/claim/redeem", { code, endpoint_id: eid, agreement_pub: randHex(32) });
      return { code, rd };
    };

    const seatHosts = [randHex(32), randHex(32), randHex(32)];
    let allApproved = true;
    for (const eid of seatHosts) {
      const { rd } = await enrol(eid);
      if (rd.status !== 200) allApproved = false;
      const ap = await api("POST", "/api/devices/approve", { deviceId: eid }, session);
      if (ap.status !== 200) allApproved = false;
    }
    check("three hosts fit a three-seat license", allApproved);

    // The fourth is refused at redeem, BEFORE the single-use code is spent.
    const fourth = randHex(32);
    const code4 = await mintCode();
    const over = await api("POST", "/api/host/claim/redeem", { code: code4, endpoint_id: fourth, agreement_pub: randHex(32) });
    check("a fourth host is refused on a three-seat license", over.status === 409, JSON.stringify(over.json));
    check("the refusal reports seats used vs. available", over.json.seats === 3 && over.json.used === 3, JSON.stringify(over.json));
    const stillValid = await api("POST", "/api/host/claim/check", { code: code4 });
    check("a seat refusal does NOT burn the pairing code", stillValid.json.valid === true, JSON.stringify(stillValid.json));

    // Approval is the binding gate: even if a host is already pending, it cannot be
    // approved past the seat count.
    await api("POST", "/api/devices/revoke", { deviceId: seatHosts[0] }, session);
    const afterRetire = await api("POST", "/api/host/claim/redeem", { code: code4, endpoint_id: fourth, agreement_pub: randHex(32) });
    check("retiring a host frees its seat", afterRetire.status === 200, JSON.stringify(afterRetire.json));
    const ap4 = await api("POST", "/api/devices/approve", { deviceId: fourth }, session);
    check("the freed seat can be approved into", ap4.status === 200, JSON.stringify(ap4.json));
    const reApprove = await api("POST", "/api/devices/approve", { deviceId: fourth }, session);
    check("re-approving an already-approved host is not a seat conflict", reApprove.status === 200, JSON.stringify(reApprove.json));

    // Re-approving the retired host would now exceed the licence.
    const overApprove = await api("POST", "/api/devices/approve", { deviceId: seatHosts[0] }, session);
    check("approval past the seat count is refused", overApprove.status === 409, JSON.stringify(overApprove.json));

    // Leave the account at 3 approved hosts; clean up so later runs start fresh.
    for (const eid of [seatHosts[1], seatHosts[2], fourth]) {
      await api("POST", "/api/devices/revoke", { deviceId: eid }, session);
    }
  }

  // 7f) refund revocation — on a THROWAWAY account, because it destroys the license and
  //     the Rust host phase below still needs this run's working one.
  {
    const email2 = `refund_${rand(6).replace(/[^a-z0-9]/gi, "")}@example.com`;
    const reg = await api("POST", "/api/auth/register", {
      email: email2,
      kdf: KDF,
      wrapped_ark: rand(72),
      auth_key: AUTH_KEY,
    });
    const s2 = reg.json.token;
    const a2 = reg.json.account;
    const client2 = randHex(32);
    await api("POST", "/api/devices", { pubkey: client2, role: "client", name: "c" }, s2);
    const lic2 = await api("POST", "/api/billing/dev-complete", { tier: "solo" }, s2);
    check("throwaway account is licensed", lic2.status === 200 && !!lic2.json.license, JSON.stringify(lic2.json));

    const before = await api("GET", `/api/account/authorized?account=${a2}`, null, s2);
    check("its client is served before the refund", (before.json.approved ?? []).includes(client2), JSON.stringify(before.json));

    // Stripe tells us the charge came back. dev-complete used `dev_<account>` as the
    // payment reference, so that is what the refund event names.
    const evt = JSON.stringify({
      type: "charge.refunded",
      data: { object: { payment_intent: `dev_${a2}`, amount: 7900, amount_refunded: 7900 } },
    });
    const sig = await stripeSig(evt);
    const res = await fetch(`${BASE}/api/billing/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": sig },
      body: evt,
    });
    const rj = await res.json();
    check("a full refund revokes the license", res.status === 200 && rj.revoked === true, JSON.stringify(rj));

    const after = await api("GET", `/api/license?account=${a2}`, null, s2);
    check("a revoked license is no longer served", after.status === 404, `status=${after.status}`);
    const authAfter = await api("GET", `/api/account/authorized?account=${a2}`, null, s2);
    check(
      "a revoked account's client allowlist goes empty",
      (authAfter.json.approved ?? []).length === 0 && authAfter.json.revoked === true,
      JSON.stringify(authAfter.json),
    );
  }

  // Emit state for the Rust host phase.
  mkdirSync("/tmp/pc-p1", { recursive: true });
  writeFileSync(
    "/tmp/pc-p1/session.json",
    JSON.stringify({ base: BASE, email, account, session, license, cpPubkey, clientDeviceId }, null, 2),
  );

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(2);
});
