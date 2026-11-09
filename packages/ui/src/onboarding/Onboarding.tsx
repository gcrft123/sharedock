// Onboarding — the screen-machine provider ported from the prototype's IIFE. Holds the
// ObState, the current screen + history stack (go/back), and the loader lifecycle, and
// renders the rail + main window + loader overlay. Each screen consumes the context via
// useOb(). The parent app mounts <Onboarding onComplete={…}/> once the user needs setup.

import React from "react";
import "./onboarding.css";
import {
  ObContext,
  SCREEN_META,
  initialState,
  errText,
  type ObState,
  type ScreenId,
  type LoaderCfg,
  type ObCtxValue,
} from "./machine";
import { OnboardRail } from "./OnboardRail";
import { Loader, type LoaderStatus } from "./Loader";
import { SignIn } from "./SignIn";
import { Recover } from "./Recover";
import { RecoveryKey } from "./RecoveryKey";
import { DockIntro } from "./DockIntro";
import { DockTier } from "./DockTier";
import { DockWhere } from "./DockWhere";
import { DockRemote } from "./DockRemote";
import { DockAllocate } from "./DockAllocate";
import { HostAdded } from "./HostAdded";
import { Topology } from "./Topology";
import { Done } from "./Done";
import { HostJoin } from "./HostJoin";
import { HostName } from "./HostName";
import { HostPending } from "./HostPending";
import { HostLive } from "./HostLive";

const SCREENS: Record<ScreenId, () => JSX.Element> = {
  app_signin: SignIn,
  app_recover: Recover,
  app_secure: RecoveryKey,
  dock_intro: DockIntro,
  dock_tier: DockTier,
  dock_where: DockWhere,
  dock_remote: DockRemote,
  dock_allocate: DockAllocate,
  host_added: HostAdded,
  topology: Topology,
  done: Done,
  host_join: HostJoin,
  host_name: HostName,
  host_pending: HostPending,
  host_live: HostLive,
};

interface LoaderState {
  cfg: LoaderCfg;
  status: LoaderStatus;
  error?: string;
}

export function Onboarding({
  onComplete,
  initialScreen = "app_signin",
}: {
  onComplete: () => void;
  /** Screen to open on first render (default the sign-in flow). The desktop app passes
   *  "host_live" when this machine is itself the signed-in account's host, so it lands on
   *  its own status view rather than the client dashboard. */
  initialScreen?: ScreenId;
}): JSX.Element {
  const [state, setState] = React.useState<ObState>(initialState);
  const [current, setCurrentState] = React.useState<ScreenId>(initialScreen);
  const [loader, setLoader] = React.useState<LoaderState | null>(null);
  const [launching, setLaunching] = React.useState(false);

  const currentRef = React.useRef<ScreenId>(initialScreen);
  const histRef = React.useRef<ScreenId[]>([]);

  const setCurrent = React.useCallback((id: ScreenId) => {
    currentRef.current = id;
    setCurrentState(id);
  }, []);

  const patch = React.useCallback((p: Partial<ObState>) => setState((s) => ({ ...s, ...p })), []);
  const set = React.useCallback((fn: (s: ObState) => ObState) => setState(fn), []);

  const go = React.useCallback(
    (id: ScreenId) => {
      histRef.current.push(currentRef.current);
      setCurrent(id);
    },
    [setCurrent],
  );

  const back = React.useCallback(() => {
    const prev = histRef.current.pop();
    if (prev) setCurrent(prev);
  }, [setCurrent]);

  const launch = React.useCallback(() => {
    setLaunching((on) => {
      if (on) return on;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      window.setTimeout(onComplete, reduce ? 160 : 880);
      return true;
    });
  }, [onComplete]);

  const runLoader = React.useCallback((cfg: LoaderCfg) => {
    setLoader({ cfg, status: "pending" });
    cfg
      .run()
      .then(() => {
        setLoader(null);
        cfg.onDone();
      })
      .catch((e) => {
        setLoader({ cfg, status: "error", error: errText(e) });
      });
  }, []);

  const ctx: ObCtxValue = React.useMemo(
    () => ({
      state,
      patch,
      set,
      go,
      back,
      canBack: histRef.current.length > 0,
      runLoader,
      onComplete,
      launch,
    }),
    [state, patch, set, go, back, runLoader, onComplete, launch],
  );

  const meta = SCREEN_META[current];
  const Screen = SCREENS[current];

  return (
    <ObContext.Provider value={ctx}>
      <div className={`shell ${meta.solo ? "solo" : ""}`}>
        {/* The setup-context rail: a four-phase progress tracker + live cloud readout +
            the real signed-in identity, keyed off the current screen's phase. Solo screens
            (host-join branch) stay bare. */}
        {!meta.solo && <OnboardRail current={current} state={state} />}
        <main className="main">
          <div id="root" key={current}>
            <div className="window">
              <div className="window-body">
                <Screen />
              </div>
            </div>
          </div>
        </main>
      </div>
      <div className="grain" aria-hidden="true" />
      {launching && (
        <div className="launch" aria-hidden="true">
          <div className="launch-mark">
            <i />
            <i />
            <i />
            <i />
          </div>
          <span className="launch-sweep" />
        </div>
      )}
      {loader && (
        <Loader
          variant={loader.cfg.variant}
          messages={loader.cfg.messages}
          status={loader.status}
          error={loader.error}
          onRetry={() => runLoader(loader.cfg)}
          onCancel={() => setLoader(null)}
        />
      )}
    </ObContext.Provider>
  );
}
