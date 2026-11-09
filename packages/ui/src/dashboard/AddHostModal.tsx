import React from "react";
import { useModalLayer } from "../shared/modal";
import { Icon, type IconName } from "./icons";

// Add-host modal (#addscrim) — mirrors the onboarding "add host" screen. Direct port of
// `renderAddChoices` + the dialog shell. Clicking a card adds a host of that kind.

interface Card {
  k: string;
  icn: IconName;
  t: string;
  d: string;
  chip: JSX.Element;
}

const CARDS: Card[] = [
  {
    k: "other",
    icn: "server",
    t: "Another machine",
    d: "Install the agent on a spare laptop or server and pair it.",
    chip: (
      <span className="chip chip-amber">
        <i></i>recommended
      </span>
    ),
  },
  {
    k: "this",
    icn: "laptop",
    t: "This computer",
    d: "Use free space on this Mac. Quickest to start.",
    chip: (
      <span className="chip chip-cream">
        <i></i>~1 TB free
      </span>
    ),
  },
];

export function AddHostModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (kind: string) => void;
}): JSX.Element {
  const dlg = React.useRef<HTMLDivElement>(null);
  useModalLayer(open, onClose, dlg);
  return (
    <div
      className={`dlg-scrim ${open ? "on" : ""}`}
      id="addscrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dlg}
        tabIndex={-1}
        className="dlg"
        role="dialog"
        aria-modal="true"
        aria-label="Add a host"
        style={{ width: "min(560px,100%)" }}
      >
        <div className="dlg-head">
          <span>Add a host</span>
          <button className="btn btn-ghost btn-sm" data-act="addclose" aria-label="Close" onClick={onClose}>
            Esc
          </button>
        </div>
        <div className="dlg-body" style={{ padding: "18px 22px 24px" }}>
          <h2 className="o-title">Where should this host live?</h2>
          <p className="o-sub">Pick the machine that will hold your files. Its disk joins the drive.</p>
          <div className="opts two" id="addchoices" style={{ marginTop: 22 }}>
            {CARDS.map((c) => (
              <button className="opt col" data-addkind={c.k} key={c.k} onClick={() => onAdd(c.k)}>
                <span className="oic">
                  <Icon name={c.icn} size={24} />
                </span>
                <span className="otx">
                  <b>{c.t}</b>
                  <p>{c.d}</p>
                  <span className="om">{c.chip}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
