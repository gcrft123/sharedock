// Thin access to the Tauri desktop bridge. In the plain browser these are inert
// (`isTauri()` is false, `invoke` throws) so callers must guard native-only paths.
// The webview exposes `window.__TAURI__.core.invoke` (withGlobalTauri: true).

type InvokeOptions = { headers?: Record<string, string> };
type TauriGlobal = {
  core: { invoke: (cmd: string, args?: unknown, options?: InvokeOptions) => Promise<unknown> };
};

function tauriGlobal(): TauriGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
}

/** True when running inside the Tauri desktop webview (native features available). */
export function isTauri(): boolean {
  return !!tauriGlobal();
}

/** Invoke a Tauri command. Throws if not running under Tauri — guard with isTauri(). */
export function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = tauriGlobal();
  if (!t) return Promise.reject(new Error(`Tauri command ${cmd} is only available in the desktop app`));
  return t.core.invoke(cmd, args ?? {}) as Promise<T>;
}

/**
 * Invoke a Tauri command with a RAW binary body (an ArrayBuffer) instead of a JSON args object.
 * Tauri sends the buffer as the raw IPC body (`InvokeBody::Raw`), so large payloads skip the
 * base64/JSON round-trip; small string metadata rides in `headers` (Rust reads `request.headers()`).
 */
export function invokeRaw<T = unknown>(
  cmd: string,
  body: ArrayBuffer,
  headers?: Record<string, string>,
): Promise<T> {
  const t = tauriGlobal();
  if (!t) return Promise.reject(new Error(`Tauri command ${cmd} is only available in the desktop app`));
  return t.core.invoke(cmd, body, { headers }) as Promise<T>;
}
