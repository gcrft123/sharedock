// host_name — the host names itself and picks an icon BEFORE its join request is sent.
// Solo (desktop host branch), reached from host_join once the code validates. The chosen
// name + icon are attached to the host: they ride start_host_daemon (host_pending) into the
// daemon's control-plane enrolment, so they show wherever the host appears (the owner's
// dashboard, the host-live screen). Intentionally text-light — just the two controls.

import React from "react";
import { useOb, HOST_ICONS, DEFAULT_HOST_ICON, type HostIcon, rv, Title } from "./machine";
import { ObIcon } from "./icons";

export function HostName(): JSX.Element {
  const { state, patch, go, back } = useOb();
  const p = state.pending;
  const [name, setName] = React.useState(p && p.name !== "This machine" ? p.name : "");
  const [icon, setIcon] = React.useState<HostIcon>(p?.icon ?? DEFAULT_HOST_ICON[p?.kind ?? "joined"]);

  const cont = () => {
    const nm = name.trim() || "My host";
    patch({ pending: p ? { ...p, name: nm, icon } : p });
    go("host_pending");
  };

  return (
    <>
      <Title center>Name this machine.</Title>
      <div className="o-body">
        <div className="namewrap rv" style={rv(1)}>
          <input
            className="input"
            autoFocus
            placeholder="e.g. Loft Server"
            aria-label="Machine name"
            value={name}
            maxLength={32}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && cont()}
          />
          <div className="iconpick" role="radiogroup" aria-label="Machine icon">
            {HOST_ICONS.map((ic) => (
              <button
                key={ic}
                type="button"
                role="radio"
                aria-checked={icon === ic}
                aria-label={ic}
                className={`iconbtn ${icon === ic ? "sel" : ""}`}
                onClick={() => setIcon(ic)}
              >
                <ObIcon name={ic} size={22} />
              </button>
            ))}
          </div>
        </div>
        <div className="actions rv" style={rv(2)}>
          <button className="btn" onClick={back}>
            &larr; Back
          </button>
          <span className="sp" />
          <button className="btn btn-primary" onClick={cont}>
            Continue <ObIcon name="arrow" />
          </button>
        </div>
      </div>
    </>
  );
}
