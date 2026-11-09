/**
 * Device pairing + registry.
 *
 * A "device" is a host or client identified by its Ed25519 public key (= the
 * relay-handshake identity / Iroh NodeId). Pairing binds that public key to an
 * account so the host's authorization list can be built from the control plane
 * instead of the `PC_DEV_ACCEPT_ANY` dev shortcut.
 *
 *   POST /api/devices          (session)  register + approve a device you own
 *   GET  /api/devices          (session)  list this account's devices
 *   POST /api/devices/approve  (session)  approve a pending device
 *   GET  /api/account/authorized (session|license)  approved CLIENT ids for the host
 *
 * Only PUBLIC keys are stored — never secrets or content keys.
 */
import type { Env } from "./types";
import { bearer, verifyLicense, verifySession } from "./tokens";
import { countApprovedHosts, licenseRevoked, seatsForAccount } from "./tiers";
import { json } from "./util";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Resolve the account for a request from a session bearer, or null. */
async function sessionAccount(env: Env, req: Request): Promise<string | null> {
  const tok = bearer(req);
  if (!tok) return null;
  const s = await verifySession(env, tok);
  return s?.sub ?? null;
}

export async function deviceRegister(env: Env, req: Request): Promise<Response> {
  const account = await sessionAccount(env, req);
  if (!account) return json({ error: "unauthorized" }, 401);
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    role?: string;
    pubkey?: string; // hex Ed25519 id
    agreement_pub?: string; // hex X25519
  };
  const role = body.role === "host" ? "host" : "client";
  if (!body.pubkey) return json({ error: "pubkey required" }, 400);

  // This endpoint registers a device ALREADY APPROVED, so for a host it spends a seat
  // just as deviceApprove does. Without the same check here the claim-flow gate is
  // trivially bypassed by registering hosts directly.
  if (role === "host") {
    const seats = await seatsForAccount(env, account);
    if (seats !== null) {
      const used = await countApprovedHosts(env, account, body.pubkey);
      if (used >= seats) {
        return json(
          {
            error: "no host seats left",
            detail: `This license covers ${seats} host${seats === 1 ? "" : "s"}, and ${used} are already active. Retire one to free a seat, or move to a larger tier.`,
            seats,
            used,
          },
          409,
        );
      }
    }
  }

  // The owner is registering their own device → approved immediately.
  await env.DB.prepare(
    `INSERT INTO devices (id, user_id, name, role, pubkey, agreement_pub, approved, added_at, last_seen)
     VALUES (?,?,?,?,?,?,1,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, role=excluded.role,
       agreement_pub=excluded.agreement_pub, approved=1, last_seen=excluded.last_seen`,
  )
    .bind(body.pubkey, account, body.name ?? role, role, body.pubkey, body.agreement_pub ?? null, nowSec(), nowSec())
    .run();
  return json({ ok: true, deviceId: body.pubkey, approved: true });
}

export async function deviceList(env: Env, req: Request): Promise<Response> {
  const account = await sessionAccount(env, req);
  if (!account) return json({ error: "unauthorized" }, 401);
  const rows = await env.DB.prepare(
    "SELECT id, name, icon, role, approved, added_at, last_seen FROM devices WHERE user_id = ? ORDER BY added_at",
  )
    .bind(account)
    .all<{ id: string; name: string; icon: string | null; role: string; approved: number; added_at: number; last_seen: number }>();
  return json({
    devices: (rows.results ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      icon: d.icon ?? undefined,
      role: d.role,
      approved: d.approved === 1,
      addedAt: d.added_at,
      lastSeen: d.last_seen,
    })),
  });
}

export async function deviceApprove(env: Env, req: Request): Promise<Response> {
  const account = await sessionAccount(env, req);
  if (!account) return json({ error: "unauthorized" }, 401);
  const { deviceId } = (await req.json().catch(() => ({}))) as { deviceId?: string };
  if (!deviceId) return json({ error: "deviceId required" }, 400);

  // Approving a HOST is what actually spends a seat, so this is the binding check.
  // Clients are unlimited; only hosts are licensed. Already-approved hosts re-approve
  // freely (countApprovedHosts excludes this device), so this is not a toggle trap.
  const dev = await env.DB.prepare("SELECT role FROM devices WHERE id = ? AND user_id = ?")
    .bind(deviceId, account)
    .first<{ role: string }>();
  if (!dev) return json({ error: "no such device" }, 404);
  if (dev.role === "host") {
    const seats = await seatsForAccount(env, account);
    if (seats !== null) {
      const used = await countApprovedHosts(env, account, deviceId);
      if (used >= seats) {
        return json(
          {
            error: "no host seats left",
            detail: `This license covers ${seats} host${seats === 1 ? "" : "s"}, and ${used} are already active. Retire one to free a seat, or move to a larger tier.`,
            seats,
            used,
          },
          409,
        );
      }
    }
  }

  const res = await env.DB.prepare("UPDATE devices SET approved = 1 WHERE id = ? AND user_id = ?")
    .bind(deviceId, account)
    .run();
  const changed = (res.meta as { changes?: number } | undefined)?.changes ?? 0;
  if (!changed) return json({ error: "no such device" }, 404);
  return json({ ok: true });
}

/** Revoke a device (un-approve). A revoked host drops from discovery + can't publish. */
export async function deviceRevoke(env: Env, req: Request): Promise<Response> {
  const account = await sessionAccount(env, req);
  if (!account) return json({ error: "unauthorized" }, 401);
  const { deviceId } = (await req.json().catch(() => ({}))) as { deviceId?: string };
  if (!deviceId) return json({ error: "deviceId required" }, 400);
  const res = await env.DB.prepare("UPDATE devices SET approved = 0 WHERE id = ? AND user_id = ?")
    .bind(deviceId, account)
    .run();
  const changed = (res.meta as { changes?: number } | undefined)?.changes ?? 0;
  if (!changed) return json({ error: "no such device" }, 404);
  return json({ ok: true });
}

/**
 * Approved CLIENT device ids (hex) for an account — the host fetches this to
 * build its allowlist. Readable with either a session for that account or the
 * account's license token (the ids are public keys; the gate prevents
 * enumeration). Never returns private material.
 */
export async function authorizedClients(env: Env, req: Request): Promise<Response> {
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

  // A refunded or charged-back account serves nobody. Hosts re-read this list every 30
  // seconds, so an empty allowlist is what actually withdraws access from a perpetual,
  // offline-verified license. Accounts that never had a license are unaffected.
  if (await licenseRevoked(env, account)) {
    return json({ account, approved: [], revoked: true });
  }

  const rows = await env.DB.prepare(
    "SELECT id FROM devices WHERE user_id = ? AND role = 'client' AND approved = 1",
  )
    .bind(account)
    .all<{ id: string }>();
  return json({ account, approved: (rows.results ?? []).map((r) => r.id) });
}
