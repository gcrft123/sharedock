import * as React from 'react';
export interface StatCellProps {
  /** Mono uppercase label */
  label: string;
  /** Numeric value; counts up ~1400ms on reveal (instant under reduced motion) */
  value: number;
  /** Orange superscript unit, e.g. '%', 'K', 'S' */
  unit?: string;
  /** Mono sub caption; mark invented numbers as SAMPLE */
  sub?: string;
  decimals?: number;
  /** Orange numeral (alternate cells for rhythm) */
  orange?: boolean;
  cross?: 'tl' | 'tr' | 'bl' | 'br' | false;
}
export declare function StatCell(props: StatCellProps): JSX.Element;
