// ui.tsx — shared presentational bits: KindGlyph, Thumb, Checkbox. Ported from the
// prototype's fb-ui.jsx, adapted to the real FileEntry shape (kind/sizeBytes).

import React from "react";
import type { FileEntry } from "@app/rpc-client";
import { FbIcon } from "./icons";
import { KIND_META, kindOf, tagOf, tileStyle } from "./kinds";

export function KindGlyph({ entry, size }: { entry: FileEntry; size?: number | string }) {
  const meta = KIND_META[kindOf(entry)] ?? KIND_META.file;
  return <FbIcon name={meta.glyph} size={size} />;
}

// Thumbnail block. `url` = a real object-URL for an image preview. `count` = folder
// child count (null when unknown — the sidebar-tree lazy model doesn't precount).
export function Thumb({ entry, url, count }: { entry: FileEntry; url?: string; count: number | null }) {
  const kind = kindOf(entry);
  if (kind === "folder") {
    return (
      <div className="thumb folder">
        <FbIcon name={count === 0 ? "folder" : "folder-open"} size={34} />
        <div className="g" />
        {count != null && <span className="fcount">{count} {count === 1 ? "ITEM" : "ITEMS"}</span>}
      </div>
    );
  }
  const isMedia = kind === "image" || kind === "video";
  if (isMedia) {
    return (
      <div className="thumb" style={url ? undefined : tileStyle(entry.name)}>
        {url ? <img src={url} alt="" /> : null}
        {kind === "video" && (
          <span
            style={{
              position: "relative",
              display: "flex",
              width: 40,
              height: 40,
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid var(--line-ember)",
              borderRadius: 999,
              background: "rgba(10,10,10,.5)",
              color: "var(--cream)",
            }}
          >
            <FbIcon name="video" size={19} />
          </span>
        )}
        <span className="tag">{tagOf(entry)}</span>
      </div>
    );
  }
  return (
    <div className="thumb">
      <KindGlyph entry={entry} size={34} />
      <div className="g" />
      <span className="tag">{tagOf(entry)}</span>
    </div>
  );
}

export function Checkbox({ on, onClick, title }: { on: boolean; onClick: (e: React.MouseEvent) => void; title?: string }) {
  return (
    <span
      className={on ? "cbx on" : "cbx"}
      role="checkbox"
      aria-checked={on}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
    >
      <FbIcon name="check" size={11} strokeWidth={2.4} />
    </span>
  );
}
