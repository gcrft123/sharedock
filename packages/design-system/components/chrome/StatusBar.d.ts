import * as React from 'react';
/** @startingPoint section="Components" subtitle="30px sticky telemetry strip with live UTC clock" viewport="700x120" */
export interface StatusBarProps {
  brand?: string;
  unit?: string;
  sys?: string;
  /** Flexible live-feed string; label invented metrics as SAMPLE FEED */
  feed?: string;
  lat?: string;
  /** Default true (position:sticky; top:0) */
  sticky?: boolean;
}
export declare function StatusBar(props: StatusBarProps): JSX.Element;
