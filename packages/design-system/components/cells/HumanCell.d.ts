import * as React from 'react';
export interface HumanCellProps {
  /** Pill chip label (the one rounded token) */
  chip?: string;
  chipTone?: 'amber' | 'peach' | 'cream';
  /** Space Grotesk 600 heading in --cream, sentence case */
  title: React.ReactNode;
  /** Space Grotesk body in --peach */
  children?: React.ReactNode;
  /** Mono muted foot label */
  foot?: React.ReactNode;
  cross?: 'tl' | 'tr' | 'bl' | 'br' | false;
}
export declare function HumanCell(props: HumanCellProps): JSX.Element;
