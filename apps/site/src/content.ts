/* Every visible string on the site lives here, so CONTENT-MAP.md can document slots
   one-to-one and filling in real copy never means hunting through components.
 *
 * Two registers, per the design system:
 *   machine (~85%) · terse, technical, UPPERCASE, mono. Labels, data, nav, buttons.
 *   ember   (~15%) · calm, plain, sentence case. The close, and nothing else.
 *
 * Standing copy rules: no em-dashes in visible copy (use `·`, `,`, `:` or a period),
 * no emoji, CTA labels three words or fewer, one CTA intent across the whole page.
 *
 * PLACEHOLDER POLICY
 *   `lorem`  · Lorem Ipsum, sized to the length real copy should run. Replace these.
 *   `real`   · true today, verified against the codebase. Safe to ship.
 *   `fwd`    · forward-looking. True once in-flight work ships. Confirm before launch.
 *   `TBD`    · deliberate placeholder awaiting a product decision (pricing).
 * See CONTENT-MAP.md for the argument each slot was designed around.
 */

export const NAV = {
  // real · structural labels
  links: [
    { label: "How it works", href: "#assembly" },
    { label: "Privacy", href: "#privacy" },
    { label: "Pricing", href: "#pricing" },
  ],
  cta: "Buy", // real
};

export const STATUS = [
  // real · each verified. No invented telemetry: a marketing page that fakes a
  // readout is a mockup, which is the one thing this surface must not be.
  "Encrypted on your device",
  "One time license",
  "No subscription",
];

export const HERO = {
  // real · the only body copy on the site that is final
  headline: "Turn old devices into your own personal cloud storage.",
  // lorem · one sentence. Names the mechanism and the payoff.
  lead: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua veniam.",
  ctaPrimary: "Buy Sharedock", // real
  ctaSecondary: "How it works", // real
};

/* The assembly · one entry per scroll stage. `tag` and `spec` stay real because a
   Lorem'd data readout reads as broken rather than as placeholder. */
export const STAGES = [
  {
    id: "laptop",
    tag: "Laptop", // real
    spec: "Retired notebook · 2012 or newer", // fwd
    title: "Lorem ipsum dolor", // lorem
    line: "Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore.", // lorem
  },
  {
    id: "tower",
    tag: "Tower", // real
    spec: "Desktop · macOS, Windows, Linux", // fwd
    title: "Consectetur adipiscing", // lorem
    line: "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo.", // lorem
  },
  {
    id: "server",
    tag: "Server", // real
    spec: "Home server · headless agent", // real
    title: "Sed do eiusmod tempor", // lorem
    line: "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.", // lorem
  },
  {
    id: "cloud",
    tag: "Pooled", // fwd
    spec: "Capacity adds up", // fwd
    title: "Excepteur sint occaecat", // lorem
    line: "Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est.", // lorem
  },
  {
    id: "dock",
    tag: "Sharedock", // real
    spec: "One drive", // fwd
    title: "Lorem ipsum dolor sit", // lorem
    line: "Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit sed quia consequuntur.", // lorem
  },
];

export const ASSEMBLY = {
  heading: "Lorem ipsum dolor sit amet consectetur", // lorem · <= 16ch per line
};

/* Fold 03 · the ways in.
 *
 * The mounted drive leads. It is the surprising claim, the one that makes a self-hoster
 * lean in, so it gets the scale and the ember and the first read; the other three are
 * set small underneath it as support. A ledger of four equal rows buried the best thing
 * this fold has to say in fourth position. */
export const SURFACES = {
  heading: "Sed ut perspiciatis unde omnis", // lorem
  lead: {
    name: "Mounted drive", // real
    line: "Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim.", // lorem
    meta: "Finder · Explorer · Files", // fwd
  },
  rest: [
    {
      name: "Browser", // real
      line: "Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod tempor.", // lorem
      meta: "Any modern browser", // real
    },
    {
      name: "Desktop app", // real
      line: "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi aliquip.", // lorem
      meta: "macOS · Windows · Linux", // fwd
    },
    {
      name: "Phone", // real
      line: "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.", // lorem
      meta: "iOS · Android", // fwd
    },
  ],
};

/* Fold 04 · the cryptography, stated once and plainly. Mechanisms are real; the
   claims they sit under are Lorem. State it, never perform it: no shield icons. */
export const PRIVACY = {
  heading: "At vero eos et accusamus", // lorem
  lead: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.", // lorem
  specs: [
    { claim: "Lorem ipsum dolor sit amet consectetur", mech: "XChaCha20-Poly1305" }, // lorem : real
    { claim: "Adipiscing elit sed do eiusmod tempor", mech: "Encrypted before it leaves you" }, // lorem : real
    { claim: "Incididunt ut labore et dolore magna", mech: "Keys never reach our servers" }, // lorem : real
    { claim: "Ut enim ad minim veniam quis nostrud", mech: "Relay forwards, cannot read" }, // lorem : real
  ],
  // ember · the honest limitation, stated rather than buried. This audience trusts a
  // product more for admitting it, and the product's own principles require it.
  caveat:
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.", // lorem
};

/* Fold 05 · the money argument, drawn as a line over time. */
export const COST = {
  heading: "Nemo enim ipsam voluptatem", // lorem
  lead: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.", // lorem
  years: 6,
  rent: { label: "Subscription", perYear: 144 }, // TBD · illustrative only
  own: { label: "Sharedock", once: 149 }, // TBD · illustrative only
  footnote: "Lorem ipsum dolor sit amet consectetur adipiscing elit.", // lorem
};

/* Fold 06 · three tiers. Names, prices and features are all awaiting a decision.
   Seat counts carry the ladder: a tier is how many devices join the pool. */
export const TIERS = {
  heading: "Quis autem vel eum iure", // lorem
  items: [
    {
      name: "Tier One", // TBD
      price: "000", // TBD
      seats: "1 device", // TBD
      features: ["Lorem ipsum dolor sit", "Consectetur adipiscing", "Sed do eiusmod tempor"], // lorem
    },
    {
      name: "Tier Two", // TBD
      price: "000", // TBD
      seats: "3 devices", // TBD
      features: ["Lorem ipsum dolor sit", "Consectetur adipiscing", "Sed do eiusmod tempor", "Ut enim ad minim"], // lorem
      featured: true,
    },
    {
      name: "Tier Three", // TBD
      price: "000", // TBD
      seats: "6 devices", // TBD
      features: ["Lorem ipsum dolor sit", "Consectetur adipiscing", "Sed do eiusmod tempor", "Ut enim ad minim"], // lorem
    },
  ],
  note: "Lorem ipsum dolor sit amet consectetur adipiscing elit.", // lorem
};

/* Fold 07 · the close. The one centered fold, and the highest the ember dial runs.
   Sentence case, peach, calm. Someone here is deciding whether to trust this with
   everything they own. */
export const CLOSE = {
  // Set at display scale now, so this is the second-loudest line on the page after the
  // hero. Keep it short: it is a statement, not a paragraph.
  line: "Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do.", // lorem
  cta: "Buy Sharedock", // real
};

/* Fold 08 · footer.
 *
 * One compact ruled bar rather than a brand column beside three stacks of links. The
 * column layout is the default every site ships, and here it would also fight the
 * wordmark rising behind it for the same vertical space. Everything sits in a single
 * band at the top; below it the page belongs to the mark. */
export const FOOTER = {
  links: [
    "How it works",
    "Privacy",
    "Pricing",
    "Download",
    "Setup guide",
    "Supported devices",
    "Security",
    "Contact",
    "Terms",
  ], // real
  legal: "© Sharedock", // real
  tagline: "Your files live on hardware you own", // real
};
