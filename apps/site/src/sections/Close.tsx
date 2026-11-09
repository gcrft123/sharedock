import { CLOSE } from "../content";

/* Fold 07 · the close.
 *
 * Set at display scale now, so it is the second-loudest line on the page after the
 * hero. A closing statement whispered at body size is a closing statement nobody
 * reads. Still the one centred fold, and still the highest the ember dial runs:
 * sentence case, peach, no telemetry, no jargon. Someone here is deciding whether to
 * trust this with everything they own, so the machine steps back.
 *
 * The mark used to sit above this line. It has moved to the footer, at architectural
 * scale, where it does far more work. */
export function Close() {
  return (
    <section className="close" id="buy">
      <div className="close-in rv">
        <p className="close-line">{CLOSE.line}</p>
        <a className="btn btn-primary close-cta" href="#pricing">
          {CLOSE.cta}
          <span className="arw" aria-hidden="true">
            &#8594;
          </span>
        </a>
      </div>
    </section>
  );
}
