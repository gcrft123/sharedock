Minimal confirmation / warning popup. A lit hairline card (r-2 radius, soft ember shadow) over a blurred scrim. Mono tone label + uppercase Archivo headline (the question), one human sentence-case line (the ember), and two actions: cancel (secondary) + confirm (the ONE primary in view).

- `tone`: `confirm` (cream label), `warning` (amber, default), `danger` (hazard orange).
- Keep it terse: title is the plain question, body reassures in sentence case, confirm label ≤3 words.
- `embedded` drops the fixed scrim and renders inline — use it inside a page region or a showcase.
- Escape / scrim-click / × all call `onCancel` when `dismissible` (default true).

```jsx
const [open, setOpen] = React.useState(true);

<ConfirmDialog
  open={open}
  tone="danger"
  title="Remove node A-07?"
  confirmLabel="Remove"
  cancelLabel="Keep"
  onConfirm={() => setOpen(false)}
  onCancel={() => setOpen(false)}
>
  This node leaves the pool. Your files never leave home, they re-pool across the other devices.
</ConfirmDialog>
```
