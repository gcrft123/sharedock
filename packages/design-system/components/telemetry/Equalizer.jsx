import React from 'react';

/* Live signal: ~28 bars, scaleY bob, staggered delays, orange gradient fill.
   Heights/durations are deterministic (seeded by index) so renders are stable. */
export function Equalizer({ bars = 28, height = 64 }) {
  const items = [];
  for (let i = 0; i < bars; i++) {
    const h = 0.35 + 0.65 * Math.abs(Math.sin(i * 7.31 + 1.7));
    const d = 1.2 + ((i * 13) % 9) / 10;
    const dl = -((i * 0.137) % 1.4);
    items.push(<i key={i} style={{ '--h': h.toFixed(2), '--d': `${d.toFixed(2)}s`, '--dl': `${dl.toFixed(2)}s` }}></i>);
  }
  return <div className="eq" style={{ height }} aria-hidden="true">{items}</div>;
}
