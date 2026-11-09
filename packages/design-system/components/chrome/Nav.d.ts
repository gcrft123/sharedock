import * as React from 'react';
export interface NavLink { label: string; href?: string; }
export interface NavProps {
  brand?: string;
  links?: NavLink[];
  /** Sign-in text link; pass '' to hide */
  signIn?: string;
  signInHref?: string;
  ctaLabel?: string;
  ctaHref?: string;
  onCta?: () => void;
  /** Default true (sticky under the 30px status bar) */
  sticky?: boolean;
}
export declare function Nav(props: NavProps): JSX.Element;
