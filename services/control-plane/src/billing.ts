/**
 * One-time purchase (NOT subscription) → perpetual signed license.
 *
 *   POST /api/billing/checkout    (session)  create a Stripe Checkout Session
 *                                            (payment mode); dev-stubbed if no key
 *   POST /api/billing/webhook                Stripe → verify sig → mint license
 *   POST /api/billing/dev-complete (session) dev-only: mint a license without Stripe
 *   GET  /api/license?account=    (session|license)  fetch the account's license
 *
 * A purchase mints a perpetual, Ed25519-signed entitlement (see tokens.ts). The
 * host verifies it OFFLINE and enforces the quota — no server round-trip, no
 * renewal, matching the one-time-price economics.
 */
import type { Env } from "./types";
import { licenseKey } from "./keys";
import { sendReceipt } from "./mailer";
import { bearer, signLicense, verifyLicense, verifySession } from "./tokens";
import {
  billingEnabled,
  DEFAULT_TIER_ID,
  priceIdFor,
  seatsFor,
  SELF_HOSTED_TIER_ID,
  tierById,
  TIERS,
  type Tier,
} from "./tiers";
import { bytesEqual, hexDecode, hexEncode, json, utf8 } from "./util";
import { hmacSign } from "./webcrypto";

const GIB = 1024 * 1024 * 1024;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
function quotaBytes(env: Env): number {
  const gb = parseInt(env.LICENSE_QUOTA_GB ?? "512", 10);
  return (Number.isFinite(gb) ? gb : 512) * GIB;
}

/**
 * The tier a purchase is for. `LICENSE_TIER` remains the deployment-wide default so a
 * single-price install keeps behaving as before; a request that names a real tier wins.
 */
function resolveTier(env: Env, requested?: string | null): Tier {
  return tierById(requested) ?? tierById(env.LICENSE_TIER) ?? tierById(DEFAULT_TIER_ID)!;
}

/** Mint (idempotently) + persist a license for an account; returns the token. */
async function issueLicense(
  env: Env,
  account: string,
  paymentRef: string,
  tier: { id: string; hostSeats: number | null },
): Promise<string> {
  // Idempotent on the payment reference: a webhook retry must not double-issue.
  const existing = await env.DB.prepare(
    "SELECT signed_token FROM licenses WHERE stripe_payment_intent = ?",
  )
    .bind(paymentRef)
    .first<{ signed_token: string }>();
  if (existing?.signed_token) return existing.signed_token;

  const token = await signLicense(env, account, tier.id, quotaBytes(env), paymentRef, tier.hostSeats ?? undefined);
  await env.DB.prepare(
    `INSERT INTO licenses (id, user_id, tier, quota_bytes, host_seats, stripe_payment_intent, signed_token, purchased_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(stripe_payment_intent) DO NOTHING`,
  )
    .bind(paymentRef, account, tier.id, quotaBytes(env), tier.hostSeats, paymentRef, token, nowSec())
    .run();
  return token;
}

/**
 * With billing off, make sure the account holds the free self-hosted license.
 *
 * Called from every read of a license (`getLicense`, `hostCredential`), so an account is
 * licensed the first time anything asks, with no purchase step. Idempotent through the
 * fixed `self_<account>` payment reference. A no-op when billing is on.
 */
export async function ensureSelfHostedLicense(env: Env, account: string): Promise<void> {
  if (billingEnabled(env)) return;
  await issueLicense(env, account, `self_${account}`, { id: SELF_HOSTED_TIER_ID, hostSeats: null });
}

/**
 * Withdraw a license after a refund or a won dispute.
 *
 * The license itself is perpetual and verified offline, so nothing can un-issue a token
 * already on a host. What revocation actually does is cut the account off at the control
 * plane: `getLicense` and `hostCredential` stop serving it, and `authorizedClients`
 * returns an empty allowlist, which every host re-reads every 30 seconds. That is the
 * enforcement path — the token is a receipt, the allowlist is the gate.
 */
async function revokeByPaymentRef(env: Env, paymentRef: string, reason: string): Promise<boolean> {
  const res = await env.DB.prepare(
    "UPDATE licenses SET revoked_at = ?1, revoked_reason = ?2 WHERE stripe_payment_intent = ?3 AND revoked_at IS NULL",
  )
    .bind(nowSec(), reason, paymentRef)
    .run();
  return ((res.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
}

export async function checkout(env: Env, req: Request): Promise<Response> {
  const tok = bearer(req);
  const s = tok ? await verifySession(env, tok) : null;
  if (!s) return json({ error: "unauthorized" }, 401);

  const body = (await req.json().catch(() => ({}))) as { tier?: string };
  // An unrecognised tier is rejected rather than quietly downgraded: charging someone for
  // a tier they did not choose is worse than making them pick again.
  if (body.tier && !tierById(body.tier)) {
    return json({ error: `unknown tier "${body.tier}"`, tiers: TIERS.map((t) => t.id) }, 400);
  }
  if (!billingEnabled(env)) {
    await ensureSelfHostedLicense(env, s.sub);
    return json({ free: true, tier: SELF_HOSTED_TIER_ID, url: "" });
  }
  const tier = resolveTier(env, body.tier);
  const origin = env.RP_ORIGIN ?? "http://localhost:5173";
  const price = priceIdFor(env, tier);

  // Dev stub: no Stripe key → return a simulated checkout the SPA can "complete"
  // by calling /api/billing/dev-complete.
  if (!env.STRIPE_API_KEY || !price) {
    return json({
      dev: true,
      tier: tier.id,
      url: `${origin}/#/dev-checkout?account=${encodeURIComponent(s.sub)}&tier=${tier.id}`,
      note: "Stripe not configured; use POST /api/billing/dev-complete in dev.",
    });
  }

  const form = new URLSearchParams();
  form.set("mode", "payment"); // one-time, NOT subscription
  form.set("line_items[0][price]", price);
  form.set("line_items[0][quantity]", "1");
  form.set("success_url", `${origin}/#/purchased?session_id={CHECKOUT_SESSION_ID}`);
  form.set("cancel_url", `${origin}/#/pricing`);
  form.set("client_reference_id", s.sub);
  form.set("metadata[account]", s.sub);
  // The tier rides the session so the webhook mints what was actually paid for, rather
  // than re-deriving it from a request the customer no longer controls.
  form.set("metadata[tier]", tier.id);

  const resp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_API_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (!resp.ok) {
    return json({ error: "stripe checkout failed", detail: await resp.text() }, 502);
  }
  const session = (await resp.json()) as { id: string; url: string };
  return json({ id: session.id, url: session.url, tier: tier.id });
}

/** Verify Stripe's `Stripe-Signature` header over the raw body. */
async function stripeSigOk(secret: string, header: string | null, rawBody: string): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  // Replay window: reject signatures older than 5 minutes.
  if (Math.abs(nowSec() - parseInt(t, 10)) > 300) return false;
  const mac = await hmacSign(utf8(secret), utf8(`${t}.${rawBody}`));
  let provided: Uint8Array;
  try {
    provided = hexDecode(v1);
  } catch {
    return false;
  }
  return bytesEqual(mac, provided) || hexEncode(mac) === v1;
}

export async function webhook(env: Env, req: Request): Promise<Response> {
  if (!billingEnabled(env)) return json({ error: "billing is off" }, 404);
  const raw = await req.text();
  // An unsigned webhook would let anyone mint a license, so production refuses to run
  // without the secret instead of skipping the check.
  if (env.ENVIRONMENT === "production" && !env.STRIPE_WEBHOOK_SECRET) {
    return json({ error: "STRIPE_WEBHOOK_SECRET is not set" }, 500);
  }
  if (env.STRIPE_WEBHOOK_SECRET) {
    const ok = await stripeSigOk(env.STRIPE_WEBHOOK_SECRET, req.headers.get("stripe-signature"), raw);
    if (!ok) return json({ error: "bad signature" }, 400);
  }
  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const obj = event.data?.object ?? {};

  if (event.type === "checkout.session.completed") {
    const account = (obj.client_reference_id as string) ?? ((obj.metadata as Record<string, string>)?.account);
    const paymentRef = (obj.payment_intent as string) ?? (obj.id as string);
    if (!account || !paymentRef) return json({ error: "missing account/payment ref" }, 400);
    // Trust Stripe's copy of the tier, not the caller's: this is the value that was
    // attached to the session we created, and it is what the customer actually paid for.
    const tier = resolveTier(env, (obj.metadata as Record<string, string> | undefined)?.tier);
    const token = await issueLicense(env, account, paymentRef, tier);
    // The receipt carries the license, so the customer keeps a durable copy of a perpetual
    // entitlement. Awaited but non-throwing: a mail failure must not make Stripe retry a
    // webhook that already minted, which would be the worse outcome by far.
    await sendReceipt(env, account, {
      tierId: tier.id,
      hostSeats: tier.hostSeats,
      license: token,
      paymentRef,
    });
    return json({ ok: true, issued: true, account, tier: tier.id, seats: tier.hostSeats, license: token });
  }

  // Money going back out. A refund or a lost dispute withdraws the entitlement; the
  // payment reference is how we find the license it paid for.
  if (event.type === "charge.refunded" || event.type === "charge.dispute.closed" || event.type === "charge.dispute.created") {
    // A partial refund is not a cancellation, so only a fully refunded charge revokes.
    if (event.type === "charge.refunded" && obj.amount_refunded != null && obj.amount != null) {
      if (Number(obj.amount_refunded) < Number(obj.amount)) {
        return json({ ok: true, ignored: "partial refund" });
      }
    }
    // A dispute the merchant won leaves the purchase standing.
    if (event.type === "charge.dispute.closed" && obj.status === "won") {
      return json({ ok: true, ignored: "dispute won" });
    }
    const paymentRef = (obj.payment_intent as string) ?? (obj.charge as string) ?? (obj.id as string);
    if (!paymentRef) return json({ error: "missing payment ref" }, 400);
    const revoked = await revokeByPaymentRef(env, paymentRef, event.type);
    return json({ ok: true, revoked, payment_ref: paymentRef });
  }

  // Acknowledge other events without action.
  return json({ ok: true, ignored: event.type ?? "unknown" });
}

/** Dev-only: complete a purchase without Stripe (mints a license). */
export async function devComplete(env: Env, req: Request): Promise<Response> {
  if (env.ENVIRONMENT === "production") return json({ error: "not available" }, 404);
  const tok = bearer(req);
  const s = tok ? await verifySession(env, tok) : null;
  if (!s) return json({ error: "unauthorized" }, 401);
  const body = (await req.json().catch(() => ({}))) as { tier?: string };
  const tier = resolveTier(env, body.tier);
  const token = await issueLicense(env, s.sub, `dev_${s.sub}`, tier);
  return json({ ok: true, account: s.sub, tier: tier.id, seats: tier.hostSeats, license: token });
}

/**
 * Testing bypass: mints a license for an account WITHOUT a Stripe purchase, so onboarding
 * can be exercised from a plain curl with no session.
 *
 * This used to run in PRODUCTION, gated only by a shared secret. That was the right call
 * while there was no other way to get a license, but it is a standing free-product endpoint
 * the moment the price is real, and a leaked or guessed secret gives away the product. Now
 * that tier-aware Stripe checkout exists, test purchases have a legitimate path (Stripe test
 * mode), so it is now OFF in production by default rather than merely secret-gated.
 *
 * `ALLOW_DEV_LICENSE=1` re-enables it in production deliberately, for the window before real
 * Stripe keys exist and this is the only way to license a test account. Two locks, both
 * required: the flag says "this deployment permits it", the secret says "you are allowed to".
 * REMOVE THE FLAG BEFORE SELLING: with it set, anyone holding the secret gets the product.
 */
export async function devLicense(env: Env, req: Request): Promise<Response> {
  if (env.ENVIRONMENT === "production" && env.ALLOW_DEV_LICENSE !== "1") {
    return json({ error: "not available" }, 404);
  }
  const secret = env.DEV_LICENSE_TOKEN;
  const b = (await req.json().catch(() => ({}))) as { token?: string; email?: string; account?: string; tier?: string };
  if (!secret || !b.token || b.token !== secret) return json({ error: "forbidden" }, 403);

  let account = b.account ?? null;
  if (!account && b.email) {
    const u = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(b.email.trim().toLowerCase())
      .first<{ id: string }>();
    account = u?.id ?? null;
  }
  if (!account) return json({ error: "no such account — pass a valid email or account id" }, 404);

  const tier = resolveTier(env, b.tier);
  const token = await issueLicense(env, account, `dev_${account}`, tier);
  return json({ ok: true, account, tier: tier.id, seats: tier.hostSeats, license: token });
}

/** The Ed25519 public key (hex) the host pins to verify license tokens offline. */
export async function licensePubkey(env: Env, _req: Request): Promise<Response> {
  const { pubRaw } = await licenseKey(env);
  return json({ pubkey: hexEncode(pubRaw), alg: "ed25519" });
}

export async function getLicense(env: Env, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const account = url.searchParams.get("account");
  if (!account) return json({ error: "account required" }, 400);

  const tok = bearer(req);
  let ok = false;
  if (tok) {
    const s = await verifySession(env, tok);
    if (s?.sub === account) ok = true;
    if (!ok) {
      const lic = await verifyLicense(env, tok);
      if (lic?.account === account) ok = true;
    }
  }
  if (!ok) return json({ error: "unauthorized" }, 401);

  await ensureSelfHostedLicense(env, account);

  // Newest LIVE license: a refunded one is not an entitlement, and returning it would
  // leave the console showing an active purchase the customer no longer owns.
  const row = await env.DB.prepare(
    `SELECT signed_token, tier, quota_bytes, host_seats, purchased_at FROM licenses
     WHERE user_id = ? AND revoked_at IS NULL ORDER BY purchased_at DESC, rowid DESC LIMIT 1`,
  )
    .bind(account)
    .first<{
      signed_token: string;
      tier: string;
      quota_bytes: number;
      host_seats: number | null;
      purchased_at: number;
    }>();
  if (!row) return json({ error: "no license" }, 404);
  return json({
    license: row.signed_token,
    tier: row.tier,
    quotaBytes: row.quota_bytes,
    hostSeats: seatsFor(row.tier, row.host_seats),
    purchasedAt: row.purchased_at,
  });
}
