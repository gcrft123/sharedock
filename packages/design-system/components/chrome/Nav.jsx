import React from 'react';
import { Button } from '../controls/Button.jsx';

/* 64px sticky nav under the status bar: wordmark + ®, mono links w/ orange underline, sign-in + ONE primary CTA. */
export function Nav({
  brand = 'SHAREDOCK',
  logo,
  logoAlt = 'Sharedock',
  logoHeight = 26,
  links = [],
  signIn = 'Sign in',
  signInHref = '#',
  ctaLabel = 'Get started',
  ctaHref = '#',
  onCta,
  sticky = true,
}) {
  return (
    <nav className="nav" style={sticky ? undefined : { position: 'relative', top: 0 }}>
      <a className="nav-mark" href="#">{logo ? <img src={logo} alt={logoAlt} style={{ height: logoHeight, width: 'auto', display: 'block' }} /> : <React.Fragment>{brand}<sup>®</sup></React.Fragment>}</a>
      {links.length > 0 && (
        <div className="nav-links">
          {links.map((l) => <a key={l.label} className="nav-link" href={l.href || '#'}>{l.label}</a>)}
        </div>
      )}
      <div className="nav-right">
        {signIn && <a className="nav-signin" href={signInHref}>{signIn}</a>}
        <Button variant="primary" size="sm" href={onCta ? undefined : ctaHref} onClick={onCta}>{ctaLabel}</Button>
      </div>
    </nav>
  );
}
