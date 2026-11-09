import React from 'react';
import { Crosshair } from './Crosshair.jsx';

/* Dense machine cell for a gap:1px hairline grid. Hover warms in place: never lifts. */
export function CapabilityCell({ index = '01', title, children, statLabel, statValue, cross = 'tl' }) {
  return (
    <article className="cell">
      {cross && <Crosshair pos={cross} />}
      <p className="cell-idx">[ {index} ]</p>
      <h3 className="cell-title">{title}</h3>
      <p className="cell-desc">{children}</p>
      {statLabel && (
        <p className="cell-foot">{statLabel} · <b>{statValue}</b></p>
      )}
    </article>
  );
}
