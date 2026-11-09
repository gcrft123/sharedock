import * as React from 'react';
/** @startingPoint section="Components" subtitle="Minimal confirmation / warning popup: scrim + hairline card, confirm / warning / danger tones" viewport="700x420" */
export interface ConfirmDialogProps {
  /** Render the dialog. Return null when false. Default true */
  open?: boolean;
  /** 'confirm' (cream label) | 'warning' (amber, default) | 'danger' (hazard) */
  tone?: 'confirm' | 'warning' | 'danger';
  /** Uppercase machine headline — the question. e.g. 'Remove node A-07?' */
  title?: string;
  /** Override the head label (defaults per tone: CONFIRM / WARNING / CAUTION) */
  eyebrow?: string;
  /** Primary action label (≤3 words). Default 'Confirm' */
  confirmLabel?: string;
  /** Secondary action label. Default 'Cancel' */
  cancelLabel?: string;
  /** Allow scrim-click / Escape to dismiss. Default true */
  dismissible?: boolean;
  /** Drop the fixed scrim and render the dialog inline in flow (for embedding / showcase) */
  embedded?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
  /** Human sentence-case body copy (the ember / reassurance line) */
  children?: React.ReactNode;
}
export declare function ConfirmDialog(props: ConfirmDialogProps): JSX.Element | null;
