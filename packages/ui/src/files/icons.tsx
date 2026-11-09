// icons.tsx — Solar-Linear-style glyphs for the file browser (folder/file/actions).
// Ported verbatim from the prototype's fb-icons.jsx FB_GLYPHS set: 24x24 grid,
// 1.5px single stroke, currentColor, round joins. The prototype fell back to the DS
// Icon component for names it did not define; that DS component is not available
// here, so `refresh` and `check-circle` (the only two the prototype leaned on the
// fallback for) are included in the set below.

import React from "react";

const G: Record<string, string> = {
  // ── file-system objects ──
  folder: '<path d="M3 7.6c0-1.1 0-1.7.4-2.1.4-.4 1-.4 2.1-.4h2.1c.5 0 .8 0 1 .1.3.1.5.2.7.4l1.4 1.4c.2.2.4.3.7.4.2.1.5.1 1 .1H18.5c1.1 0 1.7 0 2.1.4.4.4.4 1 .4 2.1V16c0 1.4 0 2.1-.4 2.6-.5.4-1.2.4-2.6.4H6c-1.4 0-2.1 0-2.6-.4C3 18.1 3 17.4 3 16V7.6Z" stroke-linejoin="round"/>',
  "folder-open": '<path d="M3.5 9V7.4c0-1 0-1.6.4-2 .4-.4 1-.4 2-.4h1.8c.5 0 .8 0 1 .1.3.1.5.2.7.4l1.3 1.3c.2.2.4.3.7.4.2.1.5.1.9.1H18c1 0 1.6 0 2 .4.4.4.4 1 .4 2v.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.9 11.6c.2-.7.3-1 .6-1.2.3-.2.7-.2 1.4-.2h13.1c.9 0 1.4 0 1.6.4.2.3.1.8-.1 1.6l-.9 3.3c-.2.9-.3 1.3-.7 1.6-.3.2-.8.2-1.7.2H6.2c-1.2 0-1.8 0-2.1-.4-.3-.4-.2-1 0-2.1l.8-2.8Z" stroke-linejoin="round"/>',
  "folder-plus": '<path d="M3 7.6c0-1.1 0-1.7.4-2.1.4-.4 1-.4 2.1-.4h2.1c.5 0 .8 0 1 .1.3.1.5.2.7.4l1.4 1.4c.2.2.4.3.7.4.2.1.5.1 1 .1H18.5c1.1 0 1.7 0 2.1.4.4.4.4 1 .4 2.1V16c0 1.4 0 2.1-.4 2.6-.5.4-1.2.4-2.6.4H6c-1.4 0-2.1 0-2.6-.4C3 18.1 3 17.4 3 16V7.6Z" stroke-linejoin="round"/><path d="M12 11v4M10 13h4" stroke-linecap="round"/>',
  file: '<path d="M4 6c0-1.9 0-2.8.6-3.4C5.2 2 6.1 2 8 2h4.3c.8 0 1.2 0 1.6.2.4.1.7.4 1.2.9l3.8 3.8c.5.5.8.8.9 1.2.2.4.2.8.2 1.6V18c0 1.9 0 2.8-.6 3.4-.6.6-1.5.6-3.4.6H8c-1.9 0-2.8 0-3.4-.6C4 20.8 4 19.9 4 18V6Z" stroke-linejoin="round"/><path d="M13 2.5V6c0 .9 0 1.4.3 1.7.3.3.8.3 1.7.3h3.5" stroke-linecap="round" stroke-linejoin="round"/>',
  "file-text": '<path d="M4 6c0-1.9 0-2.8.6-3.4C5.2 2 6.1 2 8 2h4.3c.8 0 1.2 0 1.6.2.4.1.7.4 1.2.9l3.8 3.8c.5.5.8.8.9 1.2.2.4.2.8.2 1.6V18c0 1.9 0 2.8-.6 3.4-.6.6-1.5.6-3.4.6H8c-1.9 0-2.8 0-3.4-.6C4 20.8 4 19.9 4 18V6Z" stroke-linejoin="round"/><path d="M13 2.5V6c0 .9 0 1.4.3 1.7.3.3.8.3 1.7.3h3.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 13h7M8.5 16.5h4.5" stroke-linecap="round"/>',
  image: '<path d="M2.5 12c0-4.5 0-6.7 1.4-8.1C5.3 2.5 7.5 2.5 12 2.5s6.7 0 8.1 1.4c1.4 1.4 1.4 3.6 1.4 8.1s0 6.7-1.4 8.1c-1.4 1.4-3.6 1.4-8.1 1.4s-6.7 0-8.1-1.4C2.5 18.7 2.5 16.5 2.5 12Z"/><circle cx="8.4" cy="8.6" r="1.7"/><path d="M4 17.6l3.5-3.1c.8-.7 1.9-.6 2.6.1l2.3 2.4c.5.6 1.4.7 2.1.2l.3-.2c.9-.7 2.1-.6 2.9.2L21 19.3" stroke-linecap="round" stroke-linejoin="round"/>',
  video: '<rect x="2.5" y="4.5" width="19" height="15" rx="2.6"/><path d="M10 9.4l4.2 2.6L10 14.6V9.4Z" stroke-linejoin="round"/>',
  audio: '<path d="M9 16.5V7.4c0-.7 0-1.1.2-1.4.2-.3.6-.4 1.3-.6l6-1.4c.7-.2 1.1-.3 1.4-.1.3.2.3.6.3 1.3v9.3" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="6.5" cy="16.6" rx="2.5" ry="2.1"/><ellipse cx="15.7" cy="14.5" rx="2.5" ry="2.1"/>',
  sheet: '<rect x="3" y="4" width="18" height="16" rx="2.2"/><path d="M3 9.2h18M3 14.6h18M9 9.2V20M15 9.2V20" />',
  code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.5 4l-3 16" stroke-linecap="round"/>',
  archive: '<path d="M3 7.4 12 3l9 4.4v9.2L12 21l-9-4.4V7.4Z" stroke-linejoin="round"/><path d="M3 7.4 12 12m0 0 9-4.6M12 12v9" stroke-linejoin="round"/><path d="M7.5 5.2 16.5 9.6" stroke-linecap="round"/>',
  layers: '<path d="M12 2.6 21 7l-9 4.4L3 7l9-4.4Z" stroke-linejoin="round"/><path d="m3.5 12 8.5 4.2L20.5 12" stroke-linecap="round" stroke-linejoin="round"/><path d="m3.5 16.4 8.5 4.2 8.5-4.2" stroke-linecap="round" stroke-linejoin="round"/>',
  // ── actions ──
  download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 16.5v1.5c0 1.4 1.1 2.5 2.5 2.5h11c1.4 0 2.5-1.1 2.5-2.5v-1.5" stroke-linecap="round"/>',
  upload: '<path d="M12 21V9m0 0 4 4m-4-4-4 4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 8V6.5C4 5.1 5.1 4 6.5 4h11C18.9 4 20 5.1 20 6.5V8" stroke-linecap="round"/>',
  trash: '<path d="M4 6.5h16" stroke-linecap="round"/><path d="M9.5 3.5h5" stroke-linecap="round"/><path d="M18.4 6.5l-.6 9.4c-.1 2-.2 3-1.5 3.6-.6.5-2.6.5-4.3.5s-3.7 0-4.3-.5c-1-.6-1.1-1.6-1.2-3.6L5.6 6.5"/><path d="M10 10.5v5M14 10.5v5" stroke-linecap="round"/>',
  pen: '<path d="M14.4 5.6 18.4 9.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.2 20.8 4 17c.1-.4.2-.6.4-.8l9.8-9.8c.8-.8 2-.8 2.8 0l.6.6c.8.8.8 2 0 2.8L7.8 19.6c-.2.2-.4.3-.8.4l-3.8.8Z" stroke-linejoin="round"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6" stroke-linecap="round"/>',
  "view-list": '<path d="M9 6h12M9 12h12M9 18h12" stroke-linecap="round"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" stroke-linecap="round" stroke-width="2"/>',
  "view-grid": '<rect x="3" y="3" width="7.5" height="7.5" rx="1.4"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.4"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.4"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.4"/>',
  sort: '<path d="M7 4.5v15m0 0 3-3.2m-3 3.2-3-3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 19.5v-15m0 0 3 3.2m-3-3.2-3 3.2" stroke-linecap="round" stroke-linejoin="round"/>',
  filter: '<path d="M3.5 5.5h17l-6.3 7.2c-.3.3-.4.5-.4.9v4.2c0 .4-.1.7-.4.9l-2 1.5c-.5.4-1.2 0-1.2-.7v-5.9c0-.4-.1-.6-.4-.9L3.5 5.5Z" stroke-linejoin="round"/>',
  "chevron-right": '<path d="M9 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/>',
  "chevron-down": '<path d="M5 9l7 7 7-7" stroke-linecap="round" stroke-linejoin="round"/>',
  "chevron-left": '<path d="M15 5l-7 7 7 7" stroke-linecap="round" stroke-linejoin="round"/>',
  dots: '<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  star: '<path d="M11.2 3.7c.3-.7.5-1 .8-1s.5.3.8 1l1.9 3.9c.1.2.2.3.3.4.1.1.2.1.5.2l4.3.6c.8.1 1.1.2 1.2.5.1.3-.1.6-.6 1.1l-3.1 3.1c-.2.2-.3.3-.3.5 0 .1 0 .3 0 .6l.7 4.2c.1.8.2 1.2 0 1.4-.3.2-.6 0-1.3-.3l-3.8-2c-.2-.1-.4-.2-.6-.2-.2 0-.3 0-.5.2l-3.8 2c-.7.4-1 .5-1.3.3-.2-.2-.1-.6 0-1.4l.7-4.2c0-.3 0-.4 0-.6 0-.2-.1-.3-.3-.5L2.6 11.3c-.5-.5-.8-.8-.6-1.1.1-.3.4-.4 1.2-.5l4.3-.6c.3 0 .4-.1.5-.2.1-.1.2-.2.3-.4l1.9-3.8Z" stroke-linejoin="round"/>',
  "star-fill": '<path d="M11.2 3.7c.3-.7.5-1 .8-1s.5.3.8 1l1.9 3.9c.1.2.2.3.3.4.1.1.2.1.5.2l4.3.6c.8.1 1.1.2 1.2.5.1.3-.1.6-.6 1.1l-3.1 3.1c-.2.2-.3.3-.3.5 0 .1 0 .3 0 .6l.7 4.2c.1.8.2 1.2 0 1.4-.3.2-.6 0-1.3-.3l-3.8-2c-.2-.1-.4-.2-.6-.2-.2 0-.3 0-.5.2l-3.8 2c-.7.4-1 .5-1.3.3-.2-.2-.1-.6 0-1.4l.7-4.2c0-.3 0-.4 0-.6 0-.2-.1-.3-.3-.5L2.6 11.3c-.5-.5-.8-.8-.6-1.1.1-.3.4-.4 1.2-.5l4.3-.6c.3 0 .4-.1.5-.2.1-.1.2-.2.3-.4l1.9-3.8Z" fill="currentColor" stroke-linejoin="round"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.8V12l2.6 1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  check: '<path d="M4.5 12.5 9 17 19.5 6.5" stroke-linecap="round" stroke-linejoin="round"/>',
  "check-circle": '<circle cx="12" cy="12" r="9"/><path d="M8 12.2 10.8 15 16 9.4" stroke-linecap="round" stroke-linejoin="round"/>',
  x: '<path d="M6 6l12 12M18 6 6 18" stroke-linecap="round"/>',
  move: '<path d="M11 4H7C5.3 4 4 5.3 4 7v10c0 1.7 1.3 3 3 3h4" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.5 8l4 4-4 4" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 12H9" stroke-linecap="round"/>',
  // chain-link glyph for share-link actions (two rounded halves with a gap)
  link: '<path d="M10.5 13.5a3.5 3.5 0 0 0 5.3.4l2-2a3.5 3.5 0 0 0-5-5l-1.1 1.1" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.5 10.5a3.5 3.5 0 0 0-5.3-.4l-2 2a3.5 3.5 0 0 0 5 5l1.1-1.1" stroke-linecap="round" stroke-linejoin="round"/>',
  cloud: '<path d="M6.6 19C4.1 19 2 17 2 14.5c0-2.3 1.7-4.2 3.9-4.5C6.6 6.9 9.5 4.5 13 4.5c3.9 0 7 3 7.3 6.8 1.6.5 2.7 2 2.7 3.7 0 2.2-1.8 4-4 4H6.6Z" stroke-linejoin="round"/>',
  home: '<path d="M3 10.4 12 3l9 7.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.2 9.2V17c0 1.7 1.3 3 3 3h7.6c1.7 0 3-1.3 3-3V9.2" stroke-linecap="round"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke-linecap="round"/>',
  "arrow-up": '<path d="M12 20V4m0 0 6 6m-6-6-6 6" stroke-linecap="round" stroke-linejoin="round"/>',
  "arrow-down": '<path d="M12 4v16m0 0 6-6m-6 6-6-6" stroke-linecap="round" stroke-linejoin="round"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16" stroke-linecap="round"/>',
  info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 16.5V11" stroke-linecap="round"/><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/>',
  eye: '<path d="M3.3 15.3C2.4 14.2 2 13.6 2 12s.4-2.2 1.3-3.3C5 6.5 7.8 4 12 4s7 2.5 8.7 4.7C21.6 9.8 22 10.4 22 12s-.4 2.2-1.3 3.3C19 17.5 16.2 20 12 20s-7-2.5-8.7-4.7Z"/><circle cx="12" cy="12" r="3"/>',
  // ── added locally (the prototype resolved these via the DS fallback) ──
  refresh: '<path d="M20 6.5A9 9 0 1 0 21.5 12" stroke-linecap="round"/><path d="M20.5 3v4h-4" stroke-linecap="round" stroke-linejoin="round"/>',
};

export type FbGlyphName = keyof typeof G | string;

export interface FbIconProps extends React.SVGProps<SVGSVGElement> {
  name: string;
  size?: number | string;
  strokeWidth?: number;
  label?: string;
}

export function FbIcon({ name, size = "1em", strokeWidth, style, className, label, ...rest }: FbIconProps) {
  const markup = G[name];
  const px = typeof size === "number" ? size + "px" : size;
  const a11y = label
    ? { role: "img" as const, "aria-label": label }
    : { "aria-hidden": true as const, focusable: false as const };
  const st: React.CSSProperties = {
    width: px,
    height: px,
    display: "inline-block",
    flex: "none",
    verticalAlign: "-0.14em",
    color: "inherit",
    ...(strokeWidth ? { strokeWidth } : null),
    ...style,
  };
  if (markup) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className={className}
        style={st}
        {...a11y}
        {...rest}
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    );
  }
  // unknown name: a dashed placeholder box (no DS fallback available here)
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} style={st} {...a11y}>
      <rect x={3} y={3} width={18} height={18} stroke="currentColor" strokeWidth={1.5} strokeDasharray="3 3" />
    </svg>
  );
}

export const FB_GLYPHS = G;
