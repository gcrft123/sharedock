// app_secure — show the account's RECOVERY KEY so the user can back it up.
//
// This screen used to display the Account Root Key itself, which meant the downloaded file
// decrypted every file the user owned, forever, with no way to rotate it. It now shows a
// separate random key that unwraps a server-held copy of the ARK and nothing else; losing
// it costs recovery, not confidentiality. The ARK never leaves the device.
//
// A 256-bit key can't be exactly 12 words and no BIP39 wordlist is bundled, so it renders
// as grouped hex (chunks of 4). Copy → clipboard; Download .txt → Blob. The acknowledge
// checkbox gates Continue.

import React from "react";
import { loadSession } from "@app/rpc-client";
import { useOb, rv, Title, Sub } from "./machine";
import { ObIcon } from "./icons";

/** localStorage key marking that this account has already saved its recovery key, so the
 *  screen shows once (first sign-in) and is skipped on every later sign-in. */
export const ARK_ACK_KEY = "pc.ark_ack";

/** Split the 64-char hex key into numbered 4-char groups for the key grid. */
function groups(hex: string): { n: string; v: string }[] {
  const out: { n: string; v: string }[] = [];
  for (let i = 0; i < hex.length; i += 4) {
    out.push({ n: String(out.length + 1).padStart(2, "0"), v: hex.slice(i, i + 4) });
  }
  return out;
}

export function RecoveryKey(): JSX.Element {
  const { state, patch, go, back } = useOb();
  // Minted during registration (or when upgrading an older account) and held in onboarding
  // state only. Never persisted: this is the whole secret, and the server keeps nothing
  // that could reproduce it.
  const hex = state.recoveryKey ?? "";
  const cells = React.useMemo(() => groups(hex), [hex]);
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(hex);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the download path still works */
    }
  };

  const download = () => {
    try {
      const blob = new Blob([`Sharedock account recovery key\n\n${hex}\n`], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "sharedock-recovery-key.txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <Title>Save your recovery key.</Title>
      <Sub>
        Your account is protected by your master password. We never see it, so it can&rsquo;t be reset.
        Save this recovery key somewhere safe: it is the only way back in if you forget your password.
        It unlocks nothing on its own, and you can use it more than once.
      </Sub>
      <div className="o-body">
        <div className="rv" style={rv(1)}>
          <div className="keygrid">
            {cells.map((c) => (
              <span className="kw" key={c.n}>
                <em>{c.n}</em>
                {c.v}
              </span>
            ))}
          </div>
          <div className="keyacts">
            <button className="btn btn-sm" onClick={copy}>
              <ObIcon name="copy" /> {copied ? "Copied" : "Copy"}
            </button>
            <button className="btn btn-sm" onClick={download}>
              Download .txt
            </button>
          </div>
        </div>
        <label className={`check rv ${state.saved ? "on" : ""}`} style={rv(2)}>
          <input
            type="checkbox"
            checked={state.saved}
            onChange={(e) => patch({ saved: e.target.checked })}
            style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
          />
          <span className="cbx">
            <ObIcon name="check" />
          </span>
          <span className="ct">
            <b>I&rsquo;ve stored my recovery key somewhere safe.</b> I understand Sharedock can&rsquo;t recover it
            for me.
          </span>
        </label>
        <div className="actions rv" style={rv(3)}>
          <button className="btn" onClick={back}>
            &larr; Back
          </button>
          <span className="sp" />
          <button
            className="btn btn-primary"
            disabled={!state.saved}
            onClick={() => {
              // Remember that this account backed up its key, so subsequent sign-ins skip
              // straight past this screen (it only needs to be shown, and saved, once).
              const acct = loadSession()?.account ?? state.account;
              if (acct) {
                try {
                  localStorage.setItem(ARK_ACK_KEY, acct);
                } catch {
                  /* ignore private-mode storage failure */
                }
              }
              go("dock_intro");
            }}
          >
            Continue <ObIcon name="arrow" />
          </button>
        </div>
      </div>
    </>
  );
}
