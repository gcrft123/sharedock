// SharesDialog.tsx — "Manage shares": lists the account's active share links and lets
// each be revoked. Mirrors MoveDialog (scrim + .modal card + shared button recipes).
// Reads from the app-wide ShareClient (share()); every call is wrapped so failures
// surface as toasts, never alert/confirm (the Tauri webview ignores those).

import React from "react";
import { useModalLayer } from "../shared/modal";
import type { ShareInfo } from "@app/rpc-client";
import { share } from "../shared/share";
import { formatBytes, formatRelative } from "../format";
import { FbIcon } from "./icons";
import type { ToastInput } from "./types";

const errText = (prefix: string, err: unknown): string =>
  `${prefix}: ${err instanceof Error ? err.message : String(err)}`;

export function SharesDialog({
  onClose,
  onToast,
}: {
  onClose: () => void;
  onToast: (t: ToastInput) => void;
}) {
  const dlg = React.useRef<HTMLDivElement>(null);
  // Focus in on open, Tab stays inside, focus restored on close. Escape is central
  // (ModalProvider closes only the topmost layer).
  useModalLayer(true, onClose, dlg);
  const [shares, setShares] = React.useState<ShareInfo[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const list = await share().list();
      setShares(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setShares([]);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (s: ShareInfo) => {
    setBusy(s.token);
    try {
      await share().revoke(s.token);
      onToast({ msg: <>Revoked link for <b>{s.name}</b></>, kind: "ok", icon: "trash" });
      await load();
    } catch (err) {
      onToast({ msg: errText("Revoke failed", err), icon: "info" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dlg} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-label="Manage shares" style={{ width: "min(560px,100%)" }}>
        <div className="modal-h">
          <span className="t">Shared links</span>
          <button className="x" onClick={onClose}><FbIcon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          {shares === null ? (
            <div className="fb-empty" style={{ padding: "48px 20px" }}>
              <span className="ring"><FbIcon name="refresh" size={20} /></span>
              <p>Loading shared links…</p>
            </div>
          ) : error ? (
            <div className="fb-empty" style={{ padding: "48px 20px" }}>
              <span className="ring"><FbIcon name="info" size={20} /></span>
              <h3>Couldn’t load shares</h3>
              <p>{error}</p>
              <button className="btn btn-sm" onClick={() => void load()} style={{ marginTop: 4 }}>
                <FbIcon name="refresh" size={15} /> Retry
              </button>
            </div>
          ) : shares.length === 0 ? (
            <div className="fb-empty" style={{ padding: "48px 20px" }}>
              <span className="ring"><FbIcon name="link" size={20} /></span>
              <h3>No shared links</h3>
              <p>Share a file with the link action to see it listed here.</p>
            </div>
          ) : (
            shares.map((s) => (
              <div
                key={s.token}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <span style={{ color: "var(--o)", display: "flex", flex: "none" }}>
                  <FbIcon name="link" size={16} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      font: "500 12.5px/1.3 var(--mono)",
                      color: "var(--fg)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.name}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      font: "500 10px/1.2 var(--mono)",
                      letterSpacing: ".06em",
                      textTransform: "uppercase",
                      color: "var(--muted)",
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span>{s.perms}</span>
                    <span>·</span>
                    <span>{formatBytes(s.sizeBytes)}</span>
                    <span>·</span>
                    <span>{s.accessCount} {s.accessCount === 1 ? "view" : "views"}</span>
                    <span>·</span>
                    <span>{formatRelative(s.createdAt)}</span>
                  </div>
                </div>
                <button
                  className="btn btn-sm"
                  disabled={busy === s.token}
                  onClick={() => void revoke(s)}
                  style={{ flex: "none", borderColor: "var(--o)", color: "var(--o)" }}
                >
                  <FbIcon name="trash" size={14} /> {busy === s.token ? "Revoking…" : "Revoke"}
                </button>
              </div>
            ))
          )}
        </div>
        <div className="modal-foot">
          <button className="btn btn-sm btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
