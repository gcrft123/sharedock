import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/site.css";

// Opt into the hidden start state for scroll reveals only when we can actually finish
// them. Without this the page's default is fully visible, which is what old engines,
// no-JS visitors and headless renderers get.
const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
if ("IntersectionObserver" in window && !reduced) {
  document.documentElement.classList.add("js-anim");
}

const root = document.getElementById("root")!;
const tree = (
  <StrictMode>
    <App />
  </StrictMode>
);

// The production build ships prerendered markup, so hydrate it rather than throwing it
// away and re-rendering. `pnpm dev` has an empty root and takes the create path.
if (root.firstChild) hydrateRoot(root, tree);
else createRoot(root).render(tree);
