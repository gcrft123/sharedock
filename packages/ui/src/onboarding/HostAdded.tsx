// host_added — the docked-hosts list after a commit. Shows seat usage against the
// license, offers "Add another machine" (unless all seats are used), and continues to
// topology (when >1 host) or straight to devices.

import { useOb, goOnline, GB, tierOf, rv, Title, Sub } from "./machine";
import { ObIcon } from "./icons";

export function HostAdded(): JSX.Element {
  const ob = useOb();
  const { state, patch, go } = ob;
  const hosts = state.hosts;
  const atLimit = !!state.maxHosts && hosts.length >= state.maxHosts;
  const tn = tierOf(state.tier)?.n ?? "your";
  const multi = hosts.length > 1;

  return (
    <>
      <Title>{multi ? `${hosts.length} hosts docked.` : "Your first host is live."}</Title>
      <Sub>
        {multi
          ? "They already act as one drive. Add more, or set how they combine."
          : "Files you add now live here, encrypted. Add another machine to grow, or pool/mirror across several."}
      </Sub>
      <div className="o-body">
        <div className="hostlist rv" style={rv(1)}>
          {hosts.map((h, i) => (
            <div className={`hostrow ${i === hosts.length - 1 ? "fresh" : ""}`} key={i}>
              <span className="hi">
                <ObIcon name={h.icon} />
              </span>
              <span>
                <span className="hn">{h.name}</span>
                <span className="hsub">{h.kind === "this" ? "this computer" : "remote host"}</span>
              </span>
              <span className="hcap">{GB(h.cap)}</span>
            </div>
          ))}
        </div>
        {state.maxHosts && (
          <div className="seatline rv" style={rv(2)}>
            <span className={`chip ${atLimit ? "chip-amber" : "chip-o"}`}>
              <i />
              {hosts.length} / {state.maxHosts} host seats
            </span>
            {atLimit && <span className="hint">all seats used</span>}
          </div>
        )}
        {atLimit ? (
          <div className="note rv" style={rv(3, { marginTop: 14 })}>
            <span className="ni">
              <ObIcon name="info" />
            </span>
            <p>
              <b>You&rsquo;ve docked every host on your {tn} license.</b> Upgrading adds host seats &mdash; you can
              do that anytime from your console.
            </p>
          </div>
        ) : (
          <button
            className="addrow rv"
            style={rv(3, { marginTop: 14 })}
            onClick={() => {
              patch({ pending: null });
              go("dock_where");
            }}
          >
            <span className="pl">
              <ObIcon name="plus" />
            </span>
            <span className="at">Add another machine</span>
          </button>
        )}
        <div className="actions rv" style={rv(4)}>
          <span className="sp" />
          <button className="btn btn-primary" onClick={() => (multi ? go("topology") : goOnline(ob))}>
            {multi ? "Set how they combine" : "Finish setup"} <ObIcon name="arrow" />
          </button>
        </div>
      </div>
    </>
  );
}
