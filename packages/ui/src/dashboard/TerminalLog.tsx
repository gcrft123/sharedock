import { FEATURES } from "../shared/features";
import { formatRelative } from "../format";
import { onlineHosts, type Host } from "./data";
import type { ActivityEvent } from "@app/rpc-client";

// Terminal log (#termbody). The terminal chrome (title bar + dots) always renders. When
// real host events are present (`events`, from `api.getActivity()` while connected) they
// render as log lines; otherwise the sample `sharedock log --watch` lines stand in so the
// panel is populated in demo mode. The `ACTIVITY_LOG` flag keeps the deliberate
// "coming soon" placeholder available for when the feature is switched back off.

type Line = [string, string, string, string];

function logLines(hosts: Host[]): Line[] {
  return [
    ["prompt", "$", "cmd", "sharedock log --watch"],
    ["ok", "OK", "out", "Home Server SYNCED 1.2 GB"],
    ["warn", "WARN", "out", "Old ThinkPad DIRECT LOST, on relay"],
    ["ok", "OK", "out", "Garage NUC MIRROR VERIFIED"],
    ["out", "", "out", "Old ThinkPad reconnecting, 2 retries"],
    ["ok", "OK", "out", onlineHosts(hosts).length + "/" + hosts.length + " hosts reachable"],
  ];
}

export function TerminalLog({
  hosts,
  events,
  loading,
  demo,
}: {
  hosts: Host[];
  events: ActivityEvent[] | null;
  loading?: boolean;
  demo?: boolean;
}): JSX.Element {
  const hasEvents = !!(events && events.length);
  return (
    <section className="terminal">
      <div className="term-bar">
        <span className="term-dot"></span>
        <span className="term-dot term-dot-o"></span>
        <span className="term-dot term-dot-o"></span>
        <span className="term-title">Sharedock &middot; log</span>
      </div>
      <div
        className="term-body"
        id="termbody"
        style={FEATURES.ACTIVITY_LOG ? undefined : { position: "relative", minHeight: 150 }}
      >
        {loading ? (
          [0, 1, 2, 3].map((i) => (
            <div key={i} className="skel-row" aria-hidden="true" style={{ padding: "3px 0" }}>
              <span className="skel skel-line" style={{ width: `${70 - i * 10}%` }} />
            </div>
          ))
        ) : hasEvents ? (
          // real host activity: delete reads as WARN (amber), everything else as OK (green).
          events!.map((ev) => {
            const warn = ev.kind === "delete";
            return (
              <div key={ev.id}>
                <span className={warn ? "t-warn" : "t-ok"}>{warn ? "WARN" : "OK"}</span>{" "}
                <span className="t-out">
                  {ev.detail} &middot; {formatRelative(ev.ts)}
                </span>
              </div>
            );
          })
        ) : demo && FEATURES.ACTIVITY_LOG ? (
          logLines(hosts).map((l, i) => (
            <div key={i}>
              <span className={`t-${l[0]}`}>{l[1]}</span> <span className={`t-${l[2]}`}>{l[3]}</span>
            </div>
          ))
        ) : (
          <div className="set-empty">
            <span className="se-t">Live event history</span>
            <span className="se-s">Coming soon</span>
          </div>
        )}
      </div>
    </section>
  );
}
