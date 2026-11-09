// Onboarding state machine: the ObState shape, the screen-graph context (go/back/
// patch/runLoader), shared constants copied from the prototype's IIFE, the passkey +
// billing client singletons, and a handful of presentational atoms (Title/Sub/Shards)
// and async helpers (sleep/pollUntil) the screens share. Onboarding.tsx is the provider;
// each screen consumes `useOb()`.

import React from "react";
import { PasswordClient, BillingClient, loadSession } from "@app/rpc-client";
import { CONTROL_URL, cp } from "../shared/cp";

// ── screen graph ──────────────────────────────────────────────────────────────
export type ScreenId =
  | "app_signin"
  | "app_recover"
  | "app_secure"
  | "dock_intro"
  | "dock_tier"
  | "dock_where"
  | "dock_remote"
  | "dock_allocate"
  | "host_added"
  | "topology"
  | "done"
  | "host_join"
  | "host_name"
  | "host_pending"
  | "host_live";

export type Phase = "Account" | "Storage" | "Live";
export const PHASES: Phase[] = ["Account", "Storage", "Live"];

/** Per-screen chrome metadata (phase for the rail; `solo` hides the rail). */
export const SCREEN_META: Record<ScreenId, { phase: Phase; solo?: boolean }> = {
  app_signin: { phase: "Account" },
  app_recover: { phase: "Account", solo: true },
  app_secure: { phase: "Account" },
  dock_intro: { phase: "Storage" },
  dock_tier: { phase: "Storage" },
  dock_where: { phase: "Storage" },
  dock_remote: { phase: "Storage" },
  dock_allocate: { phase: "Storage" },
  host_added: { phase: "Storage" },
  topology: { phase: "Storage" },
  done: { phase: "Live" },
  host_join: { phase: "Storage", solo: true },
  host_name: { phase: "Storage", solo: true },
  host_pending: { phase: "Storage", solo: true },
  host_live: { phase: "Live", solo: true },
};

// ── state ───────────────────────────────────────────────────────────────────
export type HostKind = "this" | "other" | "joined";
export interface PendingHost {
  kind: HostKind;
  name: string;
  icon: HostIcon; // chosen on the host name+icon screen (or a kind default)
  max: number; // GB, already capped at the license quota
  cap: number; // GB currently allocated
}
export interface HostRow {
  name: string;
  kind: HostKind;
  icon: HostIcon;
  cap: number;
}

export interface ObState {
  email: string;
  account: string;
  tier: string | null;
  maxHosts: number | null;
  quotaBytes: number | null; // license quota, caps the allocate slider
  saved: boolean; // recovery-key acknowledged
  /** The recovery key, hex, held only long enough to show it once. Never persisted. */
  recoveryKey: string | null;
  hosts: HostRow[];
  mode: "pool" | "mirror" | null;
  strategy: "balanced" | "sequential";
  pending: PendingHost | null;
  otherIdx: number;
  paused: boolean;
  claimCode: string | null;
}

export function initialState(): ObState {
  return {
    email: "",
    account: "",
    tier: null,
    maxHosts: null,
    quotaBytes: null,
    saved: false,
    recoveryKey: null,
    hosts: [],
    mode: null,
    strategy: "balanced",
    pending: null,
    otherIdx: 0,
    paused: false,
    claimCode: null,
  };
}

// ── constants (ported verbatim from the prototype) ────────────────────────────
export interface Tier {
  id: string;
  n: string;
  h: number;
  p: string;
  feats: string[];
}
/**
 * Display metadata for the tiers. The seat counts here MUST match the control plane's
 * catalog (services/control-plane/src/tiers.ts), which is authoritative: it is what gets
 * signed into the license and enforced at host enrolment. This table is for rendering
 * names and prices, and `license.hostSeats` — not `tierOf(...)?.h` — is what any screen
 * showing a real entitlement must read.
 */
export const TIERS: Tier[] = [
  { id: "solo", n: "Solo", h: 1, p: "79", feats: ["1 host", "Bring your own disk", "E2EE + relay fallback"] },
  { id: "home", n: "Home", h: 3, p: "149", feats: ["Up to 3 hosts", "Pool or mirror", "Priority relay"] },
  { id: "max", n: "Max", h: 6, p: "279", feats: ["Up to 6 hosts", "Pool or mirror", "Priority relay"] },
];
/** What a deployment with billing off (`BILLING = "off"`) grants every account. Not sold. */
export const SELF_HOSTED: Tier = { id: "self-hosted", n: "Self-hosted", h: 0, p: "0", feats: ["Unlimited hosts"] };
export const tierOf = (id: string | null): Tier | null =>
  id === SELF_HOSTED.id ? SELF_HOSTED : (TIERS.find((t) => t.id === id) ?? null);

export const OTHER = ["Old ThinkPad", "Home Server", "Closet Mini", "Spare Laptop"];
export const DISK = { this: 1000, other: 512 } as const;

// ── host identity (name + icon), chosen on the host name+icon screen ─────────────
/** The icon set a host picks from — all exist in onboarding/icons.tsx. */
export type HostIcon = "laptop" | "tower" | "server" | "drive" | "phone";
export const HOST_ICONS: HostIcon[] = ["laptop", "tower", "server", "drive", "phone"];
/** Sensible default glyph per host kind, used until the owner picks one. */
export const DEFAULT_HOST_ICON: Record<HostKind, HostIcon> = {
  this: "laptop",
  other: "server",
  joined: "tower",
};

/** GB → human ("1000 GB" → "1 TB"), matching the prototype's `GB()`. */
export const GB = (g: number): string => (g >= 1000 ? (g / 1000).toFixed(g % 1000 ? 1 : 0) + " TB" : g + " GB");

/** Bytes → a free-space label, rounded UP (ceil): whole GB below a TB, 0.1-TB steps above. */
export function freeSpaceLabel(bytes: number): string {
  const gb = bytes / 1e9;
  if (gb >= 1000) return `${Math.ceil(gb / 100) / 10} TB`;
  return `${Math.max(1, Math.ceil(gb))} GB`;
}

/** Decimal-GB from a byte count (>= 50 GB floor). */
export function quotaGb(quotaBytes: number | null): number | null {
  if (!quotaBytes) return null;
  return Math.max(50, Math.floor(quotaBytes / 1e9));
}
/** A host's max lendable GB = its free disk. The license grants host SEATS, not a byte
 *  quota, so it never caps a single partition — only the machine's own disk does.
 *  (`_quotaBytes` is retained for call-site compatibility and intentionally ignored.) */
export function hostMaxGb(diskGb: number, _quotaBytes: number | null): number {
  return diskGb;
}

// ── loader messages (verbatim) ────────────────────────────────────────────────
export const MSG = {
  signin: ["Deriving your key from your password.", "Unlocking your account.", "Opening an encrypted session."],
  license: ["Verifying your license.", "Confirming your purchase.", "Unlocking host setup."],
  recover: [
    "Checking your recovery key.",
    "Unwrapping your account key on this device.",
    "Re-wrapping it under your new password.",
  ],
  provision: [
    "Minting a stable host identity.",
    "Allocating the encrypted partition.",
    "Verifying your license offline.",
    "Publishing the endpoint · going live.",
  ],
  key: ["Wrapping your key to the new device.", "Nothing readable crosses the wire.", "Delivering securely."],
  online: ["Dialing your hosts.", "Punching a direct path · relay stands by.", "Bringing your cloud online."],
  hostlive: [
    "Receiving your key, wrapped to this host.",
    "Allocating the encrypted partition.",
    "Publishing the endpoint · going live.",
  ],
};

// ── client singletons ─────────────────────────────────────────────────────────
let _pw: PasswordClient | null = null;
export function pwauth(): PasswordClient {
  return (_pw ??= new PasswordClient(CONTROL_URL));
}
let _bill: BillingClient | null = null;
export function billing(): BillingClient {
  return (_bill ??= new BillingClient({ baseUrl: CONTROL_URL, session: () => loadSession()?.token }));
}

// ── async helpers ─────────────────────────────────────────────────────────────
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Poll `fn` until it resolves to `want`, or throw after `attempts`. */
export async function pollUntil<T>(
  fn: () => Promise<T>,
  want: (v: T) => boolean,
  opts: { attempts?: number; intervalMs?: number; timeoutMsg?: string } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 48;
  const intervalMs = opts.intervalMs ?? 2500;
  for (let i = 0; i < attempts; i++) {
    const v = await fn();
    if (want(v)) return v;
    await sleep(intervalMs);
  }
  throw new Error(opts.timeoutMsg ?? "Timed out waiting for the operation to finish.");
}

// ── loader config + context ────────────────────────────────────────────────────
export type LoaderVariant = "full" | "modal";
export interface LoaderCfg {
  variant: LoaderVariant;
  messages: string[];
  /** The async work to run behind the loader. */
  run: () => Promise<void>;
  /** Called once `run` resolves (navigate / mutate state). */
  onDone: () => void;
}

export interface ObCtxValue {
  state: ObState;
  patch: (p: Partial<ObState>) => void;
  set: (updater: (s: ObState) => ObState) => void;
  go: (id: ScreenId) => void;
  back: () => void;
  canBack: boolean;
  runLoader: (cfg: LoaderCfg) => void;
  onComplete: () => void;
  /** Play the full-screen "Open Sharedock" launch animation, then hand off via onComplete. */
  launch: () => void;
}

export const ObContext = React.createContext<ObCtxValue | null>(null);

export function useOb(): ObCtxValue {
  const c = React.useContext(ObContext);
  if (!c) throw new Error("useOb() used outside <Onboarding>");
  return c;
}

/** The final "bringing your cloud online" transition. Runs a best-effort host re-list behind
 *  the full-screen loader, then lands on the completion screen. Shared by the last setup step
 *  (host_added when single, topology when multi) since the old devices step that hosted it is
 *  gone. */
export function goOnline(ctx: Pick<ObCtxValue, "state" | "runLoader" | "go">): void {
  const acct = loadSession()?.account ?? ctx.state.account;
  ctx.runLoader({
    variant: "full",
    messages: MSG.online,
    run: async () => {
      if (acct) {
        try {
          await cp().listHosts(acct);
        } catch {
          /* bringing the cloud online is best-effort here */
        }
      }
    },
    onDone: () => ctx.go("done"),
  });
}

// ── presentational atoms ────────────────────────────────────────────────────────
/** Inline style for a staggered reveal (`--d` drives the rvIn animation-delay). */
export function rv(d: number, extra?: React.CSSProperties): React.CSSProperties {
  return { ["--d" as keyof React.CSSProperties]: d, ...extra } as React.CSSProperties;
}

export function Title({ children, center }: { children: React.ReactNode; center?: boolean }): JSX.Element {
  return (
    <h1 className="o-title rv" style={rv(0, center ? { textAlign: "center" } : undefined)}>
      {children}
    </h1>
  );
}

export function Sub({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <p className="o-sub rv" style={rv(1)}>
      {children}
    </p>
  );
}

/** The four animated loader shards. */
export function Shards(): JSX.Element {
  return (
    <div className="shards">
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}
