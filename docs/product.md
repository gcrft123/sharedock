# Product

## Register

product

## Platform

web

## Users

Technical prosumers and self-hosters. People who already run their own services, own a NAS or a homelab, and have a drawer of old phones, laptops and drives they know still have life in them. They read telemetry as information rather than intimidation: a device ID, a transfer rate, a transport readout are all things they want to see, not things to be protected from.

They are not the audience the design system's readme originally imagined ("softened for everyday users"). That line describes the tone, not the reader. The reader here is technical, and the interface should never explain away a mechanism they already understand.

## Product Purpose

Sharedock turns the old devices in your drawer into one private cloud. A customer runs a small host agent on hardware they own, allocates a quota-limited slice of its disk, and reaches those files from anywhere: through the browser console, the desktop app, or the drive mounted natively in Finder. A thin, zero-knowledge control plane handles accounts, device pairing and an encrypted relay fallback; the bytes live on the customer's own hardware and only ever transit the relay encrypted. Sold once, not rented.

Success is the switch completing: enough trust and enough capacity that the user cancels Dropbox for real. That is the bar. Not activation, not engagement, not sessions.

**The product name is Sharedock.** "Personal Cloud" is the repo and working name only, and should not reach users.

Note on surfaces: this file carries the product register for the app console. The marketing site in `apps/site` is a brand surface and follows the same principles with a sparser type scale.

## Positioning

**Old devices become one drive.** The dead phone, the retired ThinkPad and the shelf drive stop being e-waste and start being a single pooled, private cloud. That is the claim nothing else makes, and every screen should reinforce it.

Close behind, and the reason the first claim is affordable: **buy once, not forever.** A one-time purchase, not a subscription that bills until you die. Where the two compete for the same space, the pool wins and the price supports it.

## Brand Personality

**Industrial, honest, unhurried.** Heavy equipment that tells the truth and never rushes you.

The voice runs the design system's ~85% machine / 15% ember split, and that split is correct as specified. Machine register is the default: terse, technical, telemetric, uppercase for structural type, short declaratives, real device IDs and capacity readouts. Ember is the 15% reserved for the moments where a human needs reassurance rather than data, in calm sentence case.

Two standing copy rules, both from the design system and both load-bearing: no em-dashes in visible copy (use `·`, `,`, `:` or a period), and no emoji, ever. Invented metrics are labeled as sample data. No AI-cute wordplay: a line that sounds clever but wrong gets replaced with a plain sentence.

## Anti-references

**Consumer cloud (Dropbox, Google Drive).** Rounded blue friendliness, illustrated empty states, and cheerful copy that hides what is actually happening to your bytes. Sharedock's whole proposition is that you can see the machine; adopting the aesthetic that exists to obscure it would argue against the product.

**Crypto / web3.** Neon glassmorphism and "trustless" swagger. A live risk for anything that leads with encryption and peer-to-peer. Sharedock states its cryptography plainly and never performs it.

## Design Principles

**Show the machine, don't hide it.** The competition's core move is abstracting storage into a friendly blue folder. Ours is the opposite: the pool, the hosts, the transport path and the transfer are all legible on purpose. When a choice is between reassuring and truthful, pick truthful and make the truth well-designed.

**The pool is the protagonist.** Every screen should make it clearer that separate old devices have become one drive. A screen that shows storage without showing where it lives has skipped the thing being sold.

**State the cryptography, never perform it.** Zero-knowledge and E2EE are facts stated once, plainly, where they matter. They are not a badge, a shield icon, or a tone.

**Admit the gap.** The codebase already does this well: sample data is labeled, the web build honestly reports `RELAY` instead of claiming direct P2P, and `docs/not-yet-built.md` tracks what the console shows but doesn't fully back. Keep that standard. An honest limitation beats a confident fiction, and this audience will detect the fiction.

**Nothing here is trying to keep you.** A one-time purchase means the product has no reason to farm attention. No streaks, no urgency, no engagement surfaces, no upsell. Success is the user forgetting the console exists because the drive is simply mounted. That is a feature, and it should shape what we refuse to build.

## Accessibility & Inclusion

WCAG AA is the floor, confirming what the design system already claims. Body text at 4.5:1 or better against its background; the `--muted` token is restricted to 11px-and-up uppercase metadata, which is where it passes. Full `prefers-reduced-motion` support is required rather than optional: every animation needs an instant or crossfade alternative, and the terminal renders fully typed. Visible 2px focus rings on every interactive element. `prefers-reduced-transparency` swaps the nav's blur for a solid panel.
