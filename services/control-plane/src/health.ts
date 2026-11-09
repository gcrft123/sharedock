/**
 * Knowing when it breaks.
 *
 *   GET  /api/status         (public)   is the coordination service actually working
 *   POST /api/report         (session)  a client reports a failure it hit
 *   GET  /api/reports        (secret)   what has been reported
 *
 * There was no way to learn that anything had gone wrong. No crash reporting, no error
 * reporting, and no status page for the relay and control plane, which are the only pieces
 * operated centrally and the pieces every customer depends on. The first sign of a problem
 * would have been a customer email, and until recently the product could not send or receive
 * one of those either.
 *
 * Reports are deliberately thin: a category, a short message, and the app version. No file
 * names, no paths, no keys. A failure report that leaked what somebody was storing would
 * undo the entire proposition to spare us a support round trip.
 */
import type { Env } from "./types";
import { consume, tooMany } from "./ratelimit";
import { billingEnabled } from "./tiers";
import { bearer, verifySession } from "./tokens";
import { hexEncode, json, randomBytes } from "./util";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Is the service working, as opposed to merely reachable?
 *
 * `/health` answers "this Worker is running", which is nearly free and nearly meaningless: it
 * stays green while the database is unreachable. This actually touches D1, because the honest
 * question a customer has is "is it your end or mine", and the usual way status pages lie is
 * by measuring only the part that never breaks.
 */
export async function status(env: Env, _req: Request): Promise<Response> {
  const started = Date.now();
  let db: "ok" | "down" = "down";
  let dbMs = 0;
  try {
    await env.DB.prepare("SELECT 1").first();
    db = "ok";
    dbMs = Date.now() - started;
  } catch {
    db = "down";
  }

  const components = {
    // Reached at all, since this code is executing.
    api: "ok" as const,
    database: db,
    // Configuration facts, not liveness: whether these are wired says which features can
    // work at all, which is the other half of "is it me or you".
    email: env.EMAIL ? ("configured" as const) : ("not configured" as const),
    blobStorage: env.SHARES ? ("configured" as const) : ("not configured" as const),
    billing: !billingEnabled(env)
      ? ("off" as const)
      : env.STRIPE_API_KEY
        ? ("configured" as const)
        : ("not configured" as const),
  };

  const ok = components.database === "ok";
  return json(
    {
      ok,
      // Relay health is per-account and lives in a Durable Object, so it cannot be summarised
      // here without waking every one of them. Saying so beats implying it was checked.
      note: "Relay rooms are per-account Durable Objects and are not probed by this endpoint.",
      components,
      dbLatencyMs: dbMs,
      checkedAt: new Date().toISOString(),
    },
    ok ? 200 : 503,
  );
}

/**
 * A client reporting a failure it hit.
 *
 * Session-gated and rate-limited: an open reporting endpoint is a free log-spam target, and
 * an unauthenticated one tells us nothing actionable anyway.
 */
export async function report(env: Env, req: Request): Promise<Response> {
  const tok = bearer(req);
  const s = tok ? await verifySession(env, tok) : null;
  if (!s) return json({ error: "unauthorized" }, 401);

  const rl = await consume(env, "report", s.sub, { limit: 20, windowSec: 3600 });
  if (!rl.ok) return tooMany(rl);

  const b = (await req.json().catch(() => ({}))) as {
    kind?: string;
    message?: string;
    surface?: string;
    version?: string;
  };
  if (!b.kind || !b.message) return json({ error: "kind and message required" }, 400);

  // Truncated on the way in. A stack trace or a long error can carry a path, and a bounded
  // column is a cheaper guarantee than trusting every future caller to be careful.
  const clip = (v: string | undefined, n: number) => (v ?? "").slice(0, n);

  try {
    await env.DB.prepare(
      `INSERT INTO error_report (id, user_id, kind, message, surface, version, reported_at)
       VALUES (?,?,?,?,?,?,?)`,
    )
      .bind(
        hexEncode(randomBytes(12)),
        s.sub,
        clip(b.kind, 64),
        clip(b.message, 500),
        clip(b.surface, 64),
        clip(b.version, 32),
        nowSec(),
      )
      .run();
  } catch (e) {
    // Reporting a failure must never itself be a failure the caller has to handle.
    console.log(`[report] could not store report from ${s.sub}: ${String(e)}`);
    return json({ ok: true, stored: false });
  }
  return json({ ok: true, stored: true });
}

/** What has been reported. Gated by the same secret that publishes releases. */
export async function reportList(env: Env, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const secret = env.RELEASE_TOKEN;
  if (!secret || url.searchParams.get("token") !== secret) {
    return json({ error: "forbidden" }, 403);
  }
  const rows = await env.DB.prepare(
    `SELECT kind, message, surface, version, reported_at, COUNT(*) AS n
     FROM error_report GROUP BY kind, message, surface, version
     ORDER BY MAX(reported_at) DESC LIMIT 200`,
  ).all();
  // Grouped, because the useful question is "what is failing repeatedly", not "list every
  // occurrence"; and it keeps one broken client from burying everything else.
  return json({ reports: rows.results ?? [] });
}
