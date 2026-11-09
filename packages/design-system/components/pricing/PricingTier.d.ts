import * as React from 'react';
export interface PricingTierProps {
  name: string;
  /** e.g. '$0', '$740', 'Custom' */
  price: React.ReactNode;
  /** Mono suffix, e.g. '/MO PER SITE' */
  priceNote?: string;
  features?: string[];
  /** --bg-panel + inset orange ring + RECOMMENDED tab + ember lift; its CTA becomes the primary */
  featured?: boolean;
  /** ALL tiers share one label/intent */
  ctaLabel?: string;
  ctaHref?: string;
  onCta?: () => void;
}
export declare function PricingTier(props: PricingTierProps): JSX.Element;
