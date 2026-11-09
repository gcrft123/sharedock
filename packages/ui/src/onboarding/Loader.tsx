// The full-screen + modal "shard" loaders, ported from the prototype's #fsloader /
// #mloader overlays. Instead of the prototype's fixed setTimeout, this AWAITS a real
// promise: it shows the rotating messages while `status === "pending"` and swaps to an
// error state (message + Try again / Back) if the promise rejects.

import React from "react";
import { Shards, type LoaderVariant } from "./machine";
import { ObIcon } from "./icons";

export type LoaderStatus = "pending" | "error";

function useRotating(messages: string[], active: boolean): { text: string; out: boolean } {
  const [i, setI] = React.useState(0);
  const [out, setOut] = React.useState(false);
  React.useEffect(() => {
    if (!active) return;
    setI(0);
    let swap: ReturnType<typeof setTimeout> | undefined;
    const id = setInterval(() => {
      setOut(true);
      swap = setTimeout(() => {
        setI((p) => (p + 1) % messages.length);
        setOut(false);
      }, 380);
    }, 2100);
    return () => {
      clearInterval(id);
      if (swap) clearTimeout(swap);
    };
  }, [active, messages.length]);
  return { text: messages[i] ?? messages[0] ?? "", out };
}

function ErrorBlock({ error, onRetry, onCancel }: { error: string; onRetry: () => void; onCancel: () => void }): JSX.Element {
  return (
    <>
      <div className="splash">
        <span className="splash-text" style={{ color: "var(--amber)" }}>
          {error}
        </span>
      </div>
      <div className="actions" style={{ marginTop: 0, justifyContent: "center" }}>
        <button className="btn" onClick={onCancel}>
          &larr; Back
        </button>
        <button className="btn btn-primary" onClick={onRetry}>
          Try again <ObIcon name="arrow" />
        </button>
      </div>
    </>
  );
}

export function Loader({
  variant,
  messages,
  status,
  error,
  onRetry,
  onCancel,
}: {
  variant: LoaderVariant;
  messages: string[];
  status: LoaderStatus;
  error?: string;
  onRetry: () => void;
  onCancel: () => void;
}): JSX.Element {
  const pending = status === "pending";
  const { text, out } = useRotating(messages, pending);

  const splash =
    pending ? (
      <div className={`splash ${out ? "is-out" : ""}`}>
        <span className="splash-text">{text}</span>
      </div>
    ) : (
      <ErrorBlock error={error ?? "Something went wrong."} onRetry={onRetry} onCancel={onCancel} />
    );

  if (variant === "modal") {
    return (
      <div className="mscrim">
        <div className="load-card">
          <div className="lc-body">
            <Shards />
            {splash}
          </div>
          {pending && (
            <div className="lc-bar">
              <i />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="loader">
      <div className="l-inner">
        <Shards />
        {splash}
      </div>
      {pending && <div className="fs-bar" />}
    </div>
  );
}
