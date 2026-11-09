import React from "react";
import { redeemShare } from "@app/rpc-client";
import { CONTROL_URL } from "./cp";
import { formatBytes } from "../format";

// Public redeem view for a share link `…/#share=<token>&k=<secret>`. Fetches the stored
// ciphertext + wrapped key from the control plane and decrypts it locally with the
// fragment secret (never sent to the server), then downloads the file. Zero-knowledge.

function parseShareHash(): { token: string; secret: string } | null {
  const h = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
  const p = new URLSearchParams(h);
  const token = p.get("share");
  const secret = p.get("k");
  return token && secret ? { token, secret } : null;
}

/** True when the current URL is a share link (App renders <ShareRedeem/> instead of the app). */
export function shareRedeemRequested(): boolean {
  return !!parseShareHash();
}

type State =
  | { status: "loading" }
  | { status: "done"; name: string; size: number }
  | { status: "error"; message: string };

export function ShareRedeem() {
  const [state, setState] = React.useState<State>({ status: "loading" });
  const download = React.useCallback((name: string, bytes: Uint8Array) => {
    const url = URL.createObjectURL(new Blob([bytes]));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  React.useEffect(() => {
    const parsed = parseShareHash();
    if (!parsed) {
      setState({ status: "error", message: "Malformed share link." });
      return;
    }
    let alive = true;
    redeemShare(CONTROL_URL, parsed.token, parsed.secret)
      .then(({ name, bytes }) => {
        if (!alive) return;
        download(name, bytes);
        setState({ status: "done", name, size: bytes.length });
      })
      .catch((e) => alive && setState({ status: "error", message: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [download]);

  const retry = () => {
    const parsed = parseShareHash();
    if (!parsed) return;
    setState({ status: "loading" });
    redeemShare(CONTROL_URL, parsed.token, parsed.secret)
      .then(({ name, bytes }) => {
        download(name, bytes);
        setState({ status: "done", name, size: bytes.length });
      })
      .catch((e) => setState({ status: "error", message: e instanceof Error ? e.message : String(e) }));
  };

  return (
    <div className="share-redeem">
      <div className="sr-card">
        <div className="sr-mark" aria-hidden="true">
          ◇
        </div>
        {state.status === "loading" && (
          <>
            <p className="t-label">Sharedock</p>
            <h1 className="sr-title">Decrypting…</h1>
            <p className="sr-sub">Fetching and decrypting this file in your browser.</p>
          </>
        )}
        {state.status === "done" && (
          <>
            <p className="t-label">Shared with you</p>
            <h1 className="sr-title">{state.name}</h1>
            <p className="sr-sub">{formatBytes(state.size)} · decrypted &amp; downloaded.</p>
            <button
              className="btn btn-primary"
              onClick={() => {
                const parsed = parseShareHash();
                if (parsed)
                  redeemShare(CONTROL_URL, parsed.token, parsed.secret).then(({ name, bytes }) => download(name, bytes));
              }}
            >
              Download again
            </button>
          </>
        )}
        {state.status === "error" && (
          <>
            <p className="t-label">Sharedock</p>
            <h1 className="sr-title">Can't open this link</h1>
            <p className="sr-sub">{state.message}</p>
            <button className="btn" onClick={retry}>
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
