// RenameField.tsx — inline rename input, shared by grid tiles and list rows.
// Ported from the prototype's RenameField in fb-views.jsx.

import React from "react";
import type { FileEntry } from "@app/rpc-client";

export function RenameField({
  entry,
  onCommit,
  onCancel,
}: {
  entry: FileEntry;
  onCommit: (name: string | null) => void;
  onCancel: () => void;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = entry.kind === "file" ? entry.name.lastIndexOf(".") : -1;
    el.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const commit = () => {
    const v = ref.current?.value.trim() ?? "";
    onCommit(v && v !== entry.name ? v : null);
  };
  return (
    <input
      ref={ref}
      className="rename"
      defaultValue={entry.name}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") onCancel();
      }}
      onBlur={commit}
    />
  );
}
