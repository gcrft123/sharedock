// Dashboard preload cache. Onboarding calls prefetchDashboard() right after the device is
// partitioned, so the control-plane data (hosts / devices / topology) is already in flight —
// often resolved — by the time the dashboard mounts. The dashboard seeds its useAsync hooks
// from cachedSnapshot(), so the loading skeleton is only a brief fallback, and writes fresh
// results back via updateSnapshot() to keep the cache warm across mounts.

import { cp } from "../shared/cp";
import type { DiscoveredHost, DeviceInfo, Topology } from "@app/rpc-client";

export interface DashSnapshot {
  hosts?: DiscoveredHost[];
  devices?: DeviceInfo[];
  topo?: Topology;
}

const cache = new Map<string, DashSnapshot>();
const inflight = new Set<string>();

/** Kick off the control-plane fetches for an account and cache each as it resolves.
 *  Idempotent while a prefetch is already in flight for the account. */
export function prefetchDashboard(account: string | null | undefined): void {
  if (!account || inflight.has(account)) return;
  inflight.add(account);
  const snap: DashSnapshot = cache.get(account) ?? {};
  cache.set(account, snap);
  const done = () => inflight.delete(account);
  void Promise.allSettled([
    cp().listHosts(account).then((h) => (snap.hosts = h)),
    cp().listDevices().then((d) => (snap.devices = d)),
    cp().getTopology(account).then((t) => (snap.topo = t)),
  ]).then(done, done);
}

/** The cached snapshot for an account, if any prefetch (or dashboard write) has populated it. */
export function cachedSnapshot(account: string | null): DashSnapshot | null {
  return account ? cache.get(account) ?? null : null;
}

/** Merge fresh values into the cache (the dashboard calls this as its own queries resolve). */
export function updateSnapshot(account: string | null, patch: Partial<DashSnapshot>): void {
  if (!account) return;
  cache.set(account, { ...(cache.get(account) ?? {}), ...patch });
}
