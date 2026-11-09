import React from 'react';
import { Equalizer } from './Equalizer.jsx';

/* HUD telemetry card: ◊ title + ● LIVE blip, equalizer signal, 2x2 readout grid,
   blueprint minimap with radar pings. Stylized generated telemetry, not a fake screenshot. */
export function HudCard({
  title = '◊ UNIT D-01 · TELEMETRY',
  live = 'LIVE',
  readouts = [
    { k: 'Core temp', v: '412', u: '°C' },
    { k: 'Load', v: '71', u: '%' },
    { k: 'Flow', v: '1.9', u: 'T/H' },
    { k: 'Drift', v: '0.4', u: 'MM' },
  ],
  map = true,
  coord = '47.6062 N · 122.3321 W',
}) {
  return (
    <figure className="hud">
      <div className="hud-head">
        <span>{title}</span>
        <span className="hud-live"><span className="dot" aria-hidden="true"></span>{live}</span>
      </div>
      <div className="hud-body">
        <Equalizer />
        <dl className="readout">
          {readouts.map((r) => (
            <div key={r.k}>
              <dt className="k">{r.k}</dt>
              <dd className="v">{r.v}{r.u && <em>{r.u}</em>}</dd>
            </div>
          ))}
        </dl>
        {map && (
          <div className="bpmap" aria-hidden="true">
            <span className="bp-mark" style={{ left: '22%', top: '30%' }}>+</span>
            <span className="bp-mark" style={{ left: '78%', top: '22%' }}>+</span>
            <span className="bp-mark" style={{ left: '55%', top: '74%' }}>+</span>
            <span className="ping" style={{ left: '34%', top: '52%' }}></span>
            <span className="ping ping-2" style={{ left: '68%', top: '38%' }}></span>
            <span className="bp-coord">{coord}</span>
          </div>
        )}
      </div>
    </figure>
  );
}
