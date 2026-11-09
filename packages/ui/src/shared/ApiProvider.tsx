import React from "react";
import {
  getApi,
  connectRealApi,
  createEmptyApi,
  loadConfig,
  saveConfig,
  clearConfig,
} from "@app/rpc-client";
import type { DriveApi, HostConnConfig } from "@app/rpc-client";
import { cp } from "./cp";
import { isTauri } from "./tauri";
import { connectNativeApi } from "./nativeDrive";

// The DriveApi lifecycle for the whole app, lifted verbatim from the wireframe
// DriveConsole: mock by default, auto-connect to a saved host on mount, coalesced
// live-sync re-lists on remote change, and clean reconnect/disconnect. Every screen
// consumes it through `useApi()`; nobody constructs a DriveApi directly.

export type ConnState =
  | { mode: "mock" }
  | { mode: "connecting" }
  | { mode: "real"; host: string; direct: boolean }
  | { mode: "error"; message: string }
  | { mode: "disconnected"; message: string };

interface ApiContextValue {
  api: DriveApi;
  conn: ConnState;
  /** Bumped on every mutation + coalesced remote change; put it in useAsync deps. */
  rev: number;
  reload: () => void;
  connect: (cfg: HostConnConfig) => Promise<void>;
  disconnect: () => void;
}

const ApiContext = React.createContext<ApiContextValue | null>(null);

export function useApi(): ApiContextValue {
  const ctx = React.useContext(ApiContext);
  if (!ctx) throw new Error("useApi must be used within <ApiProvider>");
  return ctx;
}

export function ApiProvider({ children }: { children: React.ReactNode }) {
  const hasConfig = React.useMemo(() => !!loadConfig(), []);
  const [api, setApi] = React.useState<DriveApi>(() => (hasConfig ? createEmptyApi() : getApi()));
  const [conn, setConn] = React.useState<ConnState>(() =>
    hasConfig ? { mode: "connecting" } : { mode: "mock" },
  );
  const [rev, setRev] = React.useState(0);
  const reload = React.useCallback(() => setRev((n) => n + 1), []);

  const apiRef = React.useRef(api);
  apiRef.current = api;

  // Live sync: the host pushes a notification whenever the account changes (this or
  // another client). Coalesce a burst into one re-list so a multi-file change is a
  // single refresh, not a storm.
  const changeTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onRemoteChange = React.useCallback(() => {
    if (changeTimer.current) return;
    changeTimer.current = setTimeout(() => {
      changeTimer.current = undefined;
      setRev((n) => n + 1);
    }, 250);
  }, []);

  const connect = React.useCallback(
    async (cfg: HostConnConfig) => {
      apiRef.current.close?.();
      setConn({ mode: "connecting" });
      setApi(createEmptyApi());
      try {
        // Production relays gate /signal on an admission token (dev admits tokenless). Mint one
        // for this account+client; without it the deployed relay rejects the console's connection.
        const token = await cp()
          .relayToken(cfg.account, "client")
          .then((r) => r.token)
          .catch(() => undefined);
        const onClose = (err: Error) => {
          setApi(createEmptyApi());
          setConn({ mode: "disconnected", message: err.message });
          setRev((n) => n + 1);
        };
        // Desktop: prefer the NATIVE transport (direct Iroh QUIC → LAN speed, relay fallback);
        // if it can't establish at all, fall back to the webview relay so there's no regression.
        // The browser has no native path, so it always uses the relay.
        let real: DriveApi;
        let direct = false;
        if (isTauri()) {
          try {
            const r = await connectNativeApi(cfg, onClose, onRemoteChange, token);
            real = r.api;
            direct = r.path === "direct";
          } catch {
            real = await connectRealApi(cfg, onClose, onRemoteChange, token);
          }
        } else {
          real = await connectRealApi(cfg, onClose, onRemoteChange, token);
        }
        // Apply the owner's partition allocation to the host (idempotent; the host clamps to
        // the free disk). Only the allocator's config carries quotaBytes — adopt-only configs
        // (returning user / second device) skip this and just read the host's quota.
        if (cfg.quotaBytes) {
          try {
            await real.setQuota(cfg.quotaBytes);
          } catch {
            /* non-fatal: the host keeps its current quota; the dashboard still connects */
          }
        }
        saveConfig(cfg);
        setApi(real);
        setConn({ mode: "real", host: cfg.hostPub.slice(0, 8), direct });
        setRev((n) => n + 1);
      } catch (e) {
        setApi(createEmptyApi());
        setConn({ mode: "error", message: e instanceof Error ? e.message : String(e) });
      }
    },
    [onRemoteChange],
  );

  const disconnect = React.useCallback(() => {
    apiRef.current.close?.();
    clearConfig();
    setApi(getApi());
    setConn({ mode: "mock" });
    setRev((n) => n + 1);
  }, []);

  const autoConnected = React.useRef(false);
  React.useEffect(() => {
    if (autoConnected.current) return;
    autoConnected.current = true;
    const cfg = loadConfig();
    if (cfg) connect(cfg);
  }, [connect]);

  const value = React.useMemo<ApiContextValue>(
    () => ({ api, conn, rev, reload, connect, disconnect }),
    [api, conn, rev, reload, connect, disconnect],
  );

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}
