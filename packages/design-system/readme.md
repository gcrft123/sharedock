# Sharedock · Design System

> **Status: specification and prototype reference, not a runtime dependency.**
>
> The shipping console (`packages/ui`) does **not** import this package. It carries its
> own copy of the recipe layer at `packages/ui/src/shared/styles/ds-recipes.css`, and
> that copy is the source of truth for what users actually see. `@app/halfsteel` was a
> declared dependency of `apps/web` that nothing imported; it has been removed so the
> repo no longer implies a link that never existed.
>
> This package remains the canonical **written spec** (token block, component recipes,
> composition rules). Read it to understand intent. When
> the two disagree, `packages/ui` is what ships, and `ds-recipes.css` is where a change
> has to land to be real.
>
> See [docs/design.md](../../docs/design.md) for the captured visual system.

**Thesis: One machine, warmly lit.** An industrial-brutalist telemetry interface language for Sharedock: square, monospace, rigid 1px-hairline grids, near-black, scanlines. Sharedock turns the old phones, laptops and drives in your drawer into one private cloud, and the telemetry motif is literal here: each old device is a **docked node** reporting capacity, health and transfer. **Ember** is the warmth threaded through that one machine: a small warm radius on controls and the lit telemetry objects, pastel pill tokens, warm accent text, ember-tinted glows, and exactly one halftone serif word woven into an uppercase headline.

**The split is ~85% machine / 15% ember.** Keep the structure machine (square, gridded, mono metadata, crosshairs) and turn only the temperature warm. The machine skeleton never rounds; warmth is a small ember radius on controls and the lit objects plus the warm palette. Softened for everyday users: the machine reads devices and storage, and the human layer speaks plain sentences ("your files never leave home").

Sharedock is a **product brand built on a reusable design language.** The industrial-telemetry material (docked devices, capacity HUDs, pooled storage, activity logs) is the visual grammar; the example screens carry Sharedock's own product copy. The logo is white line art on the near-black substrate: a **mark** (cloud + cube) and a **wordmark** ("SHAREDOCK"), both in `assets/brand/`. The wordmark sits in the nav and footer; the mark is for compact spots and a favicon. All metrics in the example screens are sample data.

## Sources
- A written specification (full token block, component recipes, composition rules) authored in chat. No Figma file, no codebase, no logo assets were provided.
- **Solar Icon Set** (Linear style) by 480 Design — [github.com/480-Design/Solar-Icon-Set](https://github.com/480-Design/Solar-Icon-Set), free to use. A curated 30-icon subset is integrated (see ICONOGRAPHY).
- Fonts load from Google Fonts CDN. No font binaries are stored (see Caveats).

## Namespace
Components compile into `_ds_bundle.js` and mount from `window.MachineEmberDesignSystem_bd5c19` (a generated identifier derived from the project's original name). Call `check_design_system` for the exact value; renaming the project regenerates it. This is an internal code identifier and carries no brand meaning.

## CONTENT FUNDAMENTALS
Two registers, dosed like the visuals. These are *style* rules; the specific nouns below are placeholders.

- **Machine register (default, ~85%):** terse, technical, telemetric. Short declaratives. "Files that stay home." Device IDs, capacity, transfer rates, health readouts. UPPERCASE for all structural type: nav, labels, H2 headlines, section IDs, telemetry.
- **Human register (~15%):** calm, plain, reassuring. Sentence case. Used only where the ember dial runs highest: the human-layer section and the final CTA. "Old devices, new drive."
- Casing rule: structural/machine type is UPPERCASE; warm accent type (Space Grotesk cell headings, calm body, the single serif word) is sentence case. Sentence case is a warmth cue inside a machine section, not a mode switch.
- **No em-dashes anywhere in visible copy.** Use `·`, `,`, `:` or a period.
- No emoji, ever. No AI-cute wordplay: if a line sounds clever-but-wrong, replace it with a plain sentence.
- Label any invented metric as sample data (`SAMPLE FEED`, `<!-- mock -->`). No fake-precise numbers presented as real. Device IDs are `A-01`, `A-02`… with friendly names (Closet iPhone, Old ThinkPad).
- CTA discipline: labels ≤3 words, one line, ONE CTA intent across a whole page.
- Symbology in copy: `[ … ]` and `< … >` framing on labels, `///` and `>>>` separators, `®` `©` `™` as geometric glyphs, sample telemetry strings.

## VISUAL FOUNDATIONS
- **Color:** black substrate (`#0A0A0A`, never pure #000) + ONE accent family, hazard orange `#FF5A1F`. All "soft color" is tints of the same orange hue (amber → peach → cream → blush), never a second hue. Exactly one green (`#4AF626`) exists and it is spent on the single OK/success line inside a terminal. Foreground is warm near-white "phosphor" (`#F3EEE7`).
- **Gradients:** never as hard structure (no gradient buttons/panels). Allowed only as warmth: faint warm top-tints on cells, fills inside data viz, the halftone serif.
- **Shadows:** always ember-tinted `rgba(255,90,31,.4–.85)`, never neutral black. Restrained: resting glow under the one primary button, hover glow on cells (inset), lift under the featured tier / HUD.
- **Type:** four families, four jobs, never a fifth. Archivo Black = macro display (uppercase, ultra-tight). Space Grotesk = warm accent type (sentence case). JetBrains Mono = ALL telemetry, nav, labels, machine body. Playfair Display italic = ONE halftone-dithered word per page, woven inline into an uppercase headline.
- **Radius:** the machine skeleton is radius 0 — grids, crosshairs, chrome bars, cells, footer, marquee. Warmth is a small ember radius applied only to controls and the lit telemetry objects: buttons `--r-1` (5px), the HUD card and terminal window `--r-2` (9px). The pill chip stays 999px (28px tall). If a card feels cold, warm it with a tint or the ember radius, never a large sweep.
- **Grids:** the hairline-grid technique everywhere for multi-cell zones: `display:grid; gap:1px; background:var(--line)` with solid `--bg` cells. `+` crosshairs at cell corners. Cell hover NEVER lifts/translates: warm in place (top-tint bg + inset ember hairline + crosshair heats to orange/amber).
- **Spacing:** snap to 4, 6, 8, 10, 12, 14, 16, 20, 22, 26, 30, 34, 40, 48, 64, 88 px. Gutter `--pad: clamp(20px,5vw,88px)`. Content max 1180px. Control heights fixed: status bar 30, nav 64, button 44 (sm 34), chip 28.
- **Backgrounds/texture:** film grain overlay (SVG feTurbulence, opacity .05, blend overlay), faint global scanlines (.35) with a stronger version (.5) on hero field + terminal body, blueprint grids in minimaps. No photography, no illustration: the "real visuals" are generated telemetry (HUD, terminal, equalizer, radar).
- **Motion:** every animation motivated. Eases `--ease: cubic-bezier(.22,.61,.36,1)`, `--ease-out: cubic-bezier(.16,1,.3,1)`. IO reveals (opacity + 26px rise, .7s), stat count-ups (~1400ms), equalizer bob, radar pings (2.6s), status-dot blips, ONE marquee per page (26s linear), terminal typewriter. Full `prefers-reduced-motion` support: everything renders instantly, terminal fully typed.
- **Hover states:** buttons brighten (secondary border→fg; primary bg→`--o-bright` + deeper glow); links/nav get animated orange underline; grid cells warm in place; titles turn orange. Press: `translateY(1px)`.
- **Focus:** 2px orange ring, visible on every interactive element. Selection: orange bg, `#0A0A0A` text.
- **Transparency/blur:** only the nav (`rgba(10,10,10,.72)` + `backdrop-filter: blur(10px)`); swap to solid `--bg-panel` under `prefers-reduced-transparency`.
- **Layout rules:** anti-center bias (hero is a 1.15fr/.85fr asymmetric split; only the final CTA may center). Hero fits 100dvh minus chrome. No layout family repeats on a page. Body never scrolls horizontally: clip decorative overflow with `overflow:hidden` on their section.
- **Contrast:** WCAG AA floor. `--muted` on `--bg` is for ≥11px uppercase metadata only. `--peach`/`--cream` on dark pass comfortably.

## ICONOGRAPHY
Two layers, in priority order.

**1. Typographic/industrial symbology (the default, structural layer).** Set in JetBrains Mono, these ARE the machine's native marks:
- `+` crosshairs at grid intersections (color `--faint`, heat to `--o`/`--amber` on hover)
- `●` live/status dots (square-cornered, blinking), `◊` HUD titles, `◆` recommended tab
- `[ 01 ]`, `< … >` label framing; `///`, `>>>` separators; `®` `©` `™` glyphs
- `$` prompt, `█` block cursor, `→` button arrow, `+` list bullets

**2. Solar Icon Set — Linear (the pictographic layer).** Integrated from [github.com/480-Design/Solar-Icon-Set](https://github.com/480-Design/Solar-Icon-Set) (free, by 480 Design). The **Linear** style is used exclusively: 24×24 grid, 1.5px single-stroke, 100% corner smoothing, which reads as hairline-consistent with the 1px machine grids. Every icon is recolored `stroke: currentColor` so it inherits the phosphor/muted/orange/ember palette from context; nothing is filled. A curated 30-icon subset lives in `assets/icons/solar/*.svg` (cleaned standalone files) and embedded in the `Icon` React component (`components/icon/Icon.jsx`), which renders inline SVG sized to `1em` by default.
  - Curated names: alarm, bell, bolt, chart, check-circle, close-circle, code, command, copyright, cpu, cpu-bolt, danger, database, eye, fire, graph, info-circle, map-point, monitor, pie-chart, power, pulse, radar, refresh, round-graph, server, settings, shield, tuning, widget.
  - To add more: copy the SVG from the Linear folder of the repo, recolor `stroke="black"` → `stroke="currentColor"`, drop it in `assets/icons/solar/`, and add its inner markup to the `SOLAR` registry in `Icon.jsx`.

**Rules.** Prefer the mono glyphs for structural marks (crosshairs, dots, separators, prompts). Reach for `Icon` when a concept genuinely needs a pictogram (settings, alarm, server, radar, chart). Keep every icon monochrome, hairline, and square-framed. Never mix a second icon family, never fill an icon, and no emoji.

## Index
- `styles.css` — global entry (imports everything below)
- `tokens/` — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`, `motion.css`
- `css/` — recipe layers: `base.css`, `typography.css`, `texture.css`, `structure.css`, `controls.css`, `chrome.css`, `telemetry.css`, `motion.css`
- `components/controls/` — Button, PillChip, Eyebrow
- `components/icon/` — Icon (Solar Linear set, 30 curated glyphs)
- `components/chrome/` — StatusBar, Nav, Marquee, Footer
- `components/cells/` — SectionHeader, CapabilityCell, HumanCell, StatCell, Crosshair
- `components/pricing/` — PricingTier
- `components/telemetry/` — HudCard, Equalizer, Terminal, Reticle
- `components/overlay/` — ConfirmDialog (confirmation / warning popup)
- `guidelines/` — foundation specimen cards (colors, type, spacing, texture, motion, brand slot)
- `assets/icons/solar/` — cleaned standalone Solar Linear SVGs
- `ui_kits/marketing/` · `ui_kits/docs/` · `ui_kits/dashboard/` — three example screens
- `SKILL.md` — agent skill entry point

### Intentional additions (not in the core spec §7, needed by recipes)
- `Equalizer` — the live signal bars (spec §6), used inside HudCard and dashboards.
- `Crosshair` — the `+` corner mark (spec §4.3), used by every cell.
- `Reticle` — the cursor-follow HUD reticle (spec §5.4) as a drop-in component.
- `Icon` — inline-SVG wrapper over the Solar Icon Set (Linear), integrated at the user's request. Recolored to `currentColor`; assets in `assets/icons/solar/`.

## HOW TO EXTEND (verbatim rule)
This is ONE machine, warmly lit — not two modes. Every section is square, monospace, uppercase, black-on-black with 1px hairlines, crosshairs, and one hazard orange. Ember is the minority warmth threaded through it (~15%): a small warm radius on controls and the lit telemetry objects, pastel 999px pill tokens, warm amber/peach/cream text, ember-tinted glows, and one inline halftone serif word. Warm the temperature, never the skeleton — the grids, crosshairs, chrome and cells stay square; no soft-font section, no mode-flip. One accent hue, one primary button per view, one marquee, one green (terminal only), one halftone word per page. New content is Sharedock content: docked devices, pooled storage, health and transfer telemetry, files that stay home.

## Caveats
- Fonts are loaded from Google Fonts CDN (`tokens/fonts.css`): Archivo Black, Space Grotesk, JetBrains Mono, Playfair Display italic. No font binaries are stored; offline use needs downloaded woff2 files + local `@font-face` rules.
- The Sharedock logo ships as white transparent PNGs in `assets/brand/`: `sharedock-logo.png` (wordmark, 4809x997) and `sharedock-mark.png` (cloud + cube mark, 1000x1000). Both are white line art meant for the dark substrate. `Nav` and `Footer` take an optional `logo` prop (image src) that renders the image in place of the text wordmark.
- The internal component namespace still reads `MachineEmberDesignSystem_bd5c19` (a generated identifier from the project's original name). Renaming the project regenerates it; the compiler updates the bundle and cards on the next turn. It is an internal code identifier and carries no brand meaning.
- All metrics in the example screens are sample data and labeled as such.
