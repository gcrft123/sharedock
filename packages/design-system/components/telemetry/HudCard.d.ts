import * as React from 'react';
/** @startingPoint section="Components" subtitle="Generated telemetry HUD: signal + readouts + radar map" viewport="460x420" */
export interface HudReadout { k: string; v: string; u?: string; }
export interface HudCardProps {
  /** e.g. '◊ UNIT D-01 · TELEMETRY' */
  title?: string;
  /** LIVE blip label */
  live?: string;
  /** 4 entries -> 2x2 readout grid */
  readouts?: HudReadout[];
  /** Show the blueprint minimap with radar pings */
  map?: boolean;
  coord?: string;
}
export declare function HudCard(props: HudCardProps): JSX.Element;
