export interface Env {
  /** Per-account Durable Object: signaling + WSS relay broker. */
  ACCOUNT: DurableObjectNamespace;
  /** Relational control data (zero-knowledge: pubkeys, licenses, share meta). */
  DB: D1Database;
  /** Static web-app assets (the SPA), served for non-API paths. Optional (API-only deploys). */
  ASSETS?: Fetcher;
  ENVIRONMENT: string;

  // App origin — used by billing for Stripe checkout redirect URLs (defaults to
  // localhost:5173 in dev). RP_ID/RP_NAME are legacy passkey config, unused now that
  // auth is master-password based.
  RP_ORIGIN?: string; // exact origin the SPA is served from, e.g. "https://app.example.com"
  RP_ID?: string; // legacy (unused)
  RP_NAME?: string; // legacy (unused)

  // Signing material (base64url). Absent → committed dev-only fallbacks (see keys.ts).
  CP_TOKEN_SECRET?: string; // HMAC secret for session/relay tokens
  CP_LICENSE_SEED?: string; // Ed25519 seed for the perpetual license key

  // Cloudflare Email Sending binding. Absent in local dev and until a domain is onboarded
  // (`wrangler email sending enable <domain>`); every send degrades to a logged no-op.
  EMAIL?: { send(msg: Record<string, unknown>): Promise<unknown> };
  EMAIL_FROM?: string; // e.g. "no-reply@sharedock.app" — must be on the onboarded domain

  // R2 bucket holding the ciphertext of LARGE share links. Optional: without it, shares
  // stay inline in D1 and keep their smaller cap rather than failing.
  SHARES?: {
    put(key: string, value: string): Promise<unknown>;
    get(key: string): Promise<{ body: ReadableStream } | null>;
    delete(key: string): Promise<void>;
  };

  // Publishing a desktop release. Absent → /api/updates refuses every publish.
  RELEASE_TOKEN?: string;

  // "off" → self-hosted mode: every account gets a free, unlimited license and the
  // console skips the purchase step. Anything else → Stripe billing (or the dev stub when
  // STRIPE_API_KEY is absent outside production). See billing.ts.
  BILLING?: string;

  // Billing (one-time purchase). Absent → checkout runs in a stubbed dev mode.
  STRIPE_API_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string; // legacy single price; used as the fallback for every tier
  // One one-time price per tier (see tiers.ts). Set these to sell Solo/Home/Max at
  // different prices; without them all three fall back to STRIPE_PRICE_ID.
  STRIPE_PRICE_SOLO?: string;
  STRIPE_PRICE_HOME?: string;
  STRIPE_PRICE_MAX?: string;
  LICENSE_QUOTA_GB?: string; // quota granted by a purchase (default 512)
  LICENSE_TIER?: string; // tier label (default "personal")

  // Guarded testing bypass: when set, POST /api/billing/dev-license with this exact
  // token mints a license WITHOUT a Stripe purchase (QA/onboarding testing). Safe in
  // prod because the secret is the only way in; unset → the endpoint is always 403.
  DEV_LICENSE_TOKEN?: string;
  /** "1" re-enables the dev-license bypass in production. Remove before selling. */
  ALLOW_DEV_LICENSE?: string;
}
