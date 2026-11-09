import * as React from 'react';
export interface EqualizerProps {
  /** Bar count, ~28 default */
  bars?: number;
  /** Pixel height of the signal field */
  height?: number;
}
export declare function Equalizer(props: EqualizerProps): JSX.Element;
