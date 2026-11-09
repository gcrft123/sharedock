import { ASSEMBLY, STAGES } from "../content";

/* Fold 02 · the set-piece.
 *
 * The canvas belongs to <Narrative>, which spans this fold and the hero. This
 * component is only the copy that rides alongside it: a heading pinned top left,
 * one stage at a time bottom left, position ticks bottom right.
 *
 * When WebGL or motion is unavailable the section unpins and every stage becomes
 * readable at once. There is no path where it renders empty.
 */
export function Assembly({ live, stage }: { live: boolean; stage: number }) {
  if (!live) {
    return (
      <section id="assembly" className="asm asm-static">
        <div className="wrap">
          <h2 className="t-h2 rv">{ASSEMBLY.heading}</h2>
          <ol className="asm-list">
            {STAGES.map((s) => (
              <li key={s.id} className="asm-item rv">
                <span className="t-label asm-tag">{s.tag}</span>
                <h3 className="t-h3">{s.title}</h3>
                <p className="t-body asm-line">{s.line}</p>
                <span className="asm-spec">{s.spec}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    );
  }

  return (
    <section id="assembly" className="asm" aria-label="How Sharedock works">
      <div className="asm-pin">
        <div className="asm-frame">
          <h2 className="t-h2 asm-heading">{ASSEMBLY.heading}</h2>

          <div className="asm-foot">
            <div className="asm-stages">
              {STAGES.map((s, i) => (
                <div key={s.id} className="asm-stage" data-on={i === stage}>
                  <span className="t-label asm-tag">{s.tag}</span>
                  <h3 className="t-h3">{s.title}</h3>
                  <p className="t-body asm-line">{s.line}</p>
                  <span className="asm-spec">{s.spec}</span>
                </div>
              ))}
            </div>

            {/* Ticks, not a percentage. This is a sequence, not a loading bar. */}
            <div className="asm-ticks" aria-hidden="true">
              {STAGES.map((s, i) => (
                <span key={s.id} className="asm-tick" data-on={i <= stage} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* The reading path never depends on scroll position or on WebGL. */}
      <div className="sr-only">
        <ol>
          {STAGES.map((s) => (
            <li key={s.id}>
              {s.tag}. {s.title}. {s.line} {s.spec}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
