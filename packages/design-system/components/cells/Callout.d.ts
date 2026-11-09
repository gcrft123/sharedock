import * as React from 'react';
/** @startingPoint section="Components" subtitle="Inline callout: info / warning / danger, one warm hue" viewport="700x260" */
export interface CalloutProps {
  /** 'info' (default, hazard glyph) | 'warning' (amber glyph) | 'danger' (hazard glyph + warmer ground) */
  tone?: 'info' | 'warning' | 'danger';
  /** Leading glyph, e.g. <Icon name="shield" size={16} />. Omit for text-only. */
  icon?: React.ReactNode;
  /** One or two sentence-case lines; <b> warms to cream. */
  children?: React.ReactNode;
}
export declare function Callout(props: CalloutProps): JSX.Element;
