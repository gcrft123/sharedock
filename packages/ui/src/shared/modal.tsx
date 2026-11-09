import React from "react";

// Modal layering, focus management and Escape handling for the whole app.
//
// Deliberately NOT the native <dialog> + showModal(), which would give trapping, Escape
// and an inert background for free: <dialog> is Safari 15.4+, and this app's floor is
// Safari 14 (the macOS 10.14 Mojave desktop target, see docs/host-compatibility.md), and
// the shipped bundle has to stay free of Safari-15-only APIs. So it is implemented by hand here.
//
// Why this exists at all: modal open-state used to live in whichever component happened
// to own it (AppRoot for Settings, Dashboard for Add-host/Detail, Files for its own
// dialogs), and each component ran its own key handler. Nothing knew what was on top, so:
//   - Escape did not close Settings, even though its close button reads "Esc";
//   - on the Files page, Escape with Settings open cleared the file selection *behind*
//     the modal, and Delete/Backspace trashed the selection behind it.
// One registry fixes both: layers are a stack, exactly one Escape listener runs, and it
// only ever closes the topmost layer. Page-level key handlers call useAnyModalOpen() and
// bail while anything is open.

interface Layer {
  id: number;
  close: () => void;
}

// Two contexts on purpose. The controls are referentially STABLE for the provider's whole
// life, so useModalLayer's effects depend only on `open` and re-run only when a modal
// actually opens or closes. `anyOpen` is the reactive half. Folding both into one object
// makes its identity change on every push/pop, which tears down and re-runs the layer
// effect mid-open — that corrupts the saved focus-restore target and churns the stack.
interface ModalCtrl {
  push: (close: () => void) => number;
  pop: (id: number) => void;
  isTop: (id: number) => boolean;
}

const CtrlCtx = React.createContext<ModalCtrl | null>(null);
const AnyOpenCtx = React.createContext<boolean>(false);

let nextId = 1;

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusables(root: HTMLElement): HTMLElement[] {
  const all = Array.prototype.slice.call(root.querySelectorAll(FOCUSABLE)) as HTMLElement[];
  // offsetParent is null for display:none subtrees; the closed scrims stay mounted.
  return all.filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function ModalProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [layers, setLayers] = React.useState<Layer[]>([]);
  const layersRef = React.useRef<Layer[]>(layers);
  layersRef.current = layers;

  const push = React.useCallback((close: () => void) => {
    const id = nextId++;
    setLayers((l) => l.concat([{ id, close }]));
    return id;
  }, []);

  const pop = React.useCallback((id: number) => {
    setLayers((l) => l.filter((x) => x.id !== id));
  }, []);

  const isTop = React.useCallback((id: number) => {
    const l = layersRef.current;
    return l.length > 0 && l[l.length - 1].id === id;
  }, []);

  // The app's single Escape listener. Capture phase so it resolves before any page-level
  // handler can act on the content behind the modal.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const l = layersRef.current;
      if (!l.length) return;
      e.stopPropagation();
      e.preventDefault();
      l[l.length - 1].close();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  // Scroll lock. Without it the wheel/trackpad scrolls the page BEHIND the scrim (and a
  // modal's own scroller chains into it once it hits its end), so the content you came from
  // drifts away under the dialog. Locking here rather than in one screen covers every modal
  // — Settings, Add host, Detail, the Files dialogs — from one place.
  //
  // The dep is the BOOLEAN, not layers.length: stacking a second dialog must not tear the
  // lock down and rebuild it (that would restore the scrollbar for a frame and jump).
  const anyOpen = layers.length > 0;
  React.useEffect(() => {
    if (!anyOpen) return;
    const { body, documentElement: html } = document;
    const y = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
      pad: body.style.paddingRight,
    };
    // Pin the body at its current offset rather than just setting `overflow:hidden` on the
    // scroller. The app sets `html,body{height:100%}`, so hiding the overflow collapses the
    // scroll range and the browser clamps scrollTop to 0 — the page behind the scrim visibly
    // jumps to the top and the user loses their place. Shifting a fixed body up by `y`
    // freezes the same pixels on screen, and the offset is scrolled back on close.
    const gap = window.innerWidth - html.clientWidth; // scrollbar width; 0 with overlay bars
    body.style.position = "fixed";
    body.style.top = `-${y}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    if (gap > 0) body.style.paddingRight = `${gap}px`;
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      body.style.paddingRight = prev.pad;
      window.scrollTo(0, y);
    };
  }, [anyOpen]);

  // push/pop/isTop are useCallback([]) — this memo never re-computes.
  const ctrl = React.useMemo<ModalCtrl>(() => ({ push, pop, isTop }), [push, pop, isTop]);

  return (
    <CtrlCtx.Provider value={ctrl}>
      <AnyOpenCtx.Provider value={layers.length > 0}>{children}</AnyOpenCtx.Provider>
    </CtrlCtx.Provider>
  );
}

/** True while any modal layer is open. Page key handlers bail on this. */
export function useAnyModalOpen(): boolean {
  return React.useContext(AnyOpenCtx);
}

/**
 * Register a modal layer while `open`, and manage its focus.
 *
 * Moves focus into the dialog on open, keeps Tab inside it, and restores focus to
 * whatever was focused before on close. Escape is handled centrally by ModalProvider,
 * which closes only the topmost layer — do not add a local Escape handler.
 */
export function useModalLayer(
  open: boolean,
  onClose: () => void,
  ref: React.RefObject<HTMLElement>,
): void {
  const api = React.useContext(CtrlCtx);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const idRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!open || !api) return;
    const id = api.push(() => onCloseRef.current());
    idRef.current = id;
    const restoreTo = document.activeElement as HTMLElement | null;

    // Move focus in. Prefer the first real control; fall back to the container, which
    // carries tabIndex={-1} so it can hold focus for screen readers.
    const el = ref.current;
    if (el) {
      const f = focusables(el);
      (f.length ? f[0] : el).focus();
    }

    return () => {
      api.pop(id);
      idRef.current = null;
      // Only restore if focus is still inside the dialog we're tearing down; otherwise the
      // user has already moved on and yanking focus back would be hostile.
      const active = document.activeElement;
      const inside = !!(el && active && el.contains(active));
      if ((inside || active === document.body) && restoreTo && document.contains(restoreTo)) {
        restoreTo.focus();
      }
    };
  }, [open, api, ref]);

  // Tab trap. Only the topmost layer traps, so a dialog stacked on a dialog behaves.
  React.useEffect(() => {
    if (!open || !api) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const el = ref.current;
      const id = idRef.current;
      if (!el || id === null || !api.isTop(id)) return;
      const f = focusables(el);
      if (!f.length) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = f[0];
      const last = f[f.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!el.contains(active)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, api, ref]);
}
