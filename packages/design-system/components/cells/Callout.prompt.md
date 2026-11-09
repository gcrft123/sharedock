Inline callout — a warm hairline notice with a leading tone glyph and one sentence-case line. Use for a single aside/reassurance next to content. This is NOT an overlay; for a decision that needs actions, use `ConfirmDialog`.

```jsx
<Callout icon={<Icon name="shield" size={16} />}>Your files are encrypted on your own devices.</Callout>
<Callout tone="warning" icon={<Icon name="danger" size={16} />}>Low on space on <b>Old ThinkPad</b>.</Callout>
<Callout tone="danger" icon={<Icon name="danger" size={16} />}>This can&rsquo;t be undone.</Callout>
```

- `tone`: info (default, hazard glyph) / warning (amber glyph) / danger (hazard glyph + a stronger warm ground). One accent hue only — warmth is a tint of the orange, never a second colour.
- `icon` is any node (usually `<Icon />`); omit for text-only. Body is Space Grotesk, sentence case; `<b>` warms to cream.
- Keep it to one or two lines and one per idea; never stack more than two. Square hairline skeleton, soft `--r-1` corner.
