import * as React from 'react';
export interface FooterColumn { title: string; links: { label: string; href?: string }[]; }
export interface FooterProps {
  brand?: string;
  tagline?: string;
  columns?: FooterColumn[];
  /** Giant clipped watermark wordmark; put one glyph in <b> to turn it orange */
  mega?: React.ReactNode;
  /** Mono bottom-bar strings: (c), coordinates, BUILD/REV */
  bottom?: React.ReactNode[];
}
export declare function Footer(props: FooterProps): JSX.Element;
