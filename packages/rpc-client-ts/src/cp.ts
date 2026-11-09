// Control-plane HTTP client for the client app: host onboarding (pairing codes +
// approval), device registry, host discovery, and multi-host topology. This is the API
// layer the Hosts panel calls — transport only. The auth/session flow (passkey login)
// lives in the app; session-gated calls take a session bearer via `opts.session()`.

export interface CpClientOptions {
  /** Control-plane base URL, e.g. `https://…workers.dev` (trailing slash optional). */
  baseUrl: string;
  /** Returns the current session bearer token, or null if not signed in. */
  session?: () => string | null | undefined;
  /**
   * Returns the account's perpetual license token, or null. Discovery (`listHosts`) prefers
   * this over the session: the session is short-lived (~1h) and, once it lapses, an expired
   * bearer 401s discovery → an empty host list → the native P2P path skips the iroh dial and
   * silently drops to the relay. The license never expires and the control plane accepts it
   * for account-scoped reads, so leaning on it keeps the fast path alive.
   */
  license?: () => string | null | undefined;
}

/** A freshly minted pairing code to show the user ("Add a storage device"). */
export interface HostClaim {
  code: string;
  expiresAt: number;
  ttl: number;
}

export interface DeviceInfo {
  id: string; // endpoint id (= device pubkey hex)
  name: string;
  /** Glyph the host picked on its name+icon screen (host devices only; undefined otherwise). */
  icon?: string;
  role: "host" | "client";
  approved: boolean;
  /** Epoch MS (normalized from the control plane's whole-seconds value). */
  addedAt: number;
  /** Epoch MS (normalized from the control plane's whole-seconds value). */
  lastSeen: number;
}

/** A host advertised for the account (only approved hosts are returned). */
export interface DiscoveredHost {
  endpoint_id: string;
  agreement_pub: string | null;
  relay_url: string | null;
  direct_addrs: string[];
  /** Epoch MS (normalized from the control plane's whole-seconds value). */
  updated_at: number;
  /** The host's partition quota in bytes (for multi-host capacity math). 0 if unpublished. */
  quota_bytes?: number;
  /** The host's free disk in bytes (the ceiling on how much it can lend). 0 if unknown. */
  disk_bytes?: number;
}

export type Mode = "single" | "pool" | "mirror";
export type Strategy = "balanced" | "sequential";
export type CapacityMode = "license" | "sum";

export interface Topology {
  account: string;
  mode: Mode;
  strategy: Strategy;
  capacity_mode: CapacityMode;
}

/** A failed control-plane call, carrying the HTTP status so callers can branch on it —
 *  notably 401, which means the ~1h session lapsed rather than "the thing doesn't exist". */
export interface AccountStatus {
  account: string;
  email: string;
  createdAt: number;
  emailVerified: boolean;
  /** False for an account created before recovery keys existed and not yet signed in since. */
  hasRecoveryKey: boolean;
}

export class CpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CpError";
  }
}

/** True when `e` is a control-plane 401 (the session expired / no valid bearer). */
export function isUnauthorized(e: unknown): boolean {
  return e instanceof CpError && e.status === 401;
}

export class CpClient {
  private base: string;
  constructor(private opts: CpClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, "");
  }

  /** Account-scoped reads/writes the control plane accepts a LICENSE for. Preferring the
   *  perpetual license over the ~1h session keeps them working after the session lapses —
   *  the same reasoning as `listHosts` (see the `license` option doc). */
  private accountBearer(): string | null {
    return this.opts.license?.() ?? this.opts.session?.() ?? null;
  }

  private async req<T>(method: string, path: string, body?: unknown, bearer?: string | null): Promise<T> {
    const headers: Record<string, string> = {};
    // An explicit `bearer` (e.g. discovery's license token) overrides the session; passing
    // null/undefined falls back to the session, so existing callers are unaffected.
    const tok = bearer ?? this.opts.session?.();
    if (tok) headers.authorization = `Bearer ${tok}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      throw new CpError((json.error as string) || `${method} ${path} → ${res.status}`, res.status);
    }
    return json as T;
  }

  // --- account ---

  /** This account's own status, for Settings. */
  me(): Promise<AccountStatus> {
    return this.req<AccountStatus>("GET", "/api/account/me");
  }

  /** Send the address-confirmation link again. */
  resendVerification(): Promise<{ ok: boolean; alreadyVerified?: boolean }> {
    return this.req("POST", "/api/auth/verify/resend", {});
  }

  /** Mail another copy of the licence. `sent:false` means mail is not configured yet. */
  resendLicense(): Promise<{ ok: boolean; sent: boolean; to: string }> {
    return this.req("POST", "/api/license/resend", {});
  }

  /** Everything the control plane holds about this account, for the user to keep. */
  exportAccount(): Promise<Record<string, unknown>> {
    return this.req("GET", "/api/account/export");
  }

  /**
   * Erase the account. Irreversible, and needs the password as well as a session, so a
   * session left open on a shared machine is not enough to destroy it.
   */
  deleteAccount(authKeyB64: string): Promise<{ ok: boolean; deleted: boolean; note: string }> {
    return this.req("DELETE", "/api/account", { auth_key: authKeyB64 });
  }

  // --- host onboarding (client-initiated "add a storage device") ---

  /** Mint a single-use pairing code to show the user. */
  createHostClaim(name?: string): Promise<HostClaim> {
    return this.req<HostClaim>("POST", "/api/host/claim", { name });
  }

  /** Validate a pairing code without redeeming it, so the host UI can reject a bad code up front. */
  checkClaim(code: string): Promise<{ valid: boolean }> {
    return this.req<{ valid: boolean }>("POST", "/api/host/claim/check", { code });
  }

  /** All of the account's devices (hosts + clients). */
  async listDevices(): Promise<DeviceInfo[]> {
    const r = await this.req<{ devices: DeviceInfo[] }>("GET", "/api/devices");
    // The control plane stores last_seen/added_at in whole SECONDS; the console works in
    // epoch-ms (Date.now, formatRelative), so normalize at the boundary — otherwise every
    // device reads as ~56 years stale ("offline").
    return (r.devices ?? []).map((d) => ({
      ...d,
      lastSeen: d.lastSeen * 1000,
      addedAt: d.addedAt * 1000,
    }));
    // (icon rides through in the spread when the control plane returns it.)
  }

  /** Hosts awaiting approval — the input to the "New storage device — Approve?" cards. */
  async pendingHosts(): Promise<DeviceInfo[]> {
    return (await this.listDevices()).filter((d) => d.role === "host" && !d.approved);
  }

  /** Approve a device (a pending host becomes discoverable + can serve). */
  approveDevice(deviceId: string): Promise<{ ok: boolean }> {
    return this.req("POST", "/api/devices/approve", { deviceId });
  }

  /**
   * Register THIS device on the account. The server auto-approves the owner's own device, so
   * hosts (which pull the approved-client list into their allowlist) accept its connections.
   * Idempotent (upsert). Without this the account has no approved clients and every host
   * rejects the console → the dashboard stays on sample data.
   */
  registerDevice(
    pubkey: string,
    opts?: { role?: "client" | "host"; name?: string; agreementPub?: string },
  ): Promise<{ ok: boolean; deviceId: string; approved: boolean }> {
    return this.req("POST", "/api/devices", {
      pubkey,
      role: opts?.role ?? "client",
      name: opts?.name,
      agreement_pub: opts?.agreementPub,
    });
  }

  /** Revoke a device (a host drops from discovery + can't publish). */
  revokeDevice(deviceId: string): Promise<{ ok: boolean }> {
    return this.req("POST", "/api/devices/revoke", { deviceId });
  }

  // --- discovery + topology (for the mount + Hosts panel) ---

  /** The account's approved hosts (endpoint id, agreement pubkey, addrs). */
  async listHosts(account: string): Promise<DiscoveredHost[]> {
    // Authenticate with the perpetual license when available, falling back to the session
    // (e.g. during onboarding, before a license exists). This is what keeps the native P2P
    // fast path from silently degrading to relay once the ~1h session expires — see the
    // `license` option doc above.
    const r = await this.req<{ hosts: DiscoveredHost[] }>(
      "GET",
      `/api/host/endpoint?account=${encodeURIComponent(account)}`,
      undefined,
      this.accountBearer(),
    );
    // updated_at comes back in whole SECONDS; the console's 5-min freshness check +
    // formatRelative work in epoch-ms. Normalize here so a just-published host isn't
    // mistaken for one last seen decades ago.
    return (r.hosts ?? []).map((h) => ({ ...h, updated_at: h.updated_at * 1000 }));
  }

  // Topology is account-scoped and the control plane accepts the license for it, so both
  // sides use `accountBearer` — the storage layout stays readable AND settable once the
  // session lapses, instead of 401ing like the strictly session-gated device registry.
  getTopology(account: string): Promise<Topology> {
    return this.req<Topology>(
      "GET",
      `/api/account/topology?account=${encodeURIComponent(account)}`,
      undefined,
      this.accountBearer(),
    );
  }

  setTopology(
    account: string,
    t: { mode: Mode; strategy?: Strategy; capacity_mode?: CapacityMode },
  ): Promise<Topology> {
    return this.req<Topology>(
      "POST",
      "/api/account/topology",
      { account, ...t },
      this.accountBearer(),
    );
  }

  // --- relay admission (production /signal requires a short-lived token) ---

  /** Mint a relay admission token for `/signal?...&token=`. The local dev relay admits
   *  tokenless connections, so this is only needed against the production control plane. */
  relayToken(account: string, role: "host" | "client" = "client", host?: string): Promise<{ token: string; ttl: number }> {
    return this.req("POST", "/api/relay/token", { account, role, host });
  }
}

export function createCpClient(opts: CpClientOptions): CpClient {
  return new CpClient(opts);
}
