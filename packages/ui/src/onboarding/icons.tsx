// Icon set ported from the onboarding prototype's `I{}` map — SVG bodies copied
// verbatim from the built onboarding.html. Rendered as <ObIcon name size?/>, a
// 24x24 viewBox / fill=none wrapper like the prototype. `arrow` is the glyph span.

const BODY: Record<string, string> = {
  key: "<path fill=\"currentColor\" fill-rule=\"evenodd\" d=\"M22 8.293c0 3.476-2.83 6.294-6.32 6.294c-.636 0-2.086-.146-2.791-.732l-.882.878c-.519.517-.379.669-.148.919c.096.105.208.226.295.399c0 0 .735 1.024 0 2.049c-.441.585-1.676 1.404-3.086 0l-.294.292s.881 1.025.147 2.05c-.441.585-1.617 1.17-2.646.146l-1.028 1.024c-.706.703-1.568.293-1.91 0l-.883-.878c-.823-.82-.343-1.708 0-2.05l7.642-7.61s-.735-1.17-.735-2.78c0-3.476 2.83-6.294 6.32-6.294S22 4.818 22 8.293m-6.319 2.196a2.2 2.2 0 0 0 2.204-2.195a2.2 2.2 0 0 0-2.204-2.196a2.2 2.2 0 0 0-2.204 2.196a2.2 2.2 0 0 0 2.204 2.195\" clip-rule=\"evenodd\"/>",
  laptop: "<g fill=\"none\"><path stroke=\"currentColor\" stroke-linecap=\"round\" stroke-width=\"1.5\" d=\"M19.647 15.536H4.353m15.294 0V8c0-1.886 0-2.828-.586-3.414C18.476 4 17.533 4 15.647 4H8.353c-1.886 0-2.828 0-3.414.586S4.353 6.114 4.353 8v7.536m15.294 0l1.744 1.8l.088.092a2 2 0 0 1 .52 1.284l.001.127c0 .15 0 .224-.004.287a2 2 0 0 1-1.87 1.87a5 5 0 0 1-.287.004H4.161c-.15 0-.224 0-.287-.004a2 2 0 0 1-1.87-1.87C2 19.063 2 18.988 2 18.84l.001-.127a2 2 0 0 1 .52-1.284l.088-.092l1.744-1.8M9.5 18.5h5\"/><path fill=\"currentColor\" d=\"M12.75 6.75a.75.75 0 1 1-1.5 0a.75.75 0 0 1 1.5 0\"/></g>",
  tower: "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M2 17c0-1.886 0-2.828.586-3.414S4.114 13 6 13h12c1.886 0 2.828 0 3.414.586S22 15.114 22 17s0 2.828-.586 3.414S19.886 21 18 21H6c-1.886 0-2.828 0-3.414-.586S2 18.886 2 17ZM2 6c0-1.886 0-2.828.586-3.414S4.114 2 6 2h12c1.886 0 2.828 0 3.414.586S22 4.114 22 6s0 2.828-.586 3.414S19.886 10 18 10H6c-1.886 0-2.828 0-3.414-.586S2 7.886 2 6Z\"/><path stroke-linecap=\"round\" d=\"M11 6h7M6 6h2m3 11h7M6 17h2\"/></g>",
  // NAS/tower-server with vertical drive bays — deliberately distinct from `tower` (which is
  // two stacked horizontal bays). They shared identical path data before, so the icon picker
  // showed the same glyph twice.
  server: "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><rect x=\"4\" y=\"2.5\" width=\"16\" height=\"19\" rx=\"2\"/><path stroke-linecap=\"round\" d=\"M8.5 6v12M12 6v12M15.5 6v12\"/></g>",
  phone: "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M4 10c0-3.771 0-5.657 1.172-6.828S8.229 2 12 2s5.657 0 6.828 1.172S20 6.229 20 10v4c0 3.771 0 5.657-1.172 6.828S15.771 22 12 22s-5.657 0-6.828-1.172S4 17.771 4 14z\"/><path stroke-linecap=\"round\" d=\"M15 19H9\"/></g>",
  shield: "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M3 10.417c0-3.198 0-4.797.378-5.335c.377-.537 1.88-1.052 4.887-2.081l.573-.196C10.405 2.268 11.188 2 12 2s1.595.268 3.162.805l.573.196c3.007 1.029 4.51 1.544 4.887 2.081C21 5.62 21 7.22 21 10.417v1.574c0 5.638-4.239 8.375-6.899 9.536C13.38 21.842 13.02 22 12 22s-1.38-.158-2.101-.473C7.239 20.365 3 17.63 3 11.991z\"/><path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"m9.5 12.4l1.429 1.6l3.571-4\"/></g>",
  drive: "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M21.553 15.481L19 5.118C18.5 3.529 17.605 3 16.5 3h-9c-1.105 0-2 .53-2.5 2.118L2.447 15.48m19.106 0c-.6-1.13-1.742-1.893-3.053-1.893h-13c-1.311 0-2.454.764-3.053 1.893m19.106 0A3.86 3.86 0 0 1 22 17.294C22 19.341 20.433 21 18.5 21h-13C3.567 21 2 19.34 2 17.294c0-.658.162-1.277.447-1.813\"/><path stroke-linecap=\"round\" d=\"M18 17v1m-2.5-1v1M13 17v1m-2.5-1v1\"/></g>",
  info: "<g fill=\"none\"><circle cx=\"12\" cy=\"12\" r=\"10\" stroke=\"currentColor\" stroke-width=\"1.5\"/><path stroke=\"currentColor\" stroke-linecap=\"round\" stroke-width=\"1.5\" d=\"M12 17v-6\"/><circle cx=\"1\" cy=\"1\" r=\"1\" fill=\"currentColor\" transform=\"matrix(1 0 0 -1 11 9)\"/></g>",
  plus: "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M2 12c0-4.714 0-7.071 1.464-8.536C4.93 2 7.286 2 12 2s7.071 0 8.535 1.464C22 4.93 22 7.286 22 12s0 7.071-1.465 8.535C19.072 22 16.714 22 12 22s-7.071 0-8.536-1.465C2 19.072 2 16.714 2 12Z\"/><path stroke-linecap=\"round\" d=\"M15 12h-3m0 0H9m3 0V9m0 3v3\"/></g>",
  copy: "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><path d=\"M6 11c0-2.828 0-4.243.879-5.121C7.757 5 9.172 5 12 5h3c2.828 0 4.243 0 5.121.879C21 6.757 21 8.172 21 11v5c0 2.828 0 4.243-.879 5.121C19.243 22 17.828 22 15 22h-3c-2.828 0-4.243 0-5.121-.879C6 20.243 6 18.828 6 16z\"/><path d=\"M6 19a3 3 0 0 1-3-3v-6c0-3.771 0-5.657 1.172-6.828S7.229 2 11 2h4a3 3 0 0 1 3 3\"/></g>",
  check: "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"3.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M20 6 9 17l-5-5\"/></g>",
  pause: "<path fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" d=\"M2 6c0-1.886 0-2.828.586-3.414S4.114 2 6 2s2.828 0 3.414.586S10 4.114 10 6v12c0 1.886 0 2.828-.586 3.414S7.886 22 6 22s-2.828 0-3.414-.586S2 19.886 2 18zm12 0c0-1.886 0-2.828.586-3.414S16.114 2 18 2s2.828 0 3.414.586S22 4.114 22 6v12c0 1.886 0 2.828-.586 3.414S19.886 22 18 22s-2.828 0-3.414-.586S14 19.886 14 18z\"/>",
  play: "<path fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" d=\"M20.409 9.353a2.998 2.998 0 0 1 0 5.294L7.597 21.614C5.534 22.737 3 21.277 3 18.968V5.033c0-2.31 2.534-3.769 4.597-2.648z\"/>",
};

const SIZE: Record<string, number> = {
  key: 20,
  laptop: 20,
  tower: 20,
  server: 20,
  phone: 18,
  shield: 16,
  drive: 16,
  info: 15,
  plus: 18,
  copy: 13,
  check: 12,
  pause: 16,
  play: 16,
};

export type ObIconName = keyof typeof BODY | "arrow";

/** Maps a host "kind" to its glyph (prototype KIC map). */
export const KIND_ICON: Record<string, ObIconName> = { this: "laptop", other: "server", joined: "tower" };

export function ObIcon({ name, size }: { name: ObIconName; size?: number }): JSX.Element {
  if (name === "arrow") return <span className="btn-arrow">&rarr;</span>;
  const s = size ?? SIZE[name] ?? 18;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      dangerouslySetInnerHTML={{ __html: BODY[name] || "" }}
    />
  );
}
