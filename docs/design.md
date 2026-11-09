---
name: Sharedock
description: Industrial-brutalist telemetry for a private cloud you own, warmed by exactly one accent hue.
colors:
  substrate: "#0A0A0A"
  substrate-panel: "#0E0D0C"
  substrate-well: "#070605"
  substrate-deep: "#050403"
  phosphor: "#F3EEE7"
  phosphor-dim: "#B6AFA5"
  muted: "#80796F"
  faint: "#4A453E"
  hazard-orange: "#FF5A1F"
  hazard-bright: "#FF7E33"
  ember-deep: "#C7370B"
  amber: "#FFB25A"
  peach: "#FFCE9E"
  cream: "#FFF1E2"
  blush: "#FF8A4C"
  terminal-green: "#4AF626"
  edge: "#1B1916"
  line: "#F3EEE71C"
  line-2: "#F3EEE70F"
  line-ember: "#FF783C33"
typography:
  display:
    fontFamily: "Saira, Arial Narrow, system-ui, sans-serif"
    fontSize: "clamp(4.5rem, 15vw, 13rem)"
    fontWeight: 700
    lineHeight: 0.82
    letterSpacing: "-0.045em"
  headline:
    fontFamily: "Saira, Arial Narrow, system-ui, sans-serif"
    fontSize: "clamp(2rem, 5.4vw, 4.6rem)"
    fontWeight: 700
    lineHeight: 0.9
    letterSpacing: "-0.035em"
  stat:
    fontFamily: "Saira, Arial Narrow, system-ui, sans-serif"
    fontSize: "clamp(2.6rem, 5vw, 4rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.04em"
  subhead:
    fontFamily: "Space Grotesk, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(1.1rem, 2.3vw, 1.7rem)"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Space Grotesk, system-ui, -apple-system, sans-serif"
    fontSize: "1.2rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "normal"
  body:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "normal"
  body-human:
    fontFamily: "Space Grotesk, system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.18em"
  control:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.12em"
  serif-word:
    fontFamily: "Playfair Display, Georgia, serif"
    fontSize: "1em"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0"
rounded:
  none: "0"
  control: "5px"
  lit: "9px"
  pill: "999px"
spacing:
  sp-4: "4px"
  sp-6: "6px"
  sp-8: "8px"
  sp-10: "10px"
  sp-12: "12px"
  sp-14: "14px"
  sp-16: "16px"
  sp-20: "20px"
  sp-22: "22px"
  sp-26: "26px"
  sp-30: "30px"
  sp-34: "34px"
  sp-40: "40px"
  sp-48: "48px"
  sp-64: "64px"
  sp-88: "88px"
  pad: "clamp(20px, 5vw, 88px)"
  content-max: "1180px"
components:
  button-primary:
    backgroundColor: "{colors.hazard-orange}"
    textColor: "{colors.substrate}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 22px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.hazard-bright}"
    textColor: "{colors.substrate}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.phosphor}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 22px"
    height: "44px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.phosphor-dim}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    height: "44px"
  button-sm:
    padding: "0 16px"
    height: "34px"
  input:
    backgroundColor: "{colors.substrate-well}"
    textColor: "{colors.phosphor}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  chip-amber:
    backgroundColor: "#FFB25A1F"
    textColor: "{colors.amber}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "28px"
  chip-peach:
    backgroundColor: "#FFCE9E1A"
    textColor: "{colors.peach}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "28px"
  cell:
    backgroundColor: "{colors.substrate}"
    textColor: "{colors.phosphor-dim}"
    rounded: "{rounded.none}"
    padding: "26px"
  cell-warm:
    textColor: "{colors.peach}"
    rounded: "{rounded.none}"
    padding: "26px"
  hud:
    backgroundColor: "{colors.substrate-panel}"
    textColor: "{colors.phosphor}"
    rounded: "{rounded.lit}"
    padding: "16px"
  terminal:
    backgroundColor: "{colors.substrate-well}"
    textColor: "{colors.phosphor-dim}"
    typography: "{typography.body}"
    rounded: "{rounded.lit}"
    padding: "20px"
  nav:
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    height: "64px"
  statusbar:
    backgroundColor: "{colors.substrate-deep}"
    textColor: "{colors.muted}"
    rounded: "{rounded.none}"
    height: "30px"
---

# Design System: Sharedock

## 1. Overview

This system has no single metaphor, and doesn't want one. It runs on a ratio instead: **roughly 85% machine, 15% ember.** The machine is the skeleton, square, monospace, ruled in 1px hairlines on a near-black substrate, reporting capacity and health and transfer like equipment that has no opinion about how you feel. The ember is the 15% of warmth threaded through it: a small radius on the things you touch, a glow under the one lit object, pastel pill tokens, and warm accent text where a person genuinely needs reassurance rather than data.

The ratio is the whole design. Get it wrong in either direction and the product argues against itself. Push past 15% ember and it becomes the friendly consumer cloud whose entire purpose is to stop you from seeing where your bytes are. Drop the ember entirely and it becomes the grey NAS admin panel that is powerful, honest, and unusable. The reader here is a self-hoster who reads telemetry as information, not intimidation, so the machine layer is the default and never needs apology. The warmth is spent deliberately, at the small number of moments where a human is deciding whether to trust this thing with everything they own.

Structure never rounds. The grids, crosshairs, chrome bars, cells and footer are radius 0, permanently. Warmth is not a shape, it is a temperature: if a surface feels cold, warm it with a tint or the small ember radius, never with a large soft sweep. There is exactly one accent hue in the entire system, hazard orange, and every "soft color" in it is a tint of that same hue. A second hue is a bug.

**Key Characteristics:**
- One accent hue only (hazard orange `#FF5A1F`); all warmth is a tint of it
- Near-black substrate `#0A0A0A`, never pure `#000`
- Square skeleton (radius 0); ember radius only on controls (5px) and lit objects (9px)
- Four type families, four jobs, never a fifth
- 1px hairline grids with `+` crosshairs at cell corners
- Flat at rest; shadows are ember-tinted, never neutral black
- Film grain and faint scanlines as atmosphere, no photography, no illustration
- All structural type is UPPERCASE mono; warm accent type is sentence case

## 2. Colors

One hazard-orange accent burning on a near-black substrate, with every soft tone a tint of that same orange rather than a new hue.

### Primary

- **Hazard Orange** (`#FF5A1F`): The only accent in the system. Links, selection, focus rings, active states, crosshairs that have heated up, and the single bright button on a view. Its authority comes from scarcity.
- **Hazard Bright** (`#FF7E33`): Hover and emphasis only. The primary button brightens to this; nothing rests here.
- **Ember Deep** (`#C7370B`): The dark end of orange gradients, used inside data viz fills (the equalizer bars) and never as a flat surface color.

### Secondary

The soft human layer. These are tints of the same orange hue, used exclusively where the ember dial runs highest: the reassurance moments and the warm cells.

- **Amber** (`#FFB25A`): Soft-layer chips and kickers. The crosshair color when a warm cell is hovered.
- **Peach** (`#FFCE9E`): Body copy inside the human layer. This is the color of a calm sentence.
- **Cream** (`#FFF1E2`): Warm cell headings and highlights. The brightest warmth available.
- **Blush** (`#FF8A4C`): Soft-layer accent and kicker labels; the hue behind warm tint gradients.

### Tertiary

- **Terminal Green** (`#4AF626`): The only green that exists. It is spent on the OK/success line inside a terminal readout and nowhere else, ever. This is not a semantic success color for the system; it is a CRT artifact with one address.

### Neutral

- **Substrate** (`#0A0A0A`): The page. Near-black, deliberately not `#000`.
- **Substrate Panel** (`#0E0D0C`): Raised panels and hovered cells.
- **Substrate Well** (`#070605`): Inset wells, HUD interiors, terminal body, input fields.
- **Substrate Deep** (`#050403`): The status bar, footer, and deep insets.
- **Phosphor** (`#F3EEE7`): Primary text and headlines. A warm near-white, the glow of a monitor rather than paper.
- **Phosphor Dim** (`#B6AFA5`): Body copy and secondary text.
- **Muted** (`#7C766C`): Labels, metadata, telemetry. Contrast-restricted, see the rule below.
- **Faint** (`#4A453E`): Crosshair marks, disabled states, input placeholders.
- **Line** (`#F3EEE71C`): Primary hairlines and grid gaps. **Line 2** (`#F3EEE70F`) for faint internal dividers and blueprint grids. **Line Ember** (`#FF783C33`) for the warm hairline on hover.
- **Edge** (`#1B1916`): The giant watermark wordmark, and only that.

### Named Rules

**The One Hue Rule.** There is exactly one accent hue. Amber, peach, cream and blush are not four more colors, they are four tints of the orange. If you are reaching for a blue for "info" or a red for "danger", stop: tone is carried by glyph and ground, not by a new hue. The one exception is Terminal Green, which has a single address inside the terminal.

**The Muted Floor Rule.** `--muted` is forbidden for body copy at any size. Body text uses Phosphor Dim (`#B6AFA5`, 9.11:1) or brighter. The moment muted carries a sentence, the reader is squinting at the thing they paid for.

Muted is now `#80796F`, which clears 4.5:1 against all four substrate tones (4.60 on the page, 4.51 on the panel, 4.71 on the well, 4.76 on the deep). It was `#7C766C` at **4.40:1**, under the AA floor: the design system's stated allowance ("fine for ≥11px uppercase metadata") never held, because 11px uppercase is not "large text" under WCAG (that needs ≥18px, or ≥14px bold). The correction is imperceptible and it is the floor now. Nothing dimmer than muted may carry text.

**The Faint Is Not Text Rule.** `--faint` (`#4A453E`) is **2.09:1** on the substrate. It cannot legibly carry text at any size, so it is for non-text marks only: crosshairs, disabled states, dividers. Placeholders are text and take `--muted`. **Known gap:** roughly 25 places still set `--faint` on real (8.5–9.5px) metadata text, inherited from the prototype. Each is an AA failure. Fixing them means the system loses its third text tier, since AA only has room for two below Phosphor — that is a live design decision, not an oversight.

**The Ember Budget Rule.** Warmth is roughly 15% of any view. It buys reassurance, not decoration.

## 3. Typography

**Display Font:** Saira (variable 100–900, self-hosted; with Arial Narrow, system-ui fallback)
**Body Font:** JetBrains Mono (with ui-monospace, SF Mono, Menlo)
**Accent Font:** Space Grotesk (with system-ui, -apple-system)
**Ornament Font:** Playfair Display italic (with Georgia)

> **Display face: Saira, swapped from Archivo Black.** The display face is now Saira, self-hosted. Because Saira is a variable family whose default instance is Thin — unlike Archivo Black, which shipped as a single black weight — every display rule must state a weight explicitly or it renders hairline; the display face is pinned at **700** (`--display-weight`), the weight recorded for `display` / `headline` / `stat` above. The fallback is Arial Narrow (a condensed grotesque) rather than the general sans, so the architectural scale roughly holds before the webfont loads.

**Character:** Four families, four jobs, never a fifth. The pairing works on a hard contrast axis: an ultra-tight uppercase grotesque display against a monospace that carries every label and readout, with a humanist sans reserved for the moments the machine steps back and speaks plainly. The mono is not a style choice here, it is the product's native tongue: this interface reports device IDs, byte counts and transport paths, and those things are set in the typeface that measures.

### Hierarchy

- **Display** (Saira 700, `clamp(4.5rem, 15vw, 13rem)`, line-height 0.82, tracking -0.045em, UPPERCASE): The wordmark and the giant watermark only. This is a brand device at architectural scale, not a page heading. Do not reach for it to make an ordinary title louder.
- **Headline** (Saira 700, `clamp(2rem, 5.4vw, 4.6rem)`, line-height 0.9, tracking -0.035em, UPPERCASE, max 16ch): Section H2s. The 16ch cap is doing real work; respect it or the headline overflows on tablet.
- **Stat** (Saira 700, `clamp(2.6rem, 5vw, 4rem)`, line-height 1, tracking -0.04em): Big numeric readouts. The unit rides as a superscript mono `<em>` in hazard orange.
- **Subhead** (Space Grotesk 500, `clamp(1.1rem, 2.3vw, 1.7rem)`, line-height 1.4, tracking -0.01em, sentence case): The line under a headline. A `<b>` inside turns hazard orange at weight 600.
- **Title** (Space Grotesk 700, 1.2rem, line-height 1.25, sentence case): Cell headings. Turns hazard orange on cell hover.
- **Body** (JetBrains Mono 400, 13.5px, line-height 1.7, max 46ch): Machine body copy. The default for descriptive text.
- **Body Human** (Space Grotesk 400, 1rem, line-height 1.6, max 52ch, sentence case): The calm register. Set in Peach. Used only in the human layer and the final CTA.
- **Label** (JetBrains Mono 500, 11px, line-height 1.4, tracking 0.18em, UPPERCASE): Nav, labels, metadata, telemetry. The tight variant drops to 10.5px at 0.14em.
- **Control** (JetBrains Mono 500, 12px, line-height 1, tracking 0.12em, UPPERCASE): Button faces. Primary buttons run weight 700.

### Named Rules

**The Casing Rule.** Structural and machine type is UPPERCASE: nav, labels, H2 headlines, section IDs, telemetry, buttons. Warm accent type is sentence case: Space Grotesk cell headings, human body copy, the serif word. Sentence case is a warmth cue inside a machine section, not a mode switch. Mixing them arbitrarily destroys the 85/15 signal.

**The One Serif Word Rule.** Playfair Display italic appears exactly once per page, woven inline into an uppercase headline, halftone-dithered via a radial mask and set in Peach. Twice is a typo. The fourth family exists to be spent once.

**The Measure Rule.** Every prose class ships a max-width and it is not decorative: body 46ch, human body 52ch, cell description 34ch, headline 16ch. Long readouts wrap or truncate; they never widen the column.

## 4. Elevation

**Flat. Light is warmth, not depth.** The machine skeleton is a flat plane ruled by 1px hairlines, and it stays there. Depth, where it exists at all, is tonal: the four-step substrate ramp (page → panel → well → deep) does the layering, and a cell that is hovered gets *warmer*, not *higher*. Cells never lift and never translate. A shadow in this system is not a claim that something is raised above the page; it is a claim that something is **lit**, and only four things are lit: the one primary button, the HUD card, the featured pricing tier, and the terminal window.

Every shadow is ember-tinted. A neutral black shadow is a bug, not a preference: on a `#0A0A0A` substrate it does nothing visually and breaks the conceit that the only light source in the room is the orange one.

### Shadow Vocabulary

- **Primary button rest** (`box-shadow: 0 8px 26px -16px rgba(255,90,31,.85)`): The resting glow under the single bright button. This is the only element that glows at rest.
- **Primary button hover** (`box-shadow: 0 10px 32px -14px rgba(255,90,31,.9)`): Deeper, not higher.
- **Warm cell hover** (`box-shadow: inset 0 1.5px 0 -0.5px var(--line-ember)`): An **inset** ember hairline. Note the direction: the cell warms from inside its own edge; nothing is cast outward.
- **HUD lift** (`box-shadow: 0 30px 80px -50px rgba(255,90,31,.45)`): A wide, very soft ember bloom under the telemetry card.
- **Featured tier** (`box-shadow: inset 0 0 0 1px var(--o), 0 26px 64px -44px rgba(255,90,31,.55)`): An orange inset ring plus an ember bloom.
- **Input focus** (`box-shadow: 0 0 0 1px var(--o), 0 0 24px -8px rgba(255,90,31,.6)`): The field ignites.

### Named Rules

**The Warm-In-Place Rule.** Cell hover NEVER lifts, scales or translates. It warms where it stands: a top-tint on the background, an inset ember hairline, and the corner crosshairs heating from Faint to orange or amber. If a hover state moves a cell, it is wrong. The one motion allowance on press is `translateY(1px)`, downward, on buttons only.

**The Four Lit Objects Rule.** Only the primary button, the HUD, the featured tier and the terminal carry an outward glow. Adding a fifth glowing element dilutes all four.

## 5. Components

The whole component layer is **machined and exact**: fixed control heights, mono faces, a square skeleton, and every value snapped to the spacing scale. Nothing here is arbitrary, and nothing is soft for the sake of feeling friendly.

### Buttons

- **Shape:** The ember radius, small and deliberate (5px, `--r-1`). Height is fixed at 44px, or 34px for the small variant. Face is mono, 12px, uppercase, tracked 0.12em.
- **Primary:** Hazard Orange ground with `#0A0A0A` text at weight 700, plus the resting ember glow. **Exactly one primary button per view.** Hover brightens the ground to Hazard Bright and deepens the glow.
- **Secondary (default):** Transparent ground, 1px Line border, Phosphor text. Hover moves the border to full Phosphor. This is the workhorse; reach for it first.
- **Ghost:** Transparent, no border, Phosphor Dim text brightening to Phosphor. For tertiary actions only.
- **Focus:** 2px Hazard Orange outline at 2px offset, on every button, no exceptions. See The Focus Floor Rule below for how it is written, which is not negotiable.
- **Press:** `translateY(1px)`. The arrow glyph inside a button slides 4px right on hover.
- **Disabled:** 40% opacity, `pointer-events: none`.

### Chips

- **Style:** The one genuinely rounded token in the system (999px), 28px tall, mono 10.5px uppercase tracked 0.14em. Ground is a ~10-12% tint of its own tone with a matching inset 1px ring; there is no border property, the ring is a shadow.
- **Tones:** Amber, Peach, Cream. All three are tints of the single orange hue.
- **Detail:** The optional leading `i` dot is 5px and **square-cornered** (`border-radius: 0`) inside the round pill. That contradiction is deliberate: the machine shows through the warm token.

### Cards / Containers

There are no cards in the conventional sense, and that is the point. Multi-cell zones are built with the **hairline grid**: `display: grid; gap: 1px; background: var(--line)` with solid substrate cells sitting in it, so the "borders" are the substrate showing through a 1px gap.

- **Corner Style:** Square (0). Permanently.
- **Background:** Substrate, moving to Substrate Panel on hover. Warm cells carry a `linear-gradient(180deg, rgba(255,138,76,.04), transparent 58%)` top-tint over the substrate.
- **Shadow Strategy:** None at rest. See Elevation and The Warm-In-Place Rule.
- **Internal Padding:** 26px. Capability cells run a 238px min-height; stat cells 170px.
- **Crosshairs:** `+` marks in Faint at the cell corners, 14px, heating to orange (or amber on warm cells) on hover.

### Inputs / Fields

- **Style:** Substrate Well ground, 1px Line border, ember radius (5px), 44px tall matching the button, mono 13.5px. The field is an inset well, darker than the page.
- **Focus:** The field ignites: border to Hazard Orange, plus a 1px orange ring and a soft 24px ember bloom. `outline: none` is set because the box-shadow *is* the ring; do not remove it without replacing it.
- **Placeholder:** Faint (`#4A453E`), measured at **2.13:1** on the well. Placeholders carry the same 4.5:1 requirement as any other text, so this is a genuine AA failure, not a stylistic choice, and Faint cannot reach AA by lightening alone. Never put required information in a placeholder here; the visible uppercase label above the field is what the user is meant to read.

### Navigation

- **Status bar:** 30px, sticky, Substrate Deep, mono 10.5px uppercase tracked 0.12em in Muted, divided into cells by Line 2 borders. Carries a 6px square blipping Hazard Orange dot.
- **Nav:** 64px, sticky beneath the status bar. This is the **only** element in the entire system permitted to use transparency and blur (`rgba(10,10,10,.72)` + `backdrop-filter: blur(10px)`), and it swaps to solid Substrate Panel under `prefers-reduced-transparency`.
- **Links:** Mono 11px uppercase tracked 0.18em in Muted, brightening to Phosphor. The underline is a 1px Hazard Orange rule that scales in from the left over 0.3s. The wordmark is Saira 700 17px with a mono orange superscript.
- **Mobile:** Links and sign-in hide below 640px.

### Telemetry (signature)

The distinctive layer, and the reason the system exists. There is no photography and no illustration in Sharedock; the "real visuals" are generated telemetry.

- **HUD card:** Substrate Panel, lit radius (9px), the wide ember bloom, a Line 2-divided head with a live indicator.
- **Equalizer:** Signal bars filled with an `--o-bright → --o-ember` vertical gradient, bobbing on staggered delays. Gradients are legal *inside* data viz; they are never structure.
- **Terminal:** Substrate Well, lit radius (9px), mono 12.5px at 1.85 line-height, stronger scanlines over the body, a block cursor, and the one green success line. Under `prefers-reduced-motion` it renders fully typed rather than typing.
- **Blueprint minimap:** A 22px blueprint grid in Line 2 over Substrate Well, with orange pings expanding on a 2.6s cycle.
- **Callout:** An inline warm hairline notice, ember radius, with a leading tone glyph and one human sentence in Peach. Tone is carried by glyph color and ground warmth, never by a second hue. This is not an overlay; that is the modal dialog.

### Named Rules

**The Focus Floor Rule.** The focus ring is written as two rules, in this order, and never collapsed into one:

```css
:focus{outline:2px solid var(--focus-ring);outline-offset:2px}
:focus:not(:focus-visible){outline:none}
```

`:focus-visible` is Safari 15.4+, and this product's desktop GUI runs in the macOS WKWebView well below that. An unknown pseudo-class does not degrade, it **invalidates the whole rule** — so a `:focus-visible`-only ring does not exist at all on those engines, and the app ships with no keyboard focus indicator. `:focus` is the floor every engine honours; the second rule takes the ring back for pointer focus and is simply dropped where `:focus-visible` is unknown, leaving the ring on for mouse and keyboard alike. Noisier on an old webview is the correct way to be wrong.

Two ways to get this wrong, both verified to remove the ring entirely on those engines: **never** write `:focus, :focus-visible {…}` as a selector list (one unknown selector invalidates the entire list, taking `:focus` down with it), and **never** write `:not(:is(:focus-visible))` (`:is()` is forgiving, so it matches nothing, `:not()` then matches everything, and every focused element loses its ring).

A component may override the ring, but it must not set `outline: none` on its **base** rule: that suppresses the floor and leaves the element with no indicator once its `:focus-visible` rule drops. Put the `outline: none` inside the `:focus-visible` rule instead, so it disappears together with the custom ring it belongs to. Prefer an outline over a `box-shadow` ring: box-shadow collides with selection states that use the same property.

### Atmosphere

- **Film grain:** A fixed SVG feTurbulence overlay at 0.05 opacity, `mix-blend-mode: overlay`, last in `<body>`, `aria-hidden`.
- **Scanlines:** A faint global set at 0.35 opacity, and a stronger 0.5 version on the hero field and terminal body only.

## 6. Do's and Don'ts

### Do:

- **Do** keep the machine/ember ratio near 85/15. Machine is the default register; warmth is spent where a human is deciding whether to trust you.
- **Do** build every multi-cell zone with the hairline grid technique (`gap: 1px` over `--line`, solid substrate cells) and mark the corners with `+` crosshairs.
- **Do** keep the skeleton at radius 0 forever: grids, crosshairs, chrome bars, cells, footer. Warm a cold surface with a tint, never with a larger radius.
- **Do** tint every shadow ember (`rgba(255,90,31,.4–.85)`).
- **Do** ship exactly one primary button per view, and exactly one halftone serif word per page.
- **Do** hold WCAG AA. Body copy at Phosphor Dim (9.11:1) or brighter, and treat `--muted` (4.40:1) as the known gap it is rather than reaching for it in new work.
- **Do** give every animation a `prefers-reduced-motion` alternative. The terminal renders fully typed; reveals render instantly.
- **Do** label invented metrics as sample data (`SAMPLE FEED`), and report the transport honestly, including when the honest answer is `RELAY`.
- **Do** snap every value to the spacing scale (4, 6, 8, 10, 12, 14, 16, 20, 22, 26, 30, 34, 40, 48, 64, 88).

### Don't:

- **Don't** introduce a second hue. Amber, peach, cream and blush are tints of the one orange. If you are adding a blue for "info" or a red for "error", you have broken the system. Terminal Green has one address and it is inside the terminal.
- **Don't** drift toward **consumer cloud (Dropbox, Google Drive)**: rounded blue friendliness, illustrated empty states, and cheerful copy that hides what is happening to the user's bytes. Sharedock's proposition is that you can see the machine. An empty state here shows the machine idle, not a smiling folder.
- **Don't** drift toward **crypto / web3**: neon glassmorphism and "trustless" swagger. This is a live risk for a product that leads with encryption and peer-to-peer. State the cryptography plainly; never perform it. Blur is confined to two jobs, the sticky nav/toolbar and the modal scrim, and both ship a `prefers-reduced-transparency` fallback. A blur anywhere else is decoration and is banned.
- **Don't** lift, scale or translate a cell on hover. Warm it in place.
- **Don't** use a neutral black shadow. On `#0A0A0A` it is invisible and it breaks the single-light-source conceit.
- **Don't** put an eyebrow above every section. The `.eyebrow` component is capped at one per three sections, and the `[ 01 ]` cell index is for genuine sequences only. Numbered markers over every section are AI scaffolding, not voice.
- **Don't** use `background-clip: text` gradient text. It does not exist in this system and it is never the answer.
- **Don't** add a colored side-stripe as *decoration* on a card, callout or alert. The system does use a 2-3px inset left stripe (`box-shadow: inset 3px 0 0 var(--o)`) to mark the **selected or active row** in a list: the file row, the sidebar item, the host row. That is a functional state marker on a list item and it stays. The ban is on the decorative accent stripe, not the selection affordance; if the stripe isn't reporting state, it's decoration and it goes.
- **Don't** build identical card grids of icon + heading + text, or the hero-metric template (big number, small label, gradient accent). The stat cell and HUD are specified precisely so you don't reach for the SaaS default.
- **Don't** use gradients as structure. No gradient buttons, no gradient panels. Gradients are legal only as warmth: faint cell top-tints, data viz fills, the halftone serif.
- **Don't** use em-dashes in visible copy (use `·`, `,`, `:` or a period) and never use emoji.
- **Don't** add a fifth type family, a fifth lit object, or a second marquee on a page.
- **Don't** let a headline overflow. The 16ch cap on H2 and the display clamp are load-bearing; test the real copy at every breakpoint.
