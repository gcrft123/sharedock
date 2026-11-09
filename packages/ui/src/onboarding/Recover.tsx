// app_recover — get back in with the recovery key after a forgotten master password.
//
// This is the screen the product promised and did not have. The recovery key unwraps a
// server-held copy of the account root key on THIS device; the new password re-wraps the
// same ARK, so nothing already stored has to be re-encrypted and no file becomes
// unreadable. The control plane never sees the recovery key, the ARK, or either password.

import React from "react";
import { clientDeviceIdHex, saveSession, setAccountKeyHex, setKeyringHex } from "@app/rpc-client";
import { cp } from "../shared/cp";
import { useOb, MSG, pwauth, rv, Title, Sub } from "./machine";
import { ObIcon } from "./icons";

/** Same rules as account creation: recovery sets a real password, not a weaker one. */
const PW_RULES: { label: string; test: (pw: string) => boolean }[] = [
  { label: "At least 8 characters", test: (pw) => pw.length >= 8 },
  { label: "A capital letter", test: (pw) => /[A-Z]/.test(pw) },
  { label: "A number", test: (pw) => /[0-9]/.test(pw) },
  { label: "A special character", test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

export function Recover(): JSX.Element {
  const { state, patch, go, runLoader } = useOb();
  const [email, setEmail] = React.useState(state.email ?? "");
  const [key, setKey] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);

  const checks = PW_RULES.map((r) => ({ label: r.label, ok: r.test(password) }));
  const valid = checks.every((c) => c.ok);
  // Forgiving input: people transcribe this from paper, so spaces, newlines and case are
  // all stripped before it is parsed. 32 bytes is 64 hex characters.
  const cleanKey = key.replace(/[^0-9a-fA-F]/g, "").toLowerCase();

  const submit = () => {
    const em = email.trim();
    if (!em) return setErr("Enter your account email.");
    if (cleanKey.length !== 64) return setErr("That recovery key doesn't look complete. It's 64 characters.");
    if (!valid) return setErr("Your new password doesn't meet the requirements below.");
    if (password !== confirm) return setErr("Passwords don't match.");
    setErr(null);

    runLoader({
      variant: "modal",
      messages: MSG.recover,
      run: async () => {
        const res = await pwauth().recover(em, cleanKey, password);
        if (res.keyringHex?.length) setKeyringHex(res.keyringHex);
        else setAccountKeyHex(res.arkHex);
        saveSession({ token: res.token, account: res.account, email: em, expiresAt: Date.now() + 3600_000 });
        patch({ email: em, account: res.account });
        // Register this device so hosts will serve it, exactly as sign-in does. The session
        // is already saved above, so cp() picks it up.
        try {
          await cp().registerDevice(clientDeviceIdHex(), { role: "client", name: "This device" });
        } catch {
          /* non-fatal: the owner can approve it from the dashboard instead */
        }
      },
      onDone: () => go("dock_intro"),
    });
  };

  return (
    <>
      <Title>Use your recovery key.</Title>
      <Sub>
        Enter the key you saved when you created your account, and choose a new master password.
        Your files are not re-encrypted and nothing is lost: the key unlocks the same account.
      </Sub>
      <div className="o-body">
        <div className="osd rv" style={rv(1)}>
          <form
            className="ob"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="fp">
              <ObIcon name="key" size={54} />
            </div>
            <h4>Recover your account</h4>
            <div className="field" style={{ width: "100%" }}>
              <input
                className="input"
                type="email"
                autoComplete="username"
                placeholder="you@example.com"
                aria-label="Account email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <textarea
                className="input"
                rows={3}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                placeholder="Recovery key"
                aria-label="Recovery key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                style={{ resize: "vertical", fontFamily: "var(--mono)" }}
              />
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                placeholder="New password"
                aria-label="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                placeholder="Confirm new password"
                aria-label="Confirm new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <ul className="pwreqs" aria-label="Password requirements">
              {checks.map((c) => (
                <li key={c.label} className={`pwreq ${c.ok ? "ok" : ""}`}>
                  <span className="pwreq-mk" aria-hidden="true">
                    {c.ok ? <ObIcon name="check" size={10} /> : null}
                  </span>
                  {c.label}
                </li>
              ))}
            </ul>
            {err && (
              <p style={{ color: "var(--amber)", margin: "4px 0 0" }} role="alert">
                {err}
              </p>
            )}
            <button className="btn btn-primary" type="submit">
              Recover account
            </button>
          </form>
        </div>
        <div className="actions rv" style={rv(2)}>
          <button className="btn" onClick={() => go("app_signin")}>
            &larr; Back to sign in
          </button>
        </div>
      </div>
    </>
  );
}
