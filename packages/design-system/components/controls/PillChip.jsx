import React from 'react';

/* Pill chip: the ONE rounded token in the system. Tinted bg + matching text, same orange hue family. */
export function PillChip({ tone = 'amber', dot = false, children, ...rest }) {
  return (
    <span className={`chip chip-${tone}`} {...rest}>
      {dot && <i aria-hidden="true"></i>}
      {children}
    </span>
  );
}
