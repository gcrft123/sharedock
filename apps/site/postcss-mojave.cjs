// PostCSS transforms so the app renders on old macOS WebViews (Mojave/High Sierra,
// Safari < 14.1). The things that engine lacks or gets wrong:
//   - `clamp()`            -> UNSUPPORTED until Safari 13.1, so every declaration using it is
//                             DROPPED. In a `font:` shorthand that loses the display font +
//                             size; in `--pad`/`--sec-top`/`--sec-big` (substituted via
//                             `var()`) it makes padding invalid-at-computed-value → 0, so the
//                             content goes flush to the window edges. These are the two most
//                             visible breakages on Mojave.
//   - `inset` shorthand    -> ignored, so `position:fixed;inset:0` overlays collapse
//   - flexbox `gap`        -> ignored, so flex spacing disappears (grid gap is fine there)
//   - `place-items:center` on a tall grid -> the single track sits at the TOP (align-content
//     acts as `start`, not `stretch`), so "centered" modals render top-aligned
//   - `position:sticky`    -> needs the `-webkit-sticky` value through Safari 12; bare
//                             `sticky` is invalid there, so sticky bars fall back to static
//   - logical margins/pads (`margin-block`, `padding-inline`, …) -> shipped in Safari 12.1,
//     so on 12.0 `margin-block:auto` (onboarding card vertical-centering) is dropped and the
//     card pins to the top.
//
// `inset` and flex `gap` both shipped in Safari 14.1, so `@supports not (inset: 0)` matches
// EXACTLY the pre-14.1 engines; the gap/place-items fallbacks are emitted inside that query so
// modern browsers are untouched. The clamp / sticky / logical transforms need no `@supports`
// gate: each rewrites to something an OLD engine understands that is *also* valid and identical
// on a modern one (clamp≡max(min()), the extra `-webkit-sticky`/physical-longhand declarations
// are simply overridden by the modern one that follows).
const postcss = require("postcss");

/* ---- clamp(a, b, c) -> max(a, min(b, c)) ---------------------------------------------------
   Per spec `clamp(MIN, VAL, MAX)` is defined as `max(MIN, min(VAL, MAX))`, and `min()`/`max()`
   shipped in Safari 11.1 — a full OS release before `clamp()` (13.1). So this rewrite is a
   byte-for-byte-equivalent value that runs on Mojave/High Sierra and computes identically on
   every modern engine. Done in-place (not as a cascade fallback) because it must also fix
   custom properties: a `--x: clamp(...)` stores fine on old Safari but explodes at `var()`
   substitution time, and a preceding `--x: max(min())` line would just be overridden by the
   syntactically-valid clamp line — so the value itself has to be rewritten. */

/** Split a function's argument list on top-level commas (ignoring commas inside nested parens). */
function splitTopLevel(str) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of str) {
    if (ch === "(") { depth++; cur += ch; }
    else if (ch === ")") { depth--; cur += ch; }
    else if (ch === "," && depth === 0) { parts.push(cur); cur = ""; }
    else cur += ch;
  }
  parts.push(cur);
  return parts;
}

/** Replace every `clamp(a,b,c)` in a value string with `max(a, min(b, c))`, handling nested
 *  clamps (inside `calc()`, inside each other) and multiple clamps in one value. Only 3-arg
 *  clamps are rewritten; anything malformed is left untouched. */
function rewriteClamp(value) {
  const start = value.indexOf("clamp(");
  if (start === -1) return value;
  // Find the ')' that closes this clamp's '(' (at start + 5).
  let depth = 0;
  let end = -1;
  for (let p = start + 5; p < value.length; p++) {
    if (value[p] === "(") depth++;
    else if (value[p] === ")") { depth--; if (depth === 0) { end = p; break; } }
  }
  if (end === -1) return value; // unbalanced; leave as-is
  const args = splitTopLevel(value.slice(start + 6, end));
  let replacement;
  if (args.length === 3) {
    const a = rewriteClamp(args[0].trim());
    const b = rewriteClamp(args[1].trim());
    const c = rewriteClamp(args[2].trim());
    replacement = `max(${a}, min(${b}, ${c}))`;
  } else {
    replacement = value.slice(start, end + 1); // not a clamp we understand; keep it verbatim
  }
  // Recurse into the remainder so sibling clamp()s in the same value are handled too.
  return value.slice(0, start) + replacement + rewriteClamp(value.slice(end + 1));
}

const clampFallback = {
  postcssPlugin: "pc-clamp-fallback",
  Declaration(decl) {
    if (decl.value.indexOf("clamp(") === -1) return;
    const rewritten = rewriteClamp(decl.value);
    if (rewritten !== decl.value) decl.value = rewritten;
  },
};

/* ---- position:sticky -> prepend the -webkit-sticky value (Safari ≤ 12) --------------------- */
const webkitSticky = {
  postcssPlugin: "pc-webkit-sticky",
  Declaration: {
    position(decl) {
      if (decl.value.trim() !== "sticky") return;
      const prev = decl.prev();
      if (prev && prev.type === "decl" && prev.prop === "position" &&
          prev.value.trim() === "-webkit-sticky") return; // already emitted
      decl.cloneBefore({ value: "-webkit-sticky" });
    },
  },
};

/* ---- logical margin/padding shorthands -> physical longhands (Safari 12.0) ------------------
   Prepended, so the modern logical declaration that follows still wins on engines that honour
   it. In the app's LTR / horizontal-tb context the physical mapping is exact. */
const LOGICAL = {
  "margin-block": ["margin-top", "margin-bottom"],
  "margin-inline": ["margin-left", "margin-right"],
  "padding-block": ["padding-top", "padding-bottom"],
  "padding-inline": ["padding-left", "padding-right"],
};
const logicalFallback = {
  postcssPlugin: "pc-logical-fallback",
  Declaration(decl) {
    const sides = LOGICAL[decl.prop];
    if (!sides) return;
    const prev = decl.prev();
    if (prev && prev.type === "decl" && prev.prop === sides[1]) return; // already emitted
    const v = decl.value.trim().split(/\s+/);
    decl.cloneBefore({ prop: sides[0], value: v[0] });
    decl.cloneBefore({ prop: sides[1], value: v[1] || v[0] });
  },
};

/** Expand the `inset` shorthand to physical longhands (equivalent on every engine). */
const expandInset = {
  postcssPlugin: "pc-expand-inset",
  Declaration: {
    inset(decl) {
      const v = decl.value.trim().split(/\s+/);
      let t, r, b, l;
      if (v.length === 1) t = r = b = l = v[0];
      else if (v.length === 2) { t = b = v[0]; r = l = v[1]; }
      else if (v.length === 3) { t = v[0]; r = l = v[1]; b = v[2]; }
      else [t, r, b, l] = v;
      decl.cloneBefore({ prop: "top", value: t });
      decl.cloneBefore({ prop: "right", value: r });
      decl.cloneBefore({ prop: "bottom", value: b });
      decl.cloneBefore({ prop: "left", value: l });
      decl.remove();
    },
  },
};

/** Gate fallbacks to pre-14.1 engines only. Collected per-file, emitted in one @supports. */
const oldWebkitFallbacks = {
  postcssPlugin: "pc-old-webkit-fallbacks",
  OnceExit(root) {
    const gapRules = [];
    const centerRules = [];
    root.walkRules((rule) => {
      const parent = rule.parent;
      if (parent && parent.type === "atrule" && parent.name === "supports") return; // no recursion
      let flex = false, column = false, gap = null, placeItems = null;
      rule.walkDecls((d) => {
        if (d.prop === "display" && /(^|\s)(inline-)?flex$/.test(d.value.trim())) flex = true;
        else if (d.prop === "flex-direction" && /column/.test(d.value)) column = true;
        else if (d.prop === "gap") gap = d.value.trim();
        else if (d.prop === "place-items") placeItems = d.value.trim();
      });
      if (flex && gap) {
        gapRules.push({ selector: rule.selector, gap: gap.split(/\s+/).pop(), column });
      }
      if (placeItems) {
        // `place-items: a [b]` -> the content-distribution longhands the old engine needs
        // to actually center the single track (not just the item within it).
        const parts = placeItems.split(/\s+/);
        centerRules.push({ selector: rule.selector, align: parts[0], justify: parts[1] || parts[0] });
      }
    });
    if (!gapRules.length && !centerRules.length) return;

    const at = postcss.atRule({
      name: "supports",
      params: "not (inset: 0)",
      raws: { before: "\n", afterName: " ", between: " " },
    });
    for (const c of centerRules) {
      const rule = postcss.rule({ selector: c.selector, raws: { before: "\n  ", between: " " } });
      rule.append(postcss.decl({ prop: "align-content", value: c.align }));
      rule.append(postcss.decl({ prop: "justify-content", value: c.justify }));
      at.append(rule);
    }
    for (const g of gapRules) {
      // Margin only BETWEEN element children. `:not(:first-child)` (specificity 0,2,0) beats
      // low-specificity child rules like `.note p{margin:0}` that would otherwise win over `+`.
      const rule = postcss.rule({ selector: `${g.selector} > :not(:first-child)`, raws: { before: "\n  ", between: " " } });
      rule.append(postcss.decl({ prop: g.column ? "margin-top" : "margin-left", value: g.gap }));
      at.append(rule);
    }
    root.append(at);
  },
};

module.exports = [clampFallback, expandInset, webkitSticky, logicalFallback, oldWebkitFallbacks];
