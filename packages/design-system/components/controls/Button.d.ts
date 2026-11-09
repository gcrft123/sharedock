import * as React from 'react';
/** @startingPoint section="Components" subtitle="Square mono buttons: secondary / primary / ghost" viewport="700x300" */
export interface ButtonProps {
  /** 'secondary' (default, hairline border) | 'primary' (hazard orange, ONE per view) | 'ghost' */
  variant?: 'secondary' | 'primary' | 'ghost';
  /** 'md' = 44px, 'sm' = 34px */
  size?: 'md' | 'sm';
  /** Render as <a href> instead of <button> */
  href?: string;
  /** Append a -> arrow that nudges 4px on hover */
  arrow?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}
export declare function Button(props: ButtonProps): JSX.Element;
