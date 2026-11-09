import { TIERS } from "../content";

/* Fold 06 · pricing.
 *
 * Three cells in a hairline grid, but deliberately not three equal ones: the featured
 * tier is wider and taller than its neighbours. Equal columns are the identical-card-
 * grid tell, and they also make the page refuse to have an opinion about which tier a
 * visitor should buy. Prices are set in the display face at stat scale so the number,
 * not the tier name, is what the eye lands on.
 *
 * Still the hairline-grid technique: a 1px gap over the line colour with solid cells
 * sitting in it, so the borders are the page showing through. Square corners. */
export function Tiers() {
  return (
    <section className="tiers" id="pricing">
      <div className="wrap">
        <h2 className="t-h2 rv">{TIERS.heading}</h2>

        <div className="tier-grid rv">
          {TIERS.items.map((t) => (
            <article className="tier" key={t.name} data-featured={t.featured ? "true" : undefined}>
              <h3 className="t-label tier-name">{t.name}</h3>

              <p className="tier-price">
                <span className="tier-cur">$</span>
                {t.price}
              </p>
              <p className="tier-once">Once, not yearly</p>

              <p className="tier-seats">{t.seats}</p>

              <ul className="tier-feats">
                {t.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>

              <a className={`btn ${t.featured ? "btn-primary" : "btn-secondary"} tier-cta`} href="#buy">
                {t.featured ? "Buy Sharedock" : "Choose"}
              </a>
            </article>
          ))}
        </div>

        <p className="tiers-note">{TIERS.note}</p>
      </div>
    </section>
  );
}
