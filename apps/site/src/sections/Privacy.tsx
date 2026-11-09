import { PRIVACY } from "../content";

/* Fold 04 · the cryptography.
 *
 * One enormous claim over a dense strip of mechanisms. The scale gap is the argument:
 * the human-sized promise is what a visitor reads, the machine-sized detail underneath
 * is what makes it true, and putting them at wildly different weights is the design
 * system's 85/15 split made literal rather than described.
 *
 * Still no shield icons, no padlocks, no green ticks. Performing security is what
 * pushes a product into the crypto register the brand rejects; this fold states the
 * mechanism once, at full volume, and moves on. */
export function Privacy() {
  return (
    <section className="priv" id="privacy">
      <div className="wrap">
        <h2 className="priv-claim rv">{PRIVACY.heading}</h2>
        <p className="t-lead priv-lead rv">{PRIVACY.lead}</p>
      </div>

      <dl className="priv-strip rv">
        <div className="priv-strip-in">
        {/* No cell indices here. These four are parallel facts, not an ordered
            sequence, and numbering them would be scaffolding pretending to be
            information. */}
        {PRIVACY.specs.map((s) => (
          <div className="priv-cell" key={s.mech}>
            <dt className="priv-mech">{s.mech}</dt>
            <dd className="priv-note">{s.claim}</dd>
          </div>
        ))}
        </div>
      </dl>

      <div className="wrap">
        <p className="t-human priv-caveat rv">{PRIVACY.caveat}</p>
      </div>
    </section>
  );
}
