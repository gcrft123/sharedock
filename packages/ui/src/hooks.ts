import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { transfers } from "@app/rpc-client";
import type { Transfer } from "@app/rpc-client";

/** Live in-flight client transfers (uploads/downloads) for the transfers panel. */
export function useTransfers(): Transfer[] {
  return useSyncExternalStore(transfers.subscribe, transfers.getSnapshot);
}

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
}

/** Minimal data-fetching hook: runs `fn` on mount and on `reload()`. An optional `initial`
 *  seeds `data` (e.g. from a preloaded snapshot) so the first render is already populated —
 *  loading starts false and the fetch just revalidates. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = [], initial: T | null = null): AsyncState<T> {
  const [data, setData] = useState<T | null>(initial);
  const [loading, setLoading] = useState(initial == null);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fn()
      .then((d) => {
        if (!cancelled && alive.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled && alive.current) setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (!cancelled && alive.current) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}

/** A 1s ticking clock for live UTC display etc. Returns epoch ms. */
export function useNow(intervalMs = 1000): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return t;
}
