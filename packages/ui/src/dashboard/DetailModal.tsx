import React from "react";
import { Icon } from "./icons";
import { useModalLayer } from "../shared/modal";
import { FEATURES } from "../shared/features";
import { formatBytes } from "../format";
import { GB, hostRole, KIC, type Client, type Host, type LiveConn, type Mode, type Strategy } from "./data";

// Host / device detail modal (#infoscrim). Direct port of `openHostInfo` / `openDevInfo`.

export type DetailInfo =
  | { type: "host"; host: Host }
  | { type: "device"; client: Client }
  | null;

function KV({ k, v }: { k: string; v: React.ReactNode }): JSX.Element {
  return (
    <div>
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}

function HostBody({
  h,
  hosts,
  mode,
  strategy,
  live,
  bytesTotals,
}: {
  h: Host;
  hosts: Host[];
  mode: Mode;
  strategy: Strategy;
  live: LiveConn | null;
  bytesTotals: boolean;
}): JSX.Element {
  const off = h.status === "offline";
  const full = h.total > 0 ? Math.round((h.used / h.total) * 100) : 0;
  const st = h.status === "online" ? "Online" : h.status === "recon" ? "Reconnecting" : "Offline";
  const isConn = !off && live?.hostId === h.id; // the one connected host
  // The connected host shows its REAL transport + rate; other real (control-plane) hosts
  // have no per-host telemetry, so they read `--`; samples keep their fixture values.
  const showDirect = isConn ? live!.direct : FEATURES.DIRECT_P2P_TELEMETRY && h.transport === "direct";
  const size = (n: number) => (bytesTotals ? formatBytes(n) : GB(n));
  const readV = off ? "--" : isConn ? `${live!.read} MB/s` : bytesTotals ? "--" : `${h.read} MB/s`;
  const writeV = off ? "--" : isConn ? `${live!.write} MB/s` : bytesTotals ? "--" : `${h.write} MB/s`;
  return (
    <>
      <div className="idet-head">
        <span className="idet-ic">
          <Icon name={KIC[h.kind] || "server"} size={24} />
        </span>
        <div className="idet-tt">
          <b>{h.name}</b>
          <span>
            {st} &middot; {h.kind}
          </span>
        </div>
      </div>
      <div className="idet-grid">
        <div className="idet-full">
          <span className="k">Endpoint ID</span>
          <span className="v wide">{h.id} &middot; iroh</span>
        </div>
        <KV k="Transport" v={off ? "--" : showDirect ? "Direct P2P" : "Relay"} />
        <KV k="Role" v={hostRole(h, hosts, mode, strategy)} />
        <div className="idet-full">
          <span className="k">Disk used</span>
          <span className="v">
            {size(h.used)} / {size(h.total)} &middot; {full}%
          </span>
          <span className="idet-bar">
            <i style={{ width: `${full}%` }}></i>
          </span>
        </div>
        <KV k="Read" v={readV} />
        <KV k="Write" v={writeV} />
        <KV k="Free space" v={size(h.total - h.used)} />
        <KV k="Last seen" v={h.seen} />
      </div>
    </>
  );
}

function DeviceBody({ c }: { c: Client }): JSX.Element {
  const off = c.status === "offline";
  const showDirect = FEATURES.DIRECT_P2P_TELEMETRY && c.transport === "direct";
  return (
    <>
      <div className="idet-head">
        <span className="idet-ic">
          <Icon name={KIC[c.kind] || "monitor"} size={24} />
        </span>
        <div className="idet-tt">
          <b>{c.name}</b>
          <span>
            {off ? "Offline" : "Online"} &middot; {c.role ? c.role : "client"}
          </span>
        </div>
      </div>
      <div className="idet-grid">
        <div className="idet-full">
          <span className="k">Endpoint ID</span>
          <span className="v wide">{c.id} &middot; iroh</span>
        </div>
        <KV k="Transport" v={off ? "--" : showDirect ? "Direct P2P" : "Relay"} />
        <KV k="Type" v={c.role ? "This console" : "Client"} />
        <KV k="Access" v="Read + write" />
        <KV k="Last seen" v={c.seen} />
      </div>
    </>
  );
}

export function DetailModal({
  info,
  hosts,
  mode,
  strategy,
  live,
  bytesTotals,
  onClose,
}: {
  info: DetailInfo;
  hosts: Host[];
  mode: Mode;
  strategy: Strategy;
  live: LiveConn | null;
  bytesTotals: boolean;
  onClose: () => void;
}): JSX.Element {
  const kind = info?.type === "host" ? "Host detail" : info?.type === "device" ? "Device detail" : "Detail";
  const dlg = React.useRef<HTMLDivElement>(null);
  useModalLayer(!!info, onClose, dlg);
  return (
    <div
      className={`dlg-scrim ${info ? "on" : ""}`}
      id="infoscrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dlg}
        tabIndex={-1}
        className="dlg"
        role="dialog"
        aria-modal="true"
        aria-label="Details"
        style={{ width: "min(520px,100%)" }}
      >
        <div className="dlg-head">
          <span id="infokind">{kind}</span>
          <button className="btn btn-ghost btn-sm" data-act="infoclose" aria-label="Close" onClick={onClose}>
            Esc
          </button>
        </div>
        <div className="dlg-body" id="infobody" style={{ padding: "16px 22px 24px" }}>
          {info?.type === "host" ? (
            <HostBody h={info.host} hosts={hosts} mode={mode} strategy={strategy} live={live} bytesTotals={bytesTotals} />
          ) : null}
          {info?.type === "device" ? <DeviceBody c={info.client} /> : null}
        </div>
      </div>
    </div>
  );
}
