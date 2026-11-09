import "./polyfills"; // must be first — installs ResizeObserver etc. for old WebViews
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "@app/ui";

// Signals the index.html boot guard that the app module executed. The guard uses this to tell
// "module never ran" (a black screen on WebViews too old to parse the bundle) apart from a healthy
// boot, so it can surface a readable error instead of an empty window. See apps/web/index.html.
(window as unknown as { __booted?: boolean }).__booted = true;

const el = document.getElementById("root");
if (!el) throw new Error("#root not found");

createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
