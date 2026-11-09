import React from "react";
import {
  clientDeviceIdHex,
  isUnauthorized,
  loadConfig,
  loadLicense,
  loadSession,
  type DeviceInfo,
  type DiscoveredHost,
} from "@app/rpc-client";
import { signOut } from "../shared/session";
import { useAsync } from "../hooks";
import { useInterval } from "../shared/useInterval";
import { useApi } from "../shared/ApiProvider";
import { cp } from "../shared/cp";
import { deviceFor, hostLabel, hostOnline, quotaCeiling, setHostQuota } from "../shared/hostAdmin";
import { formatBytes, formatRelative } from "../format";
import { Icon } from "./icons";
import type { Mode, Strategy } from "./data";

// Settings → Hosts & devices. Every control here is wired to a real backend:
//
//   layout      cp.getTopology / cp.setTopology          (D1 account_topology)
//   allocation  DriveApi.SetQuota on the host itself     (see shared/hostAdmin)
//   retire      cp.revokeDevice                          (drops it from discovery)
//   activate    cp.approveDevice                         (new machines AND retired ones)
//   add         cp.createHostClaim                       (single-use pairing code)
//   devices     cp.revokeDevice                          (sign a client device out)
//
// Retire and activate are the same underlying flag: the control plane models a host as
// approved or not, so a retired host lands back in the "Inactive" list next to a machine
// that has never been approved. The copy says that plainly rather than inventing a
// "retired" state the backend does not have.

const GIB = 1024 ** 3;

/** Reads a slider in whole GiB so the thumb lands on round numbers, not byte noise. */
const toGib = (bytes: number) => Math.max(1, Math.round(bytes / GIB));

export function HostsDevicesPage({ active = true }: { active?: boolean } = {}): JSX.Element {
  const { api, conn, reload: reloadApi } = useApi();
  const account = loadSession()?.account ?? loadConfig()?.account ?? null;
  const license = loadLicense();
  // The signed entitlement, not a client-side tier lookup: a real license carries its own
  // seat count, and a legacy one carries null, meaning uncapped rather than zero.
  const seats = license?.hostSeats ?? null;

  const selfId = React.useMemo(() => {
    try {
      return clientDeviceIdHex();
    } catch {
      return "";
    }
  }, []);

  const hostsQ = useAsync(
    () => (account ? cp().listHosts(account) : Promise.reject(new Error("Not signed in."))),
    [account],
  );
  const devsQ = useAsync(() => cp().listDevices(), [account]);
  const topoQ = useAsync(
    () => (account ? cp().getTopology(account) : Promise.reject(new Error("Not signed in."))),
    [account],
  );

  // Both lists are control-plane mirrors of state that changes on other machines: a host
  // pairing itself, a daemon republishing its quota/disk (every 30s), another device signing
  // in. Poll so the page converges on its own — without this, a machine paired while this
  // page is open only appears after a manual reload. Paused while the settings modal is
  // closed: the page stays mounted behind it, and polling a screen nobody is looking at is
  // pure waste.
  useInterval(
    () => {
      hostsQ.reload();
      devsQ.reload();
    },
    active ? 10000 : null,
  );

  // One in-flight mutation at a time, keyed so only the acting row shows a spinner, plus the
  // last failure — surfaced verbatim so a rejected SetQuota/revoke is never silently swallowed.
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  // The page stays mounted behind the closed modal, so without this a one-off failure would
  // sit on screen forever — including after the user closed Settings and came back.
  React.useEffect(() => {
    if (active) setErr(null);
  }, [active]);

  // The device registry is strictly session-gated, so a 401 here means the ~1h session
  // lapsed. Host discovery and the storage layout authenticate with the perpetual license
  // and keep working, which is exactly what makes this worth calling out: the page looks
  // half-populated (no names, no devices, no seat count) for a reason the user can act on.
  const sessionLapsed = isUnauthorized(devsQ.error);

  const run = async (key: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      after?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const hosts = hostsQ.data ?? [];
  const devices = devsQ.data ?? null;
  // Seats are consumed by hosts that can actually serve, i.e. the approved ones `listHosts`
  // returns — retiring a host hands its seat back. Clamped because the count comes from the
  // license tier and a stale/over-provisioned account must not render "-1 seats free".
  const seatsFree = seats != null ? Math.max(0, seats - hosts.length) : 0;
  const seatsLabel =
    seatsFree === 0 ? "No seats free" : `${seatsFree} seat${seatsFree === 1 ? "" : "s"} free`;
  // listHosts returns only APPROVED hosts, so anything unapproved in the device registry is
  // either brand new or one the owner retired.
  const inactive = (devices ?? []).filter((d) => d.role === "host" && !d.approved);
  const clients = (devices ?? []).filter((d) => d.role === "client");

  // The host this console holds a session to — its quota edit reuses the live connection
  // instead of dialling a second one. Mirrors the Dashboard's resolution.
  const connectedHostId = React.useMemo<string | null>(() => {
    if (conn.mode !== "real" || !hosts.length) return null;
    const pub = loadConfig()?.hostPub ?? null;
    return hosts.find((h) => h.agreement_pub === pub)?.endpoint_id ?? hosts[0].endpoint_id;
  }, [conn.mode, hosts]);

  // --- storage layout -------------------------------------------------------------
  const mode: Mode = topoQ.data?.mode === "mirror" ? "mirror" : "pool";
  const strategy: Strategy = topoQ.data?.strategy === "sequential" ? "sequential" : "balanced";
  const pushTopology = (m: Mode, s: Strategy) =>
    run(`topo:${m}:${s}`, () => cp().setTopology(account!, { mode: m, strategy: s }), topoQ.reload);

  // --- pairing code ---------------------------------------------------------------
  const [code, setCode] = React.useState<{ code: string; expiresAt: number } | null>(null);
  const [copied, setCopied] = React.useState(false);
  const addHost = () =>
    run("add", async () => {
      const c = await cp().createHostClaim();
      setCode({ code: c.code, expiresAt: c.expiresAt * 1000 });
    });

  // --- per-host editors -----------------------------------------------------------
  const [editing, setEditing] = React.useState<string | null>(null); // endpoint id, quota editor
  const [confirming, setConfirming] = React.useState<string | null>(null); // endpoint id, retire

  // A SetQuota lands on the host immediately, but `listHosts` only mirrors what the daemon
  // last PUBLISHED — up to 30s stale. Without this the row keeps showing the old allocation
  // right after a successful apply, which reads as "nothing happened". Hold the value the
  // host actually confirmed (it clamps to its free disk, so this is its answer, not our
  // request) until the published figure catches up.
  const [applied, setApplied] = React.useState<Record<string, number>>({});
  const hostQuota = (h: DiscoveredHost) => applied[h.endpoint_id] ?? h.quota_bytes ?? 0;
  React.useEffect(() => {
    if (!hostsQ.data) return;
    setApplied((cur) => {
      const next = { ...cur };
      let changed = false;
      for (const h of hostsQ.data!) {
        if (next[h.endpoint_id] != null && next[h.endpoint_id] === (h.quota_bytes ?? 0)) {
          delete next[h.endpoint_id];
          changed = true;
        }
      }
      return changed ? next : cur;
    });
  }, [hostsQ.data]);

  const refreshAll = () => {
    hostsQ.reload();
    devsQ.reload();
    reloadApi(); // the dashboard's quota/host queries re-run too
  };

  return (
    <div className="set-page">
      {sessionLapsed ? (
        <div className="set-err" role="alert">
          <Icon name="info" size={15} />
          <span>Session expired — sign in again to manage hosts and devices.</span>
          <button className="btn btn-sm" onClick={signOut}>
            Sign in
          </button>
        </div>
      ) : (
        err && (
          <div className="set-err" role="alert">
            <Icon name="info" size={15} />
            <span>{err}</span>
            <button className="btn btn-ghost btn-sm" aria-label="Dismiss" onClick={() => setErr(null)}>
              &times;
            </button>
          </div>
        )
      )}

      {/* Layout only exists as a choice once there are two hosts to combine — below that it
          was a permanently inert control with a line of copy apologising for itself. */}
      {hosts.length >= 2 && (
      <section className="set-sec">
        <div className="set-sec-h">
          <span>Layout</span>
        </div>
        <div className="seg2">
          <button
            className={`segb ${mode === "pool" ? "sel" : ""}`}
            disabled={!account || busy != null}
            onClick={() => pushTopology("pool", strategy)}
          >
            <b>Pool</b>
            <span>Capacity adds up.</span>
          </button>
          <button
            className={`segb ${mode === "mirror" ? "sel" : ""}`}
            disabled={!account || busy != null}
            onClick={() => pushTopology("mirror", strategy)}
          >
            <b>Mirror</b>
            <span>Survives a dead machine.</span>
          </button>
        </div>
        {/* The switch now reaches the hosts (they ask the control plane who to replicate to),
            but each host reads its peer list when it starts, so the change is not instant.
            Saying that is better than a toggle that looks applied and quietly is not. */}
        {mode === "mirror" && (
          <p className="set-hint">
            Every host keeps a full copy, so one dead disk costs you nothing. Capacity is the
            smallest host, not the total. Hosts pick this up when they next start.
          </p>
        )}
        {mode === "pool" && (
          <p className="set-hint">
            Files are spread across your hosts and the capacity adds up. There is only one copy
            of each file, so a dead disk loses what was on it. Choose Mirror if that matters
            more than space.
          </p>
        )}
        {mode === "pool" && (
          <>
            <div className="set-sub-h">Fill order</div>
            <div className="seg2">
              <button
                className={`segb ${strategy === "balanced" ? "sel" : ""}`}
                disabled={!account || busy != null}
                onClick={() => pushTopology(mode, "balanced")}
              >
                <b>Balanced</b>
                <span>Emptiest first.</span>
              </button>
              <button
                className={`segb ${strategy === "sequential" ? "sel" : ""}`}
                disabled={!account || busy != null}
                onClick={() => pushTopology(mode, "sequential")}
              >
                <b>Sequential</b>
                <span>One at a time.</span>
              </button>
            </div>
          </>
        )}
      </section>
      )}

      <section className="set-sec">
        <div className="set-sec-h">
          <span>Hosts</span>
          <span className="set-sec-actions">
            {/* The license grants host SEATS, so what the owner needs before adding a machine
                is how many are left — not how many are used. */}
            {seats != null && <span className="set-note">{seatsLabel}</span>}
            <button className="btn btn-sm" disabled={busy === "add" || sessionLapsed} onClick={addHost}>
              <span className="bi">
                <Icon name="add" size={14} />
              </span>
              {busy === "add" ? "…" : "Add host"}
            </button>
          </span>
        </div>

        {code && (
          <div className="set-code">
            <div className="sc-main">
              <span className="sc-l">Pairing code</span>
              <b className="sc-code">{code.code}</b>
              {/* Kept: where the code goes, and that it dies. Everything else was padding. */}
              <span className="sc-sub">
                Enter on the new machine &middot; expires {formatRelative(code.expiresAt)}
              </span>
            </div>
            <button
              className="btn btn-sm"
              onClick={() => {
                navigator.clipboard
                  ?.writeText(code.code)
                  .then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  })
                  .catch(() => setErr("Could not copy — select the code and copy it manually."));
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button className="btn btn-ghost btn-sm" aria-label="Dismiss code" onClick={() => setCode(null)}>
              Done
            </button>
          </div>
        )}

        <div className="set-list">
          {hostsQ.loading && !hostsQ.data ? (
            <div className="set-row">
              <span className="sr-main">
                <b>Loading…</b>
              </span>
            </div>
          ) : hosts.length === 0 ? (
            <div className="set-row">
              <span className="sr-main">
                <b>No hosts yet</b>
              </span>
            </div>
          ) : (
            hosts.map((h) => (
              <HostRow
                key={h.endpoint_id}
                host={h}
                name={hostLabel(h, devices)}
                device={deviceFor(h, devices)}
                quota={hostQuota(h)}
                connected={h.endpoint_id === connectedHostId}
                sessionLapsed={sessionLapsed}
                busy={busy}
                editing={editing === h.endpoint_id}
                confirming={confirming === h.endpoint_id}
                onEdit={() => {
                  setConfirming(null);
                  setEditing((cur) => (cur === h.endpoint_id ? null : h.endpoint_id));
                }}
                onConfirmRetire={() => {
                  setEditing(null);
                  setConfirming((cur) => (cur === h.endpoint_id ? null : h.endpoint_id));
                }}
                onApplyQuota={(bytes) =>
                  run(
                    `quota:${h.endpoint_id}`,
                    async () => {
                      const q = await setHostQuota(
                        account!,
                        h,
                        bytes,
                        h.endpoint_id === connectedHostId ? api : null,
                      );
                      setApplied((cur) => ({ ...cur, [h.endpoint_id]: q.quotaBytes }));
                    },
                    () => {
                      setEditing(null);
                      refreshAll();
                    },
                  )
                }
                onRetire={() =>
                  run(`retire:${h.endpoint_id}`, () => cp().revokeDevice(h.endpoint_id), () => {
                    setConfirming(null);
                    refreshAll();
                  })
                }
              />
            ))
          )}
        </div>
      </section>

      {inactive.length > 0 && (
        <section className="set-sec">
          <div className="set-sec-h">Inactive hosts</div>
          <p className="set-hint">
            Paired but not serving. Files stay on their own disk.
          </p>
          <div className="set-list">
            {inactive.map((d) => (
              <div className="set-row" key={d.id}>
                <span className="sr-ic">
                  <Icon name="server" size={17} />
                </span>
                <span className="sr-main">
                  <b>{d.name || d.id.slice(0, 8)}</b>
                  <span>{formatRelative(d.addedAt)}</span>
                </span>
                <button
                  className="btn btn-sm"
                  disabled={busy != null || sessionLapsed}
                  onClick={() =>
                    run(`approve:${d.id}`, () => cp().approveDevice(d.id), refreshAll)
                  }
                >
                  {busy === `approve:${d.id}` ? "…" : "Activate"}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="set-sec">
        <div className="set-sec-h">Devices</div>
        {/* Adding one of your own devices needs no pairing code and no key to copy across:
            the account key travels encrypted under your password and is unwrapped locally on
            sign-in. Saying so is the whole feature. People assume there is a step here,
            because on every other tool of this shape there is one, and go looking for it. */}
        <p className="set-hint">
          To use Sharedock on another of your devices, install it there and sign in with this
          email and password. It is approved automatically and needs no pairing code. Your
          devices are not limited: only hosts use a seat.
        </p>
        <div className="set-list">
          {clients.length === 0 ? (
            <div className="set-row">
              <span className="sr-main">
                <b>{devsQ.loading ? "Loading…" : "No devices yet"}</b>
              </span>
            </div>
          ) : (
            clients.map((d) => (
              <div className="set-row" key={d.id}>
                <span className="sr-ic">
                  <Icon name="laptop" size={17} />
                </span>
                <span className="sr-main">
                  <b>
                    {d.name || "Device"}
                    {d.id === selfId ? " · this device" : ""}
                  </b>
                  {/* "Approved" was on every row and said nothing; only the exception earns words. */}
                  <span>
                    {d.approved ? "" : "Revoked · "}
                    {formatRelative(d.lastSeen)}
                  </span>
                </span>
                {d.id !== selfId && d.approved && (
                  <button
                    className="btn btn-ghost btn-sm sr-del"
                    title="Sign this device out"
                    aria-label="Sign this device out"
                    disabled={busy != null || sessionLapsed}
                    onClick={() => run(`revoke:${d.id}`, () => cp().revokeDevice(d.id), refreshAll)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function HostRow({
  host,
  name,
  device,
  quota,
  connected,
  sessionLapsed,
  busy,
  editing,
  confirming,
  onEdit,
  onConfirmRetire,
  onApplyQuota,
  onRetire,
}: {
  host: DiscoveredHost;
  name: string;
  device: DeviceInfo | undefined;
  /** The host's allocation in bytes — its just-confirmed value, else what it last published. */
  quota: number;
  connected: boolean;
  /** Session-gated actions (retire, and dialling a host we aren't connected to) can't run. */
  sessionLapsed: boolean;
  busy: string | null;
  editing: boolean;
  confirming: boolean;
  onEdit: () => void;
  onConfirmRetire: () => void;
  onApplyQuota: (bytes: number) => void;
  onRetire: () => void;
}): JSX.Element {
  const online = hostOnline(host);
  const ceiling = Math.max(quotaCeiling(host), quota);
  const [gib, setGib] = React.useState(() => toGib(quota || ceiling));
  // Re-seed the slider whenever the host republishes a different allocation, but not while
  // the owner is mid-drag (that would fight their input every 30s refresh).
  React.useEffect(() => {
    if (!editing) setGib(toGib(quota || ceiling));
  }, [quota, ceiling, editing]);

  const quotaBusy = busy === `quota:${host.endpoint_id}`;
  const retireBusy = busy === `retire:${host.endpoint_id}`;
  const maxGib = toGib(ceiling);

  return (
    <div className="set-row set-row-col">
      <div className="srh">
        <span className="sr-ic">
          <Icon name="server" size={17} />
        </span>
        <span className="sr-main">
          <b>{name}</b>
          {/* The bar below already states lent/ceiling — repeating it here was pure duplication. */}
          <span>{device ? formatRelative(device.lastSeen) : ""}</span>
        </span>
        {online ? (
          <span className="chip chip-o">
            <i></i>
            {connected ? "Connected" : "Online"}
          </span>
        ) : (
          <span className="chip chip-muted">Offline</span>
        )}
      </div>

      <div className="hbar-wrap srb">
        <span className="hbar">
          <i style={{ width: `${ceiling > 0 ? Math.min(100, Math.round((quota / ceiling) * 100)) : 0}%` }}></i>
        </span>
        <span className="hbar-num">
          {formatBytes(quota)} / {formatBytes(ceiling)}
        </span>
      </div>

      <div className="sra">
        {/* A lapsed session still allows a quota change on the host we hold a LIVE socket to
            (it reuses that connection); any other host needs a fresh relay token, and the
            control plane only mints client tokens for a valid session. */}
        <button
          className="btn btn-sm"
          disabled={busy != null || !online || (sessionLapsed && !connected)}
          onClick={onEdit}
        >
          {editing ? "Cancel" : "Adjust"}
        </button>
        <button className="btn btn-sm" disabled={busy != null || sessionLapsed} onClick={onConfirmRetire}>
          <span className="bi">
            <Icon name="retire" size={14} />
          </span>
          {confirming ? "Keep" : "Retire"}
        </button>
        {/* Why a control is greyed out. Neither chip explains a disabled button on its own. */}
        {!online && <span className="set-note">Offline — can&rsquo;t adjust</span>}
        {online && sessionLapsed && !connected && (
          <span className="set-note">Sign in to change this host</span>
        )}
      </div>

      {editing && (
        <div className="set-edit">
          <div className="alloc">
            <div className="top">
              <div className="t-stat">
                {gib}
                <em>GiB</em>
              </div>
              <span className="set-note">max {maxGib}</span>
            </div>
            <input
              className="rng"
              type="range"
              min={1}
              max={maxGib}
              step={1}
              value={Math.min(gib, maxGib)}
              disabled={quotaBusy}
              aria-label={`Storage lent by ${name}, gibibytes`}
              onChange={(e) => setGib(+e.target.value)}
            />
          </div>
          <div className="sra">
            <button
              className="btn btn-primary btn-sm"
              disabled={quotaBusy}
              onClick={() => onApplyQuota(gib * GIB)}
            >
              {quotaBusy ? "Applying…" : "Apply"}
            </button>
            {/* Dropped the clamp caveat: the row redraws with the host's real answer, which
                shows the clamp better than a sentence warning about it would. */}
          </div>
        </div>
      )}

      {confirming && (
        <div className="set-edit set-danger">
          {/* A destructive-looking action keeps its consequence, its reversibility, and the
              one genuine surprise (losing this console's own connection). Nothing else. */}
          <p className="set-hint">
            Stops serving. Moves to Inactive — reversible.
            {connected ? " Disconnects this console." : ""}
          </p>
          <div className="sra">
            <button className="btn btn-sm" disabled={retireBusy} onClick={onRetire}>
              {retireBusy ? "Retiring…" : "Retire"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
