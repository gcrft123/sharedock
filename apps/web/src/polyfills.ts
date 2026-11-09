// Polyfills for old WebViews (Mojave/High Sierra WKWebView, ~Safari 12) that lack
// some DOM APIs modern React/UI code assumes. Imported first in main.tsx so these
// install before the app module evaluates or mounts.
import { ResizeObserver as ResizeObserverPolyfill } from "@juggle/resize-observer";

if (typeof window !== "undefined" && !("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverPolyfill;
}
