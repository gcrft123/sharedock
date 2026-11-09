// Sample data + derivation helpers, ported verbatim from the dashboard prototype's
// `state` object and its pure helper functions (`GB`, `onlineHosts`, `bestWrite`,
// `activeHostId`, `cap`, `hostRole`, `hex`). Phase 0 renders on this sample source (a
// "Sample data" badge is shown); a later phase swaps it for real CpClient/quota data.

import type { IconName } from "./icons";

export type Mode = "pool" | "mirror";
export type Strategy = "balanced" | "sequential";
export type HostStatus = "online" | "recon" | "offline";
export type Transport = "direct" | "relay" | "-";
export type Dir = "up" | "down";

export interface Host {
  id: string;
  name: string;
  kind: string;
  used: number;
  total: number;
  status: HostStatus;
  transport: Transport;
  read: number;
  write: number;
  seen: string;
}

export interface Client {
  id: string;
  name: string;
  kind: string;
  role?: string;
  status: "online" | "offline";
  transport: Transport;
  seen: string;
}

export interface XferCur {
  name: string;
  dir: Dir;
  host: string;
  pct: number;
  speed: number;
  size: string;
}

export interface XferHist {
  name: string;
  dir: Dir;
  host: string;
  size: string;
  seen: string;
  ok: number;
}

export interface Xfer {
  cur: XferCur | null;
  hist: XferHist[];
}

/** Live telemetry for the single connected host (from `api.getConnection()`): the real
 *  read/write rate (MB/s) and transport. Attributed to exactly one host row; every other
 *  host keeps `--` / its sample transport. Null when not connected to a real host. */
export interface LiveConn {
  hostId: string;
  read: number; // MB/s (down)
  write: number; // MB/s (up)
  direct: boolean; // real transport is direct P2P (else relay)
}

export const OTHER = ["Spare Desktop", "Closet NUC", "Backup Box", "Loft Server", "Shed Pi"];

export const INITIAL_HOSTS: Host[] = [
  { id: "a1c9f2e0", name: "Garage NUC", kind: "server", used: 880, total: 1000, status: "online", transport: "direct", read: 96, write: 70, seen: "now" },
  { id: "7fe20b31", name: "Old ThinkPad", kind: "laptop", used: 151, total: 512, status: "recon", transport: "relay", read: 28, write: 19, seen: "2m ago" },
  { id: "b30d51a9", name: "Home Server", kind: "server", used: 512, total: 2000, status: "online", transport: "direct", read: 132, write: 104, seen: "now" },
  { id: "4a2f9c00", name: "Attic Mini", kind: "server", used: 64, total: 256, status: "offline", transport: "-", read: 0, write: 0, seen: "1d ago" },
];

export const INITIAL_CLIENTS: Client[] = [
  { id: "c0ffee12", name: "Studio Mac", kind: "monitor", role: "this console", status: "online", transport: "direct", seen: "now" },
  { id: "a11ce991", name: "iPhone 15", kind: "phone", status: "online", transport: "relay", seen: "6m ago" },
  { id: "d0d0beef", name: "Field Laptop", kind: "laptop", status: "offline", transport: "-", seen: "3h ago" },
];

export const INITIAL_XFER: Xfer = {
  cur: { name: "shoot-2026-raw.zip", dir: "up", host: "Home Server", pct: 37, speed: 22.4, size: "4.1 GB" },
  hist: [
    { name: "grade-v7.mov", dir: "down", host: "Garage NUC", size: "1.8 GB", seen: "4m ago", ok: 1 },
    { name: "client-brief.pdf", dir: "up", host: "Home Server", size: "2.4 MB", seen: "17m ago", ok: 1 },
    { name: "archive-2025.tar", dir: "up", host: "Old ThinkPad", size: "12 GB", seen: "1h ago", ok: 0 },
    { name: "proxies/", dir: "down", host: "Home Server", size: "640 MB", seen: "2h ago", ok: 1 },
  ],
};

// files that cycle through the "in flight" transfer as each completes
export const XPOOL: { name: string; dir: Dir; host: string; size: string }[] = [
  { name: "shoot-2026-raw.zip", dir: "up", host: "Home Server", size: "4.1 GB" },
  { name: "edit-timeline.mov", dir: "down", host: "Garage NUC", size: "2.7 GB" },
  { name: "lightroom-cat.zip", dir: "up", host: "Home Server", size: "1.3 GB" },
  { name: "archive-q3/", dir: "down", host: "Garage NUC", size: "880 MB" },
];

export const KIC: Record<string, IconName> = {
  monitor: "monitor",
  server: "server",
  laptop: "laptop",
  phone: "phone",
};

export const GB = (g: number): string =>
  g >= 1000 ? (g / 1000).toFixed(g % 1000 ? 1 : 0) + " TB" : Math.round(g) + " GB";

export const onlineHosts = (hosts: Host[]): Host[] => hosts.filter((h) => h.status === "online");
export const availHosts = (hosts: Host[]): Host[] => hosts.filter((h) => h.status !== "offline");

// strongest-connected online host (mirror write host)
export function bestWrite(hosts: Host[]): string | null {
  const c = onlineHosts(hosts)
    .slice()
    .sort(
      (a, b) => Number(b.transport === "direct") - Number(a.transport === "direct") || b.read - a.read,
    );
  return c[0] ? c[0].id : null;
}

// the "active" host that gets the pulsing dot, per mode + pool strategy
export function activeHostId(hosts: Host[], mode: Mode, strategy: Strategy): string | null {
  const on = onlineHosts(hosts);
  if (!on.length) return null;
  if (mode === "mirror") return bestWrite(hosts); // strongest connection
  if (strategy === "sequential") {
    const f = hosts.find((h) => h.status === "online" && h.used < h.total);
    return (f || on[0]).id; // currently filling
  }
  return on.slice().sort((a, b) => a.used / a.total - b.used / b.total)[0].id; // balanced -> emptiest
}

export function cap(hosts: Host[], mode: Mode): { total: number; used: number } {
  if (mode === "mirror") {
    const min = Math.min.apply(null, hosts.map((h) => h.total));
    return { total: min, used: Math.round(min * 0.667) };
  }
  return {
    total: hosts.reduce((a, h) => a + h.total, 0),
    used: hosts.reduce((a, h) => a + h.used, 0),
  };
}

export function hostRole(h: Host, hosts: Host[], mode: Mode, strategy: Strategy): string {
  if (h.status === "offline") return "Offline";
  if (mode === "mirror") return h.id === bestWrite(hosts) ? "Write host" : "Mirror replica";
  return h.id === activeHostId(hosts, mode, strategy)
    ? strategy === "sequential"
      ? "Filling now"
      : "Next write target"
    : "Pool member";
}

// deterministic pseudo endpoint id for a newly added host
export function hex(hostsLen: number, oi: number): string {
  return Math.abs(((hostsLen + oi + 3) * 2654435761) % 0xffffffff)
    .toString(16)
    .padStart(8, "0")
    .slice(0, 8);
}
