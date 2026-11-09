import React from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Tracks `prefers-reduced-motion: reduce`.
 *
 * CSS alone cannot honour this for JS-driven animation. Worse, a blanket
 * `*{transition-duration:.001s!important}` reduced-motion rule actively breaks any loop
 * that uses a CSS transition as its clock (see Throughput's feed): collapsing the
 * duration makes `transitionend` fire immediately, so the loop free-runs at the frame
 * rate instead of stopping. Those loops have to ask, and stop themselves.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(QUERY).matches;
  });

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setReduced(mq.matches);
    setReduced(mq.matches);
    // MediaQueryList.addEventListener is Safari 14+. This app also runs in the Mojave
    // WKWebView, so keep the deprecated addListener fallback (see docs/host-compatibility.md).
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else if (mq.removeListener) mq.removeListener(onChange);
    };
  }, []);

  return reduced;
}
