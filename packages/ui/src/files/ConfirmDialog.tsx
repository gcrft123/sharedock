// ConfirmDialog.tsx — scrim + hairline card confirm, ported from fb-ui.jsx.
// Used for the irreversible actions (delete forever / empty trash).

import React from "react";
import { useModalLayer } from "../shared/modal";
import { FbIcon } from "./icons";

export function ConfirmDialog({
  title,
  children,
  confirmLabel = "Confirm",
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dlg = React.useRef<HTMLDivElement>(null);
  // Escape is central (ModalProvider closes the topmost layer only). Focus lands on the
  // close button, which is the safe control for a dialog that can delete forever.
  useModalLayer(true, onClose, dlg);

  React.useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      // Enter must activate whatever control has focus. Only fall through to "confirm"
      // when focus is not on a control — otherwise the focused button's own click AND
      // this handler both fire, so Enter on "Delete forever" would close the dialog and
      // permanently delete at the same time.
      const t = e.target as HTMLElement | null;
      const tag = (t?.tagName || "").toLowerCase();
      if (tag === "button" || tag === "a" || tag === "input" || tag === "textarea") return;
      onConfirm();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onConfirm]);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={dlg}
        tabIndex={-1}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width: "min(400px,100%)" }}
      >
        <div className="modal-h">
          <span className="t">{title}</span>
          <button className="x" onClick={onClose}>
            <FbIcon name="x" size={16} />
          </button>
        </div>
        <div className="modal-msg">{children}</div>
        <div className="modal-foot">
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button
            className={"btn btn-sm " + (danger ? "" : "btn-primary")}
            style={danger ? { borderColor: "var(--o)", color: "var(--o)" } : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
