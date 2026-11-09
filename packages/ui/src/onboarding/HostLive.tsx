// host_live — desktop-only "this machine is now a host" panel. Reads the daemon's
// endpoint + status line best-effort (host_daemon_config / host_status). Pause/Resume and
// "Adjust storage" are local affordances (no dedicated backend command in this flow).
// Web builds fall back to the install-the-app notice.

import React from "react";
import { loadSession } from "@app/rpc-client";
import { isTauri, invoke } from "../shared/tauri";
import { useOb, GB, rv } from "./machine";
import { ObIcon } from "./icons";
import { MARK_SRC } from "./logo";
import { HostBranchWeb } from "./HostJoin";

export function HostLive(): JSX.Element {
  const { state, patch } = useOb();
  const tauri = isTauri();
  const p = state.pending ?? { name: "This machine", cap: 500 };
  const paused = state.paused;
  const email = loadSession()?.email ?? "—";
  const [endpoint, setEndpoint] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  // The owner-chosen name from the daemon config, so a returning host (reached via sign-in with
  // no in-memory onboarding state) still shows its real name instead of "This machine".
  const [hostName, setHostName] = React.useState<string | null>(null);
  // The REAL partition size the daemon is enforcing — the owner's allocation lands here a
  // moment after this screen appears (they allocate on their main device), so poll it and
  // show it instead of the placeholder `p.cap`.
  const [quotaGb, setQuotaGb] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!tauri) return;
    let cancelled = false;
    invoke("host_daemon_config")
      .then((c) => {
        if (cancelled) return;
        const o = (c ?? {}) as Record<string, unknown>;
        const ep = (o.endpoint ?? o.endpointId ?? o.endpoint_id) as string | undefined;
        if (ep) setEndpoint(ep);
        const nm = (o.name ?? o.host_name) as string | undefined;
        if (nm) setHostName(nm);
      })
      .catch(() => {
        /* config is best-effort */
      });
    const poll = () => {
      invoke<string>("host_status", { dataDir: null, quotaGb: p.cap })
        .then((s) => !cancelled && s && setStatus(s))
        .catch(() => {});
      invoke<number | null>("host_quota_gb", { dataDir: null })
        .then((g) => !cancelled && typeof g === "number" && g > 0 && setQuotaGb(g))
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tauri, p.cap]);

  if (!tauri) return <HostBranchWeb />;

  const statusText = paused ? "Paused" : status ?? "Online · serving";

  return (
    <div className="hostapp">
      <div className="ha-top rv" style={rv(0)}>
        <img className="ha-logo" src={MARK_SRC} alt="Sharedock" />
        <span className={`ha-badge ${paused ? "off" : ""}`}>
          <span className="livesq" />
          {paused ? "Host paused" : "Host online"}
        </span>
      </div>
      <h1 className="o-title rv" style={rv(1, { textAlign: "center" })}>
        {hostName ?? p.name} is a host.
      </h1>
      <p className="ha-sub rv" style={rv(2)}>
        Docked to your cloud and serving an encrypted partition. Runs quietly in the background &mdash; manage it
        here or from your main device.
      </p>
      <div className="ha-grid rv" style={rv(3)}>
        <div className="ha-cell">
          <span className="k">Storage lent</span>
          <span className="v">{quotaGb != null ? GB(quotaGb) : "Setting up…"}</span>
        </div>
        <div className="ha-cell">
          <span className="k">Status</span>
          <span className={`v ${paused ? "amber" : ""}`}>{statusText}</span>
        </div>
        <div className="ha-cell">
          <span className="k">Transport</span>
          <span className="v">Direct P2P</span>
        </div>
        <div className="ha-cell">
          <span className="k">Account</span>
          <span className="v">{email}</span>
        </div>
        <div className="ha-cell wide">
          <span className="k">Endpoint</span>
          <span className="v mono">{endpoint ?? "b30d51a9·c7f2·iroh"}</span>
        </div>
      </div>
      <div className="ha-acts rv" style={rv(4)}>
        <button className="btn">
          <ObIcon name="drive" /> Adjust storage
        </button>
        <button className={`btn ${paused ? "btn-primary" : ""}`} onClick={() => patch({ paused: !paused })}>
          {paused ? (
            <>
              <ObIcon name="play" /> Resume host
            </>
          ) : (
            <>
              <ObIcon name="pause" /> Pause host
            </>
          )}
        </button>
      </div>
      <div className="ha-foot rv" style={rv(5)}>
        <span className="ni">
          <ObIcon name="shield" />
        </span>
        <span>Files land here as ciphertext only. This machine never holds your key in the clear.</span>
      </div>
    </div>
  );
}
