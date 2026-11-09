Inline SVG icon from the Solar Icon Set (Linear style, by 480 Design), recolored to `currentColor`. Use it anywhere the typographic glyphs (`+`, `●`, `◊`) aren't specific enough. 24x24 grid, 1.5px hairline stroke, 100% corner smoothing.

```jsx
<Icon name="radar" />                                {/* inherits color + font-size */}
<Icon name="bolt" size={20} style={{ color: 'var(--o)' }} />
<span className="t-label"><Icon name="map-point" size={13} /> LAT 47.6062</span>
<button className="btn"><Icon name="refresh" size={16} /> Sync</button>
<Icon name="danger" label="Alarm active" style={{ color: 'var(--amber)' }} />
```

- Inherits `color` (set orange/amber/peach via a CSS var) and sizes to `1em` by default, so it lines up with mono labels.
- Decorative by default (`aria-hidden`); pass `label` to make it announced.
- Names: alarm, bell, bolt, chart, check-circle, close-circle, code, command, copyright, cpu, cpu-bolt, danger, database, eye, fire, graph, info-circle, map-point, monitor, pie-chart, power, pulse, radar, refresh, round-graph, server, settings, shield, tuning, widget.
- Keep icons monochrome and hairline. Do not fill them or round the shapes they sit in: the machine stays square, icons stay stroked.
