import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Same old-WebView CSS compat the console uses: expand `inset`, rewrite `clamp()`,
// add `-webkit-sticky` and flex-gap fallbacks. The audience for a product about
// reusing old hardware skews toward viewing the pitch ON old hardware.
import { createRequire } from "node:module";
const mojaveCssCompat = createRequire(import.meta.url)("./postcss-mojave.cjs");

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [react()],
  css: { postcss: { plugins: mojaveCssCompat } },
  resolve: { dedupe: ["react", "react-dom"] },
  server: { port: 5174, fs: { allow: [resolve(here, "../..")] } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // esbuild's CSS minifier re-collapses longhands back into `inset`, undoing the
    // compat pass. JS stays minified; gzip makes the CSS delta negligible.
    cssMinify: false,
    target: "es2019",
    rollupOptions: {
      output: {
        // three.js is only needed by the assembly section, which lazy-loads it.
        // Keeping it in its own chunk means the page paints without it.
        manualChunks: { three: ["three"] },
      },
    },
  },
});
