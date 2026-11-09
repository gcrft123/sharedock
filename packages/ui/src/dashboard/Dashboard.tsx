import React from "react";
import { useInterval } from "../shared/useInterval";
import { useApi } from "../shared/ApiProvider";
import { useAsync } from "../hooks";
import { cp } from "../shared/cp";
import {
  loadSession,
  loadConfig,
  clientDeviceIdHex,
  type Connection,
  type DiscoveredHost,
  type DeviceInfo,
} from "@app/rpc-client";
import { formatBytes, formatUptime, formatRelative, pct } from "../format";
import "./dashboard.css";
import {
  cap,
  hex,
  INITIAL_CLIENTS,
  INITIAL_HOSTS,
  INITIAL_XFER,
  OTHER,
  XPOOL,
  type Client,
  type Host,
  type LiveConn,
  type Mode,
  type Strategy,
  type Xfer,
} from "./data";
import { Metrics, type RealMetrics, type MetricsReady } from "./Metrics";
import { TopologyGraph } from "./TopologyGraph";
import { Throughput } from "./Throughput";
import { HostsPanel } from "./HostsPanel";
import { SessionsPanel } from "./SessionsPanel";
import { TransfersPanel } from "./TransfersPanel";
import { TerminalLog } from "./TerminalLog";
import { AddHostModal } from "./AddHostModal";
import { DetailModal, type DetailInfo } from "./DetailModal";
import { cachedSnapshot, updateSnapshot } from "./prefetch";

// The whole dashboard page except the rail. Ports the prototype's `state` object into
// React state, its `renderX` functions into the sub-components, and its two live loops
// into effects: the throughput wave feed (inside <Throughput>) and the current-transfer
// progress climb (below).
//
// Data sources are "real when available, else sample": the metrics strip reads the live
// DriveApi (quota + host status) when connected to a real host; the hosts / devices /
// topology panels attempt the control plane and fall back to the sample fixtures when it
// is unreachable (demo mode, or connected-but-control-plane-down). The dashboard stays
// fully populated and never crashes in any of the three realities.
//
// The rail (which owns nav + the settings trigger) and the settings modal are rendered
// separately by AppRoot, so this component is just the dashboard page body.

// --- control-plane -> dashboard shape adapters ------------------------------------
// The CpClient reports discovery-level facts plus each host's partition quota. Per-host
// disk usage and live read/write are NOT carried per host over this API, so `used` maps
// to zero and the live rate/transport are attributed only to the one connected host
// (see `live` below). `total` carries the real quota in BYTES (0 if unpublished) so the
// multi-host capacity math (Σ / min) runs on real quotas.
function mapHost(d: DiscoveredHost): Host {
  const recent = Date.now() - d.updated_at < 5 * 60 * 1000; // seen in the last 5 min
  return {
    id: d.endpoint_id,
    name: d.endpoint_id.slice(0, 8),
    kind: "server",
    used: 0,
    total: d.quota_bytes ?? 0, // bytes; rendered with formatBytes when control-plane hosts
    status: recent ? "online" : "offline",
    transport: "relay",
    read: 0,
    write: 0,
    seen: formatRelative(d.updated_at),
  };
}

function mapDevice(d: DeviceInfo): Client {
  return {
    id: d.id,
    name: d.name,
    kind: d.role === "host" ? "server" : "laptop",
    // Client has no "reconnecting" state; an unapproved device reads as not-yet-online.
    status: d.approved ? "online" : "offline",
    transport: "relay",
    seen: formatRelative(d.lastSeen),
  };
}

export function Dashboard({
  onOpenSettings,
}: {
  /** Open the settings modal on a category — the Hosts panel's real add/retire live there. */
  onOpenSettings?: (cat: string) => void;
} = {}): JSX.Element {
  const { api, conn, rev } = useApi();
  const account = loadSession()?.account ?? loadConfig()?.account ?? null;

  // Sample data is a DEMO-ONLY mockup now. Outside demo, the dashboard shows real data with
  // loading skeletons until each section arrives — never the fixtures.
  const isDemo = React.useMemo(() => {
    try {
      return !!localStorage.getItem("pc.demo");
    } catch {
      return false;
    }
  }, []);
  // Snapshot preloaded during onboarding (after partition), so the first paint is populated
  // and the skeleton is only a fallback.
  const cached = React.useMemo(() => cachedSnapshot(account), [account]);
  // This console's own device id — marks the "This device" session in the Sessions panel.
  const currentSessionId = React.useMemo(() => {
    try {
      return clientDeviceIdHex();
    } catch {
      return null;
    }
  }, []);

  const [mode, setMode] = React.useState<Mode>("pool");
  const [strategy, setStrategy] = React.useState<Strategy>("balanced");
  const [sel, setSel] = React.useState<string | null>(null);
  const [selDev, setSelDev] = React.useState<string | null>(null);
  const [hosts, setHosts] = React.useState<Host[]>(
    isDemo ? INITIAL_HOSTS : cached?.hosts?.map(mapHost) ?? [],
  );
  const [xfer, setXfer] = React.useState<Xfer>(INITIAL_XFER);
  const [oi, setOi] = React.useState(0);
  const [info, setInfo] = React.useState<DetailInfo>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [ping, setPing] = React.useState<number | null>(null);

  // --- real metrics: live DriveApi quota + host status (only trusted when connected) ---
  const quotaQ = useAsync(() => api.getQuota(), [rev, api]);
  const quota = quotaQ.data;
  const hostStatusQ = useAsync(() => api.getHostStatus(), [rev, api]);
  const hostStatus = hostStatusQ.data;

  // --- control plane: hosts / devices / topology, seeded from the preload cache ---
  const hostsQ = useAsync(
    () => (account ? cp().listHosts(account) : Promise.reject(new Error("no account"))),
    [account, rev],
    cached?.hosts ?? null,
  );
  const devsQ = useAsync(() => cp().listDevices(), [account, rev], cached?.devices ?? null);
  const topoQ = useAsync(
    () => (account ? cp().getTopology(account) : Promise.reject(new Error("no account"))),
    [account, rev],
    cached?.topo ?? null,
  );

  // Keep the preload cache warm with fresh results (so a later mount paints instantly).
  React.useEffect(() => {
    if (hostsQ.data) updateSnapshot(account, { hosts: hostsQ.data });
  }, [hostsQ.data, account]);
  React.useEffect(() => {
    if (devsQ.data) updateSnapshot(account, { devices: devsQ.data });
  }, [devsQ.data, account]);
  React.useEffect(() => {
    if (topoQ.data) updateSnapshot(account, { topo: topoQ.data });
  }, [topoQ.data, account]);

  // adopt discovered hosts once they load; in demo mode keep the sample/local list so add +
  // retire keep working and the panel is never empty.
  React.useEffect(() => {
    if (!isDemo && hostsQ.data && hostsQ.data.length) setHosts(hostsQ.data.map(mapHost));
  }, [hostsQ.data, isDemo]);

  // Sessions = the account's signed-in CLIENT devices (login grants access). Demo → fixtures
  // (demo wins even once devsQ resolves, so the mockup stays fully populated).
  const clients = React.useMemo<Client[]>(() => {
    if (isDemo) return INITIAL_CLIENTS;
    if (devsQ.data) return devsQ.data.filter((d) => d.role === "client").map(mapDevice);
    return [];
  }, [devsQ.data, isDemo]);

  // initialise the topology toggle from the control plane when it answers.
  React.useEffect(() => {
    const t = topoQ.data;
    if (!t) return;
    setMode(t.mode === "mirror" ? "mirror" : "pool"); // "single" collapses onto "pool"
    setStrategy(t.strategy === "sequential" ? "sequential" : "balanced");
  }, [topoQ.data]);

  // control-plane hosts present + a real host connection => this is live, not sample.
  const controlPlaneHosts = !!(hostsQ.data && hostsQ.data.length);

  // --- per-section readiness: each section skeletons independently until ITS data lands, so
  // a slow source never blocks the rest, and a not-yet-connected device shows skeletons
  // (never the sample fixtures — those are demo-only). ---
  const connecting = conn.mode === "connecting";
  const connected = conn.mode === "real";
  const hostsReady = isDemo || hostsQ.data !== null || !!hostsQ.error;
  const sessionsReady = isDemo || devsQ.data !== null || !!devsQ.error;
  const capReady = isDemo || (connected ? quota != null : hostsReady && !connecting);
  const uptimeReady = isDemo || (!connecting && (!connected || hostStatus != null));
  const latencyReady = isDemo || !connecting;
  const metricsReady: MetricsReady = {
    cap: capReady,
    used: capReady,
    hosts: hostsReady,
    sessions: sessionsReady,
    uptime: uptimeReady,
    latency: latencyReady,
  };

  // --- multi-host capacity: Σ(quota) pooled, min(quota) mirrored, over REAL quotas ---
  // Control-plane hosts carry their quota (bytes) in `total`, so `cap()` yields the
  // pool/mirror capacity directly. For a single connected host, the live getQuota is
  // authoritative. Pure demo (no control-plane hosts, not connected) falls back to the
  // sample capacity inside <Metrics> (real === null).
  const realMetrics = React.useMemo<RealMetrics | null>(() => {
    const connected = conn.mode === "real" && !!quota;
    if (!controlPlaneHosts && !connected) return null;
    const multi = !!(hostsQ.data && hostsQ.data.length > 1);
    // Single connected host: the live getQuota is authoritative. Otherwise (multiple real
    // hosts, or discovered-but-not-connected) cap(hosts) is Σ(total) pooled / min(total)
    // mirrored — bytes, over the real per-host quotas.
    const capBytes = connected && !multi ? quota!.quotaBytes : cap(hosts, mode).total;
    const usedBytes = connected ? quota!.usedBytes : 0;
    return {
      capacity: formatBytes(capBytes),
      usedPct: capBytes > 0 ? Math.round(pct(usedBytes, capBytes)) : 0,
      usedStored: formatBytes(usedBytes),
      uptime: connected && hostStatus ? formatUptime(hostStatus.uptimeSecs) : "--",
    };
  }, [conn.mode, quota, hostStatus, controlPlaneHosts, hostsQ.data, hosts, mode]);

  // --- the one connected host: match saved hostPub -> its endpoint id, else the single
  // real host, else the first real host ("the host currently being used"). Only real
  // control-plane hosts are candidates; in pure sample mode nothing is "connected". ---
  const connectedHostId = React.useMemo<string | null>(() => {
    if (conn.mode !== "real") return null;
    const raw = hostsQ.data;
    if (raw && raw.length) {
      const pub = loadConfig()?.hostPub ?? null;
      if (pub) {
        const m = raw.find((d) => d.agreement_pub === pub);
        if (m) return m.endpoint_id;
      }
      return raw[0].endpoint_id; // single host, or the host the throughput refers to
    }
    // `hostsQ` refetches whenever `rev` bumps (which the connection itself triggers), and a
    // transient failure clears its data. Don't drop `connectedHostId` to null in that window —
    // fall back to the already-rendered `hosts` list, or the connection would read as "relay"
    // (mapHost's default) even though conn.direct won the direct path.
    if (hosts.length) return hosts[0].id;
    return null;
  }, [conn.mode, hostsQ.data, hosts]);

  // --- live connection: real read/write + transport for the connected host, polled ---
  const [connLive, setConnLive] = React.useState<Connection | null>(null);
  React.useEffect(() => {
    if (conn.mode !== "real") {
      setConnLive(null);
      return;
    }
    let alive = true;
    const tick = () => {
      api
        .getConnection()
        .then((c) => {
          if (alive) setConnLive(c);
        })
        .catch(() => {
          if (alive) setConnLive(null);
        });
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [conn.mode, api, rev]);

  const live = React.useMemo<LiveConn | null>(() => {
    if (!connLive || !connectedHostId) return null;
    return {
      hostId: connectedHostId,
      read: Math.round(connLive.downBytesPerSec / (1024 * 1024)),
      write: Math.round(connLive.upBytesPerSec / (1024 * 1024)),
      // The web console's getConnection() reports RELAY; the desktop native transport sets
      // conn.direct when it won the direct-QUIC path, so trust that too.
      direct: connLive.path === "DIRECT_P2P" || (conn.mode === "real" && conn.direct),
    };
  }, [connLive, connectedHostId, conn]);

  // The host we hold a live session to is online NOW, even if its published endpoint row is
  // older than the 5-min freshness window (the daemon publishes once at startup, no
  // heartbeat). Force its status/transport from the live connection so a working drive never
  // reads "offline · 0/1". Other (merely discovered) hosts keep their freshness-based status.
  const hostsView = React.useMemo<Host[]>(() => {
    if (conn.mode !== "real" || !connectedHostId) return hosts;
    const direct = (conn.mode === "real" && conn.direct) || !!live?.direct;
    return hosts.map((h) =>
      h.id === connectedHostId
        ? {
            ...h,
            status: "online",
            transport: direct ? "direct" : "relay",
            // Live values from getQuota() are authoritative for the host we're connected to:
            // its enforced partition cap (the owner's allocation, not the license) and the
            // real stored bytes — the published endpoint row only carries the license quota
            // and `used: 0`.
            total: quota ? quota.quotaBytes : h.total,
            used: quota ? quota.usedBytes : h.used,
          }
        : h,
    );
  }, [hosts, conn.mode, connectedHostId, live, quota]);

  // --- activity log: real host events when connected; sample lines otherwise ---
  const activityQ = useAsync(() => api.getActivity(), [rev, api]);
  const activityEvents =
    conn.mode === "real" && activityQ.data && activityQ.data.length ? activityQ.data : null;

  // --- selection (toggle on/off, exactly as the delegated click handler did) ---
  const onSelectHost = (id: string) => setSel((cur) => (cur === id ? null : id));
  const onSelectDev = (id: string) => setSelDev((cur) => (cur === id ? null : id));

  // Topology mode/strategy are READ-ONLY here — `topoQ` above is the only writer of this
  // state. Settings → Hosts & devices owns changing them, so there is exactly one place that
  // pushes `setTopology` and one place that shows the trade-off between pool and mirror.

  // --- host add / retire ---
  // Both are REAL outside demo mode: adding means minting a pairing code and retiring means
  // revoking the host on the control plane, so both live in Settings → Hosts & devices where
  // the confirm + result can be shown. The sample fixtures keep their local-only playground
  // behaviour so the no-backend demo still animates.
  const onAdd = (kind: string) => {
    setHosts((prev) => {
      const id = hex(prev.length, oi);
      if (kind === "this") {
        return [
          ...prev,
          { id, name: "This Mac", kind: "monitor", used: 0, total: 1000, status: "online", transport: "direct", read: 0, write: 0, seen: "now" },
        ];
      }
      const nm = OTHER[oi % OTHER.length];
      return [
        ...prev,
        { id, name: nm, kind: "server", used: 0, total: 512, status: "online", transport: "direct", read: 0, write: 0, seen: "now" },
      ];
    });
    setOi((o) => o + 1);
    setAddOpen(false);
  };
  const onAddOpen = () => (isDemo ? setAddOpen(true) : onOpenSettings?.("devices"));
  const onRetire = () => {
    if (!sel) return;
    if (isDemo) {
      setHosts((prev) => prev.filter((h) => h.id !== sel));
      setSel(null);
      return;
    }
    // Retiring a real host revokes it account-wide and can cut this console's own
    // connection — it gets a confirm step, so hand off to the settings page.
    onOpenSettings?.("devices");
  };

  // --- detail modals (snapshot the current selection, like openHostInfo/openDevInfo) ---
  const onHostInfo = () => {
    const h = hostsView.find((x) => x.id === sel);
    if (h) setInfo({ type: "host", host: h });
  };
  const onDevInfo = () => {
    const c = clients.find((x) => x.id === selDev);
    if (c) setInfo({ type: "device", client: c });
  };

  // Escape is handled centrally by ModalProvider (shared/modal.tsx), which closes only the
  // topmost layer. This used to be a local listener claiming to close "every modal": it
  // could not reach Settings (that state lives in AppRoot), so Escape silently did nothing
  // there while its close button advertised "Esc".

  // --- ping: a real timed round-trip against the host, only while truly connected ---
  React.useEffect(() => {
    if (conn.mode !== "real") setPing(null);
  }, [conn.mode]);
  useInterval(
    async () => {
      const t0 = performance.now();
      try {
        await api.getQuota();
        setPing(Math.round(performance.now() - t0));
      } catch {
        setPing(null);
      }
    },
    conn.mode === "real" ? 4000 : null,
  );

  // --- demo only: sample transfer progress climbs to 100%, then rolls into history. Stops
  // once connected — the panel then shows the host's REAL transfers instead. ---
  const xiRef = React.useRef(1);
  useInterval(() => {
    if (!isDemo) return; // the sample transfer animation is demo-only now
    setXfer((prev) => {
      let cur = prev.cur;
      if (!cur) {
        const item = XPOOL[xiRef.current % XPOOL.length];
        xiRef.current++;
        cur = { ...item, pct: 2, speed: 22 };
      }
      const pctNext = cur.pct + Math.round(2 + Math.random() * 4);
      const speed = 18 + Math.random() * 10;
      if (pctNext >= 100) {
        const done = { name: cur.name, dir: cur.dir, host: cur.host, size: cur.size, seen: "just now", ok: 1 };
        let hist = [done, ...prev.hist];
        if (hist.length > 6) hist = hist.slice(0, 6);
        return { cur: null, hist };
      }
      return { cur: { ...cur, pct: pctNext, speed }, hist: prev.hist };
    });
  }, 1200);

  return (
    <>
      <div className="page page-scanlines">
        <header className="phead">
          <h1>Dashboard</h1>
          {isDemo ? <span className="sample">Sample data</span> : null}
        </header>

        <Metrics hosts={hostsView} clients={clients} mode={mode} real={realMetrics} ping={ping} ready={metricsReady} demo={isDemo} />

        <div className="row row-diagram">
          {hostsReady ? (
            <TopologyGraph
              hosts={hostsView}
              clients={clients}
              mode={mode}
              sel={sel}
              selDev={selDev}
              onSelectHost={onSelectHost}
              onSelectDev={onSelectDev}
            />
          ) : (
            <section className="hud skel-panel" aria-hidden="true">
              <span className="skel skel-block" style={{ height: 300 }} />
            </section>
          )}
          {hostsReady ? (
            <Throughput hosts={hostsView} clients={clients} ping={ping} />
          ) : (
            <section className="hud skel-panel" aria-hidden="true">
              <span className="skel skel-block" style={{ height: 300 }} />
            </section>
          )}
        </div>

        <HostsPanel
          hosts={hostsView}
          mode={mode}
          strategy={strategy}
          sel={sel}
          live={live}
          bytesTotals={controlPlaneHosts}
          loading={!hostsReady}
          onSelectHost={onSelectHost}
          onHostInfo={onHostInfo}
          onRetire={onRetire}
          onAddOpen={onAddOpen}
        />

        <div className="row row-split">
          <TransfersPanel
            xfer={xfer}
            real={connected}
            events={activityEvents}
            loading={!isDemo && connecting}
            demo={isDemo}
          />
          <div className="col-stack">
            <SessionsPanel
              sessions={clients}
              loading={!sessionsReady}
              currentId={currentSessionId}
              sel={selDev}
              onSelect={onSelectDev}
              onInfo={onDevInfo}
            />
            <TerminalLog hosts={hostsView} events={activityEvents} loading={!isDemo && connecting} demo={isDemo} />
          </div>
        </div>
      </div>

      <AddHostModal open={addOpen} onClose={() => setAddOpen(false)} onAdd={onAdd} />
      <DetailModal
        info={info}
        hosts={hostsView}
        mode={mode}
        strategy={strategy}
        live={live}
        bytesTotals={controlPlaneHosts}
        onClose={() => setInfo(null)}
      />
      <div className="grain" aria-hidden="true"></div>
    </>
  );
}
