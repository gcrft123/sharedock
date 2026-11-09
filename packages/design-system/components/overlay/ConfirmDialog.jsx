import React from 'react';
import { Button } from '../controls/Button.jsx';

/* Tone -> head label. One accent hue: warmth is a tint of the same orange
   (cream -> amber -> hazard), never a second color. */
const TONES = {
  confirm: { label: 'CONFIRM', cls: 'dlg-confirm' },
  warning: { label: 'WARNING', cls: 'dlg-warning' },
  danger: { label: 'CAUTION', cls: 'dlg-danger' },
};

/* Minimal confirmation / warning popup. A lit hairline card over a scrim:
   mono tone label, uppercase headline (the question), one human sentence-case
   line, and two actions (cancel = secondary, confirm = the ONE primary). */
export function ConfirmDialog({
  open = true,
  tone = 'warning',
  title = 'Remove node A-07?',
  eyebrow,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  dismissible = true,
  embedded = false,
  onConfirm,
  onCancel,
  children,
  ...rest
}) {
  const t = TONES[tone] || TONES.warning;

  React.useEffect(() => {
    if (embedded || !open) return;
    const onKey = (e) => { if (e.key === 'Escape' && onCancel) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, embedded, onCancel]);

  if (!open) return null;

  const card = (
    <div className={`dlg ${t.cls}`} role="alertdialog" aria-modal={embedded ? undefined : 'true'} aria-label={title} {...rest}>
      <div className="dlg-head">
        <span className="dlg-glyph">{eyebrow || t.label}</span>
      </div>
      <div className="dlg-body">
        <h2 className="dlg-title">{title}</h2>
        {children && <p className="dlg-msg">{children}</p>}
      </div>
      <div className="dlg-foot">
        <Button size="sm" onClick={onCancel}>{cancelLabel}</Button>
        <Button size="sm" variant="primary" onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </div>
  );

  if (embedded) return card;

  return (
    <div
      className="dlg-scrim"
      onMouseDown={(e) => { if (e.target === e.currentTarget && dismissible && onCancel) onCancel(); }}
    >
      {card}
    </div>
  );
}
