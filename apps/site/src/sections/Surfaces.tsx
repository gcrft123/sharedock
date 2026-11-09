import { SURFACES } from "../content";

/* Fold 03 · the ways in.
 *
 * Lead and support, not four equal rows. The mounted drive is the claim that lands
 * with a self-hoster, so it is set at display scale, carries the ember, and is read
 * first; browser, desktop and phone sit under it small and dense. Four rows of equal
 * weight had no hierarchy at all, which made the fold's best line its fourth.
 *
 * The density jump between the lead and the trio is the whole composition. */
export function Surfaces() {
  return (
    <section className="surf" id="surfaces">
      <div className="wrap">
        <h2 className="t-label surf-kicker">{SURFACES.heading}</h2>

        <article className="surf-lead rv">
          <h3 className="surf-lead-name">{SURFACES.lead.name}</h3>
          <div className="surf-lead-body">
            <p className="surf-lead-line">{SURFACES.lead.line}</p>
            <span className="surf-meta">{SURFACES.lead.meta}</span>
          </div>
        </article>
      </div>

      <div className="surf-rest">
        <div className="wrap surf-rest-in">
          {SURFACES.rest.map((r) => (
            <article className="surf-item rv" key={r.name}>
              <h3 className="surf-name">{r.name}</h3>
              <p className="surf-line">{r.line}</p>
              <span className="surf-meta">{r.meta}</span>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
