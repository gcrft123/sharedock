import React from 'react';

/* Pricing tier for a gap:1px 3-col grid. Featured tier: --bg-panel + inset orange ring +
   ◆ RECOMMENDED corner tab + ember lift. All tier CTAs share ONE label/intent. */
export function PricingTier({
  name, price, priceNote, features = [], featured = false,
  ctaLabel = 'Get started', onCta, ctaHref = '#',
}) {
  return (
    <article className={featured ? 'tier tier-featured' : 'tier'}>
      {featured && <span className="tier-tab" aria-hidden="true">◆ Recommended</span>}
      <p className="tier-name">{name}</p>
      <p className="tier-price">{price}{priceNote && <em> {priceNote}</em>}</p>
      <ul className="tier-feats">
        {features.map((f) => <li key={f}>{f}</li>)}
      </ul>
      {onCta
        ? <button type="button" className={featured ? 'btn btn-primary' : 'btn'} onClick={onCta}>{ctaLabel}</button>
        : <a className={featured ? 'btn btn-primary' : 'btn'} href={ctaHref}>{ctaLabel}</a>}
    </article>
  );
}
