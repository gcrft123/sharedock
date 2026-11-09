// ShareDialog.tsx — shows a freshly-created public share link with a Copy button.
// Mirrors MoveDialog/ConfirmDialog (scrim + .modal card + shared button recipes). The
// URL carries the decrypt secret in its fragment, so it's shown read-only for copy only.

import React from "react";
import { useModalLayer } from "../shared/modal";
import { FbIcon } from "./icons";

export function ShareDialog({
  url,
  name,
  onClose,
}: {
  url: string;
  name: string;
  onClose: () => void;
}) {
  const dlg = React.useRef<HTMLDivElement>(null);
  // Focus in on open, Tab stays inside, focus restored on close. Escape is central
  // (ModalProvider closes only the topmost layer).
  useModalLayer(true, onClose, dlg);
  const [copied, setCopied] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard API blocked (e.g. the Tauri webview): select the field so the user
      // can copy manually. Never fall back to alert/prompt — the webview ignores them.
      inputRef.current?.select();
    }
  };

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dlg} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-label="Share link" style={{ width: "min(480px,100%)" }}>
        <div className="modal-h">
          <span className="t">Share link</span>
          <button className="x" onClick={onClose}><FbIcon name="x" size={16} /></button>
        </div>
        <div className="modal-msg">
          Anyone with this link can view <b>{name}</b>. The link carries the decryption key in
          its fragment. Treat it as a secret.
        </div>
        <div className="modal-body" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            ref={inputRef}
            className="share-url"
            type="text"
            readOnly
            value={url}
            aria-label="Share URL"
            spellCheck={false}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              flex: 1,
              minWidth: 0,
              background: "var(--bg-well)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-1)",
              padding: "9px 11px",
              color: "var(--fg)",
              font: "500 11.5px/1.4 var(--mono)",
              outline: "none",
            }}
          />
          <button className="btn btn-sm btn-primary" onClick={copy} style={{ flex: "none" }}>
            <FbIcon name={copied ? "check" : "link"} size={14} /> {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="modal-foot">
          <button className="btn btn-sm btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
