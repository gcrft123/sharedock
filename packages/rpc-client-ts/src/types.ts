// Domain + transport types shared by every client (web SPA and Tauri desktop).
// The UI is written against `DriveApi`; a mock adapter implements it today and the
// real Iroh/relay transport implements the same shape later — the UI never changes.

export type Bytes = number;
export type UnixMillis = number;

/** How the client is currently reaching the host. Drives the "DIRECT P2P vs RELAY"
 *  telemetry that ties to the one-time-purchase relay economics. */
export type LinkPath = "DIRECT_P2P" | "RELAY" | "OFFLINE";

export interface HostStatus {
  hostId: string;
  machineName: string;
  os: string;
  appVersion: string;
  online: boolean;
  uptimeSecs: number;
  /** Free/total on the underlying physical disk the partition lives on. */
  diskFreeBytes: Bytes;
  diskTotalBytes: Bytes;
}

export interface Connection {
  path: LinkPath;
  latencyMs: number;
  /** Live transfer rates aggregated across active transfers. */
  upBytesPerSec: Bytes;
  downBytesPerSec: Bytes;
  /** Relay bytes consumed this billing-life (only accrues on RELAY fallback). */
  relayBytesUsed: Bytes;
  relayBytesIncluded: Bytes;
}

/** The "partition": a quota-limited managed slice of the host's disk. */
export interface Quota {
  usedBytes: Bytes;
  quotaBytes: Bytes;
  fileCount: number;
}

export type EntryKind = "file" | "dir";

export interface FileEntry {
  id: string;
  name: string;
  kind: EntryKind;
  sizeBytes: Bytes;
  modified: UnixMillis;
  /** Whether the entry is starred. */
  starred?: boolean;
  /**
   * Full path of this entry, e.g. "/Docs/report.pdf", when the adapter knows it.
   *
   * This is what lets a result found in a global view (Recent, Starred, Search) still be
   * renamed, opened in its folder, or downloaded with its subtree. `id` is deliberately NOT
   * used for that: the real host and the mock encode ids differently, so parsing one would
   * break against the other. Absent when talking to a host that predates the field.
   */
  path?: string;
  /** Best-effort mime/category for icon + preview selection. */
  category?: "image" | "video" | "audio" | "document" | "archive" | "code" | "folder" | "other";
}

export interface DirListing {
  path: string;
  entries: FileEntry[];
}

export type TransferDirection = "up" | "down";
export type TransferState = "active" | "queued" | "paused" | "done" | "error";

export interface Transfer {
  id: string;
  name: string;
  direction: TransferDirection;
  state: TransferState;
  progress: number; // 0..1
  bytesPerSec: Bytes;
  transferredBytes: Bytes;
  totalBytes: Bytes;
  etaSecs: number;
}

export type DeviceKind = "host" | "desktop" | "laptop" | "phone" | "web";

export interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  lastSeen: UnixMillis;
  thisDevice: boolean;
  /** Pending devices are awaiting pairing approval. */
  pending: boolean;
  /** Public-key fingerprint (also the Iroh NodeId short form). */
  fingerprint: string;
}

export type SharePerm = "view" | "edit";

export interface Share {
  id: string;
  name: string;
  url: string;
  perms: SharePerm;
  createdAt: UnixMillis;
  expiresAt: UnixMillis | null;
  accessCount: number;
}

export type ActivityKind = "upload" | "download" | "delete" | "share" | "login" | "pair" | "system";

export interface ActivityEvent {
  id: string;
  ts: UnixMillis;
  kind: ActivityKind;
  actor: string;
  detail: string;
}

/** The full surface the UI depends on. Reads first; a small set of mutations that
 *  the mock fulfils in-memory and the real host fulfils over the encrypted RPC. */
export interface DriveApi {
  /**
   * Replace an object's wrapped content key, for account-key rotation. Optional: only the
   * real adapter implements it, and rotation refuses rather than pretending against a mock.
   */
  rewrapKey?(id: string, wrappedCk: Uint8Array): Promise<void>;
  /** The stored wrapped content key and which keyring entry opens it. */
  inspectKey?(id: string): Promise<{ ck: Uint8Array; keyIndex: number; wrapped: Uint8Array }>;

  getHostStatus(): Promise<HostStatus>;
  getConnection(): Promise<Connection>;
  getQuota(): Promise<Quota>;
  /** Set the partition quota cap (owner allocation); the host clamps to the licensed ceiling. */
  setQuota(quotaBytes: number): Promise<Quota>;
  listDir(path: string): Promise<DirListing>;
  /** Recursive name search across the whole partition. */
  search(query: string): Promise<DirListing>;
  /** All starred entries (global, not one directory). */
  listStarred(): Promise<DirListing>;
  /** Most-recently-modified files (global). */
  listRecent(): Promise<DirListing>;
  getTransfers(): Promise<Transfer[]>;
  listDevices(): Promise<Device[]>;
  listShares(): Promise<Share[]>;
  getActivity(): Promise<ActivityEvent[]>;

  // mutations
  createFolder(parentPath: string, name: string): Promise<void>;
  deleteEntry(id: string): Promise<void>;
  createShare(entryId: string, perms: SharePerm): Promise<Share>;
  revokeShare(shareId: string): Promise<void>;
  approveDevice(deviceId: string): Promise<void>;
  revokeDevice(deviceId: string): Promise<void>;

  // organize (files page): move/rename, star, and recoverable soft-trash
  /** Move or rename an entry to `toParent/toName` (rename = same parent, new name). */
  move(id: string, toParent: string, toName: string): Promise<void>;
  star(id: string, on: boolean): Promise<void>;
  /** Soft-delete: move to trash (recoverable). Hard delete is `deleteEntry`. */
  trash(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  emptyTrash(): Promise<void>;
  listTrash(): Promise<DirListing>;

  // file transfer (E2EE client-side in the real adapter)
  uploadFile(parentPath: string, name: string, bytes: Uint8Array): Promise<void>;
  downloadFile(id: string): Promise<Uint8Array>;

  /** Tear down any underlying connection (real transport). Optional. */
  close?(): void;
}
