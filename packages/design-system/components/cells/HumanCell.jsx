import React from 'react';
import { Crosshair } from './Crosshair.jsx';
import { PillChip } from '../controls/PillChip.jsx';

/* Warm cell in the SAME square hairline grid: tonal blend only (top-tint, pill chip,
   cream heading, peach body). Hover warms in place: no lift, no radius. */
export function HumanCell({ chip, chipTone = 'amber', title, children, foot, cross = 'tl' }) {
  return (
    <article className="cell cell-warm">
      {cross && <Crosshair pos={cross} />}
      {chip && <div><PillChip tone={chipTone} dot>{chip}</PillChip></div>}
      <h3 className="cell-title">{title}</h3>
      <p className="cell-desc">{children}</p>
      {foot && <p className="cell-foot">{foot}</p>}
    </article>
  );
}
