import React from 'react';

/* Eyebrow kicker: 26px orange bar + mono uppercase label. Max 1 per 3 sections. */
export function Eyebrow({ children, ...rest }) {
  return <span className="eyebrow" {...rest}>{children}</span>;
}
