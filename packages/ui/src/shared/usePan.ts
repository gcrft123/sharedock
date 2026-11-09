import { useCallback, useEffect, useRef, useState } from "react";

export interface PanState {
  x: number;
  y: number;
}

export interface UsePan {
  pan: PanState;
  /** True while a drag is in progress (suppress click-through on nodes). */
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}

/**
 * Pixel-canvas pan for the topology graph — a direct port of the dashboard
 * prototype's `pan{x,y}` drag with a clamp. The consumer applies
 * `transform: translate(pan.x, pan.y)` to the canvas element. `clamp` bounds the
 * offset (given the current viewport + content size) so the graph can't be
 * dragged fully off-screen; return the input unchanged for a free pan.
 */
export function usePan(clamp?: (p: PanState) => PanState): UsePan {
  const [pan, setPan] = useState<PanState>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const origin = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const moved = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    origin.current = { px: e.clientX, py: e.clientY, x: pan.x, y: pan.y };
    moved.current = false;
    setDragging(true);
  }, [pan.x, pan.y]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const o = origin.current;
      if (!o) return;
      const dx = e.clientX - o.px;
      const dy = e.clientY - o.py;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved.current = true;
      const next = { x: o.x + dx, y: o.y + dy };
      setPan(clamp ? clamp(next) : next);
    };
    const onUp = () => {
      setDragging(false);
      origin.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, clamp]);

  return { pan, dragging, onPointerDown };
}
