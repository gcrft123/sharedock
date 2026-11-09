/* @ds-bundle: {"format":4,"namespace":"MachineEmberDesignSystem_bd5c19","components":[{"name":"CapabilityCell","sourcePath":"components/cells/CapabilityCell.jsx"},{"name":"Crosshair","sourcePath":"components/cells/Crosshair.jsx"},{"name":"HumanCell","sourcePath":"components/cells/HumanCell.jsx"},{"name":"SectionHeader","sourcePath":"components/cells/SectionHeader.jsx"},{"name":"StatCell","sourcePath":"components/cells/StatCell.jsx"},{"name":"Footer","sourcePath":"components/chrome/Footer.jsx"},{"name":"Marquee","sourcePath":"components/chrome/Marquee.jsx"},{"name":"Nav","sourcePath":"components/chrome/Nav.jsx"},{"name":"StatusBar","sourcePath":"components/chrome/StatusBar.jsx"},{"name":"Button","sourcePath":"components/controls/Button.jsx"},{"name":"Eyebrow","sourcePath":"components/controls/Eyebrow.jsx"},{"name":"PillChip","sourcePath":"components/controls/PillChip.jsx"},{"name":"Icon","sourcePath":"components/icon/Icon.jsx"},{"name":"ConfirmDialog","sourcePath":"components/overlay/ConfirmDialog.jsx"},{"name":"PricingTier","sourcePath":"components/pricing/PricingTier.jsx"},{"name":"Equalizer","sourcePath":"components/telemetry/Equalizer.jsx"},{"name":"HudCard","sourcePath":"components/telemetry/HudCard.jsx"},{"name":"Reticle","sourcePath":"components/telemetry/Reticle.jsx"},{"name":"Terminal","sourcePath":"components/telemetry/Terminal.jsx"}],"sourceHashes":{"components/cells/CapabilityCell.jsx":"368ae9f74575","components/cells/Crosshair.jsx":"34ce4157f1f1","components/cells/HumanCell.jsx":"4c4b75da223b","components/cells/SectionHeader.jsx":"a6b1b632f9b9","components/cells/StatCell.jsx":"0cff7c16b499","components/chrome/Footer.jsx":"87585cbd9151","components/chrome/Marquee.jsx":"3ef72e6c65c7","components/chrome/Nav.jsx":"e467c6dee71e","components/chrome/StatusBar.jsx":"280a701f9735","components/controls/Button.jsx":"49323a454309","components/controls/Eyebrow.jsx":"6ba10498ee4b","components/controls/PillChip.jsx":"e0278ad4d6d2","components/icon/Icon.jsx":"572a21897902","components/overlay/ConfirmDialog.jsx":"a37bc5d2a2d9","components/pricing/PricingTier.jsx":"02153f72e1ce","components/telemetry/Equalizer.jsx":"cb83ea876a3a","components/telemetry/HudCard.jsx":"677b47dbc01c","components/telemetry/Reticle.jsx":"dc72dc8a03a6","components/telemetry/Terminal.jsx":"dd53ed33d825"},"inlinedExternals":[],"unexposedExports":[{"name":"iconNames","sourcePath":"components/icon/Icon.jsx"}]} */

(() => {

const __ds_ns = (window.MachineEmberDesignSystem_bd5c19 = window.MachineEmberDesignSystem_bd5c19 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/cells/Crosshair.jsx
try { (() => {
/* The + corner mark for hairline-grid cells. pos: tl | tr | bl | br. Decorative. */
function Crosshair({
  pos = 'tl'
}) {
  const cls = pos === 'tl' ? 'cross' : `cross cross-${pos}`;
  return /*#__PURE__*/React.createElement("span", {
    className: cls,
    "aria-hidden": "true"
  }, "+");
}
Object.assign(__ds_scope, { Crosshair });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cells/Crosshair.jsx", error: String((e && e.message) || e) }); }

// components/cells/CapabilityCell.jsx
try { (() => {
/* Dense machine cell for a gap:1px hairline grid. Hover warms in place: never lifts. */
function CapabilityCell({
  index = '01',
  title,
  children,
  statLabel,
  statValue,
  cross = 'tl'
}) {
  return /*#__PURE__*/React.createElement("article", {
    className: "cell"
  }, cross && /*#__PURE__*/React.createElement(__ds_scope.Crosshair, {
    pos: cross
  }), /*#__PURE__*/React.createElement("p", {
    className: "cell-idx"
  }, "[ ", index, " ]"), /*#__PURE__*/React.createElement("h3", {
    className: "cell-title"
  }, title), /*#__PURE__*/React.createElement("p", {
    className: "cell-desc"
  }, children), statLabel && /*#__PURE__*/React.createElement("p", {
    className: "cell-foot"
  }, statLabel, " \xB7 ", /*#__PURE__*/React.createElement("b", null, statValue)));
}
Object.assign(__ds_scope, { CapabilityCell });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cells/CapabilityCell.jsx", error: String((e && e.message) || e) }); }

// components/cells/SectionHeader.jsx
try { (() => {
/* Section header: left = mono orange section ID + Archivo Black H2; right = short mono note. */
function SectionHeader({
  id,
  title,
  note,
  className = ''
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: `sechead ${className}`.trim()
  }, /*#__PURE__*/React.createElement("div", null, id && /*#__PURE__*/React.createElement("p", {
    className: "sechead-id"
  }, id), /*#__PURE__*/React.createElement("h2", {
    className: "t-h2"
  }, title)), note && /*#__PURE__*/React.createElement("p", {
    className: "sechead-note"
  }, note));
}
Object.assign(__ds_scope, { SectionHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cells/SectionHeader.jsx", error: String((e && e.message) || e) }); }

// components/cells/StatCell.jsx
try { (() => {
const fmt = (n, decimals) => n.toLocaleString('en-US', {
  minimumFractionDigits: decimals,
  maximumFractionDigits: decimals
});

/* Stat cell for a gap:1px 4-col grid: mono label, giant Archivo numeral that counts up
   on reveal (~1400ms, respects reduced motion), orange <em> unit, mono sub caption. */
function StatCell({
  label,
  value = 0,
  unit,
  sub,
  decimals = 0,
  orange = false,
  cross = 'tl'
}) {
  const [n, setN] = React.useState(0);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setN(value);
      return;
    }
    let raf;
    const io = new IntersectionObserver(es => {
      es.forEach(e => {
        if (!e.isIntersecting) return;
        io.unobserve(el);
        const t0 = performance.now();
        const step = t => {
          const p = Math.min(1, (t - t0) / 1400);
          setN(value * (1 - Math.pow(1 - p, 3)));
          if (p < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      });
    }, {
      threshold: 0.18
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);
  return /*#__PURE__*/React.createElement("div", {
    className: orange ? 'statcell statcell-o' : 'statcell',
    ref: ref
  }, cross && /*#__PURE__*/React.createElement(__ds_scope.Crosshair, {
    pos: cross
  }), /*#__PURE__*/React.createElement("p", {
    className: "t-label-tight"
  }, label), /*#__PURE__*/React.createElement("p", {
    className: "t-stat"
  }, /*#__PURE__*/React.createElement("data", {
    value: value
  }, fmt(n, decimals)), unit && /*#__PURE__*/React.createElement("em", null, unit)), sub && /*#__PURE__*/React.createElement("p", {
    className: "statcell-sub"
  }, sub));
}
Object.assign(__ds_scope, { StatCell });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cells/StatCell.jsx", error: String((e && e.message) || e) }); }

// components/chrome/Footer.jsx
try { (() => {
/* Footer: hairline grid (brand + link columns) on --bg-deep, giant clipped wordmark in --edge
   with one orange glyph. */
function Footer({
  brand = 'SHAREDOCK',
  logo,
  logoAlt = 'Sharedock',
  logoHeight = 30,
  tagline = 'Turn your old devices into one private cloud. One machine, warmly lit.',
  columns = [{
    title: 'Product',
    links: [{
      label: 'Features'
    }, {
      label: 'Setup'
    }, {
      label: 'Pricing'
    }]
  }, {
    title: 'Reference',
    links: [{
      label: 'Docs'
    }, {
      label: 'CLI'
    }, {
      label: 'Changelog'
    }]
  }, {
    title: 'Company',
    links: [{
      label: 'About'
    }, {
      label: 'Contact'
    }, {
      label: 'Status'
    }]
  }],
  mega = ['SHARE', /*#__PURE__*/React.createElement("b", {
    key: "amp"
  }, "DOCK")]
}) {
  return /*#__PURE__*/React.createElement("footer", {
    className: "footer"
  }, /*#__PURE__*/React.createElement("div", {
    className: "footer-grid"
  }, /*#__PURE__*/React.createElement("div", {
    className: "footer-brand"
  }, /*#__PURE__*/React.createElement("span", {
    className: "nav-mark"
  }, logo ? /*#__PURE__*/React.createElement("img", {
    src: logo,
    alt: logoAlt,
    style: {
      height: logoHeight,
      width: 'auto',
      display: 'block'
    }
  }) : /*#__PURE__*/React.createElement(React.Fragment, null, brand, /*#__PURE__*/React.createElement("sup", null, "\xAE"))), /*#__PURE__*/React.createElement("p", null, tagline)), columns.map(c => /*#__PURE__*/React.createElement("div", {
    className: "footer-col",
    key: c.title
  }, /*#__PURE__*/React.createElement("h4", null, c.title), /*#__PURE__*/React.createElement("ul", null, c.links.map(l => /*#__PURE__*/React.createElement("li", {
    key: l.label
  }, /*#__PURE__*/React.createElement("a", {
    href: l.href || '#'
  }, l.label))))))), /*#__PURE__*/React.createElement("div", {
    className: "footer-mega",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("span", null, mega)));
}
Object.assign(__ds_scope, { Footer });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/chrome/Footer.jsx", error: String((e && e.message) || e) }); }

// components/chrome/Marquee.jsx
try { (() => {
/* Full-bleed orange band, scrolling 26s linear. ONE per page. Decorative: aria-hidden. */
function Marquee({
  items = ['Numbers that don\'t blink', 'Get started', 'Unit D-01 reporting', 'One machine, warmly lit']
}) {
  const run = items.map((t, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: i
  }, /*#__PURE__*/React.createElement("span", {
    className: "marquee-item"
  }, t), /*#__PURE__*/React.createElement("span", {
    className: "marquee-sep"
  }, "///")));
  return /*#__PURE__*/React.createElement("div", {
    className: "marquee",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("div", {
    className: "marquee-track"
  }, run, run));
}
Object.assign(__ds_scope, { Marquee });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/chrome/Marquee.jsx", error: String((e && e.message) || e) }); }

// components/chrome/StatusBar.jsx
try { (() => {
/* 30px sticky telemetry strip: brand + pulsing dot, unit, sys status, live feed, lat, UTC clock. */
function StatusBar({
  brand = 'SHAREDOCK',
  unit = 'DEVICE / A-01',
  sys = 'SYS · POOL ONLINE',
  feed = 'SAMPLE FEED · A-01 128GB · USED 71% · READ 22MB/S',
  lat = 'HOME NETWORK · 6 DEVICES',
  sticky = true
}) {
  const [clock, setClock] = React.useState('--:--:--');
  React.useEffect(() => {
    const tick = () => {
      const d = new Date();
      const p = n => String(n).padStart(2, '0');
      setClock(`${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return /*#__PURE__*/React.createElement("header", {
    className: "statusbar",
    style: sticky ? undefined : {
      position: 'relative',
      top: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sb-cell"
  }, /*#__PURE__*/React.createElement("span", {
    className: "dot",
    "aria-hidden": "true"
  }), brand), /*#__PURE__*/React.createElement("div", {
    className: "sb-cell sb-mid"
  }, unit), /*#__PURE__*/React.createElement("div", {
    className: "sb-cell sb-mid"
  }, sys), /*#__PURE__*/React.createElement("div", {
    className: "sb-cell sb-mid sb-flex"
  }, /*#__PURE__*/React.createElement("span", null, feed)), /*#__PURE__*/React.createElement("div", {
    className: "sb-cell sb-mid"
  }, lat), /*#__PURE__*/React.createElement("div", {
    className: "sb-cell"
  }, /*#__PURE__*/React.createElement("output", null, clock)));
}
Object.assign(__ds_scope, { StatusBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/chrome/StatusBar.jsx", error: String((e && e.message) || e) }); }

// components/controls/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Square mono button. Variants: secondary (default) / primary (ONE per view) / ghost. */
function Button({
  variant = 'secondary',
  size = 'md',
  href,
  arrow = false,
  disabled = false,
  children,
  ...rest
}) {
  const cls = ['btn', variant === 'primary' && 'btn-primary', variant === 'ghost' && 'btn-ghost', size === 'sm' && 'btn-sm'].filter(Boolean).join(' ');
  const inner = /*#__PURE__*/React.createElement(React.Fragment, null, children, arrow && /*#__PURE__*/React.createElement("span", {
    className: "btn-arrow",
    "aria-hidden": "true"
  }, "\u2192"));
  if (href) {
    return /*#__PURE__*/React.createElement("a", _extends({
      className: cls,
      href: disabled ? undefined : href,
      "aria-disabled": disabled || undefined
    }, rest), inner);
  }
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    className: cls,
    disabled: disabled
  }, rest), inner);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/Button.jsx", error: String((e && e.message) || e) }); }

// components/chrome/Nav.jsx
try { (() => {
/* 64px sticky nav under the status bar: wordmark + ®, mono links w/ orange underline, sign-in + ONE primary CTA. */
function Nav({
  brand = 'SHAREDOCK',
  logo,
  logoAlt = 'Sharedock',
  logoHeight = 26,
  links = [],
  signIn = 'Sign in',
  signInHref = '#',
  ctaLabel = 'Get started',
  ctaHref = '#',
  onCta,
  sticky = true
}) {
  return /*#__PURE__*/React.createElement("nav", {
    className: "nav",
    style: sticky ? undefined : {
      position: 'relative',
      top: 0
    }
  }, /*#__PURE__*/React.createElement("a", {
    className: "nav-mark",
    href: "#"
  }, logo ? /*#__PURE__*/React.createElement("img", {
    src: logo,
    alt: logoAlt,
    style: {
      height: logoHeight,
      width: 'auto',
      display: 'block'
    }
  }) : /*#__PURE__*/React.createElement(React.Fragment, null, brand, /*#__PURE__*/React.createElement("sup", null, "\xAE"))), links.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "nav-links"
  }, links.map(l => /*#__PURE__*/React.createElement("a", {
    key: l.label,
    className: "nav-link",
    href: l.href || '#'
  }, l.label))), /*#__PURE__*/React.createElement("div", {
    className: "nav-right"
  }, signIn && /*#__PURE__*/React.createElement("a", {
    className: "nav-signin",
    href: signInHref
  }, signIn), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "primary",
    size: "sm",
    href: onCta ? undefined : ctaHref,
    onClick: onCta
  }, ctaLabel)));
}
Object.assign(__ds_scope, { Nav });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/chrome/Nav.jsx", error: String((e && e.message) || e) }); }

// components/controls/Eyebrow.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Eyebrow kicker: 26px orange bar + mono uppercase label. Max 1 per 3 sections. */
function Eyebrow({
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    className: "eyebrow"
  }, rest), children);
}
Object.assign(__ds_scope, { Eyebrow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/Eyebrow.jsx", error: String((e && e.message) || e) }); }

// components/controls/PillChip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Pill chip: the ONE rounded token in the system. Tinted bg + matching text, same orange hue family. */
function PillChip({
  tone = 'amber',
  dot = false,
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    className: `chip chip-${tone}`
  }, rest), dot && /*#__PURE__*/React.createElement("i", {
    "aria-hidden": "true"
  }), children);
}
Object.assign(__ds_scope, { PillChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/PillChip.jsx", error: String((e && e.message) || e) }); }

// components/cells/HumanCell.jsx
try { (() => {
/* Warm cell in the SAME square hairline grid: tonal blend only (top-tint, pill chip,
   cream heading, peach body). Hover warms in place: no lift, no radius. */
function HumanCell({
  chip,
  chipTone = 'amber',
  title,
  children,
  foot,
  cross = 'tl'
}) {
  return /*#__PURE__*/React.createElement("article", {
    className: "cell cell-warm"
  }, cross && /*#__PURE__*/React.createElement(__ds_scope.Crosshair, {
    pos: cross
  }), chip && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(__ds_scope.PillChip, {
    tone: chipTone,
    dot: true
  }, chip)), /*#__PURE__*/React.createElement("h3", {
    className: "cell-title"
  }, title), /*#__PURE__*/React.createElement("p", {
    className: "cell-desc"
  }, children), foot && /*#__PURE__*/React.createElement("p", {
    className: "cell-foot"
  }, foot));
}
Object.assign(__ds_scope, { HumanCell });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/cells/HumanCell.jsx", error: String((e && e.message) || e) }); }

// components/icon/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Solar Icon Set — Linear style, by 480 Design (github.com/480-Design/Solar-Icon-Set).
   Recolored stroke -> currentColor and embedded so the component is self-contained in the
   bundle. Icons inherit color from `color` and size from font-size (default 1em). 24x24 grid,
   1.5px stroke, 100% corner smoothing. Standalone cleaned SVGs also live in assets/icons/solar/. */
const SOLAR = {
  "alarm": "<circle cx=\"12\" cy=\"13\" r=\"9\" stroke=\"currentColor\" stroke-width=\"1.5\"></circle><path d=\"M12 9V13L14.5 15.5\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"></path><path d=\"M3.5 4.5L7.50002 2\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"></path><path d=\"M20.5 4.5L16.5 2\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"></path>",
  "bell": "<path d=\"M18.7491 9.70957V9.00497C18.7491 5.13623 15.7274 2 12 2C8.27256 2 5.25087 5.13623 5.25087 9.00497V9.70957C5.25087 10.5552 5.00972 11.3818 4.5578 12.0854L3.45036 13.8095C2.43882 15.3843 3.21105 17.5249 4.97036 18.0229C9.57274 19.3257 14.4273 19.3257 19.0296 18.0229C20.789 17.5249 21.5612 15.3843 20.5496 13.8095L19.4422 12.0854C18.9903 11.3818 18.7491 10.5552 18.7491 9.70957Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M7.5 19C8.15503 20.7478 9.92246 22 12 22C14.0775 22 15.845 20.7478 16.5 19\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path>",
  "bolt": "<path d=\"M5.66953 9.91436L8.73167 5.77133C10.711 3.09327 11.7007 1.75425 12.6241 2.03721C13.5474 2.32018 13.5474 3.96249 13.5474 7.24712V7.55682C13.5474 8.74151 13.5474 9.33386 13.926 9.70541L13.946 9.72466C14.3327 10.0884 14.9492 10.0884 16.1822 10.0884C18.4011 10.0884 19.5106 10.0884 19.8855 10.7613C19.8917 10.7724 19.8977 10.7837 19.9036 10.795C20.2576 11.4784 19.6152 12.3475 18.3304 14.0857L15.2683 18.2287C13.2889 20.9067 12.2992 22.2458 11.3758 21.9628C10.4525 21.6798 10.4525 20.0375 10.4525 16.7528L10.4526 16.4433C10.4526 15.2585 10.4526 14.6662 10.074 14.2946L10.054 14.2754C9.6673 13.9117 9.05079 13.9117 7.81775 13.9117C5.59888 13.9117 4.48945 13.9117 4.1145 13.2387C4.10829 13.2276 4.10225 13.2164 4.09639 13.205C3.74244 12.5217 4.3848 11.6526 5.66953 9.91436Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path>",
  "chart": "<path d=\"M22 22H2\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M21 22V14.5C21 13.6716 20.3284 13 19.5 13H16.5C15.6716 13 15 13.6716 15 14.5V22\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M15 22V5C15 3.58579 15 2.87868 14.5607 2.43934C14.1213 2 13.4142 2 12 2C10.5858 2 9.87868 2 9.43934 2.43934C9 2.87868 9 3.58579 9 5V22\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M9 22V9.5C9 8.67157 8.32843 8 7.5 8H4.5C3.67157 8 3 8.67157 3 9.5V22\" stroke=\"currentColor\" stroke-width=\"1.5\"></path>",
  "check-circle": "<circle cx=\"12\" cy=\"12\" r=\"10\" stroke=\"currentColor\" stroke-width=\"1.5\"></circle><path d=\"M8.5 12.5L10.5 14.5L15.5 9.5\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"></path>",
  "close-circle": "<circle cx=\"12\" cy=\"12\" r=\"10\" stroke=\"currentColor\" stroke-width=\"1.5\"></circle><path d=\"M14.5 9.49999L9.5 14.5M9.49998 9.49997L14.5 14.4999\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path>",
  "code": "<path d=\"M17 7.82959L18.6965 9.35641C20.239 10.7447 21.0103 11.4389 21.0103 12.3296C21.0103 13.2203 20.239 13.9145 18.6965 15.3028L17 16.8296\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M13.9868 5L12 12.4149L10.0132 19.8297\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M6.99999 7.82959L5.30352 9.35641C3.76096 10.7447 2.98969 11.4389 2.98969 12.3296C2.98969 13.2203 3.76096 13.9145 5.30352 15.3028L6.99999 16.8296\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path>",
  "command": "<path d=\"M8 8H16V16H8V8Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M16 16.001L19 16.0005C20.6569 16.0002 22.0002 17.3432 22.0005 19C22.0007 20.6569 20.6578 22.0002 19.0009 22.0005C17.3441 22.0007 16.0007 20.6578 16.0005 19.001L16 16.001Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M8.00096 16.001L5.00096 16.0005C3.34411 16.0002 2.00075 17.3432 2.00049 19C2.00023 20.6569 3.34316 22.0002 5.00002 22.0005C6.65687 22.0007 8.00023 20.6578 8.00049 19.001L8.00096 16.001Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M16 8.00002L19 8.00049C20.6569 8.00075 22.0002 6.65781 22.0005 5.00096C22.0007 3.34411 20.6578 2.00075 19.0009 2.00049C17.3441 2.00023 16.0007 3.34316 16.0005 5.00002L16 8.00002Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M8.00096 8.00002L5.00096 8.00049C3.34411 8.00075 2.00075 6.65781 2.00049 5.00096C2.00023 3.34411 3.34316 2.00075 5.00002 2.00049C6.65687 2.00023 8.00023 3.34316 8.00049 5.00002L8.00096 8.00002Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path>",
  "copyright": "<path d=\"M2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M14 15.6672C13.475 15.8812 12.8952 16 12.2857 16C9.91878 16 8 14.2091 8 12C8 9.79086 9.91878 8 12.2857 8C12.8952 8 13.475 8.11876 14 8.33283\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path>",
  "cpu-bolt": "<path d=\"M7 10C7 8.58579 7 7.87868 7.43934 7.43934C7.87868 7 8.58579 7 10 7H14C15.4142 7 16.1213 7 16.5607 7.43934C17 7.87868 17 8.58579 17 10V14C17 15.4142 17 16.1213 16.5607 16.5607C16.1213 17 15.4142 17 14 17H10C8.58579 17 7.87868 17 7.43934 16.5607C7 16.1213 7 15.4142 7 14V10Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M12.4286 10L11 12H13L11.5714 14\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"></path><path d=\"M4 12C4 8.22876 4 6.34315 5.17157 5.17157C6.34315 4 8.22876 4 12 4C15.7712 4 17.6569 4 18.8284 5.17157C20 6.34315 20 8.22876 20 12C20 15.7712 20 17.6569 18.8284 18.8284C17.6569 20 15.7712 20 12 20C8.22876 20 6.34315 20 5.17157 18.8284C4 17.6569 4 15.7712 4 12Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M4 12H2\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M22 12H20\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M4 9H2\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M22 9H20\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M4 15H2\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M22 15H20\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M12 20L12 22\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M12 2L12 4\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M9 20L9 22\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M9 2L9 4\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M15 20L15 22\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M15 2L15 4\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path>",
  "cpu": "<path d=\"M7 10C7 8.58579 7 7.87868 7.43934 7.43934C7.87868 7 8.58579 7 10 7H14C15.4142 7 16.1213 7 16.5607 7.43934C17 7.87868 17 8.58579 17 10V14C17 15.4142 17 16.1213 16.5607 16.5607C16.1213 17 15.4142 17 14 17H10C8.58579 17 7.87868 17 7.43934 16.5607C7 16.1213 7 15.4142 7 14V10Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M4 12C4 8.22876 4 6.34315 5.17157 5.17157C6.34315 4 8.22876 4 12 4C15.7712 4 17.6569 4 18.8284 5.17157C20 6.34315 20 8.22876 20 12C20 15.7712 20 17.6569 18.8284 18.8284C17.6569 20 15.7712 20 12 20C8.22876 20 6.34315 20 5.17157 18.8284C4 17.6569 4 15.7712 4 12Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M4 12H2\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M22 12H20\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M4 9H2\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M22 9H20\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M4 15H2\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M22 15H20\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M12 20L12 22\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M12 2L12 4\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M9 20L9 22\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M9 2L9 4\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M15 20L15 22\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M15 2L15 4\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path>",
  "danger": "<path d=\"M12 7V13\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><circle cx=\"12\" cy=\"16\" r=\"1\" fill=\"currentColor\"></circle><path d=\"M7.84308 3.80211C9.8718 2.6007 10.8862 2 12 2C13.1138 2 14.1282 2.6007 16.1569 3.80211L16.8431 4.20846C18.8718 5.40987 19.8862 6.01057 20.4431 7C21 7.98943 21 9.19084 21 11.5937V12.4063C21 14.8092 21 16.0106 20.4431 17C19.8862 17.9894 18.8718 18.5901 16.8431 19.7915L16.1569 20.1979C14.1282 21.3993 13.1138 22 12 22C10.8862 22 9.8718 21.3993 7.84308 20.1979L7.15692 19.7915C5.1282 18.5901 4.11384 17.9894 3.55692 17C3 16.0106 3 14.8092 3 12.4063V11.5937C3 9.19084 3 7.98943 3.55692 7C4.11384 6.01057 5.1282 5.40987 7.15692 4.20846L7.84308 3.80211Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path>",
  "database": "<path d=\"M4 18V6\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M20 6V18\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M12 10C16.4183 10 20 8.20914 20 6C20 3.79086 16.4183 2 12 2C7.58172 2 4 3.79086 4 6C4 8.20914 7.58172 10 12 10Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M20 12C20 14.2091 16.4183 16 12 16C7.58172 16 4 14.2091 4 12\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M20 18C20 20.2091 16.4183 22 12 22C7.58172 22 4 20.2091 4 18\" stroke=\"currentColor\" stroke-width=\"1.5\"></path>",
  "eye": "<path d=\"M3.27489 15.2957C2.42496 14.1915 2 13.6394 2 12C2 10.3606 2.42496 9.80853 3.27489 8.70433C4.97196 6.49956 7.81811 4 12 4C16.1819 4 19.028 6.49956 20.7251 8.70433C21.575 9.80853 22 10.3606 22 12C22 13.6394 21.575 14.1915 20.7251 15.2957C19.028 17.5004 16.1819 20 12 20C7.81811 20 4.97196 17.5004 3.27489 15.2957Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M15 12C15 13.6569 13.6569 15 12 15C10.3431 15 9 13.6569 9 12C9 10.3431 10.3431 9 12 9C13.6569 9 15 10.3431 15 12Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path>",
  "fire": "<path d=\"M20 13.1111C20 20.2222 13.9556 22 10.9333 22C8.28889 22 3 20.2222 3 13.1111C3 10.3295 4.46147 8.46138 5.85996 7.39454C6.63841 6.80069 7.6304 7.39197 7.73017 8.36598L7.816 9.20382C7.92052 10.2241 8.84932 11.0606 9.70932 10.5017C11.3938 9.40705 12 6.7752 12 5.33334V5.00971C12 3.58 13.4438 2.65985 14.6023 3.49767C17.1653 5.35127 20 8.58427 20 13.1111Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M8 18.4445C8 21.2889 10.4889 22 11.7333 22C12.8222 22 15 21.2889 15 18.4445C15 17.3435 14.4107 16.6002 13.8404 16.1713C13.4424 15.872 12.8828 16.1408 12.7459 16.6196C12.5675 17.2437 11.9228 17.636 11.5944 17.0759C11.2941 16.5638 11.2941 15.7957 11.2941 15.3334C11.2941 14.6968 10.6539 14.2847 10.1389 14.6589C9.10649 15.4091 8 16.6815 8 18.4445Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path>",
  "graph": "<path d=\"M2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C22 4.92893 22 7.28595 22 12C22 16.714 22 19.0711 20.5355 20.5355C19.0711 22 16.714 22 12 22C7.28595 22 4.92893 22 3.46447 20.5355C2 19.0711 2 16.714 2 12Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M7 14L8.79689 11.8437C9.50894 10.9893 9.86496 10.562 10.3333 10.562C10.8017 10.562 11.1577 10.9893 11.8698 11.8437L12.1302 12.1563C12.8423 13.0107 13.1983 13.438 13.6667 13.438C14.135 13.438 14.4911 13.0107 15.2031 12.1563L17 10\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path>",
  "info-circle": "<circle cx=\"12\" cy=\"12\" r=\"10\" stroke=\"currentColor\" stroke-width=\"1.5\"></circle><path d=\"M12 17V11\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><circle r=\"1\" transform=\"matrix(1 0 0 -1 12 8)\" fill=\"currentColor\"></circle>",
  "map-point": "<path d=\"M4 10.1433C4 5.64588 7.58172 2 12 2C16.4183 2 20 5.64588 20 10.1433C20 14.6055 17.4467 19.8124 13.4629 21.6744C12.5343 22.1085 11.4657 22.1085 10.5371 21.6744C6.55332 19.8124 4 14.6055 4 10.1433Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><circle cx=\"12\" cy=\"10\" r=\"3\" stroke=\"currentColor\" stroke-width=\"1.5\"></circle>",
  "monitor": "<path d=\"M2 10C2 6.22876 2 4.34315 3.17157 3.17157C4.34315 2 6.22876 2 10 2H14C17.7712 2 19.6569 2 20.8284 3.17157C22 4.34315 22 6.22876 22 10V11C22 13.8284 22 15.2426 21.1213 16.1213C20.2426 17 18.8284 17 16 17H8C5.17157 17 3.75736 17 2.87868 16.1213C2 15.2426 2 13.8284 2 11V10Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M16 22H8\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M12 17L12 22\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M22 13H2\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path>",
  "pie-chart": "<path d=\"M20 15.5524C18.8263 19.2893 15.3351 22 11.2108 22C6.12383 22 2 17.8762 2 12.7892C2 8.66488 4.71065 5.1737 8.44759 4\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M21.9131 9.94727C20.8515 6.14438 17.8556 3.14845 14.0527 2.0869C12.4091 1.6281 11 3.05419 11 4.76062V11.4551C11 12.3083 11.6917 13 12.5449 13H19.2394C20.9458 13 22.3719 11.5909 21.9131 9.94727Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path>",
  "power": "<path d=\"M12 2V6\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M8.5 3.70593C5.26806 5.07145 3 8.27087 3 12C3 16.9706 7.02944 21 12 21C16.9706 21 21 16.9706 21 12C21 8.27087 18.7319 5.07145 15.5 3.70593\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path>",
  "pulse": "<path d=\"M5 15H6.39445C7.1804 15 7.57337 15 7.90501 15.1775C8.23665 15.355 8.45463 15.682 8.8906 16.3359L9.05039 16.5756C9.47306 17.2096 9.68439 17.5266 9.97087 17.5096C10.2573 17.4926 10.4297 17.1528 10.7743 16.4732L12.7404 12.5965C13.0987 11.8899 13.2779 11.5366 13.5711 11.5248C13.8642 11.5131 14.0711 11.8509 14.485 12.5265L15.1222 13.567C15.5512 14.2672 15.7656 14.6174 16.1072 14.8087C16.4487 15 16.8593 15 17.6805 15H19\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C22 4.92893 22 7.28595 22 12C22 16.714 22 19.0711 20.5355 20.5355C19.0711 22 16.714 22 12 22C7.28595 22 4.92893 22 3.46447 20.5355C2 19.0711 2 16.714 2 12Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path>",
  "radar": "<path d=\"M12 11.9996L5.00197 6.33546C4.57285 5.98813 3.93869 6.05182 3.63599 6.5135C3.06678 7.38163 2.62413 8.35389 2.34078 9.41136C0.911364 14.746 4.07719 20.2294 9.41185 21.6588C14.7465 23.0882 20.2299 19.9224 21.6593 14.5877C23.0887 9.25308 19.9229 3.76971 14.5882 2.34029C11.9556 1.63489 9.28684 2.04857 7.0869 3.28972\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path>",
  "refresh": "<path d=\"M3.67981 11.3333L2.92981 11.3333L2.92981 11.3333L3.67981 11.3333ZM3.67981 13L3.15157 13.5324C3.44398 13.8225 3.91564 13.8225 4.20805 13.5324L3.67981 13ZM5.88787 11.8657C6.18191 11.574 6.18377 11.0991 5.89203 10.8051C5.60029 10.511 5.12542 10.5092 4.83138 10.8009L5.88787 11.8657ZM2.52824 10.8009C2.2342 10.5092 1.75933 10.511 1.46759 10.8051C1.17585 11.0991 1.17772 11.574 1.47176 11.8657L2.52824 10.8009ZM18.6156 7.39279C18.8325 7.74565 19.2944 7.85585 19.6473 7.63892C20.0001 7.42199 20.1103 6.96007 19.8934 6.60721L18.6156 7.39279ZM12.0789 2.25C7.03155 2.25 2.92981 6.3112 2.92981 11.3333H4.42981C4.42981 7.15072 7.84884 3.75 12.0789 3.75V2.25ZM2.92981 11.3333L2.92981 13L4.42981 13L4.42981 11.3333L2.92981 11.3333ZM4.20805 13.5324L5.88787 11.8657L4.83138 10.8009L3.15157 12.4676L4.20805 13.5324ZM4.20805 12.4676L2.52824 10.8009L1.47176 11.8657L3.15157 13.5324L4.20805 12.4676ZM19.8934 6.60721C18.287 3.99427 15.3873 2.25 12.0789 2.25V3.75C14.8484 3.75 17.2727 5.20845 18.6156 7.39279L19.8934 6.60721Z\" fill=\"currentColor\"></path><path d=\"M20.3139 11L20.8411 10.4666C20.549 10.1778 20.0788 10.1778 19.7867 10.4666L20.3139 11ZM18.1004 12.1333C17.8058 12.4244 17.8031 12.8993 18.0942 13.1939C18.3854 13.4885 18.8603 13.4913 19.1549 13.2001L18.1004 12.1333ZM21.4729 13.2001C21.7675 13.4913 22.2424 13.4885 22.5335 13.1939C22.8247 12.8993 22.822 12.4244 22.5274 12.1332L21.4729 13.2001ZM5.31794 16.6061C5.1004 16.2536 4.6383 16.1442 4.28581 16.3618C3.93331 16.5793 3.82391 17.0414 4.04144 17.3939L5.31794 16.6061ZM11.8827 21.75C16.9451 21.75 21.0639 17.6915 21.0639 12.6667H19.5639C19.5639 16.8466 16.1332 20.25 11.8827 20.25V21.75ZM21.0639 12.6667V11H19.5639V12.6667H21.0639ZM19.7867 10.4666L18.1004 12.1333L19.1549 13.2001L20.8411 11.5334L19.7867 10.4666ZM19.7867 11.5334L21.4729 13.2001L22.5274 12.1332L20.8411 10.4666L19.7867 11.5334ZM4.04144 17.3939C5.65405 20.007 8.56403 21.75 11.8827 21.75V20.25C9.10023 20.25 6.66584 18.7903 5.31794 16.6061L4.04144 17.3939Z\" fill=\"currentColor\"></path>",
  "round-graph": "<path d=\"M12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 9.20261 3.14864 6.67349 5 4.85857\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M5 12C5 15.866 8.13401 19 12 19C15.866 19 19 15.866 19 12C19 8.13401 15.866 5 12 5\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M12 16C14.2091 16 16 14.2091 16 12C16 9.79086 14.2091 8 12 8\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path>",
  "server": "<path d=\"M2 17C2 15.1144 2 14.1716 2.58579 13.5858C3.17157 13 4.11438 13 6 13H18C19.8856 13 20.8284 13 21.4142 13.5858C22 14.1716 22 15.1144 22 17C22 18.8856 22 19.8284 21.4142 20.4142C20.8284 21 19.8856 21 18 21H6C4.11438 21 3.17157 21 2.58579 20.4142C2 19.8284 2 18.8856 2 17Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M2 6C2 4.11438 2 3.17157 2.58579 2.58579C3.17157 2 4.11438 2 6 2H18C19.8856 2 20.8284 2 21.4142 2.58579C22 3.17157 22 4.11438 22 6C22 7.88562 22 8.82843 21.4142 9.41421C20.8284 10 19.8856 10 18 10H6C4.11438 10 3.17157 10 2.58579 9.41421C2 8.82843 2 7.88562 2 6Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M11 6H18\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M6 6H8\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M11 17H18\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M6 17H8\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path>",
  "settings": "<circle cx=\"12\" cy=\"12\" r=\"3\" stroke=\"currentColor\" stroke-width=\"1.5\"></circle><path d=\"M13.7654 2.15224C13.3978 2 12.9319 2 12 2C11.0681 2 10.6022 2 10.2346 2.15224C9.74457 2.35523 9.35522 2.74458 9.15223 3.23463C9.05957 3.45834 9.0233 3.7185 9.00911 4.09799C8.98826 4.65568 8.70226 5.17189 8.21894 5.45093C7.73564 5.72996 7.14559 5.71954 6.65219 5.45876C6.31645 5.2813 6.07301 5.18262 5.83294 5.15102C5.30704 5.08178 4.77518 5.22429 4.35436 5.5472C4.03874 5.78938 3.80577 6.1929 3.33983 6.99993C2.87389 7.80697 2.64092 8.21048 2.58899 8.60491C2.51976 9.1308 2.66227 9.66266 2.98518 10.0835C3.13256 10.2756 3.3397 10.437 3.66119 10.639C4.1338 10.936 4.43789 11.4419 4.43786 12C4.43783 12.5581 4.13375 13.0639 3.66118 13.3608C3.33965 13.5629 3.13248 13.7244 2.98508 13.9165C2.66217 14.3373 2.51966 14.8691 2.5889 15.395C2.64082 15.7894 2.87379 16.193 3.33973 17C3.80568 17.807 4.03865 18.2106 4.35426 18.4527C4.77508 18.7756 5.30694 18.9181 5.83284 18.8489C6.07289 18.8173 6.31632 18.7186 6.65204 18.5412C7.14547 18.2804 7.73556 18.27 8.2189 18.549C8.70224 18.8281 8.98826 19.3443 9.00911 19.9021C9.02331 20.2815 9.05957 20.5417 9.15223 20.7654C9.35522 21.2554 9.74457 21.6448 10.2346 21.8478C10.6022 22 11.0681 22 12 22C12.9319 22 13.3978 22 13.7654 21.8478C14.2554 21.6448 14.6448 21.2554 14.8477 20.7654C14.9404 20.5417 14.9767 20.2815 14.9909 19.902C15.0117 19.3443 15.2977 18.8281 15.781 18.549C16.2643 18.2699 16.8544 18.2804 17.3479 18.5412C17.6836 18.7186 17.927 18.8172 18.167 18.8488C18.6929 18.9181 19.2248 18.7756 19.6456 18.4527C19.9612 18.2105 20.1942 17.807 20.6601 16.9999C21.1261 16.1929 21.3591 15.7894 21.411 15.395C21.4802 14.8691 21.3377 14.3372 21.0148 13.9164C20.8674 13.7243 20.6602 13.5628 20.3387 13.3608C19.8662 13.0639 19.5621 12.558 19.5621 11.9999C19.5621 11.4418 19.8662 10.9361 20.3387 10.6392C20.6603 10.4371 20.8675 10.2757 21.0149 10.0835C21.3378 9.66273 21.4803 9.13087 21.4111 8.60497C21.3592 8.21055 21.1262 7.80703 20.6602 7C20.1943 6.19297 19.9613 5.78945 19.6457 5.54727C19.2249 5.22436 18.693 5.08185 18.1671 5.15109C17.9271 5.18269 17.6837 5.28136 17.3479 5.4588C16.8545 5.71959 16.2644 5.73002 15.7811 5.45096C15.2977 5.17191 15.0117 4.65566 14.9909 4.09794C14.9767 3.71848 14.9404 3.45833 14.8477 3.23463C14.6448 2.74458 14.2554 2.35523 13.7654 2.15224Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path>",
  "shield": "<path d=\"M3 10.4167C3 7.21907 3 5.62028 3.37752 5.08241C3.75503 4.54454 5.25832 4.02996 8.26491 3.00079L8.83772 2.80472C10.405 2.26824 11.1886 2 12 2C12.8114 2 13.595 2.26824 15.1623 2.80472L15.7351 3.00079C18.7417 4.02996 20.245 4.54454 20.6225 5.08241C21 5.62028 21 7.21907 21 10.4167C21 10.8996 21 11.4234 21 11.9914C21 17.6294 16.761 20.3655 14.1014 21.5273C13.38 21.8424 13.0193 22 12 22C10.9807 22 10.62 21.8424 9.89856 21.5273C7.23896 20.3655 3 17.6294 3 11.9914C3 11.4234 3 10.8996 3 10.4167Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M3 11L12 8L21 11\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M12 2V21.5\" stroke=\"currentColor\" stroke-width=\"1.5\"></path>",
  "tuning": "<path d=\"M14 14.5C14 12.8431 15.3431 11.5 17 11.5C18.6568 11.5 20 12.8431 20 14.5C20 16.1569 18.6568 17.5 17 17.5C15.3431 17.5 14 16.1569 14 14.5Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M3.99998 9.5C3.99998 11.1569 5.34312 12.5 6.99998 12.5C8.65683 12.5 9.99998 11.1569 9.99998 9.5C9.99998 7.84315 8.65683 6.5 6.99998 6.5C5.34312 6.5 3.99998 7.84315 3.99998 9.5Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M16.9585 9L16.9585 2\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M6.9585 15L6.9585 22\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M16.9585 22L16.9585 20\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path><path d=\"M6.9585 2L6.9585 4\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\"></path>",
  "widget": "<path d=\"M2.5 6.5C2.5 4.61438 2.5 3.67157 3.08579 3.08579C3.67157 2.5 4.61438 2.5 6.5 2.5C8.38562 2.5 9.32843 2.5 9.91421 3.08579C10.5 3.67157 10.5 4.61438 10.5 6.5C10.5 8.38562 10.5 9.32843 9.91421 9.91421C9.32843 10.5 8.38562 10.5 6.5 10.5C4.61438 10.5 3.67157 10.5 3.08579 9.91421C2.5 9.32843 2.5 8.38562 2.5 6.5Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M13.5 17.5C13.5 15.6144 13.5 14.6716 14.0858 14.0858C14.6716 13.5 15.6144 13.5 17.5 13.5C19.3856 13.5 20.3284 13.5 20.9142 14.0858C21.5 14.6716 21.5 15.6144 21.5 17.5C21.5 19.3856 21.5 20.3284 20.9142 20.9142C20.3284 21.5 19.3856 21.5 17.5 21.5C15.6144 21.5 14.6716 21.5 14.0858 20.9142C13.5 20.3284 13.5 19.3856 13.5 17.5Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M2.5 17.5C2.5 15.6144 2.5 14.6716 3.08579 14.0858C3.67157 13.5 4.61438 13.5 6.5 13.5C8.38562 13.5 9.32843 13.5 9.91421 14.0858C10.5 14.6716 10.5 15.6144 10.5 17.5C10.5 19.3856 10.5 20.3284 9.91421 20.9142C9.32843 21.5 8.38562 21.5 6.5 21.5C4.61438 21.5 3.67157 21.5 3.08579 20.9142C2.5 20.3284 2.5 19.3856 2.5 17.5Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path><path d=\"M13.5 6.5C13.5 4.61438 13.5 3.67157 14.0858 3.08579C14.6716 2.5 15.6144 2.5 17.5 2.5C19.3856 2.5 20.3284 2.5 20.9142 3.08579C21.5 3.67157 21.5 4.61438 21.5 6.5C21.5 8.38562 21.5 9.32843 20.9142 9.91421C20.3284 10.5 19.3856 10.5 17.5 10.5C15.6144 10.5 14.6716 10.5 14.0858 9.91421C13.5 9.32843 13.5 8.38562 13.5 6.5Z\" stroke=\"currentColor\" stroke-width=\"1.5\"></path>"
};
const iconNames = Object.keys(SOLAR);
function Icon({
  name,
  size,
  label,
  strokeWidth,
  style,
  className,
  ...rest
}) {
  const markup = SOLAR[name];
  const px = size == null ? '1em' : typeof size === 'number' ? size + 'px' : size;
  const a11y = label ? {
    role: 'img',
    'aria-label': label
  } : {
    'aria-hidden': 'true',
    focusable: 'false'
  };
  const st = {
    width: px,
    height: px,
    display: 'inline-block',
    flex: 'none',
    verticalAlign: '-0.15em',
    color: 'inherit',
    ...(strokeWidth ? {
      strokeWidth
    } : null),
    ...style
  };
  if (!markup) {
    return /*#__PURE__*/React.createElement("svg", _extends({
      viewBox: "0 0 24 24",
      fill: "none",
      className: className,
      style: st
    }, a11y, rest), /*#__PURE__*/React.createElement("rect", {
      x: "3",
      y: "3",
      width: "18",
      height: "18",
      stroke: "currentColor",
      strokeWidth: "1.5",
      strokeDasharray: "3 3"
    }));
  }
  return /*#__PURE__*/React.createElement("svg", _extends({
    viewBox: "0 0 24 24",
    fill: "none",
    className: className,
    style: st
  }, a11y, rest, {
    dangerouslySetInnerHTML: {
      __html: markup
    }
  }));
}
Object.assign(__ds_scope, { iconNames, Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/icon/Icon.jsx", error: String((e && e.message) || e) }); }

// components/overlay/ConfirmDialog.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Tone -> head label. One accent hue: warmth is a tint of the same orange
   (cream -> amber -> hazard), never a second color. */
const TONES = {
  confirm: {
    label: 'CONFIRM',
    cls: 'dlg-confirm'
  },
  warning: {
    label: 'WARNING',
    cls: 'dlg-warning'
  },
  danger: {
    label: 'CAUTION',
    cls: 'dlg-danger'
  }
};

/* Minimal confirmation / warning popup. A lit hairline card over a scrim:
   mono tone label, uppercase headline (the question), one human sentence-case
   line, and two actions (cancel = secondary, confirm = the ONE primary). */
function ConfirmDialog({
  open = true,
  tone = 'warning',
  title = 'Remove node A-07?',
  eyebrow,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  dismissible = true,
  embedded = false,
  onConfirm,
  onCancel,
  children,
  ...rest
}) {
  const t = TONES[tone] || TONES.warning;
  React.useEffect(() => {
    if (embedded || !open) return;
    const onKey = e => {
      if (e.key === 'Escape' && onCancel) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, embedded, onCancel]);
  if (!open) return null;
  const card = /*#__PURE__*/React.createElement("div", _extends({
    className: `dlg ${t.cls}`,
    role: "alertdialog",
    "aria-modal": embedded ? undefined : 'true',
    "aria-label": title
  }, rest), /*#__PURE__*/React.createElement("div", {
    className: "dlg-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "dlg-glyph"
  }, eyebrow || t.label)), /*#__PURE__*/React.createElement("div", {
    className: "dlg-body"
  }, /*#__PURE__*/React.createElement("h2", {
    className: "dlg-title"
  }, title), children && /*#__PURE__*/React.createElement("p", {
    className: "dlg-msg"
  }, children)), /*#__PURE__*/React.createElement("div", {
    className: "dlg-foot"
  }, /*#__PURE__*/React.createElement(__ds_scope.Button, {
    size: "sm",
    onClick: onCancel
  }, cancelLabel), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    size: "sm",
    variant: "primary",
    onClick: onConfirm
  }, confirmLabel)));
  if (embedded) return card;
  return /*#__PURE__*/React.createElement("div", {
    className: "dlg-scrim",
    onMouseDown: e => {
      if (e.target === e.currentTarget && dismissible && onCancel) onCancel();
    }
  }, card);
}
Object.assign(__ds_scope, { ConfirmDialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlay/ConfirmDialog.jsx", error: String((e && e.message) || e) }); }

// components/pricing/PricingTier.jsx
try { (() => {
/* Pricing tier for a gap:1px 3-col grid. Featured tier: --bg-panel + inset orange ring +
   ◆ RECOMMENDED corner tab + ember lift. All tier CTAs share ONE label/intent. */
function PricingTier({
  name,
  price,
  priceNote,
  features = [],
  featured = false,
  ctaLabel = 'Get started',
  onCta,
  ctaHref = '#'
}) {
  return /*#__PURE__*/React.createElement("article", {
    className: featured ? 'tier tier-featured' : 'tier'
  }, featured && /*#__PURE__*/React.createElement("span", {
    className: "tier-tab",
    "aria-hidden": "true"
  }, "\u25C6 Recommended"), /*#__PURE__*/React.createElement("p", {
    className: "tier-name"
  }, name), /*#__PURE__*/React.createElement("p", {
    className: "tier-price"
  }, price, priceNote && /*#__PURE__*/React.createElement("em", null, " ", priceNote)), /*#__PURE__*/React.createElement("ul", {
    className: "tier-feats"
  }, features.map(f => /*#__PURE__*/React.createElement("li", {
    key: f
  }, f))), onCta ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: featured ? 'btn btn-primary' : 'btn',
    onClick: onCta
  }, ctaLabel) : /*#__PURE__*/React.createElement("a", {
    className: featured ? 'btn btn-primary' : 'btn',
    href: ctaHref
  }, ctaLabel));
}
Object.assign(__ds_scope, { PricingTier });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/pricing/PricingTier.jsx", error: String((e && e.message) || e) }); }

// components/telemetry/Equalizer.jsx
try { (() => {
/* Live signal: ~28 bars, scaleY bob, staggered delays, orange gradient fill.
   Heights/durations are deterministic (seeded by index) so renders are stable. */
function Equalizer({
  bars = 28,
  height = 64
}) {
  const items = [];
  for (let i = 0; i < bars; i++) {
    const h = 0.35 + 0.65 * Math.abs(Math.sin(i * 7.31 + 1.7));
    const d = 1.2 + i * 13 % 9 / 10;
    const dl = -(i * 0.137 % 1.4);
    items.push(/*#__PURE__*/React.createElement("i", {
      key: i,
      style: {
        '--h': h.toFixed(2),
        '--d': `${d.toFixed(2)}s`,
        '--dl': `${dl.toFixed(2)}s`
      }
    }));
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "eq",
    style: {
      height
    },
    "aria-hidden": "true"
  }, items);
}
Object.assign(__ds_scope, { Equalizer });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/telemetry/Equalizer.jsx", error: String((e && e.message) || e) }); }

// components/telemetry/HudCard.jsx
try { (() => {
/* HUD telemetry card: ◊ title + ● LIVE blip, equalizer signal, 2x2 readout grid,
   blueprint minimap with radar pings. Stylized generated telemetry, not a fake screenshot. */
function HudCard({
  title = '◊ UNIT D-01 · TELEMETRY',
  live = 'LIVE',
  readouts = [{
    k: 'Core temp',
    v: '412',
    u: '°C'
  }, {
    k: 'Load',
    v: '71',
    u: '%'
  }, {
    k: 'Flow',
    v: '1.9',
    u: 'T/H'
  }, {
    k: 'Drift',
    v: '0.4',
    u: 'MM'
  }],
  map = true,
  coord = '47.6062 N · 122.3321 W'
}) {
  return /*#__PURE__*/React.createElement("figure", {
    className: "hud"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hud-head"
  }, /*#__PURE__*/React.createElement("span", null, title), /*#__PURE__*/React.createElement("span", {
    className: "hud-live"
  }, /*#__PURE__*/React.createElement("span", {
    className: "dot",
    "aria-hidden": "true"
  }), live)), /*#__PURE__*/React.createElement("div", {
    className: "hud-body"
  }, /*#__PURE__*/React.createElement(__ds_scope.Equalizer, null), /*#__PURE__*/React.createElement("dl", {
    className: "readout"
  }, readouts.map(r => /*#__PURE__*/React.createElement("div", {
    key: r.k
  }, /*#__PURE__*/React.createElement("dt", {
    className: "k"
  }, r.k), /*#__PURE__*/React.createElement("dd", {
    className: "v"
  }, r.v, r.u && /*#__PURE__*/React.createElement("em", null, r.u))))), map && /*#__PURE__*/React.createElement("div", {
    className: "bpmap",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("span", {
    className: "bp-mark",
    style: {
      left: '22%',
      top: '30%'
    }
  }, "+"), /*#__PURE__*/React.createElement("span", {
    className: "bp-mark",
    style: {
      left: '78%',
      top: '22%'
    }
  }, "+"), /*#__PURE__*/React.createElement("span", {
    className: "bp-mark",
    style: {
      left: '55%',
      top: '74%'
    }
  }, "+"), /*#__PURE__*/React.createElement("span", {
    className: "ping",
    style: {
      left: '34%',
      top: '52%'
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "ping ping-2",
    style: {
      left: '68%',
      top: '38%'
    }
  }), /*#__PURE__*/React.createElement("span", {
    className: "bp-coord"
  }, coord))));
}
Object.assign(__ds_scope, { HudCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/telemetry/HudCard.jsx", error: String((e && e.message) || e) }); }

// components/telemetry/Reticle.jsx
try { (() => {
/* Cursor-follow HUD reticle: full-viewport 1px orange crosshair lerping toward the pointer
   (rAF, transform only) + live mono lat/lon tag. pointer:fine only; off under reduced motion. */
function Reticle() {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!window.matchMedia('(pointer:fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = ref.current;
    if (!el) return;
    let tx = innerWidth / 2,
      ty = innerHeight / 2,
      x = tx,
      y = ty,
      on = false,
      raf;
    const mv = e => {
      tx = e.clientX;
      ty = e.clientY;
      if (!on) {
        on = true;
        el.style.opacity = '1';
      }
    };
    const loop = () => {
      x += (tx - x) * 0.14;
      y += (ty - y) * 0.14;
      el.children[0].style.transform = `translateX(${x.toFixed(1)}px)`;
      el.children[1].style.transform = `translateY(${y.toFixed(1)}px)`;
      const tag = el.children[2];
      tag.style.transform = `translate(${(x + 14).toFixed(1)}px, ${(y + 14).toFixed(1)}px)`;
      tag.textContent = `LAT ${(47.6062 + (y / innerHeight - 0.5) * 0.02).toFixed(4)} · LON ${(-122.3321 + (x / innerWidth - 0.5) * 0.02).toFixed(4)}`;
      raf = requestAnimationFrame(loop);
    };
    addEventListener('mousemove', mv);
    raf = requestAnimationFrame(loop);
    return () => {
      removeEventListener('mousemove', mv);
      cancelAnimationFrame(raf);
    };
  }, []);
  return /*#__PURE__*/React.createElement("div", {
    className: "reticle",
    ref: ref,
    "aria-hidden": "true",
    style: {
      opacity: 0
    }
  }, /*#__PURE__*/React.createElement("i", {
    className: "ret-v"
  }), /*#__PURE__*/React.createElement("i", {
    className: "ret-h"
  }), /*#__PURE__*/React.createElement("span", {
    className: "ret-tag"
  }));
}
Object.assign(__ds_scope, { Reticle });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/telemetry/Reticle.jsx", error: String((e && e.message) || e) }); }

// components/telemetry/Terminal.jsx
try { (() => {
const DEFAULT_LINES = [{
  t: 'cmd',
  text: 'sharedock add --device A-01'
}, {
  t: 'out',
  text: 'LINK ESTABLISHED · ENCRYPTED · REV 2.6'
}, {
  t: 'cmd',
  text: 'sharedock status --all'
}, {
  t: 'out',
  text: '[ 08:14:22 ] A-01 128GB · HEALTHY'
}, {
  t: 'out',
  text: '[ 08:14:23 ] A-02 512GB · HEALTHY'
}, {
  t: 'warn',
  text: 'WARN · A-07 LOW SPACE · 91% USED'
}, {
  t: 'ok',
  text: 'OK · POOL ONLINE · 6/6 DEVICES'
}];

/* CRT terminal: typewriter output (cmd ~34ms/char, output ~8ms/char), blinking block cursor,
   scanline overlay. Color roles: prompt --o, cmd --fg, out --fg-dim, ok --term-green (the ONLY
   green in the system), warn --amber. Renders fully typed under reduced motion or static=true. */
function Terminal({
  title = 'SHAREDOCK · /bin/sharedock · A-01',
  lines = DEFAULT_LINES,
  static: isStatic = false,
  minHeight
}) {
  const total = lines.reduce((s, l) => s + l.text.length, 0);
  const [n, setN] = React.useState(isStatic ? total : 0);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (isStatic) {
      setN(total);
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setN(total);
      return;
    }
    const el = ref.current;
    let timer;
    const io = new IntersectionObserver(es => {
      es.forEach(e => {
        if (!e.isIntersecting) return;
        io.unobserve(el);
        let i = 0;
        const speedAt = idx => {
          let acc = 0;
          for (const l of lines) {
            acc += l.text.length;
            if (idx < acc) return l.t === 'cmd' ? 34 : 8;
          }
          return 8;
        };
        const step = () => {
          i += 1;
          setN(i);
          if (i < total) timer = setTimeout(step, speedAt(i));
        };
        timer = setTimeout(step, 400);
      });
    }, {
      threshold: 0.18
    });
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimeout(timer);
    };
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
    const last = !done || i === lines.length - 1 && n >= total;
    rows.push(/*#__PURE__*/React.createElement("div", {
      className: "term-line",
      key: i
    }, l.t === 'cmd' && /*#__PURE__*/React.createElement("span", {
      className: "t-prompt"
    }, "$ "), /*#__PURE__*/React.createElement("samp", {
      className: `t-${l.t}`
    }, shown), last && /*#__PURE__*/React.createElement("span", {
      className: "t-cursor",
      "aria-hidden": "true"
    })));
    if (!done) break;
  }
  if (rows.length === 0) rows.push(/*#__PURE__*/React.createElement("div", {
    className: "term-line",
    key: "c"
  }, /*#__PURE__*/React.createElement("span", {
    className: "t-cursor",
    "aria-hidden": "true"
  })));
  return /*#__PURE__*/React.createElement("figure", {
    className: "terminal",
    ref: ref
  }, /*#__PURE__*/React.createElement("div", {
    className: "term-bar",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("span", {
    className: "term-dot"
  }), /*#__PURE__*/React.createElement("span", {
    className: "term-dot term-dot-o"
  }), /*#__PURE__*/React.createElement("span", {
    className: "term-dot term-dot-o"
  }), /*#__PURE__*/React.createElement("span", {
    className: "term-title"
  }, title)), /*#__PURE__*/React.createElement("div", {
    className: "term-body scanlines",
    style: minHeight ? {
      minHeight
    } : undefined
  }, rows));
}
Object.assign(__ds_scope, { Terminal });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/telemetry/Terminal.jsx", error: String((e && e.message) || e) }); }

__ds_ns.CapabilityCell = __ds_scope.CapabilityCell;

__ds_ns.Crosshair = __ds_scope.Crosshair;

__ds_ns.HumanCell = __ds_scope.HumanCell;

__ds_ns.SectionHeader = __ds_scope.SectionHeader;

__ds_ns.StatCell = __ds_scope.StatCell;

__ds_ns.Footer = __ds_scope.Footer;

__ds_ns.Marquee = __ds_scope.Marquee;

__ds_ns.Nav = __ds_scope.Nav;

__ds_ns.StatusBar = __ds_scope.StatusBar;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Eyebrow = __ds_scope.Eyebrow;

__ds_ns.PillChip = __ds_scope.PillChip;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.ConfirmDialog = __ds_scope.ConfirmDialog;

__ds_ns.PricingTier = __ds_scope.PricingTier;

__ds_ns.Equalizer = __ds_scope.Equalizer;

__ds_ns.HudCard = __ds_scope.HudCard;

__ds_ns.Reticle = __ds_scope.Reticle;

__ds_ns.Terminal = __ds_scope.Terminal;

})();
