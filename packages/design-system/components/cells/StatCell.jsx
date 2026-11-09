import React from 'react';
import { Crosshair } from './Crosshair.jsx';

const fmt = (n, decimals) => n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/* Stat cell for a gap:1px 4-col grid: mono label, giant Archivo numeral that counts up
   on reveal (~1400ms, respects reduced motion), orange <em> unit, mono sub caption. */
export function StatCell({ label, value = 0, unit, sub, decimals = 0, orange = false, cross = 'tl' }) {
  const [n, setN] = React.useState(0);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(value); return; }
    let raf;
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => {
        if (!e.isIntersecting) return;
        io.unobserve(el);
        const t0 = performance.now();
        const step = (t) => {
          const p = Math.min(1, (t - t0) / 1400);
          setN(value * (1 - Math.pow(1 - p, 3)));
          if (p < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      });
    }, { threshold: 0.18 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [value]);
  return (
    <div className={orange ? 'statcell statcell-o' : 'statcell'} ref={ref}>
      {cross && <Crosshair pos={cross} />}
      <p className="t-label-tight">{label}</p>
      <p className="t-stat"><data value={value}>{fmt(n, decimals)}</data>{unit && <em>{unit}</em>}</p>
      {sub && <p className="statcell-sub">{sub}</p>}
    </div>
  );
}
