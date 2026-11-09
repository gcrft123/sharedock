import * as React from 'react';
/** @startingPoint section="Components" subtitle="Dense machine cell for 1px hairline grids" viewport="700x280" */
export interface CapabilityCellProps {
  /** Mono index rendered as [ 01 ] */
  index?: string;
  title: React.ReactNode;
  /** Mono description body */
  children?: React.ReactNode;
  /** Bottom stat: LABEL · value */
  statLabel?: string;
  statValue?: React.ReactNode;
  /** Crosshair corner, or false to hide */
  cross?: 'tl' | 'tr' | 'bl' | 'br' | false;
}
export declare function CapabilityCell(props: CapabilityCellProps): JSX.Element;
