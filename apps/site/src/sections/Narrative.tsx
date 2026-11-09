import { useEffect, useRef, useState } from "react";
import { Hero } from "./Hero";
import { Assembly } from "./Assembly";
import type { AssemblyHandle } from "../assembly/scene";
import { hasWebGL, prefersReducedMotion, useScrollProgress } from "../assembly/useScrollProgress";

/* Folds 01 + 02 share one canvas.
 *
 * The wireframe is not introduced by the assembly section; it is already there in the
 * hero, bled off to the right of the headline, and the scroll simply walks toward it.
 * That removes the seam between "marketing hero" and "the animated bit", which is the
 * join that makes most landing pages read as assembled from parts.
 *
 * The canvas is fixed and spans both folds, so nothing re-mounts mid-scroll. It stops
 * rendering the moment the pair leaves the viewport.
 */
export function Narrative() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<AssemblyHandle | null>(null);
  const [stage, setStage] = useState(0);
  const { progress, visible } = useScrollProgress(wrapRef);

  // Starts false on both the prerendered HTML and the first client render, so
  // hydration matches, then upgrades once we know the browser can actually do it. The
  // readable, unpinned version is therefore what ships in the HTML and what anyone
  // without WebGL or with reduced motion keeps.
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!prefersReducedMotion() && hasWebGL()) setLive(true);
  }, []);

  useEffect(() => {
    if (!live) return;
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let raf = 0;

    // three.js is the bulk of this page's JavaScript and only this pair of folds needs
    // it, so it loads on its own chunk after the page has already painted.
    import("../assembly/scene")
      .then(({ createAssembly }) => {
        if (disposed) return;
        return createAssembly(host, { reducedMotion: false, onStage: setStage }).then((h) => {
          if (disposed) return h.dispose();
          handleRef.current = h;
          const tick = () => {
            raf = requestAnimationFrame(tick);
            h.setProgress(progress.current);
          };
          raf = requestAnimationFrame(tick);
        });
      })
      // A model that fails to load, a lost context, a chunk that never arrives: any of
      // these would otherwise reject silently and leave a pinned section with nothing
      // in it. Falling back to the readable static version is always better than an
      // empty screen.
      .catch((err) => {
        console.error("[assembly] falling back to static:", err);
        if (!disposed) setLive(false);
      });

    const onResize = () => handleRef.current?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [live, progress]);

  useEffect(() => {
    handleRef.current?.setActive(visible);
  }, [visible]);

  return (
    <div className="narr" ref={wrapRef}>
      {live ? (
        <div className="narr-canvas-wrap" data-on={visible} aria-hidden="true" ref={hostRef} />
      ) : null}
      <Hero />
      <Assembly live={live} stage={stage} />
      <div className="narr-exit" aria-hidden="true" />
    </div>
  );
}
