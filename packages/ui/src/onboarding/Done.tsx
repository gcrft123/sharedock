// done — the completion summary. "Open Sharedock" plays the full-screen launch animation
// (owned by Onboarding, so it clears the rail), then hands control back to the app.

import { useOb, GB, tierOf, rv } from "./machine";
import { ObIcon } from "./icons";
import { MARK_SRC } from "./logo";

export function Done(): JSX.Element {
  const { state, launch } = useOb();
  const hosts = state.hosts;
  const mir = hosts.length > 1 && state.mode === "mirror";
  const total = hosts.reduce((a, h) => a + h.cap, 0);
  const cap = hosts.length ? (mir ? Math.min(...hosts.map((h) => h.cap)) : total) : 0;
  const modeTxt = hosts.length > 1 ? (mir ? "Mirror · redundant" : "Pool · " + state.strategy) : "Single host";
  const seats = state.maxHosts;

  return (
    <div className="finale">
      <img className="done-logo rv" style={rv(0)} src={MARK_SRC} alt="" />
      <h1 className="o-title rv" style={rv(1, { textAlign: "center" })}>
        You&rsquo;re all set.
      </h1>
      <div className="summary rv" style={rv(2)}>
        <div className="sr">
          <span className="k">License</span>
          <span className="v">
            {tierOf(state.tier)?.n ?? "--"} · {seats ? `${seats} host${seats > 1 ? "s" : ""}` : "unlimited hosts"}
          </span>
        </div>
        <div className="sr">
          <span className="k">Hosts</span>
          <span className="v">
            {hosts.length} · {hosts.map((h) => h.name).join(", ")}
          </span>
        </div>
        <div className="sr">
          <span className="k">Storage</span>
          <span className="v">
            {modeTxt} · {GB(cap)}
          </span>
        </div>
      </div>
      <div className="actions rv" style={rv(3, { justifyContent: "center" })}>
        <button className="btn btn-primary" onClick={launch}>
          Open Sharedock <ObIcon name="arrow" />
        </button>
      </div>
    </div>
  );
}
