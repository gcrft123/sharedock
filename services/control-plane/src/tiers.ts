/**
 * The tier catalog: the one place that decides what a purchase entitles you to.
 *
 * Sharedock is priced by HOST SEATS, not by bytes — a tier says how many machines an
 * account may enrol as hosts. The catalog lives server-side because the seat count is
 * signed into the license; a client-side table can be edited by anyone holding the app,
 * so it can never be what decides how many hosts you get.
 *
 * Each tier maps to its own Stripe price, read from env so prices can be rotated without
 * a deploy. `STRIPE_PRICE_ID` is the pre-tier single price and is honoured as a fallback,
 * so an existing single-price deployment keeps working until the three prices exist.
 */
import type { Env } from "./types";

export interface Tier {
  id: string;
  name: string;
  hostSeats: number;
  /** Env var holding this tier's Stripe price id. */
  priceEnv: "STRIPE_PRICE_SOLO" | "STRIPE_PRICE_HOME" | "STRIPE_PRICE_MAX";
}

export const TIERS: readonly Tier[] = [
  { id: "solo", name: "Solo", hostSeats: 1, priceEnv: "STRIPE_PRICE_SOLO" },
  { id: "home", name: "Home", hostSeats: 3, priceEnv: "STRIPE_PRICE_HOME" },
  { id: "max", name: "Max", hostSeats: 6, priceEnv: "STRIPE_PRICE_MAX" },
] as const;

export const DEFAULT_TIER_ID = "solo";

/**
 * The tier every account gets when billing is off (`BILLING = "off"`). It is not in
 * `TIERS` because nobody buys it, and it carries no seat count, so `seatsFor` returns
 * null and enrolment is never capped.
 */
export const SELF_HOSTED_TIER_ID = "self-hosted";

/** False when the deployment runs without billing (`BILLING = "off"`). */
export function billingEnabled(env: Env): boolean {
  return env.BILLING !== "off";
}

export function tierById(id: string | null | undefined): Tier | null {
  return TIERS.find((t) => t.id === id) ?? null;
}

/** The Stripe price for a tier, falling back to the legacy single price. */
export function priceIdFor(env: Env, tier: Tier): string | undefined {
  const perTier = (env as unknown as Record<string, string | undefined>)[tier.priceEnv];
  return perTier ?? env.STRIPE_PRICE_ID;
}

/**
 * How many hosts a license allows, or `null` for one minted before seats existed.
 *
 * Null means UNENFORCED, and that is deliberate rather than an oversight: those licenses
 * were sold as a single undifferentiated product with no host limit, and retroactively
 * capping what somebody already bought is not something we do. Every new purchase carries
 * a signed seat count, so the null case shrinks to zero on its own.
 */
export function seatsFor(tierId: string, signedSeats: number | null | undefined): number | null {
  if (typeof signedSeats === "number" && signedSeats > 0) return signedSeats;
  return tierById(tierId)?.hostSeats ?? null;
}

/**
 * Seats on an account's live license, or `null` when nothing is enforceable — no license
 * at all (dev and self-hosted installs run this way), or a pre-seats license.
 *
 * A revoked license is not counted, which means a refunded account cannot enrol new
 * hosts even before its allowlist empties.
 *
 * Ordered by insertion as well as timestamp: `purchased_at` has one-second resolution, so
 * two licenses minted in the same second tie and SQLite may return either. An account that
 * upgrades would then get its seat count from whichever row won the coin toss.
 */
export async function seatsForAccount(env: Env, account: string): Promise<number | null> {
  const row = await env.DB.prepare(
    `SELECT tier, host_seats FROM licenses
     WHERE user_id = ? AND revoked_at IS NULL ORDER BY purchased_at DESC, rowid DESC LIMIT 1`,
  )
    .bind(account)
    .first<{ tier: string; host_seats: number | null }>();
  if (!row) return null;
  return seatsFor(row.tier, row.host_seats);
}

/**
 * Hosts currently occupying a seat: approved ones only.
 *
 * Retiring a host sets `approved = 0` rather than deleting the row (its keys and history
 * stay), so counting every host row would make a retired machine hold its seat forever —
 * and the console tells people to retire a host precisely to free one. A pending host has
 * not been approved and serves nothing, so it holds no seat either.
 *
 * `exceptId` omits the device being acted on, so re-pairing or re-approving an existing
 * host is never counted twice.
 */
export async function countApprovedHosts(env: Env, account: string, exceptId?: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM devices WHERE user_id = ? AND role = 'host' AND approved = 1 AND id <> ?",
  )
    .bind(account, exceptId ?? "")
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** True when the account once had a license and every one of them is now revoked. */
export async function licenseRevoked(env: Env, account: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) AS live
     FROM licenses WHERE user_id = ?`,
  )
    .bind(account)
    .first<{ total: number; live: number | null }>();
  if (!row || row.total === 0) return false;
  return (row.live ?? 0) === 0;
}
