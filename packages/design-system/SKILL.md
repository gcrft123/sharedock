---
name: sharedock-design
description: Use this skill to build Sharedock interfaces and assets in its industrial-brutalist telemetry design language (warmly lit), for production or throwaway prototypes/mocks/etc. Sharedock turns old devices into one private cloud; the telemetry motif renders docked devices, pooled storage, and health/transfer readouts. Contains design guidelines, colors, type, fonts, icons, and UI kit components.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this system.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

Sharedock is a product brand built on this reusable design language: the industrial-telemetry motif is the visual material, rendered as docked devices, capacity HUDs, pooled storage and activity logs. Example-screen metrics are sample data; the wordmark is `SHARE`+`DOCK` in Archivo Black (DOCK takes hazard orange). A consumer can drop a transparent-PNG mark into the brand slot in its place.

Core rule (verbatim): This is ONE machine, warmly lit — not two modes. Every section is square, monospace, uppercase, black-on-black with 1px hairlines, crosshairs, and one hazard orange. Ember is the minority warmth threaded through it (~15%): a small warm radius on controls and the lit telemetry objects, pastel 999px pill tokens, warm amber/peach/cream text, ember-tinted glows, and one inline halftone serif word. Warm the temperature, never the skeleton — the grids, crosshairs, chrome and cells stay square; no soft-font section, no mode-flip. One accent hue, one primary button per view, one marquee, one green (terminal only), one halftone word per page.

Key paths: `styles.css` (global entry), `tokens/`, `css/` (recipe classes), `components/` (React primitives + per-directory `.prompt.md` usage notes), `assets/icons/solar/` (Solar Linear icons), `guidelines/` (specimen cards), `ui_kits/marketing|docs|dashboard` (example screens).
