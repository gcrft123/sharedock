// ContextMenu.tsx — right-click / more-actions menu, ported from fb-ui.jsx.
// Position clamps to the viewport; closes on outside click, Escape, or resize.

import React from "react";
import { FbIcon } from "./icons";
import type { ContextMenuItem } from "./types";

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<React.CSSProperties>({ left: x, top: y, visibility: "hidden" });
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = x, top = y;
    if (left + r.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - r.width - 8);
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ left, top, visibility: "visible" });
  }, [x, y]);
  React.useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current || !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="ctx" style={pos} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it.sep ? (
          <div key={i} className="sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={it.danger ? "danger" : ""}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onClick?.();
            }}
          >
            {it.icon && (
              <span className="ic">
                <FbIcon name={it.icon} size={15} />
              </span>
            )}
            <span>{it.label}</span>
            {it.kbd && <span className="kb">{it.kbd}</span>}
          </button>
        ),
      )}
    </div>
  );
}
