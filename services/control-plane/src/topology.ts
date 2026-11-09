/**
 * Per-account multi-host topology.
 *
 *   GET  /api/account/topology?account=  (session|license)  read the account's config
 *   POST /api/account/topology           (session|license)  set it
 *   GET  /api/account/peers?account=&self=  (session|license)  mirror peers for a host
 *
 * Records how the account's hosts combine:
 *   - mode:          single | pool | mirror
 *   - strategy:      balanced | sequential          (pool fill order)
 *   - capacity_mode: license | sum                  (sum = sum-of-disks, pooling)
 *
 * An account with no row behaves as single-host. The placement and replication themselves
 * happen client- and host-side, never here.
 *
 * `peers` is what connects the two. Setting mode to `mirror` in the console used to write a
 * row that nothing ever read: hosts learned their replication peers only from a `PC_PEERS`
 * environment variable set by hand, so the console offered a mode that did nothing at all.
 * A host now asks this endpoint who to mirror to.
 */
import type { Env } from "./types";
import { bearer, verifyLicense, verifySession } from "./tokens";
import { json } from "./util";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** True if the bearer is a session for, or the license of, `account`. */
async function ownsAccount(env: Env, req: Request, account: string): Promise<boolean> {
  const tok = bearer(req);
  if (!tok) return false;
  const s = await verifySession(env, tok);
  if (s?.sub === account) return true;
  const lic = await verifyLicense(env, tok);
  return lic?.account === account;
}

interface TopologyRow {
  mode: string;
  strategy: string;
  capacity_mode: string;
  updated_at: number;
}

const DEFAULT_TOPOLOGY = { mode: "single", strategy: "balanced", capacity_mode: "license" };

export async function topologyGet(env: Env, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const account = url.searchParams.get("account");
  if (!account) return json({ error: "account required" }, 400);
  if (!(await ownsAccount(env, req, account))) return json({ error: "unauthorized" }, 401);

  const row = await env.DB.prepare(
    "SELECT mode, strategy, capacity_mode, updated_at FROM account_topology WHERE account = ?",
  )
    .bind(account)
    .first<TopologyRow>();
  if (!row) return json({ account, ...DEFAULT_TOPOLOGY });
  return json({
    account,
    mode: row.mode,
    strategy: row.strategy,
    capacity_mode: row.capacity_mode,
    updated_at: row.updated_at,
  });
}

export async function topologyPut(env: Env, req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    account?: string;
    mode?: string;
    strategy?: string;
    capacity_mode?: string;
  };
  const account = body.account;
  if (!account) return json({ error: "account required" }, 400);
  if (!(await ownsAccount(env, req, account))) return json({ error: "unauthorized" }, 401);

  const mode = ["single", "pool", "mirror"].includes(body.mode ?? "") ? body.mode! : "single";
  const strategy = body.strategy === "sequential" ? "sequential" : "balanced";
  // Pooling defaults to sum-of-disks; single/mirror default to the license cap.
  let capacityMode = body.capacity_mode;
  if (capacityMode !== "sum" && capacityMode !== "license") {
    capacityMode = mode === "pool" ? "sum" : "license";
  }

  await env.DB.prepare(
    `INSERT INTO account_topology (account, mode, strategy, capacity_mode, updated_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(account) DO UPDATE SET mode=excluded.mode, strategy=excluded.strategy,
       capacity_mode=excluded.capacity_mode, updated_at=excluded.updated_at`,
  )
    .bind(account, mode, strategy, capacityMode, nowSec())
    .run();
  return json({ ok: true, account, mode, strategy, capacity_mode: capacityMode });
}

/**
 * The other approved hosts this host should replicate to.
 *
 * Empty unless the account is in `mirror` mode, so the switch in the console is what turns
 * replication on, and turning it off stops new hosts from joining the mesh.
 *
 * Returns public keys only: an endpoint id (which is also the device's public key) and the
 * X25519 agreement key its peers seal sessions to. Both are already public, and neither
 * grants access on its own — the peer still has to authorize the connection.
 */
export async function peersGet(env: Env, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const account = url.searchParams.get("account");
  if (!account) return json({ error: "account required" }, 400);
  if (!(await ownsAccount(env, req, account))) return json({ error: "unauthorized" }, 401);

  const row = await env.DB.prepare("SELECT mode FROM account_topology WHERE account = ?")
    .bind(account)
    .first<{ mode: string }>();
  const mode = row?.mode ?? DEFAULT_TOPOLOGY.mode;
  if (mode !== "mirror") return json({ mode, peers: [] });

  // Exclude the caller: a host must not try to mirror to itself.
  const self = url.searchParams.get("self") ?? "";
  const rows = await env.DB.prepare(
    `SELECT id, agreement_pub FROM devices
     WHERE user_id = ? AND role = 'host' AND approved = 1 AND id <> ? AND agreement_pub IS NOT NULL`,
  )
    .bind(account, self)
    .all<{ id: string; agreement_pub: string }>();

  return json({
    mode,
    peers: (rows.results ?? []).map((r) => ({ endpoint_id: r.id, agreement_pub: r.agreement_pub })),
  });
}
