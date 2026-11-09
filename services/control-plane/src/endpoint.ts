/**
 * Host Iroh endpoint discovery / signaling (the direct-P2P fast path).
 *
 *   POST /api/host/endpoint          (license)         a host publishes its EndpointAddr
 *   GET  /api/host/endpoint?account= (session|license) a client fetches the account's hosts
 *
 * Stores ONLY public addressing: the EndpointId (= the host's device pubkey), its X25519
 * agreement pubkey (the client session handshake seals to it), direct socket addresses,
 * and a relay URL — never secrets or content keys. Multi-host: one row per (account,
 * host), so an account can run several hosts (pooling/mirroring). The host authenticates
 * with its perpetual license (which carries the account); a client reads with a session
 * for that account (or the license).
 */
import type { Env } from "./types";
import { bearer, verifyLicense, verifySession } from "./tokens";
import { json } from "./util";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** The host publishes its Iroh endpoint (authenticated by its license). */
export async function hostEndpointPut(env: Env, req: Request): Promise<Response> {
  const tok = bearer(req);
  const lic = tok ? await verifyLicense(env, tok) : null;
  if (!lic) return json({ error: "unauthorized" }, 401);

  const body = (await req.json().catch(() => ({}))) as {
    endpoint_id?: string;
    agreement_pub?: string;
    relay_url?: string;
    direct_addrs?: string[];
    quota_bytes?: number;
    disk_bytes?: number;
  };
  if (!body.endpoint_id) return json({ error: "endpoint_id required" }, 400);

  const quota = typeof body.quota_bytes === "number" && Number.isFinite(body.quota_bytes) ? body.quota_bytes : 0;
  const disk = typeof body.disk_bytes === "number" && Number.isFinite(body.disk_bytes) ? body.disk_bytes : 0;

  // Approval gate: an ONBOARDED host that isn't approved can't advertise itself. A legacy
  // host with no `devices` row (env-configured) is allowed for backward compat.
  const dev = await env.DB.prepare(
    "SELECT approved FROM devices WHERE id = ? AND user_id = ? AND role = 'host'",
  )
    .bind(body.endpoint_id, lic.account)
    .first<{ approved: number }>();
  if (dev && dev.approved !== 1) return json({ error: "host not approved" }, 403);

  const direct = JSON.stringify(Array.isArray(body.direct_addrs) ? body.direct_addrs : []);

  await env.DB.prepare(
    `INSERT INTO host_endpoints (account, endpoint_id, agreement_pub, relay_url, direct_addrs, quota_bytes, disk_bytes, updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(account, endpoint_id) DO UPDATE SET agreement_pub=excluded.agreement_pub,
       relay_url=excluded.relay_url, direct_addrs=excluded.direct_addrs, quota_bytes=excluded.quota_bytes,
       disk_bytes=excluded.disk_bytes, updated_at=excluded.updated_at`,
  )
    .bind(lic.account, body.endpoint_id, body.agreement_pub ?? null, body.relay_url ?? null, direct, quota, disk, nowSec())
    .run();
  return json({ ok: true, account: lic.account, endpoint_id: body.endpoint_id });
}

interface HostEndpointRow {
  endpoint_id: string;
  agreement_pub: string | null;
  relay_url: string | null;
  direct_addrs: string;
  quota_bytes: number | null;
  disk_bytes: number | null;
  updated_at: number;
}

function shapeHost(r: HostEndpointRow) {
  return {
    endpoint_id: r.endpoint_id,
    agreement_pub: r.agreement_pub,
    relay_url: r.relay_url,
    direct_addrs: JSON.parse(r.direct_addrs ?? "[]") as string[],
    quota_bytes: r.quota_bytes ?? 0,
    disk_bytes: r.disk_bytes ?? 0,
    updated_at: r.updated_at,
  };
}

/** A client fetches the account's host(s) to dial them directly. */
export async function hostEndpointGet(env: Env, req: Request): Promise<Response> {
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

  // Discovery gate: return only APPROVED hosts (or legacy hosts with no `devices` row).
  // Pending/revoked onboarded hosts are invisible, so clients never dial them.
  const rows = await env.DB.prepare(
    `SELECT he.endpoint_id, he.agreement_pub, he.relay_url, he.direct_addrs, he.quota_bytes, he.disk_bytes, he.updated_at
     FROM host_endpoints he
     LEFT JOIN devices d ON d.id = he.endpoint_id AND d.role = 'host'
     WHERE he.account = ? AND (d.id IS NULL OR d.approved = 1)
     ORDER BY he.updated_at`,
  )
    .bind(account)
    .all<HostEndpointRow>();
  const hosts = (rows.results ?? []).map(shapeHost);

  // Legacy single-object shape for pre-multi-host callers (?legacy=1).
  if (url.searchParams.get("legacy") === "1") {
    if (hosts.length === 0) return json({ error: "no endpoint" }, 404);
    const h = hosts[0];
    return json({
      account,
      endpoint_id: h.endpoint_id,
      relay_url: h.relay_url,
      direct_addrs: h.direct_addrs,
      quota_bytes: h.quota_bytes,
      updated_at: h.updated_at,
    });
  }
  return json({ account, hosts });
}
