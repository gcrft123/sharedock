// Security, Network and About — the settings categories that used to render "No options yet".
//
// They were empty because nothing existed behind them. That changed: address confirmation,
// recovery keys, licence re-delivery, data export and account deletion are all real now, and
// every one of them was invisible in the product. An account could have no recovery key at
// all and nothing anywhere would say so.
//
// Nothing here is invented to fill space. Categories with nothing real behind them were
// removed from the sidebar instead (see SettingsModal), because a nav item that leads to an
// apology is worse than one that is not there.

import React from "react";
import { loadSession, rotateAccountKey, type AccountStatus, type RotateProgress } from "@app/rpc-client";
import { cp, CONTROL_URL } from "../shared/cp";
import { pwauth } from "../onboarding/machine";
import { Icon } from "./icons";
import { useApi } from "../shared/ApiProvider";
import { isTauri } from "../shared/tauri";

/** Small async helper: run once on mount, expose {data, error, loading, reload}. */
function useAsync<T>(fn: () => Promise<T>, deps: React.DependencyList) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fn()
      .then((d) => !cancelled && (setData(d), setError(null)))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, loading, reload: () => setN((x) => x + 1) };
}

/** A labelled row with a value and an optional action, matching the Hosts page rows. */
function Row({
  title,
  detail,
  action,
}: {
  title: string;
  detail: React.ReactNode;
  action?: React.ReactNode;
}): JSX.Element {
  // Buttons sit as direct siblings of `.sr-main`, matching the rows on the Hosts page.
  return (
    <div className="set-row">
      <span className="sr-main">
        <b>{title}</b>
        <span>{detail}</span>
      </span>
      {action}
    </div>
  );
}

export function SecurityPage(): JSX.Element {
  const meQ = useAsync<AccountStatus>(() => cp().me(), []);
  const { api } = useApi();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [rotatePw, setRotatePw] = React.useState("");
  const [rotating, setRotating] = React.useState<RotateProgress | null>(null);
  const [newRecovery, setNewRecovery] = React.useState<string | null>(null);

  const rotate = async () => {
    const session = loadSession();
    if (!session) return setErr("Your session expired. Sign in again.");
    setErr(null);
    setMsg(null);
    setBusy("rotate");
    setRotating({ done: 0, total: 0, phase: "scanning" });
    try {
      const r = await rotateAccountKey({
        api,
        controlUrl: CONTROL_URL,
        sessionToken: session.token,
        email: session.email,
        password: rotatePw,
        onProgress: setRotating,
      });
      setNewRecovery(r.recoveryKeyHex);
      // A partial rotation keeps the old key, so it has NOT revoked anything yet. Say so.
      setMsg(
        r.failed === 0
          ? `Done. ${r.filesRewrapped} file${r.filesRewrapped === 1 ? "" : "s"} re-keyed. Old devices can no longer read them.`
          : `${r.filesRewrapped} re-keyed, ${r.failed} could not be reached. Your old key is still in use until those are done, so run this again.`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setRotating(null);
      setRotatePw("");
      meQ.reload();
    }
  };

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setErr(null);
    setMsg(null);
    try {
      setMsg(await fn());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      meQ.reload();
    }
  };

  const me = meQ.data;

  return (
    <div className="set-page">
      <section className="set-sec">
        <div className="set-sec-h">Sign-in</div>
        <div className="set-list">
          <Row
            title="Master password"
            detail="Derived on this device. We never receive it, so it cannot be reset, only recovered."
          />
          <Row
            title="Recovery key"
            detail={
              meQ.loading
                ? "Checking…"
                : me?.hasRecoveryKey
                  ? "Set. This is the only way back in if you forget your password."
                  : "Not set yet. Sign out and back in to create one."
            }
          />
          <Row
            title="Email address"
            detail={
              meQ.loading
                ? "Checking…"
                : me?.emailVerified
                  ? `${me.email} · confirmed`
                  : `${me?.email ?? "—"} · not confirmed`
            }
            action={
              me && !me.emailVerified ? (
                <button
                  className="btn btn-sm"
                  disabled={busy != null}
                  onClick={() =>
                    run("verify", async () => {
                      const r = await cp().resendVerification();
                      return r.alreadyVerified ? "Already confirmed." : "Confirmation link sent.";
                    })
                  }
                >
                  {busy === "verify" ? "…" : "Resend"}
                </button>
              ) : undefined
            }
          />
          {/* Stated rather than hidden: people notice being signed out and deserve to know
              it is deliberate rather than a fault. */}
          <Row title="Sessions" detail="A sign-in lasts about an hour on this device, then asks again." />
        </div>
      </section>

      <section className="set-sec">
        <div className="set-sec-h">Rotate your account key</div>
        {/* The honest framing. Retiring a device stops it reaching your hosts, which covers a
            laptop sold or lost. It does not take back the key that device already holds, and
            only rotation does. Saying that plainly is the point: somebody who thinks retiring
            is enough will not do this when they need to. */}
        <p className="set-hint">
          Retiring a device stops it reaching your hosts within a minute. It does not take back
          the account key that device already has. If a machine was stolen, or you think a copy
          of your files got out, rotate: it gives every file a new key that old devices cannot
          read.
        </p>
        <p className="set-hint">
          Your files are not re-uploaded and not re-encrypted, so this is quick even for a large
          drive. You will get a new recovery key at the end, because the old one unlocks the old
          account key. Connect to a host first.
        </p>
        {!rotating ? (
          <div className="set-list">
            <Row
              title="Confirm with your password"
              detail={
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  aria-label="Password"
                  value={rotatePw}
                  onChange={(e) => setRotatePw(e.target.value)}
                  style={{ marginTop: 6, maxWidth: 280 }}
                />
              }
              action={
                <button
                  className="btn btn-sm"
                  disabled={!rotatePw || busy != null}
                  onClick={() => rotate()}
                >
                  Rotate key
                </button>
              }
            />
          </div>
        ) : (
          <p className="set-hint">
            {rotating.phase === "scanning"
              ? "Finding your files…"
              : rotating.phase === "finishing"
                ? "Finishing…"
                : `Re-keying ${rotating.done} of ${rotating.total}…`}
          </p>
        )}
        {newRecovery && (
          <div className="set-list">
            <Row
              title="Your new recovery key"
              detail={
                <span style={{ wordBreak: "break-all", fontFamily: "var(--mono)" }}>{newRecovery}</span>
              }
            />
          </div>
        )}
        {msg && <p className="set-hint">{msg}</p>}
        {err && (
          <p className="set-hint" role="alert" style={{ color: "var(--amber)" }}>
            {err}
          </p>
        )}
      </section>
    </div>
  );
}

export function NetworkPage(): JSX.Element {
  const { api, conn } = useApi();
  const [path, setPath] = React.useState<string | null>(null);

  // One read when the page opens. This is a status readout on a screen somebody deliberately
  // opened, not a live instrument, so it does not need the dashboard's polling loop.
  React.useEffect(() => {
    if (conn.mode !== "real") {
      setPath(null);
      return;
    }
    let alive = true;
    api
      .getConnection()
      .then((c) => alive && setPath(c?.path ?? null))
      .catch(() => alive && setPath(null));
    return () => {
      alive = false;
    };
  }, [api, conn.mode]);

  return (
    <div className="set-page">
      <section className="set-sec">
        <div className="set-sec-h">Connection</div>
        <div className="set-list">
          <Row
            title="Transport"
            detail={
              path === "DIRECT_P2P"
                ? "Direct. Files move between your devices without touching our servers."
                : path
                  ? "Relay. Encrypted traffic passes through our servers because a direct connection was not available."
                  : "Not connected to a host right now."
            }
          />
          {/* The web build cannot open a raw QUIC socket, so it is always relayed. Saying so
              is why the dashboard reports RELAY honestly instead of claiming direct. */}
          {!isTauri() && (
            <Row
              title="Why relay here"
              detail="A browser cannot open the direct connection the desktop app uses. Install the desktop app for direct transfers on your own network."
            />
          )}
          <Row title="Coordination service" detail={CONTROL_URL || "same origin"} />
        </div>
        <p className="set-hint">
          Whatever the path, files are encrypted on your device before they leave it. The relay
          carries ciphertext it cannot read.
        </p>
      </section>
    </div>
  );
}

export function AboutPage(): JSX.Element {
  const session = loadSession();
  return (
    <div className="set-page">
      <section className="set-sec">
        <div className="set-sec-h">Sharedock</div>
        <div className="set-list">
          <Row title="Account" detail={session?.email ?? "Not signed in"} />
          <Row title="Coordination service" detail={CONTROL_URL || "same origin"} />
          <Row title="Surface" detail={isTauri() ? "Desktop app" : "Web console"} />
        </div>
      </section>

      <section className="set-sec">
        <div className="set-sec-h">Legal</div>
        <div className="set-list">
          <Row
            title="Terms of sale and use"
            detail={<a href="/legal/terms" target="_blank" rel="noreferrer">Open</a>}
          />
          <Row
            title="Privacy policy"
            detail={<a href="/legal/privacy" target="_blank" rel="noreferrer">Open</a>}
          />
          <Row
            title="Refund policy"
            detail={<a href="/legal/refunds" target="_blank" rel="noreferrer">Open</a>}
          />
        </div>
      </section>
    </div>
  );
}

/**
 * Licence re-delivery, data export and account deletion. Rendered inside the Account page,
 * because they are all things you do to the account itself.
 */
export function AccountDangerZone(): JSX.Element {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const [password, setPassword] = React.useState("");

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setErr(null);
    setMsg(null);
    try {
      setMsg(await fn());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <section className="set-sec">
        <div className="set-sec-h">Your data</div>
        <div className="set-list">
          <Row
            title="Email me my licence"
            detail="A perpetual licence is worth keeping in an inbox, where it survives a reinstall."
            action={
              <button
                className="btn btn-sm"
                disabled={busy != null}
                onClick={() =>
                  run("lic", async () => {
                    const r = await cp().resendLicense();
                    // Honest: mail may simply not be configured on this deployment.
                    return r.sent ? `Sent to ${r.to}.` : "Email is not set up on this service yet.";
                  })
                }
              >
                {busy === "lic" ? "…" : "Send"}
              </button>
            }
          />
          <Row
            title="Download my data"
            detail="Everything this service stores about you. Not your files: those are already yours."
            action={
              <button
                className="btn btn-sm"
                disabled={busy != null}
                onClick={() =>
                  run("exp", async () => {
                    const data = await cp().exportAccount();
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "sharedock-account.json";
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                    return "Downloaded.";
                  })
                }
              >
                {busy === "exp" ? "…" : "Download"}
              </button>
            }
          />
        </div>
      </section>

      <section className="set-sec">
        <div className="set-sec-h">Delete account</div>
        <p className="set-hint">
          This erases your account, your devices and your licence from this service. It cannot be
          undone and there is no recovery. Your files stay on your own hosts: to remove those,
          delete the Sharedock folder on each host machine.
        </p>
        {!confirming ? (
          <button className="btn btn-sm" onClick={() => setConfirming(true)}>
            <span className="bi">
              <Icon name="trash" size={14} />
            </span>
            Delete my account
          </button>
        ) : (
          <div className="set-list">
            {/* The password again, not just the open session: a laptop left unlocked in a
                cafe must not be enough to destroy somebody's account. */}
            <Row
              title="Confirm with your password"
              detail={
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  aria-label="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ marginTop: 6, maxWidth: 280 }}
                />
              }
              action={
                <>
                  <button className="btn btn-sm" onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    disabled={busy != null || !password}
                    onClick={() =>
                      run("del", async () => {
                        const authKey = await pwauth().authKeyFor(loadSession()?.email ?? "", password);
                        await cp().deleteAccount(authKey);
                        localStorage.clear();
                        location.reload();
                        return "Deleted.";
                      })
                    }
                  >
                    {busy === "del" ? "…" : "Delete permanently"}
                  </button>
                </>
              }
            />
          </div>
        )}
        {msg && <p className="set-hint">{msg}</p>}
        {err && (
          <p className="set-hint" role="alert" style={{ color: "var(--amber)" }}>
            {err}
          </p>
        )}
      </section>
    </>
  );
}
