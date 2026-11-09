// dock_intro — the two-way fork (set up a host here / join with a pairing code).
//
// On mount this only ADOPTS an existing license; it never starts a purchase. It used to
// check out on mount, which meant a customer was charged before ever seeing a price or
// choosing a tier. Buying now happens on dock_tier, behind an explicit choice.

import React from "react";
import { loadSession } from "@app/rpc-client";
import { useOb, MSG, billing, rv, Title, Sub } from "./machine";
import { ObIcon } from "./icons";

export function DockIntro(): JSX.Element {
  const { state, patch, go, back, runLoader } = useOb();
  const ranRef = React.useRef(false);

  const adoptLicense = React.useCallback(() => {
    runLoader({
      variant: "modal",
      messages: MSG.license,
      run: async () => {
        const acct = loadSession()?.account;
        if (!acct) throw new Error("Your session expired. Sign in again.");
        const lic = await billing().getLicense(acct);
        if (!lic) return; // unlicensed is fine here: dock_tier handles buying
        try {
          localStorage.setItem("pc.license", JSON.stringify(lic));
        } catch {
          /* ignore storage failure */
        }
        patch({ tier: lic.tier, quotaBytes: lic.quotaBytes, maxHosts: lic.hostSeats });
      },
      onDone: () => {
        /* stay on dock_intro */
      },
    });
  }, [runLoader, patch]);

  React.useEffect(() => {
    if (!state.tier && !ranRef.current) {
      ranRef.current = true;
      adoptLicense();
    }
  }, [state.tier, adoptLicense]);

  return (
    <>
      <Title>Give your files a home.</Title>
      <Sub>
        A &ldquo;host&rdquo; is a machine that stores your bytes. Set one up from here &mdash; or, if you&rsquo;re
        already on the machine you want to dock, join it with a code from your main device.
      </Sub>
      <div className="o-body">
        <div className="opts two rv" style={rv(1)}>
          <button className="opt col" onClick={() => go(state.tier ? "dock_where" : "dock_tier")}>
            <span className="oic">
              <ObIcon name="drive" />
            </span>
            <span className="otx">
              <b>Set up a host from here</b>
              <p>Turn this Mac or a spare machine into an encrypted partition for your cloud.</p>
            </span>
          </button>
          <button className="opt col" onClick={() => go("host_join")}>
            <span className="oic">
              <ObIcon name="key" />
            </span>
            <span className="otx">
              <b>I have a pairing code</b>
              <p>You&rsquo;re on the machine to dock. Enter the code from your main device to join it as a host.</p>
            </span>
          </button>
        </div>
        <div className="actions rv" style={rv(2)}>
          <button className="btn" onClick={back}>
            &larr; Back
          </button>
        </div>
      </div>
    </>
  );
}
