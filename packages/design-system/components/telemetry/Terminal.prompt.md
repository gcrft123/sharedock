CRT terminal: square window, orange traffic dot + two outline dots, scanline body, typewriter output, blinking block cursor. Success lines are the ONLY green in the entire system; use at most one.

```jsx
<Terminal lines={[
  { t:'cmd', text:'sharedock add --device A-01' },
  { t:'out', text:'LINK ESTABLISHED · ENCRYPTED' },
  { t:'warn', text:'WARN · A-07 LOW SPACE 91%' },
  { t:'ok', text:'OK · POOL ONLINE · 6/6 DEVICES' },
]} />
```

Typing starts when scrolled into view; renders fully typed under reduced motion or static.
