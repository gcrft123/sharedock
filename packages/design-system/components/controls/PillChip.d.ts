import * as React from 'react';
export interface PillChipProps {
  /** Tint family (same orange hue): 'amber' | 'peach' | 'cream' */
  tone?: 'amber' | 'peach' | 'cream';
  /** Show a small square status dot */
  dot?: boolean;
  children?: React.ReactNode;
}
export declare function PillChip(props: PillChipProps): JSX.Element;
