import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Old-WebView CSS compat (expand `inset`, flex-gap fallback under @supports). CJS.
import { createRequire } from "node:module";
const mojaveCssCompat = createRequire(import.meta.url)("./postcss-mojave.cjs");

const here = fileURLToPath(new URL(".", import.meta.url)); // apps/web/
const repoRoot = resolve(here, "../..");
const p = (rel: string) => resolve(repoRoot, rel);

// Resolve the workspace packages to their SOURCE (not through node_modules), so
// @vitejs/plugin-react transforms their .jsx/.tsx. Order matters: more specific
// subpaths first.
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@app/ui/ui.css", replacement: p("packages/ui/src/ui.css") },
      { find: "@app/ui", replacement: p("packages/ui/src/index.tsx") },
      { find: "@app/rpc-client", replacement: p("packages/rpc-client-ts/src/index.ts") },
    ],
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    exclude: ["@app/ui", "@app/rpc-client"],
  },
  css: {
    // Make the bundled CSS run on old macOS WebViews (Mojave/High Sierra, Safari <14.1):
    // expand `inset`, and add a flex-`gap` fallback gated to those engines only.
    postcss: { plugins: mojaveCssCompat },
  },
  server: {
    port: 5173,
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // esbuild's CSS minifier re-collapses our `top/right/bottom/left` back into the
    // `inset` shorthand (unsupported <Safari 14.1), undoing the postcss-mojave expansion.
    // Disable CSS minify to keep the longhands; JS stays minified, and gzip makes the
    // CSS size delta negligible (~identical over the wire).
    cssMinify: false,
    // Old WKWebViews (Mojave/High Sierra) predate Safari 13.1/14 syntax — optional
    // chaining `?.`, nullish `??`, logical assignment `??=`. The crypto is now BigInt-free,
    // so we transpile all of that down; es2019 output runs on Safari 11+.
    target: "es2019",
  },
});
