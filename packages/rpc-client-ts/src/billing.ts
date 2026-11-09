// Billing client for the control plane's one-time-purchase flow. Onboarding calls
// checkout() then polls getLicense() until the perpetual license is minted. In dev
// (no Stripe keys) the worker returns a dev checkout URL and devComplete() mints the
// license directly. Session-gated calls carry the passkey bearer.

export interface CheckoutResult {
  /** True when the worker has no Stripe keys (dev): follow `url` then call devComplete(). */
  dev?: boolean;
  /** True when billing is off: the license already exists, so there is nothing to pay. */
  free?: boolean;
  url: string;
  id?: string;
  /** The tier the session was actually created for, echoed back by the worker. */
  tier?: string;
}

export interface License {
  license: string;
  tier: string;
  quotaBytes: number;
  /**
   * Host machines this license covers, straight from the server. `null` for a license
   * minted before seats existed, which means unlimited rather than zero — render it as
   * "unlimited", never as a cap of 0.
   */
  hostSeats: number | null;
  purchasedAt: number;
}

const LICENSE_KEY = "pc.license";

/**
 * The perpetual license, persisted in localStorage at purchase (onboarding writes it). Unlike
 * the ~1h passkey session it never expires, so account-scoped reads that must not lapse —
 * notably host discovery for the native P2P fast path — can authenticate with `.license`.
 */
export function loadLicense(): License | null {
  try {
    const s = localStorage.getItem(LICENSE_KEY);
    if (!s) return null;
    const o = JSON.parse(s) as License;
    return o && o.license ? o : null;
  } catch {
    return null;
  }
}

export interface BillingClientOptions {
  baseUrl: string;
  session?: () => string | null | undefined;
}

export class BillingClient {
  private base: string;
  constructor(private opts: BillingClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, "");
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
    const headers: Record<string, string> = {};
    const tok = this.opts.session?.();
    if (tok) headers.authorization = `Bearer ${tok}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* non-JSON */
    }
    if (!res.ok && res.status !== 404) {
      throw new Error((json.error as string) || `${method} ${path} → ${res.status}`);
    }
    return { status: res.status, json: json as T };
  }

  /**
   * Start a one-time checkout for `tier`. Real Stripe returns a hosted URL; dev returns
   * `{dev,url}`. The tier is sent to the server, which maps it to the matching Stripe
   * price and signs the seat count into the license — the client never decides seats.
   */
  async checkout(tier: string): Promise<CheckoutResult> {
    return (await this.req<CheckoutResult>("POST", "/api/billing/checkout", { tier })).json;
  }

  /** Dev-only: mint the license without Stripe (404 in production). */
  async devComplete(tier: string): Promise<{ license: string }> {
    return (await this.req<{ license: string }>("POST", "/api/billing/dev-complete", { tier })).json;
  }

  /** The account's license, or null if not purchased yet (poll after checkout). */
  async getLicense(account: string): Promise<License | null> {
    const { status, json } = await this.req<License>(
      "GET",
      `/api/license?account=${encodeURIComponent(account)}`,
    );
    if (status === 404 || !json.license) return null;
    return json;
  }
}

export function createBillingClient(opts: BillingClientOptions): BillingClient {
  return new BillingClient(opts);
}
