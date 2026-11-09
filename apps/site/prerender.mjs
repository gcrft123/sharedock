/* Build-time prerender.
 *
 * The page is static content, so there is no reason to make a visitor execute React
 * before they can read it. This renders <App /> to HTML once at build time and injects
 * it into dist/index.html; the client then hydrates it.
 *
 * Three reasons this is not optional here:
 *   - The product is sold to people running old hardware, and this site's browser floor
 *     is old Safari. Prerendered markup paints immediately and survives a JS failure.
 *   - Crawlers and link unfurlers get real content rather than an empty div.
 *   - First contentful paint no longer waits on a 50 kB JavaScript bundle.
 *
 * <Narrative> deliberately starts in its static branch on both server and client and
 * upgrades to WebGL in an effect, so hydration matches.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
// React itself loads as a normal Node dependency. Only our own TSX needs Vite's
// transform, so pushing react-dom through ssrLoadModule just breaks its CJS wrapper.
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "dist/index.html");

const vite = await createServer({
  root: here,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "warn",
});

try {
  const { App } = await vite.ssrLoadModule("/src/App.tsx");
  const html = renderToString(createElement(App));
  const out = readFileSync(dist, "utf8").replace(
    '<div id="root"></div>',
    `<div id="root">${html}</div>`,
  );
  writeFileSync(dist, out);
  console.log(`prerendered ${(html.length / 1024).toFixed(1)} kB into dist/index.html`);
} finally {
  await vite.close();
}
