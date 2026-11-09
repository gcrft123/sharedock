import React from 'react';

/* The + corner mark for hairline-grid cells. pos: tl | tr | bl | br. Decorative. */
export function Crosshair({ pos = 'tl' }) {
  const cls = pos === 'tl' ? 'cross' : `cross cross-${pos}`;
  return <span className={cls} aria-hidden="true">+</span>;
}
