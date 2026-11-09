// app_signin — master-password sign-in / create-account. Runs entirely in the app
// (any browser AND the Tauri webview — no WebAuthn, no password manager). On success
// it derives the account key from the password, sets it locally, saves the session,
// and advances to the recovery-key screen. A subtle link boots on sample data.

import React from "react";
import { AuthError, clientDeviceIdHex, loadSession, saveConfig, saveSession, setAccountKeyHex, setKeyringHex } from "@app/rpc-client";
import { cp, relayOrigin } from "../shared/cp";
import { isTauri, invoke } from "../shared/tauri";
import { useOb, MSG, billing, pwauth, rv, Title, Sub } from "./machine";
import { ARK_ACK_KEY } from "./RecoveryKey";
import { ObIcon } from "./icons";

/** Master-password strength rules, shown as a live checklist on the CREATE-ACCOUNT screen
 *  (all at once). Sign-in never runs these — it only reports invalid credentials. */
const PW_RULES: { label: string; test: (pw: string) => boolean }[] = [
  { label: "At least 8 characters", test: (pw) => pw.length >= 8 },
  { label: "A capital letter", test: (pw) => /[A-Z]/.test(pw) },
  { label: "A number", test: (pw) => /[0-9]/.test(pw) },
  { label: "A special character", test: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

export function SignIn(): JSX.Element {
  const { patch, go, runLoader, onComplete } = useOb();
  const [mode, setMode] = React.useState<"signin" | "signup">("signin");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);

  const signup = mode === "signup";
  const pwChecks = PW_RULES.map((r) => ({ label: r.label, ok: r.test(password) }));
  const pwValid = pwChecks.every((c) => c.ok);
  const linkBtn: React.CSSProperties = {
    background: "none",
    border: 0,
    padding: 0,
    font: "inherit",
    color: "var(--o)",
    cursor: "pointer",
    textDecoration: "underline",
  };

  const finish = (
    res: { account: string; token: string; arkHex: string; keyringHex?: string[]; recoveryKeyHex?: string },
    em: string,
  ) => {
    // The whole ring, not just the newest key: a device signing in during a rotation needs
    // the previous key too, or the files not yet re-wrapped will not open.
    if (res.keyringHex?.length) setKeyringHex(res.keyringHex);
    else setAccountKeyHex(res.arkHex);
    saveSession({ token: res.token, account: res.account, email: em, expiresAt: Date.now() + 3600_000 });
    // The recovery key is held in state only, never persisted: it is the whole secret and
    // the server keeps nothing that could reproduce it. app_secure shows it once.
    patch({ email: em, account: res.account, recoveryKey: res.recoveryKeyHex ?? null });
  };

  const submit = () => {
    const em = email.trim();
    const pw = password;
    if (signup) {
      // Create account: enforce the case requirements (the checklist shows all of them at once).
      if (!em) return setErr("Enter your account email.");
      if (!pwValid) return setErr("Your password doesn't meet the requirements below.");
      if (pw !== confirm) return setErr("Passwords don't match.");
    } else {
      // Sign in: no case requirements — the only thing we surface is invalid credentials.
      if (!em || !pw) return setErr("Invalid email or password.");
    }
    setErr(null);
    // A returning user (logging in on a fresh device/browser) with a license + a host already
    // on the account should land on the dashboard, not replay the whole setup. `adopted` is
    // set inside run() and consumed by onDone to pick the destination. `localHost` takes
    // priority: if THIS machine is the account's own host, it lands on its status view instead.
    let adopted = false;
    let localHost = false;
    // True when this sign-in minted a recovery key for an account that had none, so the
    // routing below can show it even though the account acknowledged the old screen.
    let mintedRecovery = false;
    runLoader({
      variant: "modal",
      messages: MSG.signin,
      run: async () => {
        let account: string;
        if (signup) {
          const res = await pwauth().register(em, pw);
          finish(res, em);
          account = res.account;
        } else {
          try {
            const res = await pwauth().login(em, pw);
            // Accounts created before recovery keys existed have no recovery blob. This is
            // the one moment the ARK is in hand and the account is proven, so mint one now
            // rather than leaving them permanently unrecoverable.
            const rk = res.hasRecovery ? null : await pwauth().ensureRecovery(res.token, res.arkHex);
            if (rk) mintedRecovery = true;
            finish(rk ? { ...res, recoveryKeyHex: rk } : res, em);
            account = res.account;
          } catch (e) {
            // Any credential failure (wrong password OR no such account) reads the same, so we
            // don't leak whether the email is registered — just "invalid credentials".
            if (e instanceof AuthError) throw new Error("Invalid email or password.");
            throw e;
          }
        }
        // Register this device as an approved client (owner's own device → auto-approved) so
        // hosts add it to their allowlist and accept the console's connection. Best-effort:
        // a transient failure here shouldn't block sign-in (it retries on the next launch).
        try {
          await cp().registerDevice(clientDeviceIdHex(), { role: "client", name: "This device" });
        } catch {
          /* non-fatal */
        }
        // Is THIS machine the account's own host? (Desktop only: a local pc-daemon wrote
        // host.json for this account.) If so it should land on its own status view, so skip the
        // client-adopt below and let onDone route to host_live.
        if (isTauri()) {
          try {
            const cfg = await invoke<{ account?: string } | null>("host_daemon_config");
            if (cfg?.account && cfg.account === account) localHost = true;
          } catch {
            /* not a host / no daemon — treat as a normal client */
          }
        }
        // Returning-user adopt: if the account already has a license AND a published host,
        // save the license + a host connection and skip straight to the dashboard.
        if (!signup && !localHost) {
          try {
            const [lic, hosts] = await Promise.all([
              billing().getLicense(account),
              cp().listHosts(account),
            ]);
            if (lic && hosts.length) {
              localStorage.setItem("pc.license", JSON.stringify(lic));
              const host = hosts.find((h) => h.agreement_pub) ?? hosts[0];
              // No quotaBytes: adopting an existing host, not (re)allocating it.
              saveConfig({ relayUrl: relayOrigin(), account, hostPub: host.agreement_pub ?? "" });
              adopted = true;
            }
          } catch {
            /* fall back to onboarding if discovery fails */
          }
        }
      },
      onDone: () => {
        if (localHost) return go("host_live");
        if (adopted) return onComplete();
        // Show the recovery-key screen only the first time this account signs in; once it has
        // been acknowledged (saved), later sign-ins skip straight to host setup. finish() has
        // already saved the session, so the account is readable here.
        const account = loadSession()?.account ?? null;
        // A freshly minted key must be shown even to an account that acknowledged the old
        // (raw-ARK) screen: it has never seen this key, and it is the only copy.
        if (mintedRecovery) return go("app_secure");
        const acked = !!account && localStorage.getItem(ARK_ACK_KEY) === account;
        go(acked ? "dock_intro" : "app_secure");
      },
    });
  };

  return (
    <>
      <Title>{signup ? "Create your account." : "Sign in to set up your cloud."}</Title>
      <Sub>
        {signup
          ? "Your master password unlocks your encrypted account on every device. We never see it, so it can't be reset. You'll get a recovery key next: that is what gets you back in if you forget it."
          : "Sign in with your email and master password to finish setting up Sharedock on this Mac."}
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
            <h4>{signup ? "Create your Sharedock account" : "Sign in to Sharedock"}</h4>
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
              <input
                className="input"
                type="password"
                autoComplete={signup ? "new-password" : "current-password"}
                placeholder="Password"
                aria-label="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {signup && (
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Confirm password"
                  aria-label="Confirm password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              )}
            </div>
            {signup && (
              <ul className="pwreqs" aria-label="Password requirements">
                {pwChecks.map((c) => (
                  <li key={c.label} className={`pwreq ${c.ok ? "ok" : ""}`}>
                    <span className="pwreq-mk" aria-hidden="true">
                      {c.ok ? <ObIcon name="check" size={10} /> : null}
                    </span>
                    {c.label}
                  </li>
                ))}
              </ul>
            )}
            <button className="btn btn-primary" type="submit" style={{ width: "100%", marginTop: 6 }}>
              {signup ? "Create account" : "Sign in"}
            </button>
            {!signup && (
              <button type="button" style={{ ...linkBtn, marginTop: 10 }} onClick={() => go("app_recover")}>
                Forgot your password?
              </button>
            )}
            {err && (
              <p style={{ color: "var(--amber)", margin: "4px 0 0" }} role="alert">
                {err}
              </p>
            )}
          </form>
        </div>
        <div className="note rv" style={rv(2, { marginTop: 20 })}>
          <span className="ni">
            <ObIcon name="shield" />
          </span>
          <p>
            {signup ? (
              <>
                Already have an account?{" "}
                <button type="button" style={linkBtn} onClick={() => (setMode("signin"), setErr(null))}>
                  Sign in
                </button>
                .
              </>
            ) : (
              <>
                No account yet?{" "}
                <button type="button" style={linkBtn} onClick={() => (setMode("signup"), setErr(null))}>
                  Create one
                </button>
                . You&rsquo;ll buy a license next.
              </>
            )}
          </p>
        </div>
      </div>
    </>
  );
}
