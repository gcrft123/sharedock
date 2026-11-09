import { COST } from "../content";

/* Fold 05 · the money argument, drawn rather than asserted.
 *
 * The plot is now the fold rather than an illustration inside it: full height, type
 * set into the field instead of stacked above it, and the crossover called out where
 * it actually happens. Cumulative rent climbs as a column per year; the purchase is one
 * flat rule crossing them. Each bar splits exactly where it passes that rule, so the
 * lit portion is precisely the money that bought nothing.
 *
 * DOM and CSS only. No chart library, no SVG: the columns are divs and the rule is a
 * border. Prices are placeholders and the crossover year is computed, so the argument
 * survives whatever numbers land.
 */
export function Cost() {
  const years = Array.from({ length: COST.years }, (_, i) => i + 1);
  const cumulative = years.map((y) => COST.rent.perYear * y);
  const peak = Math.max(cumulative[cumulative.length - 1], COST.own.once) * 1.1;
  const ownPct = (COST.own.once / peak) * 100;
  const crossIndex = cumulative.findIndex((v) => v > COST.own.once);

  return (
    <section className="cost" id="cost">
      <div className="cost-field">
        <div className="wrap cost-head">
          <h2 className="t-h2 rv">{COST.heading}</h2>
          <p className="t-lead cost-lead rv">{COST.lead}</p>
        </div>

        <div className="wrap">
          <div
            className="cost-plot rv"
            style={{ ["--own-pct" as string]: `${ownPct}%` }}
            role="img"
            aria-label={`Cumulative cost over ${COST.years} years. A subscription keeps climbing; Sharedock is paid once and stays flat.`}
          >
            <div className="cost-own" style={{ bottom: `${ownPct}%` }}>
              <span className="cost-own-label">
                {COST.own.label} <b>${COST.own.once}</b>
              </span>
            </div>

            <div className="cost-cols">
              {years.map((y, i) => {
                const barPct = (cumulative[i] / peak) * 100;
                const split = Math.min(100, (COST.own.once / cumulative[i]) * 100);
                return (
                  <div className="cost-col" key={y} data-cross={i === crossIndex ? "true" : undefined}>
                    {/* A tick from the baseline to the purchase line, at the column
                        where rent overtakes it. Marks the crossing, not the column. */}
                    {i === crossIndex ? <span className="cost-cross" /> : null}
                    <div
                      className="cost-bar"
                      style={{
                        height: `${barPct}%`,
                        backgroundImage: `linear-gradient(to top, var(--bg-panel) 0 ${split}%, rgba(255,90,31,0.16) ${split}% 100%)`,
                      }}
                    />
                    <span className="cost-year">{y}</span>
                  </div>
                );
              })}
            </div>
            <span className="cost-axis">Years</span>
          </div>

          <div className="cost-legend">
            <span className="cost-key">
              {COST.rent.label} · ${COST.rent.perYear}/yr
            </span>
            {crossIndex >= 0 ? (
              <span className="cost-key cost-key-cross">
                Costs more from year {crossIndex + 1}
              </span>
            ) : null}
            <span className="cost-key cost-foot">{COST.footnote}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
