// Toasts.tsx — transient toasts + the useToasts hook. Ported from fb-ui.jsx.
// Used for success confirmations, the soft-trash Undo affordance, and API errors.

import React from "react";
import { FbIcon } from "./icons";
import type { ToastItem, ToastInput } from "./types";

export function useToasts() {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const timers = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const dismiss = React.useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    clearTimeout(timers.current[id]);
    delete timers.current[id];
  }, []);
  const push = React.useCallback((t: ToastInput) => {
    const id = "tst" + Math.random().toString(36).slice(2, 8);
    setToasts((cur) => [...cur.slice(-3), { id, ...t }]);
    timers.current[id] = setTimeout(() => {
      setToasts((cur) => cur.filter((x) => x.id !== id));
    }, t.duration || 4200);
    return id;
  }, []);
  return { toasts, push, dismiss };
}

export function Toasts({ toasts, dismiss }: { toasts: ToastItem[]; dismiss: (id: string) => void }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={"toast" + (t.kind === "ok" ? " ok" : "")}>
          <span className="ic">
            <FbIcon name={t.icon || (t.kind === "ok" ? "check-circle" : "info")} size={15} />
          </span>
          <span>{t.msg}</span>
          {t.undo && (
            <button
              className="undo"
              onClick={() => {
                t.undo?.();
                dismiss(t.id);
              }}
            >
              Undo
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
