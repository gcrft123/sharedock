import { Icon } from "./icons";
import { FEATURES } from "../shared/features";
import type { Client } from "./data";

// Sessions panel — active sign-in sessions, derived from the account's device registry
// (login grants file access, so every signed-in device is a live session). Read-only: a
// session isn't something you "add", so there's no add affordance. The console's own device
// is marked "This device". Shows a skeleton while the registry is still loading.

export interface SessionsPanelProps {
  sessions: Client[];
  loading: boolean;
  currentId: string | null;
  sel: string | null;
  onSelect: (id: string) => void;
  onInfo: () => void;
}

export function SessionsPanel({ sessions, loading, currentId, sel, onSelect, onInfo }: SessionsPanelProps): JSX.Element {
  const cols = "12px minmax(0,1fr) auto";
  return (
    <section className="hud">
      <div className="hud-head">
        <span className="l" id="sesshead">
          &#9674; Sessions
        </span>
        <span className="hactions">
          <button className="btn btn-sm" disabled={!sel} onClick={onInfo}>
            <span>
              <Icon name="info" size={14} />
            </span>
            Info
          </button>
        </span>
      </div>
      <div className="rows" id="sessrows">
        {loading ? (
          [0, 1, 2].map((i) => (
            <div className="hrow skel-row" key={i} style={{ gridTemplateColumns: cols }} aria-hidden="true">
              <span className="skel skel-dot" />
              <span className="skel skel-line" style={{ width: "42%" }} />
              <span className="skel skel-line" style={{ width: 96, justifySelf: "end" }} />
            </div>
          ))
        ) : sessions.length === 0 ? (
          <div className="sub-h" style={{ color: "var(--faint)", padding: "10px 2px" }}>
            No active sessions.
          </div>
        ) : (
          sessions.map((c) => {
            const off = c.status === "offline";
            const tp = off ? "Offline" : FEATURES.DIRECT_P2P_TELEMETRY && c.transport === "direct" ? "Direct P2P" : "Relay";
            const current = !!currentId && c.id === currentId;
            return (
              <button
                key={c.id}
                className={`hrow ${sel === c.id ? "sel" : ""}`}
                data-dev={c.id}
                style={{ gridTemplateColumns: cols }}
                onClick={() => onSelect(c.id)}
              >
                <span className={`sdot ${off ? "unavail" : "avail"}`}></span>
                <span className="hname">
                  <b>{c.name}</b>
                  {current ? (
                    <span className="chip chip-muted" style={{ marginLeft: 9 }}>
                      This device
                    </span>
                  ) : null}
                </span>
                <span className="hcell" style={{ textAlign: "right", ...(off ? { color: "var(--faint)" } : null) }}>
                  {tp} &middot; {current ? "now" : c.seen}
                </span>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
