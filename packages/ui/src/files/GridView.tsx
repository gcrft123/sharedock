// GridView.tsx — grid of tiles. Ported from fb-views.jsx (GridView + Tile). The last
// incomplete row is padded with inert filler cells so the grid gap color doesn't show.
// Folder child-counts aren't shown in the grid (the path API has no cheap count per
// folder without a fetch-per-tile); the tile reads "FOLDER" instead.

import React from "react";
import type { FileEntry } from "@app/rpc-client";
import { FbIcon } from "./icons";
import { Thumb, Checkbox } from "./ui";
import { RenameField } from "./RenameField";
import { useDrop } from "./drop";
import { fmtBytes, timeAgo } from "./kinds";
import { childPath, type ItemFlags, type ItemHandlers } from "./types";

function Tile({
  entry,
  flags,
  url,
  h,
  path,
}: {
  entry: FileEntry;
  flags: ItemFlags;
  url?: string;
  h: ItemHandlers;
  path: string;
}) {
  const isDir = entry.kind === "dir";
  const destPath = childPath(path, entry.name);
  const [over, dh] = useDrop((e) => h.dropOnFolder(destPath, e), isDir && !flags.dragging);
  return (
    <div
      className={"fb-tile" + (flags.selected ? " sel" : "") + (over ? " drop-into" : "") + (flags.dragging ? " dragging" : "")}
      role="button"
      tabIndex={0}
      draggable={!flags.renaming}
      onDragStart={(e) => h.onDragStart(entry.id, e)}
      onDragEnd={h.onDragEnd}
      onClick={(e) => h.onSelect(entry.id, e)}
      onDoubleClick={() => h.onOpen(entry)}
      onContextMenu={(e) => h.onContext(entry, e)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          h.onOpen(entry);
        }
      }}
      {...dh}
      aria-pressed={flags.selected}
      data-screen-label={isDir ? "Folder tile" : "File tile"}
    >
      <span className="cross">+</span>
      <span className="tile-check">
        <Checkbox on={flags.selected} onClick={(e) => h.onToggle(entry.id, e)} />
      </span>
      {entry.starred && <span className="tile-star"><FbIcon name="star-fill" size={13} /></span>}
      <Thumb entry={entry} url={url} count={null} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {flags.renaming ? (
          <RenameField entry={entry} onCommit={(v) => h.onRenameCommit(entry, v)} onCancel={h.onRenameCancel} />
        ) : (
          <span className="tile-name">{entry.name}</span>
        )}
        <span className="tile-meta">
          <span>{isDir ? "FOLDER" : fmtBytes(entry.sizeBytes)}</span>
          <span className="dotsep">·</span>
          <span>{timeAgo(entry.modified)}</span>
        </span>
      </div>
    </div>
  );
}

export function GridView({
  items,
  flagsFor,
  urls,
  h,
  path,
}: {
  items: FileEntry[];
  flagsFor: (entry: FileEntry) => ItemFlags;
  urls: Record<string, string>;
  h: ItemHandlers;
  path: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [cols, setCols] = React.useState(1);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const tpl = getComputedStyle(el).gridTemplateColumns;
      const n = tpl ? tpl.split(" ").filter(Boolean).length : 1;
      setCols(n || 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items.length]);
  const fillers = items.length ? (cols - (items.length % cols)) % cols : 0;
  return (
    <div className="fb-grid" role="grid" ref={ref}>
      {items.map((n) => (
        <Tile key={n.id} entry={n} flags={flagsFor(n)} url={urls[n.id]} h={h} path={path} />
      ))}
      {Array.from({ length: fillers }).map((_, i) => (
        <div key={"flr" + i} className="fb-tile filler" aria-hidden="true">
          <span className="cross">+</span>
        </div>
      ))}
    </div>
  );
}
