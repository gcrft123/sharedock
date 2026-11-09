import { Icon } from "./icons";
import { FEATURES } from "../shared/features";
import { formatBytes } from "../format";
import { activeHostId, GB, type Host, type LiveConn, type Mode, type Strategy } from "./data";

// Hosts panel (#hostrows) + its header actions. Direct port of `renderHosts`. The
// pulsing dot marks the mode/strategy-selected "active" host; Info/Retire enable only
// with a selection.

export interface HostsPanelProps {
  hosts: Host[];
  mode: Mode;
  strategy: Strategy;
  sel: string | null;
  /** Live rate + transport for the one connected host; null in sample/demo mode. */
  live: LiveConn | null;
  /** True when hosts come from the control plane (disk figures are BYTES). */
  bytesTotals: boolean;
  /** Show a skeleton while the host list is still loading (device not yet connected). */
  loading?: boolean;
  onSelectHost: (id: string) => void;
  onHostInfo: () => void;
  onRetire: () => void;
  onAddOpen: () => void;
}

export function HostsPanel({
  hosts,
  mode,
  strategy,
  sel,
  live,
  bytesTotals,
  loading,
  onSelectHost,
  onHostInfo,
  onRetire,
  onAddOpen,
}: HostsPanelProps): JSX.Element {
  const act = activeHostId(hosts, mode, strategy);
  // Disk figures are bytes when sourced from the control plane, GB-units for samples.
  const size = (n: number) => (bytesTotals ? formatBytes(n) : GB(n));
  return (
    <section className="hud" style={{ marginBottom: 16 }}>
      <div className="hud-head">
        <span className="l" id="hostshead">
          &#9674; Hosts
        </span>
        <span className="hactions">
          <button className="btn btn-sm" data-act="hostinfo" id="hinfobtn" disabled={!sel} onClick={onHostInfo}>
            <span id="ic-hinfo">
              <Icon name="info" size={14} />
            </span>
            Info
          </button>
          <button className="btn btn-sm" data-act="retire" id="retirebtn" disabled={!sel} onClick={onRetire}>
            <span id="ic-retire">
              <Icon name="retire" size={14} />
            </span>
            Retire
          </button>
          <button className="btn btn-primary btn-sm" data-act="addopen" onClick={onAddOpen}>
            <span id="ic-add2">
              <Icon name="add" size={14} />
            </span>
            Add host
          </button>
        </span>
      </div>
      <div className="rows" id="hostrows">
        {loading
          ? [0, 1].map((i) => (
              <div className="hrow skel-row" key={i} aria-hidden="true">
                <span className="skel skel-dot" />
                <span className="skel skel-line" style={{ width: "55%" }} />
                <span className="hbar-wrap">
                  <span className="skel skel-line" style={{ width: "100%", height: 6 }} />
                </span>
                <span className="skel skel-chip" />
                <span className="skel skel-line" style={{ width: 60 }} />
                <span className="skel skel-line" style={{ width: 48 }} />
              </div>
            ))
          : hosts.map((h) => {
          const off = h.status === "offline";
          const dot = off ? "unavail" : h.id === act ? "active" : "avail"; // pulsing = active host
          const full = h.total > 0 ? Math.round((h.used / h.total) * 100) : 0;
          const barw = full >= 88 ? "warn" : "";
          const isConn = !off && live?.hostId === h.id; // the one connected host
          // Transport: the connected host shows its REAL transport (RELAY in the web
          // build — honest; direct-P2P is the native path); other hosts keep their
          // sample/relay transport.
          const showDirect = isConn ? live!.direct : FEATURES.DIRECT_P2P_TELEMETRY && h.transport === "direct";
          // Per-host throughput: only the connected host has a real rate; every other
          // host reads `-- / --` (no fabricated per-host numbers).
          const realSpeed = FEATURES.PER_HOST_THROUGHPUT && isConn && live != null;
          return (
            <button
              key={h.id}
              className={`hrow ${sel === h.id ? "sel" : ""}`}
              data-host={h.id}
              onClick={() => onSelectHost(h.id)}
            >
              <span className={`sdot ${dot}`}></span>
              <span className="hname">
                <b>{h.name}</b>
              </span>
              <span className="hbar-wrap">
                <span className={`hbar ${barw}`}>
                  <i style={{ width: `${full}%` }}></i>
                </span>
                <span className="hbar-num">
                  {size(h.used)} / {size(h.total)}
                </span>
              </span>
              <span>
                {off ? (
                  <span className="chip chip-muted">Offline</span>
                ) : showDirect ? (
                  <span className="chip chip-o">
                    <i></i>Direct P2P
                  </span>
                ) : (
                  <span className="chip chip-amber">
                    <i></i>Relay
                  </span>
                )}
              </span>
              <span className={`hspeed ${realSpeed ? "" : "off"}`}>
                {realSpeed ? `${live!.read} / ${live!.write}` : "-- / --"}
                <em>MB/s</em>
              </span>
              <span className="hcell" style={off ? { color: "var(--faint)" } : undefined}>
                {h.seen}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
