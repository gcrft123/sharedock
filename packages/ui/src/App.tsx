import React from "react";
import { loadSession, loadConfig, refreshSessionIfNeeded } from "@app/rpc-client";
import { CONTROL_URL } from "./shared/cp";
import { ApiProvider } from "./shared/ApiProvider";
import { AppRoot } from "./shared/AppRoot";
import { ModalProvider } from "./shared/modal";
import { Onboarding } from "./onboarding/Onboarding";
import { ShareRedeem, shareRedeemRequested } from "./shared/ShareRedeem";
import { isTauri, invoke } from "./shared/tauri";

// Root of the Sharedock console. Onboarding gates the app: a first run (no passkey
// session / no license / no host configured) starts at sign-in and walks through
// purchase + host setup; once past that the app (dashboard / files / settings) renders
// on the real host (auto-connected by ApiProvider) or the mock. The "Explore with
// sample data" escape sets `pc.demo` to skip straight in for a no-backend demo.

function isOnboarded(): boolean {
  try {
    if (localStorage.getItem("pc.demo")) return true;
    return !!(loadSession() && localStorage.getItem("pc.license") && loadConfig());
  } catch {
    return false;
  }
}

function inDemo(): boolean {
  try {
    return !!localStorage.getItem("pc.demo");
  } catch {
    return false;
  }
}

/** Leave the "Explore with sample data" view — clear the flag and return to sign-in. */
function exitDemo(): void {
  try {
    localStorage.removeItem("pc.demo");
  } catch {
    /* ignore */
  }
  location.reload();
}

/** Is THIS machine (desktop only) the signed-in account's own host? The desktop app spawns a
 *  local `pc-daemon` when it's a host and persists `host.json`; `host_daemon_config` reports its
 *  account. If that matches the signed-in session, the machine should land on its own "this is a
 *  host" status view, not the client dashboard. Resolves false on web / on a non-host machine /
 *  when signed into a different account. */
async function isLocalHostMachine(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const cfg = await invoke<{ account?: string } | null>("host_daemon_config");
    const session = loadSession();
    return !!(cfg?.account && session && cfg.account === session.account);
  } catch {
    return false;
  }
}

export function App() {
  // On the desktop we must ask the Tauri side whether this is a host machine before choosing a
  // view, so start in "loading" there (a brief, invisible bg fill — long enough for one IPC
  // round-trip, and it keeps the boot guard happy by mounting a child). The web decides
  // synchronously.
  const [phase, setPhase] = React.useState<"loading" | "onboarding" | "app" | "host">(() =>
    isTauri() ? "loading" : isOnboarded() ? "app" : "onboarding",
  );

  React.useEffect(() => {
    if (phase !== "loading") return;
    let cancelled = false;
    isLocalHostMachine().then((host) => {
      if (cancelled) return;
      setPhase(host ? "host" : isOnboarded() ? "app" : "onboarding");
    });
    return () => {
      cancelled = true;
    };
  }, [phase]);

  // Keep the session alive while the app is open, and send the user back to sign-in when it
  // has genuinely lapsed. Sessions last an hour, and nothing used to renew them: the console
  // simply began 401ing while continuing to show whatever it had last loaded. One instance of
  // that presented as the wrong transport path, which is about as far from "you are signed
  // out" as a symptom gets.
  React.useEffect(() => {
    if (phase !== "app" && phase !== "host") return;
    let cancelled = false;
    const tick = () => {
      refreshSessionIfNeeded(CONTROL_URL).then((alive) => {
        // Only act on a definite expiry, and only from a screen that needs the session.
        if (!cancelled && !alive && loadSession()) setPhase("onboarding");
      });
    };
    tick();
    // Well inside the refresh window, so a sleeping laptop that wakes late still gets one
    // attempt before the token is past renewing.
    const id = setInterval(tick, 4 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase]);

  // A share link (…/#share=<token>&k=<secret>) opens the public redeem view, regardless
  // of sign-in state — a recipient need not have an account.
  if (shareRedeemRequested()) {
    return <ShareRedeem />;
  }

  if (phase === "loading") {
    return <div className="app-shell" style={{ minHeight: "100vh", background: "var(--bg)" }} aria-hidden="true" />;
  }
  // Host machine → its own status view (host_live). A returning sign-in on a host also detects
  // this and jumps there directly (see SignIn), so both paths converge on host_live.
  if (phase === "host") {
    return <Onboarding onComplete={() => setPhase("app")} initialScreen="host_live" />;
  }
  if (phase === "onboarding") {
    return <Onboarding onComplete={() => setPhase("app")} />;
  }
  return (
    <>
      <ModalProvider>
        <ApiProvider>
          <AppRoot />
        </ApiProvider>
      </ModalProvider>
      {inDemo() && (
        <button className="demo-exit" onClick={exitDemo}>
          Exit sample data
        </button>
      )}
    </>
  );
}
