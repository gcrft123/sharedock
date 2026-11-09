import React from "react";
import { useTransfers } from "../hooks";
import { usePrefersReducedMotion } from "../shared/useReducedMotion";
import { availHosts, type Client, type Host } from "./data";

// Throughput HUD — the scrolling read/write wave feed plus the Read/Write/Ping/Relay
// readout (`renderSignal`). The wave is a direct port of the prototype's imperative feed
// loop (established bars scroll rigidly, only the entering bar grows in, seamless via
// recycling the leftmost bar on each `transitionend`); the ONLY change is its data source
// — the bar amplitudes now track the live client transfer rates instead of a fixed random
// walk, so the feed idles near zero when nothing is transferring. Read/Write read the same
// live transfers; Ping is the measured RTT passed from the dashboard.

// Bytes/sec that maps to a full-height bar. Chosen so ordinary transfers fill the wave.
const REF_BPS = 60 * 1024 * 1024;

export function Throughput({
  hosts,
  clients,
  ping,
}: {
  hosts: Host[];
  clients: Client[];
  ping: number | null;
}): JSX.Element {
  const feedRef = React.useRef<HTMLDivElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const transfers = useTransfers();
  const active = transfers.filter((t) => t.state === "active");
  const readBps = active.filter((t) => t.direction === "down").reduce((a, t) => a + t.bytesPerSec, 0);
  const writeBps = active.filter((t) => t.direction === "up").reduce((a, t) => a + t.bytesPerSec, 0);

  // Live amplitudes (0..1) the imperative feed loop reads on every recycle. Refs so the
  // long-lived loop below always sees the current rate without re-running its effect.
  const readAmpRef = React.useRef(0);
  const writeAmpRef = React.useRef(0);
  readAmpRef.current = Math.min(1, readBps / REF_BPS);
  writeAmpRef.current = Math.min(1, writeBps / REF_BPS);

  React.useEffect(() => {
    const feedEl = feedRef.current;
    if (!feedEl) return;
    const track = document.createElement("div");
    track.className = "feed-track";
    feedEl.appendChild(track);

    const STEP = 8;
    const FHALF = 54;
    // A discrete waveform driven by a plain interval, NOT a `transitionend` chain — the old
    // chain silently stalls on old WebKit (Mojave) and under the reduced-motion
    // `transition-duration:0` override, leaving a dead graph. Each tick marches every bar's
    // height one slot left and samples a fresh one on the right, so the wave visibly scrolls
    // and always reflects the live read/write amplitude (a faint baseline keeps it alive when
    // idle). Slower under reduced motion (non-strobing) but never frozen.
    const TICK = reducedMotion ? 2500 : 900;
    const amp = (base: number, min: number) => Math.min(1, Math.max(min, base * (0.7 + Math.random() * 0.6)));
    const nextR = () => amp(readAmpRef.current, 0.02);
    const nextW = () => amp(writeAmpRef.current, 0.015);
    const setBar = (b: Element, r: number, w: number) => {
      const u = b.firstElementChild as HTMLElement;
      const d = b.lastElementChild as HTMLElement;
      u.style.transition = reducedMotion ? "none" : `height ${TICK}ms ease-out`;
      d.style.transition = reducedMotion ? "none" : `height ${TICK}ms ease-out`;
      u.style.height = (r * FHALF).toFixed(1) + "px";
      d.style.height = (w * FHALF).toFixed(1) + "px";
    };
    const mkBar = (r: number, w: number) => {
      const b = document.createElement("div");
      b.className = "fbar";
      const u = document.createElement("span");
      u.className = "up";
      const d = document.createElement("span");
      d.className = "dn";
      b.appendChild(u);
      b.appendChild(d);
      setBar(b, r, w);
      return b;
    };
    const NBAR = Math.max(24, Math.ceil((feedEl.clientWidth || 360) / STEP) + 3);
    for (let i = 0; i < NBAR; i++) {
      track.appendChild(mkBar(nextR(), nextW()));
    }

    const shift = () => {
      const bars = track.children;
      if (bars.length < 2) return;
      // March each bar's amplitude into its left neighbour, then sample a fresh right edge.
      for (let i = 0; i < bars.length - 1; i++) {
        const next = bars[i + 1] as HTMLElement;
        const nu = (next.firstElementChild as HTMLElement).style.height;
        const nd = (next.lastElementChild as HTMLElement).style.height;
        const cur = bars[i] as HTMLElement;
        (cur.firstElementChild as HTMLElement).style.transition = reducedMotion ? "none" : `height ${TICK}ms linear`;
        (cur.lastElementChild as HTMLElement).style.transition = reducedMotion ? "none" : `height ${TICK}ms linear`;
        (cur.firstElementChild as HTMLElement).style.height = nu;
        (cur.lastElementChild as HTMLElement).style.height = nd;
      }
      setBar(bars[bars.length - 1], nextR(), nextW());
    };
    const id = setInterval(shift, TICK);

    return () => {
      clearInterval(id);
      if (track.parentNode) track.parentNode.removeChild(track);
    };
  }, [reducedMotion]);

  const read = Math.round(readBps / (1024 * 1024));
  const write = Math.round(writeBps / (1024 * 1024));
  const relay =
    availHosts(hosts).filter((h) => h.transport === "relay").length +
    clients.filter((c) => c.status !== "offline" && c.transport === "relay").length;

  return (
    <section className="hud col">
      <div className="hud-head">
        <span className="l">&#9674; Throughput</span>
      </div>
      <div className="sig-body">
        <div className="feed" id="feed" ref={feedRef}>
          <span className="feed-lbl r">Read</span>
          <span className="feed-lbl w">Write</span>
        </div>
        <div className="readout sig-read" id="sigread">
          <div>
            <span className="k">Read</span>
            <span className="v">
              {read}
              <em>MB/s</em>
            </span>
          </div>
          <div>
            <span className="k">Write</span>
            <span className="v">
              {write}
              <em>MB/s</em>
            </span>
          </div>
          <div>
            <span className="k">Ping</span>
            <span className={`v ${ping == null ? "dim" : ""}`}>
              {ping == null ? "--" : ping}
              <em>ms</em>
            </span>
          </div>
          <div>
            <span className="k">Relay</span>
            <span className={`v ${relay ? "" : "dim"}`}>
              {relay}
              <em>{relay === 1 ? "link" : "links"}</em>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
