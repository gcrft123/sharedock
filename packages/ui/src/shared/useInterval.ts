import { useEffect, useRef } from "react";

/** Run `cb` every `ms` while mounted. Pass `ms = null` to pause. The latest `cb`
 *  is always used without resetting the timer (Dan Abramov's pattern). */
export function useInterval(cb: () => void, ms: number | null): void {
  const saved = useRef(cb);
  saved.current = cb;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => saved.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}
