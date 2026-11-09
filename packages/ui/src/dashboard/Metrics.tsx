import { cap, GB, onlineHosts, type Client, type Host, type Mode } from "./data";

// Metrics strip (#metrics) — a 6-cell hairgrid. Capacity / Used / Uptime read the live
// DriveApi when a real host is connected (`real`), Hosts/Sessions count the live arrays, and
// Latency shows the measured ping RTT. Each cell loads INDEPENDENTLY: a `ready` flag per cell
// swaps its value for a skeleton block until that cell's own data has arrived, so a slow
// source never blocks the rest of the strip.

interface Metric {
  l: string;
  v: string | number;
  u?: string;
  s: string;
  warn?: boolean;
  ready: boolean;
}

/** Live metric values sourced from the DriveApi (quota + host status). */
export interface RealMetrics {
  capacity: string; // formatBytes(quotaBytes)
  usedPct: number; // pct(usedBytes, quotaBytes)
  usedStored: string; // formatBytes(usedBytes)
  uptime: string; // formatUptime(uptimeSecs)
}

/** Per-cell readiness — false renders that cell as a skeleton until its data lands. */
export interface MetricsReady {
  cap: boolean;
  used: boolean;
  hosts: boolean;
  sessions: boolean;
  uptime: boolean;
  latency: boolean;
}

export function Metrics({
  hosts,
  clients,
  mode,
  real,
  ping,
  ready,
  demo,
}: {
  hosts: Host[];
  clients: Client[];
  mode: Mode;
  real: RealMetrics | null;
  ping: number | null;
  ready: MetricsReady;
  demo?: boolean;
}): JSX.Element {
  const c = cap(hosts, mode);
  const usedPctSample = c.total > 0 ? Math.round((c.used / c.total) * 100) : 0;
  const hOn = onlineHosts(hosts).length;
  const hRec = hosts.filter((h) => h.status === "recon").length;
  const dOn = clients.filter((x) => x.status === "online").length;

  const M: Metric[] = [
    { l: "Capacity", v: real ? real.capacity : GB(c.total), s: mode === "mirror" ? "smallest disk" : hosts.length + " disks pooled", ready: ready.cap },
    { l: "Used", v: real ? real.usedPct : usedPctSample, u: "%", s: (real ? real.usedStored : GB(c.used)) + " stored", ready: ready.used },
    { l: "Hosts online", v: hOn + " / " + hosts.length, s: hRec ? hRec + " reconnecting" : "all reachable", warn: hRec > 0, ready: ready.hosts },
    { l: "Sessions", v: dOn + " / " + clients.length, s: clients.length - dOn + " idle", ready: ready.sessions },
    { l: "Uptime", v: real ? real.uptime : demo ? "99.62" : "--", u: !real && demo ? "%" : undefined, s: real ? "since restart" : demo ? "trailing 30 days" : "not connected", ready: ready.uptime },
    { l: "Latency", v: ping == null ? "--" : ping, u: ping == null ? undefined : "ms", s: "avg to hosts", ready: ready.latency },
  ];

  return (
    <div className="hairgrid cols-6 metrics" id="metrics">
      {M.map((m, i) => (
        <div className={`mcell ${m.warn ? "warn" : ""}`} key={m.l}>
          {i === 0 ? <span className="cross">+</span> : null}
          <div className="ml">{m.l}</div>
          {m.ready ? (
            <>
              <div className="mv">
                {m.v}
                {m.u ? <em>{m.u}</em> : null}
              </div>
              <div className="ms">{m.s}</div>
            </>
          ) : (
            <>
              <div className="mv">
                <span className="skel skel-mv" />
              </div>
              <div className="ms">
                <span className="skel skel-line" style={{ width: 72 }} />
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
