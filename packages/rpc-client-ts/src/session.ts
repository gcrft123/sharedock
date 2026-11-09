// The signed-in session, persisted in localStorage so a reload stays signed in.
// The token is a short-lived (1h) HMAC bearer minted by the control plane's
// /api/auth/{register,login,refresh}; `account` is the D1 user id used as the relay
// rendezvous id, the relay-token subject, and every CpClient `account` argument.

const SESSION_KEY = "pc.session";

export interface Session {
  token: string;
  account: string;
  email: string;
  /** Epoch ms when the bearer expires (best-effort; the server is authoritative). */
  expiresAt: number;
}

export function loadSession(): Session | null {
  try {
    const s = localStorage.getItem(SESSION_KEY);
    if (!s) return null;
    const o = JSON.parse(s) as Session;
    if (!o.token || !o.account) return null;
    return o;
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

/** Refresh once the session is within this of expiring. */
const REFRESH_WINDOW_MS = 10 * 60_000;

/**
 * Keep the session alive while the app is open.
 *
 * Sessions last an hour and nothing used to renew them, so the console quietly degraded:
 * calls began failing with 401 and screens carried on showing whatever they had last loaded.
 * One occurrence of this presented as the console reporting the wrong transport path, which
 * is about as far from "your session expired" as a symptom can get.
 *
 * Returns whether a session is still usable. `false` means the app should send the user back
 * to sign-in rather than keep making calls that cannot succeed.
 */
export async function refreshSessionIfNeeded(baseUrl: string): Promise<boolean> {
  const s = loadSession();
  if (!s) return false;

  const remaining = s.expiresAt - Date.now();
  if (remaining > REFRESH_WINDOW_MS) return true; // plenty of time left
  // Already gone: refreshing needs a live token, so this is a real sign-in, not a renewal.
  if (remaining <= 0) return false;

  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/auth/refresh`, {
      method: "POST",
      headers: { authorization: `Bearer ${s.token}` },
    });
    if (!res.ok) return false;
    const r = (await res.json()) as { token?: string; expiresInSec?: number };
    if (!r.token) return false;
    saveSession({ ...s, token: r.token, expiresAt: Date.now() + (r.expiresInSec ?? 3600) * 1000 });
    return true;
  } catch {
    // Offline is not expired. Keep the session and let the next attempt decide.
    return true;
  }
}
