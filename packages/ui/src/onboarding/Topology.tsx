// topology — pool vs mirror (+ fill strategy for pool). Only reached when more than one
// host is docked. Each choice is pushed to the control plane via setTopology(); the local
// state updates immediately so the UI stays responsive even if the call is in flight.

import { loadSession } from "@app/rpc-client";
import { cp } from "../shared/cp";
import { useOb, goOnline, rv, Title, Sub } from "./machine";
import { ObIcon } from "./icons";

const F = ["A", "B", "C"];

export function Topology(): JSX.Element {
  const ob = useOb();
  const { state, patch, go } = ob;
  const names = state.hosts.slice(0, 3).map((h) => h.name);

  const pushTopology = (mode: "pool" | "mirror" | null, strategy: "balanced" | "sequential") => {
    const acct = loadSession()?.account ?? state.account;
    if (!acct || !mode) return;
    cp()
      .setTopology(acct, { mode, strategy })
      .catch(() => {
        /* non-blocking: local state already reflects the choice */
      });
  };

  const setMode = (m: "pool" | "mirror") => {
    patch({ mode: m });
    pushTopology(m, state.strategy);
  };
  const setStrat = (s: "balanced" | "sequential") => {
    patch({ strategy: s });
    pushTopology(state.mode, s);
  };

  const diagram = (mirror: boolean) => (
    <div className="dia">
      <div className="dctop">
        <span className="dcon">Sharedock</span>
      </div>
      <div className="dwire" />
      <div className="dhosts">
        {names.map((n, i) => (
          <div className="dh" key={i}>
            <div className="dfiles">
              {mirror ? (
                names.map((_, j) => (
                  <span className="df" key={j}>
                    {F[j]}
                  </span>
                ))
              ) : (
                <span className="df">{F[i]}</span>
              )}
            </div>
            <div className="dn">{n}</div>
          </div>
        ))}
      </div>
      {mirror && (
        <div className="dmesh">
          {"◄  "}hosts copy each other{"  ►"}
        </div>
      )}
    </div>
  );

  return (
    <>
      <Title>Combine your machines.</Title>
      <Sub>
        You have more than one host. Decide whether they add up for capacity, or copy each other for safety.
      </Sub>
      <div className="o-body">
        <div className="topo rv" style={rv(1)}>
          <button className={`tpc ${state.mode === "pool" ? "sel" : ""}`} onClick={() => setMode("pool")}>
            <span className="otick">
              <ObIcon name="check" />
            </span>
            <div className="tph">
              <b>Pool</b>
              <span className="rl">capacity</span>
            </div>
            {diagram(false)}
            <p>
              Each file lives on one host. Capacity = <b>every disk added up</b>.
            </p>
          </button>
          <button className={`tpc ${state.mode === "mirror" ? "sel" : ""}`} onClick={() => setMode("mirror")}>
            <span className="otick">
              <ObIcon name="check" />
            </span>
            <div className="tph">
              <b>Mirror</b>
              <span className="rl">redundancy</span>
            </div>
            {diagram(true)}
            <p>Every file on every host. A machine can die and files keep working.</p>
          </button>
        </div>
        {state.mode === "pool" && (
          <div className="strat rv" style={rv(1)}>
            <div className="sl">Fill strategy</div>
            <div className="seg2">
              <button
                className={`segb ${state.strategy === "balanced" ? "sel" : ""}`}
                onClick={() => setStrat("balanced")}
              >
                <b>Balanced</b>
                <span>Fill the emptiest host first.</span>
              </button>
              <button
                className={`segb ${state.strategy === "sequential" ? "sel" : ""}`}
                onClick={() => setStrat("sequential")}
              >
                <b>Sequential</b>
                <span>Fill one, then the next.</span>
              </button>
            </div>
          </div>
        )}
        <div className="actions rv" style={rv(2)}>
          <button className="btn" onClick={() => go("host_added")}>
            &larr; Back
          </button>
          <span className="sp" />
          <button className="btn btn-primary" disabled={!state.mode} onClick={() => goOnline(ob)}>
            Finish setup <ObIcon name="arrow" />
          </button>
        </div>
      </div>
    </>
  );
}
