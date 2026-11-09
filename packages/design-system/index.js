// @app/halfsteel — barrel export of the Halfsteel design system's React primitives.
// App builds import these JSX sources directly (Vite transforms them); the CDN
// _ds_bundle.js / window.MachineEmberDesignSystem_* global is a design-tool artifact
// and is intentionally NOT used here.

export { Callout } from './components/cells/Callout.jsx';
export { CapabilityCell } from './components/cells/CapabilityCell.jsx';
export { Crosshair } from './components/cells/Crosshair.jsx';
export { HumanCell } from './components/cells/HumanCell.jsx';
export { SectionHeader } from './components/cells/SectionHeader.jsx';
export { StatCell } from './components/cells/StatCell.jsx';

export { Footer } from './components/chrome/Footer.jsx';
export { Marquee } from './components/chrome/Marquee.jsx';
export { Nav } from './components/chrome/Nav.jsx';
export { StatusBar } from './components/chrome/StatusBar.jsx';

export { Button } from './components/controls/Button.jsx';
export { Eyebrow } from './components/controls/Eyebrow.jsx';
export { PillChip } from './components/controls/PillChip.jsx';

export { Icon, iconNames } from './components/icon/Icon.jsx';

export { PricingTier } from './components/pricing/PricingTier.jsx';

export { Equalizer } from './components/telemetry/Equalizer.jsx';
export { HudCard } from './components/telemetry/HudCard.jsx';
export { Reticle } from './components/telemetry/Reticle.jsx';
export { Terminal } from './components/telemetry/Terminal.jsx';
