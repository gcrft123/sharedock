import { useEffect, useRef, useState } from "react";

/** Progress of a tall section through the viewport, 0 at the moment its top pins and
 *  1 when its bottom clears. Read inside rAF rather than on the scroll event, so it
 *  never forces layout on the scroll thread. */
export function useScrollProgress(ref: React.RefObject<HTMLElement>) {
  const progress = useRef(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let raf = 0;
    let running = false;

    const measure = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      progress.current = span <= 0 ? 0 : Math.min(1, Math.max(0, -r.top / span));
    };
    const onScroll = () => {
      if (!running || raf) return;
      raf = requestAnimationFrame(measure);
    };

    const io = new IntersectionObserver(
      ([e]) => {
        running = e.isIntersecting;
        setVisible(e.isIntersecting);
        if (running) measure();
      },
      { rootMargin: "120px 0px" },
    );
    io.observe(el);

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    measure();

    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref]);

  return { progress, visible };
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Feature-detect WebGL rather than assuming it. The visitors most likely to lack it
 *  are exactly the old-hardware owners this product is sold to. */
export function hasWebGL() {
  try {
    if (!window.WebGLRenderingContext) return false;
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl") || c.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return false;
    // Hand the probe's context straight back. Browsers cap live contexts and drop the
    // oldest past the limit, so a probe that holds one is spending the budget the real
    // renderer needs.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
