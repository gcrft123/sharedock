// dock_remote — pair another machine. Mints a REAL pairing code via createHostClaim and
// shows it as the primary affordance. Polls pendingHosts(); when the machine that entered
// the code appears (having named + iconned itself), it renders as a card — the same card the
// host sees — plus its machine ID, and the owner approves it here. No QR (we have no encoder)
// and no per-machine placeholder name (the host names itself now).

import React from "react";
import { cp } from "../shared/cp";
import { useOb, errText, DEFAULT_HOST_ICON, rv, Title, Sub, type HostIcon } from "./machine";
import { ObIcon } from "./icons";

const POLL_MS = 3000;
const MAX_POLLS = 60; // ~3 min

export function DockRemote(): JSX.Element {
  const { state, patch, go, back } = useOb();
  const [code, setCode] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  // The host that entered the code, awaiting the owner's explicit approval (security gate:
  // a leaked code can enroll a pending host, but it can't serve until approved here).
  const [pendingHost, setPendingHost] = React.useState<{ id: string; name: string; icon: HostIcon } | null>(null);

  const approve = async () => {
    if (!pendingHost) return;
    try {
      await cp().approveDevice(pendingHost.id);
    } catch (e) {
      setErr(errText(e));
      return;
    }
    // Adopt the host's own chosen name + icon into the allocation flow.
    patch({
      pending: state.pending
        ? { ...state.pending, name: pendingHost.name, icon: pendingHost.icon }
        : state.pending,
    });
    go("dock_allocate");
  };

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let polls = 0;

    const start = async () => {
      setErr(null);
      setCode(null);
      try {
        const claim = await cp().createHostClaim(state.pending?.name);
        if (cancelled) return;
        setCode(claim.code);
        patch({ claimCode: claim.code });
      } catch (e) {
        if (!cancelled) setErr(errText(e));
        return;
      }
      timer = setInterval(async () => {
        polls++;
        try {
          // Surface ANY host awaiting approval — the machine that entered this code. No "new
          // since I started watching" filter: a host left pending by an earlier attempt must
          // still be pick-up-able, not ignored. Stop polling and hand it to the owner to approve.
          const host = (await cp().pendingHosts())[0];
          if (host) {
            if (timer) clearInterval(timer);
            if (cancelled) return;
            setPendingHost({
              id: host.id,
              name: host.name || "New machine",
              icon: (host.icon as HostIcon) || DEFAULT_HOST_ICON.other,
            });
            return;
          }
        } catch {
          /* transient — keep polling */
        }
        if (polls >= MAX_POLLS) {
          if (timer) clearInterval(timer);
          if (!cancelled) setErr("No machine has connected yet. Check the agent and try again.");
        }
      }, POLL_MS);
    };

    void start();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  return (
    <>
      <Title>Set up your host.</Title>
      <Sub>On the other machine, open Sharedock and enter this code. It shows up here to approve.</Sub>
      <div className="o-body">
        <ol className="pairsteps rv" style={rv(1)}>
          <li className="sl-row">
            <span className="no">1</span>
            <span className="tx">
              On that machine, install and open Sharedock from <code>sharedock.app</code>.
            </span>
          </li>
          <li className="sl-row">
            <span className="no">2</span>
            <span className="tx">
              Choose <b>I have a pairing code</b>.
            </span>
          </li>
          <li className="sl-row">
            <span className="no">3</span>
            <span className="tx">Enter the code below, then name the machine.</span>
          </li>
        </ol>

        <div className="codebox rv" style={rv(2)}>
          <span className="cl">Pairing code</span>
          <span className="pcode-lg">{code ? (code.match(/.{1,4}/g)?.join("-") ?? code) : "· · ·"}</span>
        </div>

        {err ? (
          <div className="note rv" style={rv(3, { marginTop: 16 })}>
            <span className="ni" style={{ color: "var(--amber)" }}>
              !
            </span>
            <p style={{ color: "var(--peach)" }}>{err}</p>
          </div>
        ) : pendingHost ? (
          <div className="hostlist rv" style={rv(3, { marginTop: 16 })}>
            <div className="hostrow" style={{ boxShadow: "inset 2px 0 0 var(--amber)" }}>
              <span className="hi">
                <ObIcon name={pendingHost.icon} />
              </span>
              <span>
                <span className="hn">{pendingHost.name} · pending</span>
                <span className="hsub mono">{pendingHost.id.slice(0, 20)}</span>
              </span>
              <span className="waiting" style={{ margin: 0 }}>
                <span className="sq" />
              </span>
            </div>
          </div>
        ) : (
          <div className="waiting rv" style={rv(3, { marginTop: 16 })}>
            <span className="sq" /> Waiting for the machine to connect&hellip;
          </div>
        )}

        <div className="actions rv" style={rv(4)}>
          <button className="btn" onClick={back}>
            &larr; Back
          </button>
          <span className="sp" />
          {pendingHost && !err && (
            <button className="btn btn-primary" onClick={approve}>
              Approve &amp; continue <ObIcon name="arrow" />
            </button>
          )}
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
