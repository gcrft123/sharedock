// A tiny framework-agnostic store of in-flight client transfers (uploads +
// downloads). The UI subscribes via useSyncExternalStore to render live
// progress. getSnapshot returns a stable reference until something changes.

import type { Transfer } from "./types";

type Listener = () => void;

class TransferStore {
  private list: Transfer[] = [];
  private meta = new Map<string, { total: number; startedAt: number }>();
  private listeners = new Set<Listener>();
  private seq = 0;
  private lastProgressEmit = 0;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): Transfer[] => this.list;

  start(name: string, direction: "up" | "down", totalBytes: number): string {
    const id = `t${++this.seq}`;
    this.meta.set(id, { total: totalBytes, startedAt: Date.now() });
    this.list = [
      ...this.list,
      { id, name, direction, state: "active", progress: 0, bytesPerSec: 0, transferredBytes: 0, totalBytes, etaSecs: 0 },
    ];
    this.emit();
    return id;
  }

  update(id: string, transferredBytes: number): void {
    const m = this.meta.get(id);
    if (!m) return;
    const elapsed = Math.max(0.001, (Date.now() - m.startedAt) / 1000);
    const rate = transferredBytes / elapsed;
    const progress = m.total > 0 ? Math.min(1, transferredBytes / m.total) : 0;
    const eta = rate > 0 ? Math.max(0, (m.total - transferredBytes) / rate) : 0;
    this.list = this.list.map((t) =>
      t.id === id ? { ...t, transferredBytes, progress, bytesPerSec: rate, etaSecs: eta } : t,
    );
    // coalesce progress emits: re-rendering the whole dashboard on every chunk
    // adds main-thread jank during large transfers. ~5 fps is plenty for a bar.
    const now = Date.now();
    if (now - this.lastProgressEmit >= 200 || progress >= 1) {
      this.lastProgressEmit = now;
      this.emit();
    }
  }

  finish(id: string): void {
    this.list = this.list.map((t) => (t.id === id ? { ...t, state: "done", progress: 1 } : t));
    this.emit();
    // drop it shortly after so the panel doesn't accumulate completed rows
    setTimeout(() => {
      this.list = this.list.filter((t) => t.id !== id);
      this.meta.delete(id);
      this.emit();
    }, 2500);
  }

  fail(id: string): void {
    this.list = this.list.map((t) => (t.id === id ? { ...t, state: "error" } : t));
    this.emit();
    setTimeout(() => {
      this.list = this.list.filter((t) => t.id !== id);
      this.meta.delete(id);
      this.emit();
    }, 4000);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

export const transfers = new TransferStore();
