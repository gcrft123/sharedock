import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { FOOTER } from "../content";
import { hasWebGL, prefersReducedMotion } from "../assembly/useScrollProgress";

// ogl is the only dependency this component pulls in, and only the footer needs it, so
// it loads on its own async chunk once the horizon is within reach, never in the main
// bundle and never during the build-time prerender (which renders `fx` false).
const Strands = lazy(() => import("../reactbits/Strands"));

/* Fold 08 · the footer, and the page's last image.
 *
 * Layout: one compact ruled band, not a brand column beside three stacks of links.
 * Column footers are the default every site ships, and here they would also fight the
 * wordmark for the same vertical space. Everything sits in a single row at the top;
 * everything below belongs to the mark.
 *
 * The ember horizon: the wordmark rises from the bottom edge as the footer scrolls in,
 * and it is not lit, it is the thing blocking the light. A hard hazard-orange rule sits
 * at the horizon, and the letterforms are punched out of the page substrate so they read
 * as a silhouette against the glow. The design system's whole conceit is that the only
 * light source in the room is the orange one; this is the one place on the site that
 * says so literally.
 *
 * The light source itself is now a live one: a field of ember strands (React Bits,
 * retinted to the brand) flowing behind the silhouette, in place of a static radial
 * bloom. It is gated three ways so it never taxes the old hardware this product courts:
 * only when the browser has WebGL and motion is allowed, only once the horizon is within
 * reach of the viewport (so the context is never created for a visitor who never scrolls
 * here), and paused whenever it is off screen. Everyone else keeps the static `.foot-glow`,
 * which is also what ships in the prerendered HTML.
 *
 * Progress is scrubbed from real scroll position through a CSS custom property rather
 * than `animation-timeline`, which Firefox still does not ship and which would leave
 * this fold static for a large share of visitors. Under reduced motion, or before the
 * effect runs, `--emerge` stays at 1 and the composition is simply already arrived.
 */
export function Footer() {
  const ref = useRef<HTMLElement>(null);

  // Upgrade to the live field only when it can run. Starts false so the prerender and
  // the first client render both carry the static glow and hydration matches.
  const [fx, setFx] = useState(false);
  // Latches true the first time the horizon comes within reach; keeps the WebGL context
  // mounted from then on rather than recreating it on every scroll past.
  const [near, setNear] = useState(false);
  // Drives the render-loop pause: true only while the horizon is actually on screen.
  const [onScreen, setOnScreen] = useState(false);

  useEffect(() => {
    if (!prefersReducedMotion() && hasWebGL()) setFx(true);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    let raf = 0;
    let running = false;
    let last = -1;

    // Measured against the viewport, not against the element's own scroll span. The
    // assembly's hook divides by `height - innerHeight`, which is zero or negative for
    // anything shorter than the screen: on a tall viewport that pinned `--emerge` at 0
    // and the horizon simply never arrived. This asks the only question that matters
    // here, which is how far the footer has risen into view.
    const measure = () => {
      const r = el.getBoundingClientRect();
      const travel = Math.min(window.innerHeight * 0.8, r.height) || 1;
      const t = Math.max(0, Math.min(1, (window.innerHeight - r.top) / travel));
      const eased = 1 - Math.pow(1 - t, 3);
      const q = Math.round(eased * 200) / 200;
      if (q === last) return;
      last = q;
      el.style.setProperty("--emerge", String(q));
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (running) measure();
    };

    const io = new IntersectionObserver(
      ([e]) => {
        running = e.isIntersecting;
        setOnScreen(e.isIntersecting);
        if (e.isIntersecting) setNear(true);
        if (running) measure();
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(el);
    measure();
    raf = requestAnimationFrame(tick);

    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <footer className="foot" ref={ref}>
      {/* The light source, lifted behind the whole footer so it does not stop at the
          horizon strip: it washes up past the wordmark, behind the tagline and the nav
          row, then fades out. `.foot-body` sits above it, and the wordmark, opaque and
          masked to the letterforms, is what blocks it into a silhouette. */}
      <div className="foot-fx" aria-hidden="true">
        {fx && near ? (
          <Suspense fallback={<div className="foot-glow" />}>
            <Strands
              className="foot-strands"
              paused={!onScreen}
              colors={["#FF5A1F", "#FF7A2E", "#FFB066", "#E23A00"]}
              count={5}
              speed={0.04}
              amplitude={1.15}
              waviness={0.85}
              thickness={0.7}
              glow={1.85}
              taper={1.25}
              spread={1.15}
              intensity={0.8}
              saturation={1.6}
              scale={1.9}
            />
          </Suspense>
        ) : (
          <div className="foot-glow" />
        )}
      </div>

      <div className="foot-body">
        <div className="wrap foot-bar">
          <a className="foot-mark" href="#top" aria-label="Sharedock, back to top">
            <img src="./brand/mark.svg" alt="" width={22} height={22} />
          </a>

          <nav className="foot-links" aria-label="Footer">
            {FOOTER.links.map((l) => (
              <a className="lnk foot-link" href="#top" key={l}>
                {l}
              </a>
            ))}
          </nav>

          <span className="foot-legal">{FOOTER.legal}</span>
        </div>

        <p className="foot-tagline">{FOOTER.tagline}</p>

        <div className="foot-horizon" aria-hidden="true">
          <div className="foot-word" />
          <div className="foot-rule" />
        </div>
      </div>
    </footer>
  );
}
