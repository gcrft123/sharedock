Square mono action button; use exactly ONE primary per view, labels <=3 words, one CTA intent per page.

```jsx
<Button variant="primary" arrow>Get started</Button>
<Button>View docs</Button>
<Button variant="ghost" size="sm">Cancel</Button>
```

- `variant`: secondary (hairline, border->fg on hover) / primary (orange bg, resting ember glow) / ghost.
- `size="sm"` = 34px for nav/toolbars. `href` renders an anchor. `:active` presses down 1px.
