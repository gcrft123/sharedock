// Real host administration from the console (Settings → Hosts & devices).
//
// Quota lives on the HOST, not in the control plane: `host_endpoints.quota_bytes` is only a
// mirror the daemon republishes every 30s, so changing an allocation means a live `SetQuota`
// RPC to the machine that owns the partition. Two paths:
//
//   - the host the console already holds a session to  -> reuse that DriveApi
//   - any other host                                    -> open a short-lived relay
//     connection, send the one RPC, close it again
//
// The transient dial seals its session key to the target host's agreement pubkey, so it can
// only ever be answered by that host — a wrong-host room fails the handshake rather than
// applying the quota somewhere else. It CAN legitimately fail on an account whose hosts each
// serve their own relay room (`PC_HOST_ROOM=self`), because the browser transport dials the
// account room; callers surface the error instead of pretending it worked.

import { connectRealApi, type DeviceInfo, type DiscoveredHost, type DriveApi, type Quota } from "@app/rpc-client";
import { cp, relayOrigin } from "./cp";

/** Hosts republish every 30s; anything older than this window is treated as offline. */
export const HOST_FRESH_MS = 5 * 60 * 1000;

export function hostOnline(h: DiscoveredHost, now = Date.now()): boolean {
  return now - h.updated_at < HOST_FRESH_MS;
}

/**
 * Apply `quotaBytes` to `host`. `connected` is the live DriveApi when the console is already
 * connected to THIS host (skips the second connection). Resolves with the quota the host
 * actually applied — it clamps to its own free disk, so the reply can be lower than asked.
 */
export async function setHostQuota(
  account: string,
  host: DiscoveredHost,
  quotaBytes: number,
  connected: DriveApi | null,
): Promise<Quota> {
  if (connected) return connected.setQuota(quotaBytes);
  if (!host.agreement_pub) throw new Error("This host has not published its key yet.");
  // Production relays gate /signal on an admission token; the dev relay admits tokenless.
  const token = await cp()
    .relayToken(account, "client")
    .then((r) => r.token)
    .catch(() => undefined);
  const api = await connectRealApi(
    { relayUrl: relayOrigin(), account, hostPub: host.agreement_pub },
    undefined,
    undefined,
    token,
  );
  try {
    return await api.setQuota(quotaBytes);
  } finally {
    api.close?.();
  }
}

/**
 * The ceiling for a host's allocation slider: its free disk, but never below what it has
 * already lent (a host that filled its disk still has to render its current allocation).
 * Falls back to the current quota when the daemon could not measure the disk (0).
 */
export function quotaCeiling(h: DiscoveredHost): number {
  const disk = h.disk_bytes ?? 0;
  const quota = h.quota_bytes ?? 0;
  return Math.max(disk, quota, 1);
}

/** The device-registry row for a discovered host (carries the name + icon the owner chose). */
export function deviceFor(h: DiscoveredHost, devices: DeviceInfo[] | null): DeviceInfo | undefined {
  return devices?.find((d) => d.id === h.endpoint_id && d.role === "host");
}

/** Display name for a host: the label from the device registry, else its endpoint prefix. */
export function hostLabel(h: DiscoveredHost, devices: DeviceInfo[] | null): string {
  return deviceFor(h, devices)?.name || h.endpoint_id.slice(0, 8);
}
