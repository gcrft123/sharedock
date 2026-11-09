import { Icon } from "./icons";
import { useTransfers } from "../hooks";
import { formatBytes, formatRelative } from "../format";
import type { ActivityEvent, Transfer } from "@app/rpc-client";
import type { Dir, Xfer } from "./data";

// Transfers panel (#transfers). Direct port of `renderTransfers` — an optional in-flight
// row (progress + live speed) above the recent-transfer history. Live client transfers
// (`useTransfers()`) drive it when present; the sample `xfer` simulation is the fallback
// so the panel is never empty in demo mode.

function DirIcon({ d }: { d: Dir }): JSX.Element {
  return (
    <span className={`tdir ${d}`}>
      <Icon name={d === "up" ? "upload" : "download"} size={15} />
    </span>
  );
}

// Build the panel's view-model from the live transfer store: the first in-flight transfer
// becomes the "in flight" row; completed/errored transfers become the "recent" history.
function fromLive(live: Transfer[]): Xfer {
  const inflight = live.filter((t) => t.state === "active" || t.state === "queued" || t.state === "paused");
  const terminal = live.filter((t) => t.state === "done" || t.state === "error");
  const first = inflight[0];
  return {
    cur: first
      ? {
          name: first.name,
          dir: first.direction,
          host: "",
          size: formatBytes(first.totalBytes),
          pct: Math.round(first.progress * 100),
          speed: first.bytesPerSec / (1024 * 1024),
        }
      : null,
    hist: terminal.map((t) => ({
      name: t.name,
      dir: t.direction,
      host: "",
      size: formatBytes(t.totalBytes),
      seen: "just now",
      ok: t.state === "done" ? 1 : 0,
    })),
  };
}

// Connected view: live in-flight transfers plus the host's recent upload/download activity
// (real, cross-session), so a connected drive shows its true transfer history — never the
// demo fixtures.
function realView(live: Transfer[], events: ActivityEvent[] | null): Xfer {
  const base = fromLive(live);
  const seen = new Set(base.hist.map((h) => h.name));
  const recent = (events ?? [])
    .filter((e) => e.kind === "upload" || e.kind === "download")
    .filter((e) => !seen.has(e.detail))
    .slice(0, 6)
    .map((e) => ({
      name: e.detail,
      dir: (e.kind === "upload" ? "up" : "down") as Dir,
      host: "",
      size: "",
      seen: formatRelative(e.ts),
      ok: 1,
    }));
  return { cur: base.cur, hist: [...base.hist, ...recent].slice(0, 6) };
}

export function TransfersPanel({
  xfer,
  real,
  events,
  loading,
  demo,
}: {
  xfer: Xfer;
  real: boolean;
  events: ActivityEvent[] | null;
  loading?: boolean;
  demo?: boolean;
}): JSX.Element {
  const live = useTransfers();
  // Connected → real data (possibly empty). Demo → the sample animation so the panel reads as
  // "alive" without a backend. Otherwise (real, not-yet-connected) → live client transfers only.
  const x = real ? realView(live, events) : demo ? (live.length ? fromLive(live) : xfer) : fromLive(live);
  const empty = !loading && !x.cur && x.hist.length === 0;
  if (loading) {
    return (
      <section className="hud">
        <div className="hud-head">
          <span className="l">&#9674; Transfers</span>
        </div>
        <div id="transfers">
          <div className="sub-h">Recent</div>
          {[0, 1, 2].map((i) => (
            <div className="trow skel-row" key={i} aria-hidden="true">
              <span className="skel skel-dot" style={{ width: 22, height: 22 }} />
              <span className="skel skel-line" style={{ width: "50%" }} />
              <span className="skel skel-line" style={{ width: 80, marginLeft: "auto" }} />
            </div>
          ))}
        </div>
      </section>
    );
  }
  return (
    <section className="hud">
      <div className="hud-head">
        <span className="l">&#9674; Transfers</span>
        <span id="xfersum" style={{ color: "var(--faint)" }}></span>
      </div>
      <div id="transfers">
        {empty ? (
          <div className="sub-h" style={{ color: "var(--faint)" }}>
            No transfers yet &mdash; upload or download a file to see it here.
          </div>
        ) : null}
        {x.cur ? (
          <>
            <div className="sub-h">In flight</div>
            <div className="trow cur">
              <div className="tcur-head">
                <DirIcon d={x.cur.dir} />
                <span className="tfn">{x.cur.name}</span>
                <span className="tpct">
                  <b>{x.cur.pct}%</b> &middot; {x.cur.speed.toFixed(1)} MB/s
                </span>
              </div>
              <span className="tprog">
                <i style={{ width: `${x.cur.pct}%` }}></i>
              </span>
            </div>
          </>
        ) : null}
        {!empty && <div className="sub-h">Recent</div>}
        {x.hist.map((t, i) => (
          <div className="trow" key={i}>
            <DirIcon d={t.dir} />
            <span className="tmid">
              <b>{t.name}</b>
            </span>
            <span className="tright">
              <span className={`tstatus ${t.ok ? "ok" : "fail"}`}>{t.ok ? "Complete" : "Failed"}</span>
              <span>{t.seen}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
