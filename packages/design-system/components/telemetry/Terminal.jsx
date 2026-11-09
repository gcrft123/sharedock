import React from 'react';

const DEFAULT_LINES = [
  { t: 'cmd', text: 'sharedock add --device A-01' },
  { t: 'out', text: 'LINK ESTABLISHED · ENCRYPTED · REV 2.6' },
  { t: 'cmd', text: 'sharedock status --all' },
  { t: 'out', text: '[ 08:14:22 ] A-01 128GB · HEALTHY' },
  { t: 'out', text: '[ 08:14:23 ] A-02 512GB · HEALTHY' },
  { t: 'warn', text: 'WARN · A-07 LOW SPACE · 91% USED' },
  { t: 'ok', text: 'OK · POOL ONLINE · 6/6 DEVICES' },
];

/* CRT terminal: typewriter output (cmd ~34ms/char, output ~8ms/char), blinking block cursor,
   scanline overlay. Color roles: prompt --o, cmd --fg, out --fg-dim, ok --term-green (the ONLY
   green in the system), warn --amber. Renders fully typed under reduced motion or static=true. */
export function Terminal({ title = 'SHAREDOCK · /bin/sharedock · A-01', lines = DEFAULT_LINES, static: isStatic = false, minHeight }) {
  const total = lines.reduce((s, l) => s + l.text.length, 0);
  const [n, setN] = React.useState(isStatic ? total : 0);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (isStatic) { setN(total); return; }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(total); return; }
    const el = ref.current;
    let timer;
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => {
        if (!e.isIntersecting) return;
        io.unobserve(el);
        let i = 0;
        const speedAt = (idx) => {
          let acc = 0;
          for (const l of lines) { acc += l.text.length; if (idx < acc) return l.t === 'cmd' ? 34 : 8; }
          return 8;
        };
        const step = () => {
          i += 1;
          setN(i);
          if (i < total) timer = setTimeout(step, speedAt(i));
        };
        timer = setTimeout(step, 400);
      });
    }, { threshold: 0.18 });
    io.observe(el);
    return () => { io.disconnect(); clearTimeout(timer); };
  }, [isStatic, total]);
  let used = 0;
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const remaining = n - used;
    if (remaining <= 0) break;
    const shown = l.text.slice(0, Math.min(l.text.length, remaining));
    used += l.text.length;
    const done = remaining >= l.text.length;
    const last = !done || (i === lines.length - 1 && n >= total);
    rows.push(
      <div className="term-line" key={i}>
        {l.t === 'cmd' && <span className="t-prompt">$ </span>}
        <samp className={`t-${l.t}`}>{shown}</samp>
        {last && <span className="t-cursor" aria-hidden="true"></span>}
      </div>
    );
    if (!done) break;
  }
  if (rows.length === 0) rows.push(<div className="term-line" key="c"><span className="t-cursor" aria-hidden="true"></span></div>);
  return (
    <figure className="terminal" ref={ref}>
      <div className="term-bar" aria-hidden="true">
        <span className="term-dot"></span>
        <span className="term-dot term-dot-o"></span>
        <span className="term-dot term-dot-o"></span>
        <span className="term-title">{title}</span>
      </div>
      <div className="term-body scanlines" style={minHeight ? { minHeight } : undefined}>{rows}</div>
    </figure>
  );
}
