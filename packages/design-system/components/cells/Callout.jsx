import React from 'react';

/* Inline callout — a warm hairline notice with a leading tone glyph and one
   human, sentence-case line. Warmth is a tint of the one accent (amber -> hazard),
   never a second colour. This is NOT an overlay: for a decision, use ConfirmDialog. */
export function Callout({ tone = 'info', icon, children, ...rest }) {
  const cls = [
    'callout',
    tone === 'warning' && 'callout-warning',
    tone === 'danger' && 'callout-danger',
  ].filter(Boolean).join(' ');
  return (
    <div className={cls} role="note" {...rest}>
      {icon && <span className="callout-glyph" aria-hidden="true">{icon}</span>}
      <p className="callout-body">{children}</p>
    </div>
  );
}
