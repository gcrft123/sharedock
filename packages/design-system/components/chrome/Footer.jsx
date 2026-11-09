import React from 'react';

/* Footer: hairline grid (brand + link columns) on --bg-deep, giant clipped wordmark in --edge
   with one orange glyph. */
export function Footer({
  brand = 'SHAREDOCK',
  logo,
  logoAlt = 'Sharedock',
  logoHeight = 30,
  tagline = 'Turn your old devices into one private cloud. One machine, warmly lit.',
  columns = [
    { title: 'Product', links: [{ label: 'Features' }, { label: 'Setup' }, { label: 'Pricing' }] },
    { title: 'Reference', links: [{ label: 'Docs' }, { label: 'CLI' }, { label: 'Changelog' }] },
    { title: 'Company', links: [{ label: 'About' }, { label: 'Contact' }, { label: 'Status' }] },
  ],
  mega = ['SHARE', <b key="amp">DOCK</b>],
}) {
  return (
    <footer className="footer">
      <div className="footer-grid">
        <div className="footer-brand">
          <span className="nav-mark">{logo ? <img src={logo} alt={logoAlt} style={{ height: logoHeight, width: 'auto', display: 'block' }} /> : <React.Fragment>{brand}<sup>®</sup></React.Fragment>}</span>
          <p>{tagline}</p>
        </div>
        {columns.map((c) => (
          <div className="footer-col" key={c.title}>
            <h4>{c.title}</h4>
            <ul>
              {c.links.map((l) => <li key={l.label}><a href={l.href || '#'}>{l.label}</a></li>)}
            </ul>
          </div>
        ))}
      </div>
      <div className="footer-mega" aria-hidden="true"><span>{mega}</span></div>
    </footer>
  );
}
