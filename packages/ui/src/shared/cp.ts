// The single control-plane HTTP client for the app. The base URL is resolved at load
// time from (in order): a runtime `localStorage["pc.control_url"]` override, the build
// env `VITE_CONTROL_URL`, then the local `wrangler dev` default. The runtime override lets
// a PRE-BUILT app (e.g. the desktop bundle) point at any control plane — a dev tunnel, a
// staging deploy — without rebuilding: set it and reload.
//
//   localStorage.setItem("pc.control_url", "https://xyz.trycloudflare.com"); location.reload();
//
// The session bearer is read live so the same client works before and after sign-in.

import { createCpClient, loadSession, loadLicense, type CpClient } from "@app/rpc-client";

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;

function resolveControlUrl(): string {
  let override: string | null = null;
  try {
    override = localStorage.getItem("pc.control_url");
  } catch {
    /* no storage */
  }
  // Default to the SAME ORIGIN — correct when the web app is served from the control-plane
  // Worker (one deploy/tunnel for API + relay + app). Local `vite dev` and the desktop app
  // (tauri://localhost) override it via VITE_CONTROL_URL or localStorage["pc.control_url"].
  const sameOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost:8787";
  const raw = override || env?.VITE_CONTROL_URL || sameOrigin;
  return raw.replace(/\/+$/, "");
}

/** Persist a runtime control-plane URL override (call `location.reload()` after). */
export function setControlUrl(url: string): void {
  localStorage.setItem("pc.control_url", url.replace(/\/+$/, ""));
}

/** The resolved control-plane origin (HTTP(S)). */
export const CONTROL_URL: string = resolveControlUrl();

/** The relay/signaling origin the WebSocket transport dials (`<origin>/signal`). Defaults to
 *  the control-plane origin as ws(s) — one tunnel/deploy serves both the API and the relay
 *  DO — unless `VITE_RELAY_URL` overrides it (e.g. a standalone dev relay). */
export function relayOrigin(): string {
  const override = (() => {
    try {
      return localStorage.getItem("pc.relay_url");
    } catch {
      return null;
    }
  })();
  const raw = override || env?.VITE_RELAY_URL;
  if (raw) return raw.replace(/\/+$/, "");
  return CONTROL_URL.replace(/^http/, "ws"); // https→wss, http→ws
}

let singleton: CpClient | null = null;

export function cp(): CpClient {
  if (!singleton) {
    singleton = createCpClient({
      baseUrl: CONTROL_URL,
      session: () => loadSession()?.token ?? null,
      // Durable fallback for discovery so the native P2P path survives a lapsed session.
      license: () => loadLicense()?.license ?? null,
    });
  }
  return singleton;
}
