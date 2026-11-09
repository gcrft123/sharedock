// Human formatting helpers. Kept dependency-free and locale-stable.

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export function formatBytes(n: number, decimals = 1): string {
  if (!isFinite(n) || n <= 0) return "0 B";
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / Math.pow(1024, i);
  const d = i === 0 ? 0 : v >= 100 ? 0 : decimals;
  return `${v.toFixed(d)} ${UNITS[i]}`;
}

export function formatRate(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return "—";
  return `${formatBytes(bytesPerSec, 0)}/s`;
}

export function formatDuration(secs: number): string {
  if (secs <= 0) return "0s";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatEta(secs: number): string {
  if (secs <= 0) return "—";
  return formatDuration(secs);
}

export function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatRelative(ts: number, nowMs = Date.now()): string {
  const diff = nowMs - ts;
  const future = diff < 0;
  const s = Math.floor(Math.abs(diff) / 1000);
  const wrap = (n: number, u: string) => (future ? `in ${n}${u}` : `${n}${u} ago`);
  if (s < 45) return future ? "soon" : "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return wrap(m, "m");
  const h = Math.floor(m / 60);
  if (h < 24) return wrap(h, "h");
  const d = Math.floor(h / 24);
  return wrap(d, "d");
}

export function formatClock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Percentage 0..100 as an integer-ish string. */
export function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}
