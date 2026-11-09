// ListView.tsx — table listing. Ported from fb-views.jsx (ListView + Row + ListHead).

import type { FileEntry } from "@app/rpc-client";
import { FbIcon } from "./icons";
import { Checkbox } from "./ui";
import { RenameField } from "./RenameField";
import { useDrop } from "./drop";
import { KIND_META, kindOf, tagOf, fmtBytes, timeAgo } from "./kinds";
import { childPath, type ItemFlags, type ItemHandlers, type SortKey, type SortState } from "./types";

function Row({
  entry,
  flags,
  h,
  path,
}: {
  entry: FileEntry;
  flags: ItemFlags;
  h: ItemHandlers;
  path: string;
}) {
  const isDir = entry.kind === "dir";
  const destPath = childPath(path, entry.name);
  const [over, dh] = useDrop((e) => h.dropOnFolder(destPath, e), isDir && !flags.dragging);
  return (
    <div
      className={
        "fb-row" +
        (isDir ? " isdir" : "") +
        (flags.selected ? " sel" : "") +
        (over ? " drop-into" : "") +
        (flags.dragging ? " dragging" : "")
      }
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
      data-screen-label={isDir ? "Folder row" : "File row"}
    >
      <span onClick={(e) => e.stopPropagation()} style={{ display: "flex", justifyContent: "center" }}>
        <Checkbox on={flags.selected} onClick={(e) => h.onToggle(entry.id, e)} />
      </span>
      <span className="c-name">
        <span className="ic"><FbIcon name={(KIND_META[kindOf(entry)] ?? KIND_META.file).glyph} size={18} /></span>
        {flags.renaming ? (
          <RenameField entry={entry} onCommit={(v) => h.onRenameCommit(entry, v)} onCancel={h.onRenameCancel} />
        ) : (
          <span className="nm">{entry.name}</span>
        )}
        {entry.starred && <span className="st"><FbIcon name="star-fill" size={12} /></span>}
      </span>
      <span className="c-tag"><span>{tagOf(entry)}</span></span>
      <span className="c-size">{isDir ? "--" : fmtBytes(entry.sizeBytes)}</span>
      <span className="c-mod">{timeAgo(entry.modified)}</span>
      <span className="c-more">
        <button
          onClick={(e) => {
            e.stopPropagation();
            h.onContext(entry, e);
          }}
          aria-label="More actions"
        >
          <FbIcon name="dots" size={16} />
        </button>
      </span>
    </div>
  );
}

function ListHead({ sort, onSort }: { sort: SortState; onSort: (s: SortState) => void }) {
  const col = (key: SortKey, label: string, cls?: string) => (
    <button
      className={(sort.key === key ? "act " : "") + (cls || "")}
      onClick={() => onSort(sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" })}
    >
      <span>{label}</span>
      {sort.key === key && <FbIcon name={sort.dir === "asc" ? "arrow-up" : "arrow-down"} size={12} />}
    </button>
  );
  return (
    <div className="fb-listhead">
      <span />
      {col("name", "Name", "h-name")}
      {col("kind", "Type", "h-type")}
      {col("size", "Size", "r h-size")}
      {col("modified", "Modified", "r h-mod")}
      <span />
    </div>
  );
}

export function ListView({
  items,
  flagsFor,
  h,
  path,
  sort,
  onSort,
}: {
  items: FileEntry[];
  flagsFor: (entry: FileEntry) => ItemFlags;
  h: ItemHandlers;
  path: string;
  sort: SortState;
  onSort: (s: SortState) => void;
}) {
  return (
    <div role="grid">
      <ListHead sort={sort} onSort={onSort} />
      {items.map((n) => (
        <Row key={n.id} entry={n} flags={flagsFor(n)} h={h} path={path} />
      ))}
    </div>
  );
}
