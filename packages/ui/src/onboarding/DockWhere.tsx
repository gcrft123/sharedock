// dock_where — pick where the host lives. "This computer" is offered only in the Tauri
// desktop app (the web build can't run a local daemon); the web build shows only
// "Another machine". Choosing seeds `state.pending` (with a default icon) and routes to
// pairing (other) or straight to allocation (this). The "This computer" chip shows this
// Mac's real free disk (native free_disk_bytes), rounded up.

import React from "react";
import { isTauri, invoke } from "../shared/tauri";
import {
  useOb,
  DISK,
  OTHER,
  freeSpaceLabel,
  hostMaxGb,
  DEFAULT_HOST_ICON,
  rv,
  Title,
  Sub,
  type HostKind,
} from "./machine";
import { ObIcon } from "./icons";

export function DockWhere(): JSX.Element {
  const { state, patch, go } = useOb();
  const more = state.hosts.length > 0;
  const [freeBytes, setFreeBytes] = React.useState<number | null>(null);

  // Real free disk on this Mac (desktop only) for the chip + the allocate ceiling.
  React.useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    invoke<number>("free_disk_bytes")
      .then((b) => {
        if (!cancelled && typeof b === "number" && b > 0) setFreeBytes(b);
      })
      .catch(() => {
        /* keep the placeholder if the native call is unavailable */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const thisDiskGb = freeBytes ? Math.floor(freeBytes / 1e9) : DISK.this;

  const chooseHost = (kind: HostKind) => {
    if (kind === "this") {
      const max = hostMaxGb(thisDiskGb, state.quotaBytes);
      const name = state.hosts.some((h) => h.kind === "this") ? `This Mac (${state.hosts.length + 1})` : "This Mac";
      patch({ pending: { kind: "this", name, icon: DEFAULT_HOST_ICON.this, max, cap: Math.min(600, max) } });
      go("dock_allocate");
    } else {
      const max = hostMaxGb(DISK.other, state.quotaBytes);
      const name = OTHER[state.otherIdx % OTHER.length];
      patch({
        pending: { kind: "other", name, icon: DEFAULT_HOST_ICON.other, max, cap: Math.min(420, max) },
        otherIdx: state.otherIdx + 1,
      });
      go("dock_remote");
    }
  };

  return (
    <>
      <Title>{more ? "Add another machine." : "Where should this host live?"}</Title>
      <Sub>
        {more
          ? "Dock one more machine. Its disk joins the drive."
          : "Pick the machine that will hold your files. You can add more later."}
      </Sub>
      <div className="o-body">
        <div className="opts two rv" style={rv(1)}>
          <button className="opt col" onClick={() => chooseHost("other")}>
            <span className="oic">
              <ObIcon name="tower" />
            </span>
            <span className="otx">
              <b>Another machine</b>
              <p>Install the agent on a spare laptop or server and pair it.</p>
              <span className="om">
                <span className="chip chip-amber">
                  <i />
                  recommended
                </span>
              </span>
            </span>
          </button>
          {isTauri() && (
            <button className="opt col" onClick={() => chooseHost("this")}>
              <span className="oic">
                <ObIcon name="laptop" />
              </span>
              <span className="otx">
                <b>This computer</b>
                <p>Use free space on this Mac. Quickest to start.</p>
                <span className="om">
                  <span className="chip chip-cream">
                    <i />
                    {freeBytes ? `${freeSpaceLabel(freeBytes)} free` : "Checking disk…"}
                  </span>
                </span>
              </span>
            </button>
          )}
        </div>
        <div className="actions rv" style={rv(2)}>
          <button className="btn" onClick={() => go(more ? "host_added" : "dock_intro")}>
            &larr; Back
          </button>
        </div>
      </div>
    </>
  );
}
