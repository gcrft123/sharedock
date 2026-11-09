import { HERO } from "../content";

/* Fold 01 · hero.
   Asymmetric split, per the design system's anti-centre bias. The right column is
   deliberately empty: the assembly canvas reads through it, so the first wireframe
   arrives here rather than being introduced later. No mockup, no screenshot, no
   invented dashboard. */
export function Hero() {
  return (
    <section className="hero" id="top">
      <div className="hero-in">
        <div className="hero-copy">
          <h1 className="t-display hero-h1">{HERO.headline}</h1>
          <p className="t-lead hero-lead">{HERO.lead}</p>
          <div className="hero-cta">
            <a className="btn btn-primary" href="#pricing">
              {HERO.ctaPrimary}
            </a>
            <a className="btn btn-ghost" href="#assembly">
              {HERO.ctaSecondary}
              <span className="arw" aria-hidden="true">
                &#8595;
              </span>
            </a>
          </div>
        </div>
        <div className="hero-void" aria-hidden="true" />
      </div>
    </section>
  );
}
