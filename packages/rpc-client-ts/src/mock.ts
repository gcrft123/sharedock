// In-memory mock implementation of DriveApi. Gives the UI realistic, navigable
// data with working mutations so the whole console is exercisable before any
// backend exists. Swap `createMockApi()` for the real transport later; the UI
// is unchanged.

import type {
  ActivityEvent,
  Connection,
  Device,
  DirListing,
  DriveApi,
  FileEntry,
  HostStatus,
  Quota,
  Share,
  SharePerm,
  Transfer,
} from "./types";

const GB = 1024 ** 3;
const MB = 1024 ** 2;
// Mutable so the mock reflects a demo `setQuota` (the allocation slider) like a real host.
let mockQuotaBytes = 512 * GB;
const KB = 1024;

interface Node {
  name: string;
  kind: "file" | "dir";
  sizeBytes: number;
  modified: number;
  category?: FileEntry["category"];
  starred?: boolean;
  children?: Node[];
}

const now = Date.now();
const daysAgo = (d: number) => now - d * 86_400_000;
const minsAgo = (m: number) => now - m * 60_000;

// A small but believable tree rooted at "/".
const ROOT: Node = {
  name: "",
  kind: "dir",
  sizeBytes: 0,
  modified: now,
  children: [
    {
      name: "Documents",
      kind: "dir",
      sizeBytes: 0,
      modified: daysAgo(2),
      children: [
        { name: "Q3-financials.xlsx", kind: "file", sizeBytes: 1.8 * MB, modified: daysAgo(2), category: "document" },
        { name: "lease-agreement.pdf", kind: "file", sizeBytes: 640 * KB, modified: daysAgo(18), category: "document" },
        { name: "roadmap.md", kind: "file", sizeBytes: 12 * KB, modified: minsAgo(42), category: "code" },
        {
          name: "Invoices",
          kind: "dir",
          sizeBytes: 0,
          modified: daysAgo(6),
          children: [
            { name: "2026-06.pdf", kind: "file", sizeBytes: 220 * KB, modified: daysAgo(34), category: "document" },
            { name: "2026-07.pdf", kind: "file", sizeBytes: 231 * KB, modified: daysAgo(6), category: "document" },
          ],
        },
      ],
    },
    {
      name: "Photos",
      kind: "dir",
      sizeBytes: 0,
      modified: daysAgo(1),
      children: [
        { name: "iceland-2026", kind: "dir", sizeBytes: 0, modified: daysAgo(1), children: [
          { name: "DSC_0431.raw", kind: "file", sizeBytes: 48 * MB, modified: daysAgo(1), category: "image" },
          { name: "DSC_0432.raw", kind: "file", sizeBytes: 51 * MB, modified: daysAgo(1), category: "image" },
          { name: "DSC_0433.raw", kind: "file", sizeBytes: 47 * MB, modified: daysAgo(1), category: "image" },
        ] },
        { name: "profile.jpg", kind: "file", sizeBytes: 3.1 * MB, modified: daysAgo(20), category: "image" },
      ],
    },
    {
      name: "Media",
      kind: "dir",
      sizeBytes: 0,
      modified: daysAgo(3),
      children: [
        { name: "launch-cut-v7.mov", kind: "file", sizeBytes: 8.6 * GB, modified: minsAgo(11), category: "video" },
        { name: "score-final.wav", kind: "file", sizeBytes: 412 * MB, modified: daysAgo(3), category: "audio" },
        { name: "podcast-ep12.mp3", kind: "file", sizeBytes: 88 * MB, modified: daysAgo(9), category: "audio" },
      ],
    },
    {
      name: "Projects",
      kind: "dir",
      sizeBytes: 0,
      modified: minsAgo(90),
      children: [
        { name: "personal-cloud.zip", kind: "file", sizeBytes: 1.2 * GB, modified: minsAgo(90), category: "archive" },
        { name: "notes.txt", kind: "file", sizeBytes: 4 * KB, modified: minsAgo(90), category: "document" },
      ],
    },
    { name: "backup-2026-07-01.tar.zst", kind: "file", sizeBytes: 96 * GB, modified: daysAgo(9), category: "archive" },
    { name: "README.first", kind: "file", sizeBytes: 2 * KB, modified: daysAgo(40), category: "document" },
  ],
};

function categoryOf(n: Node): FileEntry["category"] {
  if (n.kind === "dir") return "folder";
  return n.category ?? "other";
}

function normalize(path: string): string {
  if (!path || path === "/") return "/";
  return "/" + path.split("/").filter(Boolean).join("/");
}

function findDir(path: string): Node | null {
  const p = normalize(path);
  if (p === "/") return ROOT;
  let cur: Node = ROOT;
  for (const seg of p.split("/").filter(Boolean)) {
    const next = cur.children?.find((c) => c.name === seg && c.kind === "dir");
    if (!next) return null;
    cur = next;
  }
  return cur;
}

/** Recursive size for directories so the browser can show folder weights. */
function sizeOf(n: Node): number {
  if (n.kind === "file") return n.sizeBytes;
  return (n.children ?? []).reduce((s, c) => s + sizeOf(c), 0);
}

function idFor(path: string, name: string): string {
  return `${normalize(path)}::${name}`.replace(/[^\w:.-]/g, "_");
}

function toEntry(parentPath: string, n: Node): FileEntry {
  return {
    id: idFor(parentPath, n.name),
    name: n.name,
    kind: n.kind,
    sizeBytes: sizeOf(n),
    modified: n.modified,
    starred: n.starred ?? false,
    // The mock knows exactly where each node sits, so the global views behave the same
    // here as against a real host rather than degrading only in the demo.
    path: `${normalize(parentPath)}${normalize(parentPath).endsWith("/") ? "" : "/"}${n.name}`,
    category: categoryOf(n),
  };
}

/** Every entry in the tree, recursively (for global search / starred / recent views). */
function collectAll(): FileEntry[] {
  const out: FileEntry[] = [];
  const walk = (dir: Node, dirPath: string) => {
    for (const c of dir.children ?? []) {
      out.push(toEntry(dirPath, c));
      if (c.kind === "dir") walk(c, dirPath === "/" ? `/${c.name}` : `${dirPath}/${c.name}`);
    }
  };
  walk(ROOT, "/");
  return out;
}

/** Locate a node by its opaque id anywhere in the tree, tracking its parent. */
function findById(id: string): { node: Node; parentPath: string; parentDir: Node } | null {
  const walk = (dir: Node, dirPath: string): { node: Node; parentPath: string; parentDir: Node } | null => {
    for (const c of dir.children ?? []) {
      if (idFor(dirPath, c.name) === id) return { node: c, parentPath: dirPath, parentDir: dir };
      if (c.kind === "dir") {
        const childPath = dirPath === "/" ? `/${c.name}` : `${dirPath}/${c.name}`;
        const r = walk(c, childPath);
        if (r) return r;
      }
    }
    return null;
  };
  return walk(ROOT, "/");
}

function countFiles(n: Node): number {
  if (n.kind === "file") return 1;
  return (n.children ?? []).reduce((s, c) => s + countFiles(c), 0);
}

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

export function createMockApi(): DriveApi {
  // Mutable overlay state kept in-memory.
  const transfers: Transfer[] = [
    { id: "t1", name: "launch-cut-v7.mov", direction: "up", state: "active", progress: 0.62, bytesPerSec: 74 * MB, transferredBytes: 5.3 * GB, totalBytes: 8.6 * GB, etaSecs: 46 },
    { id: "t2", name: "personal-cloud.zip", direction: "down", state: "active", progress: 0.28, bytesPerSec: 39 * MB, transferredBytes: 0.34 * GB, totalBytes: 1.2 * GB, etaSecs: 22 },
    { id: "t3", name: "DSC_0433.raw", direction: "up", state: "queued", progress: 0, bytesPerSec: 0, transferredBytes: 0, totalBytes: 47 * MB, etaSecs: 0 },
  ];

  const devices: Device[] = [
    { id: "d0", name: "studio-mini (host)", kind: "host", lastSeen: now, thisDevice: false, pending: false, fingerprint: "iroh:7f3a…d21c" },
    { id: "d1", name: "studio-mbp", kind: "laptop", lastSeen: minsAgo(2), thisDevice: true, pending: false, fingerprint: "iroh:9b04…1e88" },
    { id: "d2", name: "iPhone 16 Pro", kind: "phone", lastSeen: minsAgo(35), thisDevice: false, pending: false, fingerprint: "iroh:2caa…77f0" },
    { id: "d3", name: "office-linux", kind: "desktop", lastSeen: now, thisDevice: false, pending: true, fingerprint: "iroh:4d19…ab52" },
  ];

  const shares: Share[] = [
    { id: "s1", name: "launch-cut-v7.mov", url: "https://drv.sh/x/8Kd2#…", perms: "view", createdAt: daysAgo(1), expiresAt: daysAgo(-6), accessCount: 14 },
    { id: "s2", name: "Q3-financials.xlsx", url: "https://drv.sh/x/Pq91#…", perms: "edit", createdAt: daysAgo(4), expiresAt: null, accessCount: 3 },
  ];

  // in-memory file bytes for the mock's upload/download
  const blobs = new Map<string, Uint8Array>();

  // soft-trash overlay: nodes removed from the tree but recoverable.
  const trashed: { node: Node; origParent: string; entry: FileEntry }[] = [];

  const activity: ActivityEvent[] = [
    { id: "a1", ts: minsAgo(1), kind: "upload", actor: "studio-mbp", detail: "launch-cut-v7.mov · 62% · DIRECT" },
    { id: "a2", ts: minsAgo(3), kind: "login", actor: "web", detail: "session opened · passkey OK" },
    { id: "a3", ts: minsAgo(35), kind: "download", actor: "iPhone 16 Pro", detail: "score-final.wav · RELAY" },
    { id: "a4", ts: minsAgo(58), kind: "share", actor: "studio-mbp", detail: "created link · Q3-financials.xlsx" },
    { id: "a5", ts: minsAgo(90), kind: "pair", actor: "system", detail: "office-linux requested pairing" },
  ];

  return {
    async getHostStatus(): Promise<HostStatus> {
      await delay();
      return {
        hostId: "host_7f3a",
        machineName: "studio-mini",
        os: "macOS 15.5",
        appVersion: "0.1.0-dev",
        online: true,
        uptimeSecs: 6 * 86400 + 4 * 3600 + 12 * 60,
        diskFreeBytes: 1.61 * 1024 * GB,
        diskTotalBytes: 2 * 1024 * GB,
      };
    },
    async getConnection(): Promise<Connection> {
      await delay();
      return {
        path: "DIRECT_P2P",
        latencyMs: 3,
        upBytesPerSec: 74 * MB,
        downBytesPerSec: 39 * MB,
        relayBytesUsed: 2.4 * GB,
        relayBytesIncluded: 50 * GB,
      };
    },
    async getQuota(): Promise<Quota> {
      await delay();
      return { usedBytes: sizeOf(ROOT), quotaBytes: mockQuotaBytes, fileCount: countFiles(ROOT) };
    },
    async setQuota(quotaBytes: number): Promise<Quota> {
      await delay();
      mockQuotaBytes = quotaBytes;
      return { usedBytes: sizeOf(ROOT), quotaBytes: mockQuotaBytes, fileCount: countFiles(ROOT) };
    },
    async listDir(path: string): Promise<DirListing> {
      await delay();
      const dir = findDir(path);
      const p = normalize(path);
      if (!dir) return { path: p, entries: [] };
      const entries = (dir.children ?? [])
        .map((c) => toEntry(p, c))
        // dirs first, then alpha
        .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
      return { path: p, entries };
    },
    async search(query: string): Promise<DirListing> {
      await delay();
      const q = query.trim().toLowerCase();
      const entries = q ? collectAll().filter((e) => e.name.toLowerCase().includes(q)) : [];
      return { path: "search", entries };
    },
    async listStarred(): Promise<DirListing> {
      await delay();
      return { path: "starred", entries: collectAll().filter((e) => e.starred) };
    },
    async listRecent(): Promise<DirListing> {
      await delay();
      const files = collectAll()
        .filter((e) => e.kind === "file")
        .sort((a, b) => b.modified - a.modified)
        .slice(0, 100);
      return { path: "recent", entries: files };
    },
    async getTransfers(): Promise<Transfer[]> {
      await delay();
      return transfers.slice();
    },
    async listDevices(): Promise<Device[]> {
      await delay();
      return devices.slice();
    },
    async listShares(): Promise<Share[]> {
      await delay();
      return shares.slice();
    },
    async getActivity(): Promise<ActivityEvent[]> {
      await delay();
      return activity.slice();
    },

    async createFolder(parentPath: string, name: string): Promise<void> {
      await delay();
      const dir = findDir(parentPath);
      if (!dir) return;
      dir.children = dir.children ?? [];
      if (!dir.children.some((c) => c.name === name)) {
        dir.children.push({ name, kind: "dir", sizeBytes: 0, modified: Date.now(), children: [] });
      }
    },
    async deleteEntry(id: string): Promise<void> {
      await delay();
      // id is "<parentPath>::<name>"
      const [parentPath, name] = id.split("::");
      const dir = findDir(parentPath.replace(/_/g, "/"));
      if (dir?.children) dir.children = dir.children.filter((c) => c.name !== name);
    },
    async createShare(entryId: string, perms: SharePerm): Promise<Share> {
      await delay();
      const name = entryId.split("::")[1] ?? "item";
      const share: Share = {
        id: "s" + (shares.length + 1),
        name,
        url: "https://drv.sh/x/" + Math.random().toString(36).slice(2, 6) + "#…",
        perms,
        createdAt: Date.now(),
        expiresAt: null,
        accessCount: 0,
      };
      shares.push(share);
      return share;
    },
    async revokeShare(shareId: string): Promise<void> {
      await delay();
      const i = shares.findIndex((s) => s.id === shareId);
      if (i >= 0) shares.splice(i, 1);
    },
    async approveDevice(deviceId: string): Promise<void> {
      await delay();
      const d = devices.find((x) => x.id === deviceId);
      if (d) d.pending = false;
    },
    async revokeDevice(deviceId: string): Promise<void> {
      await delay();
      const i = devices.findIndex((x) => x.id === deviceId);
      if (i >= 0) devices.splice(i, 1);
    },

    async move(id: string, toParent: string, toName: string): Promise<void> {
      await delay();
      const f = findById(id);
      if (!f) return;
      const dest = findDir(toParent);
      if (!dest) return;
      const oldId = idFor(f.parentPath, f.node.name);
      f.parentDir.children = (f.parentDir.children ?? []).filter((c) => c !== f.node);
      f.node.name = toName;
      dest.children = (dest.children ?? []).filter((c) => c.name !== toName);
      dest.children.push(f.node);
      const newId = idFor(toParent, toName);
      const b = blobs.get(oldId);
      if (b) {
        blobs.set(newId, b);
        blobs.delete(oldId);
      }
    },
    async star(id: string, on: boolean): Promise<void> {
      await delay();
      const f = findById(id);
      if (f) f.node.starred = on;
    },
    async trash(id: string): Promise<void> {
      await delay();
      const f = findById(id);
      if (!f) return;
      f.parentDir.children = (f.parentDir.children ?? []).filter((c) => c !== f.node);
      trashed.push({ node: f.node, origParent: f.parentPath, entry: toEntry(f.parentPath, f.node) });
    },
    async restore(id: string): Promise<void> {
      await delay();
      const i = trashed.findIndex((t) => t.entry.id === id);
      if (i < 0) return;
      const [t] = trashed.splice(i, 1);
      const dir = findDir(t.origParent);
      if (dir) {
        dir.children = dir.children ?? [];
        dir.children.push(t.node);
      }
    },
    async emptyTrash(): Promise<void> {
      await delay();
      trashed.length = 0;
    },
    async listTrash(): Promise<DirListing> {
      await delay();
      return { path: "trash", entries: trashed.map((t) => t.entry) };
    },

    async uploadFile(parentPath: string, name: string, bytes: Uint8Array): Promise<void> {
      await delay();
      const dir = findDir(parentPath);
      if (!dir) return;
      dir.children = (dir.children ?? []).filter((c) => c.name !== name);
      dir.children.push({ name, kind: "file", sizeBytes: bytes.length, modified: Date.now(), category: "other" });
      blobs.set(idFor(parentPath, name), bytes.slice());
    },
    async downloadFile(id: string): Promise<Uint8Array> {
      await delay();
      return blobs.get(id) ?? new Uint8Array();
    },
  };
}
