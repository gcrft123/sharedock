import * as React from 'react';
export interface SectionHeaderProps {
  /** Mono orange section ID, e.g. 'SEC.03 / CONSOLE' */
  id?: string;
  /** Uppercase Archivo Black H2; may embed ONE <span className="serif-word"> per page */
  title: React.ReactNode;
  /** Short mono note, right-aligned, max ~38ch */
  note?: React.ReactNode;
  className?: string;
}
export declare function SectionHeader(props: SectionHeaderProps): JSX.Element;
