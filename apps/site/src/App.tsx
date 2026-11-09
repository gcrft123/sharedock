import { useEffect } from "react";
import { Chrome } from "./sections/Chrome";
import { Narrative } from "./sections/Narrative";
import { Surfaces } from "./sections/Surfaces";
import { Privacy } from "./sections/Privacy";
import { Cost } from "./sections/Cost";
import { Tiers } from "./sections/Tiers";
import { Close } from "./sections/Close";
import { Footer } from "./sections/Footer";

export function App() {
  // Reveals enhance an already-visible default: `.rv` is opaque until `js-anim` is
  // set, which main.tsx only does when IntersectionObserver exists and the visitor has
  // not asked for reduced motion. Nothing here can leave a section blank.
  useEffect(() => {
    if (!document.documentElement.classList.contains("js-anim")) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("is-on");
          io.unobserve(e.target);
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -6% 0px" },
    );
    const observeAll = () => document.querySelectorAll(".rv:not(.is-on)").forEach((el) => io.observe(el));
    observeAll();

    // Anything that mounts later gets observed too. Without this, a `.rv` element added
    // after this effect ran keeps its hidden start state forever, which is precisely
    // the "section ships blank" failure this reveal system exists to avoid.
    const mo = new MutationObserver(observeAll);
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);

  return (
    <>
      <a className="skip" href="#assembly">
        Skip to content
      </a>
      <Chrome />
      <main>
        <Narrative />
        <Surfaces />
        <Privacy />
        <Cost />
        <Tiers />
        <Close />
      </main>
      <Footer />
    </>
  );
}
