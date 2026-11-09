# Sharedock site · content map

Every visible string lives in [`src/content.ts`](src/content.ts). This document says what
each slot was designed to argue, so the placeholder can be replaced without redesigning
the layout around it.

Read the **budget** column as a hard constraint, not a suggestion. The layouts were
tested at those lengths; materially longer copy will re-wrap headings, unbalance the
ledger, or push the hero's button below the fold.

## Legend

| Tag | Meaning |
|---|---|
| **real** | True today, verified against the codebase. Ships as-is. |
| **lorem** | Lorem Ipsum. Replace. |
| **fwd** | Forward-looking. True once in-flight work ships. Confirm before launch. |
| **TBD** | Awaiting a product decision (all pricing). |

## Copy rules, all load-bearing

- **No em-dashes in visible copy.** Use `·`, `,`, `:` or a full stop.
- **No emoji.** Ever.
- **Two registers.** Machine (~85%): terse, technical, UPPERCASE for structural type.
  Ember (~15%): calm, plain, sentence case, and only in the close and the privacy
  caveat. Sentence case inside a machine section is a warmth cue, not a mode switch.
- **CTA labels are three words or fewer**, and the whole page carries one CTA intent.
- **No invented metrics.** If a number appears, it must be real or visibly a placeholder.

---

## 00 · Chrome

| Slot | Tag | Argument | Budget |
|---|---|---|---|
| `STATUS[0..2]` | real | Three true facts, establishing the pitch before the headline is read: it is encrypted, it is bought once, it is not a subscription. Everything here must stay literally true, because a status bar that invents a readout has turned the page into a mockup. | ≤ 24 chars each; 3 items, last two hide under 860px |
| `NAV.links` | real | Structural. Match the fold order. | ≤ 14 chars each, 3 max |
| `NAV.cta` | real | Secondary here on purpose. The hero owns the primary; the two are never co-visible. | ≤ 8 chars |

## 01 · Hero

| Slot | Tag | Argument | Budget |
|---|---|---|---|
| `HERO.headline` | **real, final** | The product thesis in one line. Do not touch: the type scale is tuned to this exact string. | fixed |
| `HERO.lead` | lorem | One sentence naming the mechanism and the payoff. Answers "how" and "so what" for someone who read the headline and is deciding whether to keep scrolling. Should mention that the hardware is theirs and already owned. | 110–150 chars, 2 lines |
| `HERO.ctaPrimary` | real | The page's one primary action. | ≤ 3 words |
| `HERO.ctaSecondary` | real | Escape hatch for the not-yet-convinced, pointing at the assembly. | ≤ 3 words |

## 02 · The assembly

The set-piece. Five scroll beats: three devices, then the dispersal into the mark's
cloud, then the convergence onto its cube. The section argues the thesis rather than
illustrating it, so the copy should track the transformation, not narrate the animation.

**Never describe the animation in the copy.** No "watch as", no "see how".

| Slot | Tag | Argument | Budget |
|---|---|---|---|
| `ASSEMBLY.heading` | lorem | The section's claim: separate old machines become one drive. | ≤ 13ch per line, 3–4 lines |
| `STAGES[n].tag` | real | Device name. Keep literal. | ≤ 10 chars |
| `STAGES[n].spec` | real / fwd | The qualifying detail: what kind of machine, which platforms. This is the proof that the junk in someone's drawer is eligible, so it must stay factual. | ≤ 34 chars |
| `STAGES[n].title` | lorem | One short claim per device. | 18–26 chars, 1 line |
| `STAGES[n].line` | lorem | One sentence. Stages 1–3: what this class of machine contributes. Stage 4 (`cloud`): the machines stop being separate, written for the moment they are mid-dissolve. Stage 5 (`dock`): it is now one drive you reach from anywhere. | 95–120 chars, 2–3 lines |

Per-stage intent, in order:

1. **laptop** · the lowest bar to entry. A retired notebook already qualifies.
2. **tower** · capacity. The machine under the desk has real disk in it.
3. **server** · the always-on case, for people who already run one.
4. **cloud** · the turn. Separate machines become pooled capacity.
5. **dock** · the payoff, and the logo. One drive.

Stages 4 and 5 are one continuous move, not two: the devices dissolve and reassemble
directly as the mark. Don't write stage 4 as though something arrives in between.

## 03 · The ways in

Lead and support, not four equal rows. **Mounted drive** carries the fold at display
scale and takes the ember; browser, desktop and phone sit under it small and dense.

| Slot | Tag | Argument | Budget |
|---|---|---|---|
| `SURFACES.heading` | lorem | Now a small tracked label, not a headline: the lead name is what the eye lands on. Keep it short. | ≤ 34 chars, one line |
| `lead.name` | real | The surface. Set in the display face, so length is load-bearing. | ≤ 15 chars |
| `lead.line` | lorem | **The fold's best sentence.** The drive appears in Finder or Explorer as a real disk, so nothing has to change about how you work. This is the claim that makes a self-hoster lean in; give it your strongest writing. | 90–110 chars |
| `lead.meta` | fwd | Platform support. Factual. | ≤ 30 chars |
| `rest[n].name` | real | The surface. Keep literal. | ≤ 16 chars |
| `rest[n].line` | lorem | One sentence on what this surface is for and when you would reach for it. | 70–90 chars, 2 lines |
| `rest[n].meta` | real / fwd | Platform support. Factual. | ≤ 30 chars |

Exactly three entries in `rest`. The grid is a fixed three columns above 860px.

## 04 · Privacy

One enormous claim over a dense strip of mechanisms. The scale gap is the argument: the
promise is human-sized, the proof is machine-sized. State the cryptography once, at full
volume, and move on. **No shield icons, no padlocks, no green ticks.** Performing
security is what pushes a product into the crypto/web3 register the brand rejects.

| Slot | Tag | Argument | Budget |
|---|---|---|---|
| `PRIVACY.heading` | lorem | Nobody can read your files, including us. Set at display scale: this is the loudest thing in the fold. | ≤ 15ch per line, 2 lines |
| `PRIVACY.lead` | lorem | Why that is structural rather than a promise: the keys never leave the customer. | 120–150 chars |
| `specs[n].claim` | lorem | A plain-language note under the mechanism. Four cells, so keep them even in length. | 32–40 chars, 1–2 lines |
| `specs[n].mech` | real | The mechanism, in machine register. These are verified and must not drift. | ≤ 30 chars |
| `PRIVACY.caveat` | lorem, **ember** | The honest limitation. Zero-knowledge means nobody can recover your data if you lose your password and every device. Say it here rather than burying it: this audience trusts a product more for admitting it, and it is a stated product principle. | 90–120 chars |

## 05 · Cost

The conversion fold. A subscription's cumulative cost climbs as a column per year; the
Sharedock price is one flat rule crossing them. Each bar is split where it crosses the
purchase price, so the tinted part is exactly the money that bought nothing.

| Slot | Tag | Argument | Budget |
|---|---|---|---|
| `COST.heading` | lorem | You are renting storage you could own. | ≤ 16ch per line |
| `COST.lead` | lorem | Set up the comparison in one sentence. | 90–110 chars |
| `COST.rent.perYear` | TBD | Competitor annual price used for the comparison. Pick a real, citable plan and footnote it. | number |
| `COST.own.once` | TBD | Must match the featured tier's price. | number |
| `COST.years` | — | 6 reads well. Below 4 the argument weakens; above 8 the columns get thin. | 4–8 |
| `COST.footnote` | lorem | Cite the competitor plan the comparison uses. Legally and reputationally worth getting exactly right. | ≤ 110 chars |

The chart adapts to whatever numbers you set, including the crossover year, which is
computed rather than written.

## 06 · Pricing

Three tiers in a hairline grid. The ladder is **seats**: a tier is how many devices join
the pool. One tier is featured and owns the page's only primary button below the hero.

| Slot | Tag | Budget |
|---|---|---|
| `TIERS.heading` | lorem | ≤ 16ch per line |
| `items[n].name` | TBD | ≤ 12 chars |
| `items[n].price` | TBD | 3–4 digits; `$` is set separately |
| `items[n].seats` | TBD | ≤ 14 chars |
| `items[n].features` | lorem | 3–4 items, ≤ 26 chars each |
| `TIERS.note` | lorem | ≤ 90 chars |

`featured: true` moves the orange ring, the ember bloom and the primary button. Exactly
one tier may carry it.

## 07 · Close

The only centred fold, and the highest the ember dial runs.

| Slot | Tag | Argument | Budget |
|---|---|---|---|
| `CLOSE.line` | lorem, **ember** | One calm sentence in plain language, now set at display scale as the second-loudest line on the page. Someone here is deciding whether to trust this with everything they own, so the machine steps back. Sentence case, no jargon, no telemetry. **Keep it short: it is a statement, not a paragraph.** | 55–75 chars, 3 lines |
| `CLOSE.cta` | real | Same label as the hero. One CTA intent. | ≤ 3 words |

## 08 · Footer

One compact ruled band, then the ember horizon. The wordmark rises from the bottom edge
as a silhouette against a hazard-orange glow, so nothing may be placed below the band:
the lower half of the fold belongs to the mark.

| Slot | Tag | Argument | Budget |
|---|---|---|---|
| `FOOTER.links` | real | A single inline run, not columns. Order them by how often someone would actually want them. | 8–10 items, ≤ 18 chars each |
| `FOOTER.legal` | real | Sits at the right end of the band. | ≤ 20 chars |
| `FOOTER.tagline` | real | The last line of copy on the site, directly above the horizon. Keep it a statement of fact, not a slogan. | ≤ 46 chars, one line |

---

## Forward-looking claims, in one place

These are written as true because you asked for them to be. Each depends on work that
is not yet reachable from the shipped apps. Confirm before launch.

| Where | Claim |
|---|---|
| `STAGES.tower.spec` | Desktop hosts on macOS, Windows and Linux |
| `STAGES.cloud.*`, `STAGES.dock.*` | Multiple devices pool into one drive from the shipped console |
| `SURFACES.rows[1].meta` | Desktop app on macOS, Windows and Linux |
| `SURFACES.rows[2].*` | A phone client exists |
| `SURFACES.rows[3].meta` | Native mount on Finder, Explorer and Files |
| `TIERS.items[].seats` | Seat counts are enforced |

## Claims the site must not make

Verified against the codebase. These are precision problems rather than roadmap items,
so they do not become true by shipping something.

- **Not Argon2id.** The shipping client key derivation is scrypt, chosen so it runs on
  old WebKit, which is on-brand. Say "memory-hard key derivation", or say scrypt.
- **Filenames are not encrypted at rest.** File contents are ciphertext; the host keeps
  a plaintext index of names and sizes on the customer's own machine. "Your filenames
  are encrypted" is false.
- **No speed or throughput figure, anywhere.** The only measured numbers are relay-path
  browser transfers. Direct peer-to-peer throughput has never been measured.
- **Do not claim the installer is notarised.** It is signed, not notarised.
- **Do not claim "fully tested end to end".** The storage and transport layer is well
  covered by tests; the account, billing and pairing layer currently is not.
- **Do not invent telemetry.** No fake transfer rates, device counts or uptime figures,
  including in the status bar. If a metric is illustrative, label it.
