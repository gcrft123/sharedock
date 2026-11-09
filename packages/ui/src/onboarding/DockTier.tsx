// dock_tier — pick what you are buying, before you buy it.
//
// This screen exists because checkout previously charged a single price no matter what
// the console displayed, so the tier a customer thought they were choosing never reached
// Stripe. The tier picked here is sent to the control plane, which maps it to that tier's
// price and signs the seat count into the license. Seat counts shown below are the
// server's own catalog values; the client never decides an entitlement.

import React from "react";
import { loadSession } from "@app/rpc-client";
import { useOb, MSG, billing, TIERS, pollUntil, rv, Title, Sub } from "./machine";
import { ObIcon } from "./icons";

export function DockTier(): JSX.Element {
  const { state, patch, go, back, runLoader } = useOb();
  const [picked, setPicked] = React.useState<string>(state.tier ?? "home");

  const buy = (tierId: string) => {
    runLoader({
      variant: "modal",
      messages: MSG.license,
      run: async () => {
        const acct = loadSession()?.account;
        if (!acct) throw new Error("Your session expired. Sign in again.");

        // Already licensed (a second pass through onboarding): adopt it rather than
        // charging again.
        let lic = await billing().getLicense(acct);
        if (!lic) {
          const co = await billing().checkout(tierId);
          if (co.dev) {
            await billing().devComplete(tierId);
          } else if (co.url) {
            window.open(co.url, "_blank", "noopener");
          }
          lic = await pollUntil(() => billing().getLicense(acct), (l) => !!l, {
            timeoutMsg: "No license yet. Finish your purchase in the browser, then try again.",
          });
        }
        if (!lic) throw new Error("No license found for this account.");
        try {
          localStorage.setItem("pc.license", JSON.stringify(lic));
        } catch {
          /* ignore storage failure */
        }
        patch({ tier: lic.tier, quotaBytes: lic.quotaBytes, maxHosts: lic.hostSeats });
      },
      onDone: () => go("dock_where"),
    });
  };

  return (
    <>
      <Title>Pick your tier.</Title>
      <Sub>
        A tier is how many machines you can turn into hosts. Paid once, not yearly, and it never
        expires. You can move to a larger tier later.
      </Sub>
      <div className="o-body">
        <div className="opts rv" style={rv(1)}>
          {TIERS.map((t) => (
            <button
              key={t.id}
              className={`opt${picked === t.id ? " sel" : ""}`}
              aria-pressed={picked === t.id}
              onClick={() => setPicked(t.id)}
            >
              <span className="otick" aria-hidden="true">
                <ObIcon name="check" />
              </span>
              <span className="oic">
                <ObIcon name={t.h > 1 ? "tower" : "drive"} />
              </span>
              <span className="otx">
                <b>
                  {t.n} · ${t.p}
                </b>
                <p>
                  {t.h} host{t.h === 1 ? "" : "s"}. {t.feats.slice(1).join(". ")}.
                </p>
              </span>
            </button>
          ))}
        </div>
        <div className="actions rv" style={rv(2)}>
          <button className="btn" onClick={back}>
            &larr; Back
          </button>
          <button className="btn btn-p" onClick={() => buy(picked)}>
            Continue
          </button>
        </div>
      </div>
    </>
  );
}
