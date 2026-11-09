// host_pending — desktop-only. Starts the local host daemon with the entered pairing
// code, then polls host_daemon_running until it reports up and advances to host_live.
// Replaces the prototype's "Simulate approval" button with the real poll; failures show
// inline with a Try again. Web builds show the install-the-app fallback.

import React from "react";
import { loadSession } from "@app/rpc-client";
import { isTauri, invoke } from "../shared/tauri";
import { CONTROL_URL, relayOrigin, cp } from "../shared/cp";
import { useOb, errText, rv, Title, Sub } from "./machine";
import { ObIcon } from "./icons";
import { HostBranchWeb } from "./HostJoin";

export function HostPending(): JSX.Element {
  const { state, go } = useOb();
  const [err, setErr] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const nm = state.pending?.name ?? "This machine";
  const tauri = isTauri();

  React.useEffect(() => {
    if (!tauri) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let polls = 0;

    const run = async () => {
      setErr(null);
      const account = loadSession()?.account;
      // Baseline of already-published hosts, so we detect the ONE this dock brings online.
      let before = 0;
      try {
        before = account ? (await cp().listHosts(account)).length : 0;
      } catch {
        /* baseline best-effort */
      }
      try {
        const quotaGb = state.pending?.cap ?? 500;
        const claim = state.claimCode ?? "";
        // Pass the owner's chosen name + icon so the daemon enrolls the host with them
        // (PC_HOST_NAME / PC_HOST_ICON override the claim's placeholder name).
        await invoke("start_host_daemon", {
          args: {
            controlUrl: CONTROL_URL,
            relayUrl: relayOrigin(),
            claim,
            quotaGb,
            hostName: state.pending?.name,
            hostIcon: state.pending?.icon,
          },
        });
      } catch (e) {
        if (!cancelled) setErr(errText(e));
        return;
      }
      timer = setInterval(async () => {
        polls++;
        try {
          // "Online" means the owner APPROVED this host on their main device AND its daemon then
          // started serving + published its endpoint — not merely that the process spawned
          // (host_daemon_running would advance before approval). Wait for the published host.
          const hosts = account ? await cp().listHosts(account) : [];
          if (hosts.length > before) {
            if (timer) clearInterval(timer);
            if (!cancelled) go("host_live");
            return;
          }
          // The daemon must stay alive while we wait; if it died, stop spinning.
          const alive = await invoke<boolean>("host_daemon_running").catch(() => true);
          if (!alive) {
            if (timer) clearInterval(timer);
            if (!cancelled) setErr("The host stopped before it came online. Try again.");
            return;
          }
        } catch {
          /* transient — keep polling */
        }
        if (polls >= 96) {
          // ~4 min
          if (timer) clearInterval(timer);
          if (!cancelled)
            setErr("Still waiting for approval. Approve this host on your main device, then it comes online here.");
        }
      }, 2500);
    };

    void run();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, tauri]);

  if (!tauri) return <HostBranchWeb back={() => go("host_join")} />;

  return (
    <>
      <Title>Waiting for approval.</Title>
      <Sub>
        Sharedock sent a request to your main device. Approve this host there, and setup continues here
        automatically.
      </Sub>
      <div className="o-body">
        <div className="hostlist rv" style={rv(1)}>
          <div className="hostrow" style={{ boxShadow: "inset 2px 0 0 var(--amber)" }}>
            <span className="hi">
              <ObIcon name={state.pending?.icon ?? "tower"} />
            </span>
            <span>
              <span className="hn">{nm} · pending</span>
            </span>
            <span className="waiting" style={{ margin: 0 }}>
              <span className="sq" />
            </span>
          </div>
        </div>
        {err && (
          <div className="note rv" style={rv(2, { marginTop: 16 })}>
            <span className="ni" style={{ color: "var(--amber)" }}>
              !
            </span>
            <p style={{ color: "var(--peach)" }}>{err}</p>
          </div>
        )}
        <div className="actions rv" style={rv(3)}>
          <button className="btn" onClick={() => go("host_join")}>
            &larr; Back
          </button>
          <span className="sp" />
          {err && (
            <button className="btn btn-primary" onClick={() => setNonce((n) => n + 1)}>
              Try again
            </button>
          )}
        </div>
      </div>
    </>
  );
}
