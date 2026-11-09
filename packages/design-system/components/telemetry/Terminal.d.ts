import * as React from 'react';
/** @startingPoint section="Components" subtitle="CRT terminal with typewriter output" viewport="700x320" */
export interface TerminalLine {
  /** 'cmd' (typed at 34ms/char, $ prompt) | 'out' | 'ok' (the ONLY green) | 'warn' (amber) */
  t: 'cmd' | 'out' | 'ok' | 'warn';
  text: string;
}
export interface TerminalProps {
  /** Title-bar string, e.g. 'CONSOLE · /bin/console · UNIT D-01' */
  title?: string;
  lines?: TerminalLine[];
  /** Render fully typed, no animation (also forced by reduced motion) */
  static?: boolean;
  /** CSS min-height for the body */
  minHeight?: string | number;
}
export declare function Terminal(props: TerminalProps): JSX.Element;
