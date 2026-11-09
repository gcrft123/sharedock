import * as React from 'react';

export type SolarIconName =
  | 'alarm' | 'bell' | 'bolt' | 'chart' | 'check-circle' | 'close-circle' | 'code'
  | 'command' | 'copyright' | 'cpu' | 'cpu-bolt' | 'danger' | 'database' | 'eye'
  | 'fire' | 'graph' | 'info-circle' | 'map-point' | 'monitor' | 'pie-chart'
  | 'power' | 'pulse' | 'radar' | 'refresh' | 'round-graph' | 'server'
  | 'settings' | 'shield' | 'tuning' | 'widget';

/** @startingPoint section="Components" subtitle="Solar Icon Set (Linear) recolored to currentColor" viewport="700x260" */
export interface IconProps extends React.SVGAttributes<SVGSVGElement> {
  /** Icon name from the curated Solar Linear set */
  name: SolarIconName;
  /** Size: number (px) or any CSS length. Default '1em' (inherits font-size) */
  size?: number | string;
  /** Accessible label. Omit for decorative icons (auto aria-hidden) */
  label?: string;
  /** Override the 1.5 default stroke width */
  strokeWidth?: number;
}
export declare function Icon(props: IconProps): JSX.Element;
export declare const iconNames: SolarIconName[];
