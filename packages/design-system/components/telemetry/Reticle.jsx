import React from 'react';

/* Cursor-follow HUD reticle: full-viewport 1px orange crosshair lerping toward the pointer
   (rAF, transform only) + live mono lat/lon tag. pointer:fine only; off under reduced motion. */
export function Reticle() {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!window.matchMedia('(pointer:fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = ref.current;
    if (!el) return;
    let tx = innerWidth / 2, ty = innerHeight / 2, x = tx, y = ty, on = false, raf;
    const mv = (e) => { tx = e.clientX; ty = e.clientY; if (!on) { on = true; el.style.opacity = '1'; } };
    const loop = () => {
      x += (tx - x) * 0.14; y += (ty - y) * 0.14;
      el.children[0].style.transform = `translateX(${x.toFixed(1)}px)`;
      el.children[1].style.transform = `translateY(${y.toFixed(1)}px)`;
      const tag = el.children[2];
      tag.style.transform = `translate(${(x + 14).toFixed(1)}px, ${(y + 14).toFixed(1)}px)`;
      tag.textContent = `LAT ${(47.6062 + (y / innerHeight - 0.5) * 0.02).toFixed(4)} · LON ${(-122.3321 + (x / innerWidth - 0.5) * 0.02).toFixed(4)}`;
      raf = requestAnimationFrame(loop);
    };
    addEventListener('mousemove', mv);
    raf = requestAnimationFrame(loop);
    return () => { removeEventListener('mousemove', mv); cancelAnimationFrame(raf); };
  }, []);
  return (
    <div className="reticle" ref={ref} aria-hidden="true" style={{ opacity: 0 }}>
      <i className="ret-v"></i><i className="ret-h"></i><span className="ret-tag"></span>
    </div>
  );
}
