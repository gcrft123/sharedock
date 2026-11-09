import React from 'react';

/* Square mono button. Variants: secondary (default) / primary (ONE per view) / ghost. */
export function Button({ variant = 'secondary', size = 'md', href, arrow = false, disabled = false, children, ...rest }) {
  const cls = [
    'btn',
    variant === 'primary' && 'btn-primary',
    variant === 'ghost' && 'btn-ghost',
    size === 'sm' && 'btn-sm',
  ].filter(Boolean).join(' ');
  const inner = (
    <React.Fragment>
      {children}
      {arrow && <span className="btn-arrow" aria-hidden="true">→</span>}
    </React.Fragment>
  );
  if (href) {
    return <a className={cls} href={disabled ? undefined : href} aria-disabled={disabled || undefined} {...rest}>{inner}</a>;
  }
  return <button type="button" className={cls} disabled={disabled} {...rest}>{inner}</button>;
}
