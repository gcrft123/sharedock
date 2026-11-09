// host_join — the "I have a pairing code" branch that docks THIS machine as a host. This
// requires running a background daemon, so it is desktop-only: in the Tauri app it
// collects the code and hands off to host_pending; in the web build the whole branch body
// is replaced with copy telling the user to install the desktop app (chrome preserved).

import React from "react";
import { isTauri } from "../shared/tauri";
import { cp } from "../shared/cp";
import { useOb, DISK, DEFAULT_HOST_ICON, rv, Title, Sub } from "./machine";
import { ObIcon } from "./icons";

/** Web fallback for the (desktop-only) host-join branch — keeps the screen chrome. */
export function HostBranchWeb({ back }: { back?: () => void }): JSX.Element {
  return (
    <>
      <Title>Get the desktop app.</Title>
      <Sub>
        Docking this machine as a host runs a background daemon, which only the Sharedock desktop app can do.
        Install it, then come back to this step.
      </Sub>
      <div className="o-body">
        <div className="note rv" style={rv(1)}>
          <span className="ni">
            <ObIcon name="drive" />
          </span>
          <p>
            Download Sharedock for macOS at <b>sharedock.app</b> and open it on the machine you want to dock.
          </p>
        </div>
        {back && (
          <div className="actions rv" style={rv(2)}>
            <button className="btn" onClick={back}>
              &larr; Back
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export function HostJoin(): JSX.Element {
  const { patch, go } = useOb();
  const [segs, setSegs] = React.useState(["", "", ""]);
  const [err, setErr] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);
  const refs = [React.useRef<HTMLInputElement>(null), React.useRef<HTMLInputElement>(null), React.useRef<HTMLInputElement>(null)];

  if (!isTauri()) return <HostBranchWeb back={() => go("dock_intro")} />;

  const onSeg = (i: number, raw: string) => {
    const v = raw.toUpperCase().slice(0, 4);
    setSegs((prev) => prev.map((s, j) => (j === i ? v : s)));
    setErr(null);
    if (v.length >= 4 && i < 2) refs[i + 1].current?.focus();
  };

  const submit = async () => {
    const code = segs.join("").toUpperCase();
    setErr(null);
    setChecking(true);
    try {
      // Validate up front so a wrong code is rejected here, not by silently spinning on the
      // "waiting for approval" screen (the daemon redeems asynchronously and can't report back).
      const { valid } = await cp().checkClaim(code);
      if (!valid) {
        setErr("That code is invalid or expired. Double-check it and try again.");
        setChecking(false);
        return;
      }
    } catch {
      /* if the check itself fails (offline), fall through — the daemon redeem is the real gate */
    }
    setChecking(false);
    patch({
      pending: { kind: "joined", name: "This machine", icon: DEFAULT_HOST_ICON.joined, max: DISK.this, cap: 500 },
      claimCode: code,
    });
    go("host_name");
  };

  return (
    <>
      <Title>Enter your pairing code.</Title>
      <Sub>
        On your main device you started adding a host, and it showed a code. Enter it here to dock this machine.
      </Sub>
      <div className="o-body">
        <div className="joincode rv" style={rv(1)}>
          <input
            ref={refs[0]}
            className="cseg"
            maxLength={4}
            value={segs[0]}
            aria-label="Code segment 1"
            onChange={(e) => onSeg(0, e.target.value)}
          />
          <span className="cdash">&ndash;</span>
          <input
            ref={refs[1]}
            className="cseg"
            maxLength={4}
            value={segs[1]}
            aria-label="Code segment 2"
            onChange={(e) => onSeg(1, e.target.value)}
          />
          <span className="cdash">&ndash;</span>
          <input
            ref={refs[2]}
            className="cseg"
            maxLength={4}
            value={segs[2]}
            aria-label="Code segment 3"
            onChange={(e) => onSeg(2, e.target.value)}
          />
        </div>
        {err && (
          <p style={{ color: "var(--amber)", margin: "12px 0 0" }} role="alert">
            {err}
          </p>
        )}
        <div className="note rv" style={rv(2, { marginTop: 22 })}>
          <span className="ni">
            <ObIcon name="shield" />
          </span>
          <p>
            This machine registers a host identity and requests to join. Your key is never typed here &mdash; it&rsquo;s
            delivered only after your main device approves.
          </p>
        </div>
        <div className="actions rv" style={rv(3)}>
          <button className="btn" onClick={() => go("dock_intro")}>
            &larr; Back
          </button>
          <span className="sp" />
          <button
            className="btn btn-primary"
            disabled={segs.join("").length < 12 || checking}
            onClick={submit}
          >
            {checking ? (
              "Checking…"
            ) : (
              <>
                Continue <ObIcon name="arrow" />
              </>
            )}
          </button>
        </div>
      </div>
    </>
  );
}
