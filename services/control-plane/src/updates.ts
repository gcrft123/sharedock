/**
 * The desktop update channel.
 *
 *   GET  /api/updates/:target/:version   (public)  what the app polls; 204 when current
 *   POST /api/updates                    (secret)  publish a release
 *
 * The app checks the artifact's signature against a public key compiled into the binary, so
 * this endpoint is a directory, not a trust anchor. The signing private key never reaches
 * this server: whoever controls the control plane still cannot ship anyone a malicious
 * update, which is the property worth preserving.
 */
import type { Env } from "./types";
import { json } from "./util";

/**
 * Compare dotted numeric versions. Returns >0 when `a` is newer.
 *
 * Deliberately not a full semver implementation: releases here are plain `x.y.z`, and a
 * partial semver parser that silently mishandles pre-release tags would be worse than one
 * that only claims to handle what is actually published. Non-numeric segments compare as 0,
 * so a malformed version never reads as newer than a real one.
 */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = parseInt(pa[i] ?? "0", 10);
    const nb = parseInt(pb[i] ?? "0", 10);
    const va = Number.isFinite(na) ? na : 0;
    const vb = Number.isFinite(nb) ? nb : 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

/**
 * Tauri's updater contract: 204 means "you are current", 200 with a body means "here is the
 * newer build". Anything else is treated as an error by the client and simply retried later,
 * which is the right failure mode for a background check.
 */
export async function checkUpdate(env: Env, _req: Request, target: string, current: string): Promise<Response> {
  if (!target || !current) return json({ error: "target and version required" }, 400);

  const rows = await env.DB.prepare(
    "SELECT version, url, signature, notes, pub_date FROM releases WHERE target = ?",
  )
    .bind(target)
    .all<{ version: string; url: string; signature: string; notes: string | null; pub_date: string }>();

  // Newest by version, not by insertion order: republishing an old build as a correction
  // must not offer it as an upgrade to someone already ahead of it.
  let best: { version: string; url: string; signature: string; notes: string | null; pub_date: string } | null = null;
  for (const r of rows.results ?? []) {
    if (!best || cmpVersion(r.version, best.version) > 0) best = r;
  }
  if (!best || cmpVersion(best.version, current) <= 0) {
    return new Response(null, { status: 204 });
  }
  return json({
    version: best.version,
    notes: best.notes ?? "",
    pub_date: best.pub_date,
    url: best.url,
    signature: best.signature,
  });
}

/**
 * Publish a release. Gated by `RELEASE_TOKEN`, a secret held by whoever cuts builds; without
 * it set, publishing is refused outright rather than left open.
 */
export async function publishRelease(env: Env, req: Request): Promise<Response> {
  const secret = env.RELEASE_TOKEN;
  const b = (await req.json().catch(() => ({}))) as {
    token?: string;
    version?: string;
    target?: string;
    url?: string;
    signature?: string;
    notes?: string;
    pub_date?: string;
  };
  if (!secret || !b.token || b.token !== secret) return json({ error: "forbidden" }, 403);
  if (!b.version || !b.target || !b.url || !b.signature) {
    return json({ error: "version, target, url and signature required" }, 400);
  }
  // An artifact served over plain HTTP could be swapped in transit. The signature would fail
  // and the update would be refused, but failing here says why.
  if (!/^https:\/\//.test(b.url)) return json({ error: "url must be https" }, 400);

  await env.DB.prepare(
    `INSERT INTO releases (version, target, url, signature, notes, pub_date, created_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(version, target) DO UPDATE SET
       url = excluded.url, signature = excluded.signature,
       notes = excluded.notes, pub_date = excluded.pub_date`,
  )
    .bind(
      b.version,
      b.target,
      b.url,
      b.signature,
      b.notes ?? null,
      b.pub_date ?? new Date().toISOString(),
      Math.floor(Date.now() / 1000),
    )
    .run();
  return json({ ok: true, version: b.version, target: b.target });
}
