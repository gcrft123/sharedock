import React from "react";
import { Icon } from "./icons";
import {
  bestWrite,
  onlineHosts,
  KIC,
  type Client,
  type Host,
  type Mode,
} from "./data";

// Topology diagram (#dgm) — a pannable pixel canvas (NOT a viewBox-scaled SVG), ported
// from `renderDiagram` + the pan IIFE. Node positions, link colours (direct/relay/off),
// animated pulses and drag-to-pan (with tap-still-selects-node) are all preserved.

const NODE_SP = 94; // vertical spacing between stacked nodes

interface Pos {
  x: number;
  y: number;
}
interface Link {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cls: string;
  live: boolean;
}

interface Geo {
  cvW: number;
  cvH: number;
  vpW: number;
  vpH: number;
}

function clampPan(p: Pos, g: Geo): Pos {
  let x: number, y: number;
  if (g.cvW <= g.vpW) x = (g.vpW - g.cvW) / 2;
  else x = Math.max(g.vpW - g.cvW, Math.min(0, p.x));
  if (g.cvH <= g.vpH) y = (g.vpH - g.cvH) / 2;
  else y = Math.max(g.vpH - g.cvH, Math.min(0, p.y));
  return { x, y };
}

export interface TopologyGraphProps {
  hosts: Host[];
  clients: Client[];
  /** Still needed: mirror draws host-to-host links, pool draws hub-to-host. Read-only here —
   *  the mode is CHOSEN in Settings → Hosts & devices, which is the one place that writes it. */
  mode: Mode;
  sel: string | null;
  selDev: string | null;
  onSelectHost: (id: string) => void;
  onSelectDev: (id: string) => void;
}

export function TopologyGraph({
  hosts,
  clients,
  mode,
  sel,
  selDev,
  onSelectHost,
  onSelectDev,
}: TopologyGraphProps): JSX.Element {
  const dgmRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLDivElement | null>(null);
  const [vp, setVp] = React.useState({ w: 0, h: 0 });
  const [pan, setPan] = React.useState<Pos>({ x: 0, y: 0 });
  const panReady = React.useRef(false);

  // measure the viewport (dgm.clientWidth/Height in the prototype)
  React.useLayoutEffect(() => {
    const el = dgmRef.current;
    if (!el) return;
    const measure = () => setVp({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- geometry (derived exactly as renderDiagram computes it) ----
  const vpW = vp.w || 600;
  const vpH = vp.h || 340;
  const bw = bestWrite(hosts);
  const nMax = Math.max(clients.length, hosts.length, 1);
  const cvW = Math.max(vpW, 540);
  const cvH = Math.max(vpH, (nMax - 1) * NODE_SP + 130); // grow the canvas as hosts are added
  const sideX = Math.max(94, cvW * 0.15);
  const leftX = sideX;
  const rightX = cvW - sideX;
  const midX = cvW / 2;
  const midY = cvH / 2;
  const colY = (n: number, i: number) => midY - ((n - 1) * NODE_SP) / 2 + i * NODE_SP;

  const pos: Record<string, Pos> = { hub: { x: midX, y: midY } };
  clients.forEach((c, i) => {
    pos["c" + c.id] = { x: leftX, y: colY(clients.length, i) };
  });
  hosts.forEach((h, i) => {
    pos["h" + h.id] = { x: rightX, y: colY(hosts.length, i) };
  });

  // every link is the same weight + shape; only colour + moving pulse differ
  const links: Link[] = [];
  const seg = (a: string, b: string, cls: string, live: boolean) =>
    links.push({ x1: pos[a].x, y1: pos[a].y, x2: pos[b].x, y2: pos[b].y, cls, live });
  clients.forEach((c) => {
    if (c.status === "offline") seg("c" + c.id, "hub", "off", false);
    else seg("c" + c.id, "hub", c.transport === "relay" ? "relay" : "direct", true);
  });
  hosts.forEach((h) => {
    if (mode === "mirror") seg("hub", "h" + h.id, h.id === bw ? "direct" : "off", h.id === bw);
    else if (h.status === "offline") seg("hub", "h" + h.id, "off", false);
    else seg("hub", "h" + h.id, h.transport === "relay" ? "relay" : "direct", true);
  });
  if (mode === "mirror" && bw) {
    onlineHosts(hosts).forEach((h) => {
      if (h.id !== bw) seg("h" + bw, "h" + h.id, "direct", true);
    });
  }

  const pannable = cvH > vpH + 1 || cvW > vpW + 1;

  // keep live refs for the imperative drag handler
  const geoRef = React.useRef<Geo>({ cvW, cvH, vpW, vpH });
  geoRef.current = { cvW, cvH, vpW, vpH };
  const panRef = React.useRef(pan);
  panRef.current = pan;

  // center once (with real measured size), then re-clamp on geometry change
  React.useLayoutEffect(() => {
    if (!vp.w) return; // wait for the first real measurement
    const g: Geo = { cvW, cvH, vpW, vpH };
    if (!panReady.current) {
      setPan(clampPan({ x: (vpW - cvW) / 2, y: (vpH - cvH) / 2 }, g));
      panReady.current = true;
    } else {
      setPan((p) => clampPan(p, g));
    }
  }, [cvW, cvH, vpW, vpH, vp.w]);

  // drag-to-pan (ported from the prototype IIFE). Capturing only after a real move keeps
  // a plain tap flowing through to the node button's click, so selection still works.
  React.useEffect(() => {
    const dgm = dgmRef.current;
    if (!dgm) return;
    let dragging = false;
    let moved = false;
    let captured = false;
    let sx = 0;
    let sy = 0;
    let spx = 0;
    let spy = 0;
    let pid = -1;
    let live: Pos = panRef.current;
    const applyImperative = (p: Pos) => {
      const c = canvasRef.current;
      if (c) c.style.transform = "translate(" + p.x.toFixed(1) + "px," + p.y.toFixed(1) + "px)";
    };
    const onDown = (e: PointerEvent) => {
      if (e.button) return;
      dragging = true;
      moved = false;
      captured = false;
      pid = e.pointerId;
      sx = e.clientX;
      sy = e.clientY;
      spx = panRef.current.x;
      spy = panRef.current.y;
      live = panRef.current;
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 4) {
        moved = true;
        if (dgm.classList.contains("pannable")) {
          dgm.classList.add("grabbing");
          try {
            dgm.setPointerCapture(pid);
            captured = true;
          } catch {
            /* capture unsupported */
          }
        }
      }
      if (moved) {
        live = clampPan({ x: spx + dx, y: spy + dy }, geoRef.current);
        applyImperative(live);
      }
    };
    const end = () => {
      if (!dragging) return;
      dragging = false;
      dgm.classList.remove("grabbing");
      if (captured) {
        try {
          dgm.releasePointerCapture(pid);
        } catch {
          /* ignore */
        }
        captured = false;
      }
      if (moved) setPan(live); // commit the dragged offset back to React state
    };
    const onClickCapture = (e: MouseEvent) => {
      if (moved) {
        moved = false;
        e.stopPropagation();
        e.preventDefault();
      }
    };
    dgm.addEventListener("pointerdown", onDown);
    dgm.addEventListener("pointermove", onMove);
    dgm.addEventListener("pointerup", end);
    dgm.addEventListener("pointercancel", end);
    dgm.addEventListener("click", onClickCapture, true);
    return () => {
      dgm.removeEventListener("pointerdown", onDown);
      dgm.removeEventListener("pointermove", onMove);
      dgm.removeEventListener("pointerup", end);
      dgm.removeEventListener("pointercancel", end);
      dgm.removeEventListener("click", onClickCapture, true);
    };
  }, []);

  return (
    <section className="hud">
      <div className="hud-head">
        <span className="l">&#9674; Topology</span>
      </div>
      <div className={`dgm ${pannable ? "pannable" : ""}`} id="dgm" ref={dgmRef}>
        <div
          className="dgm-canvas"
          ref={canvasRef}
          style={{
            width: cvW,
            height: cvH,
            transform: `translate(${pan.x.toFixed(1)}px,${pan.y.toFixed(1)}px)`,
          }}
        >
          <svg width={cvW} height={cvH} viewBox={`0 0 ${cvW} ${cvH}`}>
            {links.map((s, i) => (
              <React.Fragment key={i}>
                <line
                  className={`dl ${s.cls}`}
                  x1={s.x1.toFixed(1)}
                  y1={s.y1.toFixed(1)}
                  x2={s.x2.toFixed(1)}
                  y2={s.y2.toFixed(1)}
                />
                {s.live ? (
                  <line
                    className={`dpulse ${s.cls}`}
                    x1={s.x1.toFixed(1)}
                    y1={s.y1.toFixed(1)}
                    x2={s.x2.toFixed(1)}
                    y2={s.y2.toFixed(1)}
                  />
                ) : null}
              </React.Fragment>
            ))}
          </svg>
          <div className="dgm-nodes">
            {clients.map((c) => (
              <button
                key={c.id}
                className={`node node-client ${selDev === c.id ? "sel" : ""}`}
                data-dev={c.id}
                style={{ left: `${pos["c" + c.id].x.toFixed(1)}px`, top: `${pos["c" + c.id].y.toFixed(1)}px` }}
                onClick={() => onSelectDev(c.id)}
              >
                <div className="node-box">
                  <span className="node-ic">
                    <Icon name={KIC[c.kind] || "monitor"} size={20} />
                  </span>
                  <span className="node-name">{c.name}</span>
                </div>
              </button>
            ))}
            <div
              className="node node-hub"
              style={{ left: `${pos.hub.x.toFixed(1)}px`, top: `${pos.hub.y.toFixed(1)}px` }}
            >
              <div className="node-box">
                <span className="node-ic">
                  <Icon name="dash" size={20} />
                </span>
                <span className="node-name">Your cloud</span>
              </div>
            </div>
            {hosts.map((h) => (
              <button
                key={h.id}
                className={`node node-host ${sel === h.id ? "sel" : ""}`}
                data-host={h.id}
                style={{ left: `${pos["h" + h.id].x.toFixed(1)}px`, top: `${pos["h" + h.id].y.toFixed(1)}px` }}
                onClick={() => onSelectHost(h.id)}
              >
                <div className="node-box">
                  <span className="node-ic">
                    <Icon name={KIC[h.kind] || "server"} size={20} />
                  </span>
                  <span className="node-name">{h.name}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
        {pannable ? <div className="dgm-hint">Drag to pan</div> : null}
      </div>
    </section>
  );
}
