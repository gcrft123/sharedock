import React from 'react';

/* Full-bleed orange band, scrolling 26s linear. ONE per page. Decorative: aria-hidden. */
export function Marquee({ items = ['Numbers that don\'t blink', 'Get started', 'Unit D-01 reporting', 'One machine, warmly lit'] }) {
  const run = items.map((t, i) => (
    <React.Fragment key={i}>
      <span className="marquee-item">{t}</span>
      <span className="marquee-sep">///</span>
    </React.Fragment>
  ));
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee-track">{run}{run}</div>
    </div>
  );
}
