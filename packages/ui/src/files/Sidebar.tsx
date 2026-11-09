// Sidebar.tsx — locations (All files / Recent / Starred / Trash) + a LAZY folder
// tree. Ported from fb-panels.jsx. The prototype walked an in-memory tree; here each
// tree node fetches its child dirs from api.listDir(path) when expanded, keyed on
// `rev` so it re-lists after mutations. Nodes are keyed by PATH (opaque ids untouched).

import React from "react";
import type { DriveApi, FileEntry } from "@app/rpc-client";
import { useAsync } from "../hooks";
import { FbIcon } from "./icons";
import { useDrop } from "./drop";
import { childPath, type ViewType } from "./types";

function Loc({
  icon,
  label,
  active,
  count,
  onClick,
  onDrop,
  canDrop,
}: {
  icon: string;
  label: string;
  active: boolean;
  count?: number | null;
  onClick: () => void;
  onDrop?: (e: React.DragEvent) => void;
  canDrop?: boolean;
}) {
  const [over, dh] = useDrop((e) => onDrop && onDrop(e), !!canDrop && !!onDrop);
  return (
    <button className={"sb-item" + (active ? " on" : "") + (over ? " drop-into" : "")} onClick={onClick} {...dh}>
      <span className="ic"><FbIcon name={icon} size={17} /></span>
      <span className="nm">{label}</span>
      {count != null && <span className="ct">{count}</span>}
    </button>
  );
}

interface TreeNodeProps {
  api: DriveApi;
  rev: number;
  path: string;
  name: string;
  view: ViewType;
  curPath: string;
  expanded: Set<string>;
  onNavigate: (view: ViewType, path?: string) => void;
  onToggle: (path: string) => void;
  onDropInto: (destPath: string, e: React.DragEvent) => void;
}

function TreeNode({ api, rev, path, name, view, curPath, expanded, onNavigate, onToggle, onDropInto }: TreeNodeProps) {
  const isOpen = expanded.has(path);
  const active = view === "folder" && curPath === path;
  const [over, dh] = useDrop((e) => onDropInto(path, e));
  const kids = useAsync<FileEntry[]>(
    () =>
      isOpen
        ? api.listDir(path).then((d) => d.entries.filter((e) => e.kind === "dir").sort((a, b) => a.name.localeCompare(b.name)))
        : Promise.resolve([]),
    [isOpen, path, rev],
  );
  const dirs = kids.data ?? [];
  return (
    <div>
      <div className="sb-tree-row">
        {/* The twist is always shown: the path API can't cheaply tell if a folder has
            subfolders without a fetch, so we let expand reveal an empty branch. */}
        <button className="tw" onClick={() => onToggle(path)} aria-label={isOpen ? "Collapse" : "Expand"}>
          <FbIcon name="chevron-right" size={13} style={{ transform: isOpen ? "rotate(90deg)" : "none" }} />
        </button>
        <button
          className={"sb-item" + (active ? " on" : "") + (over ? " drop-into" : "")}
          onClick={() => onNavigate("folder", path)}
          {...dh}
          style={{ paddingLeft: 4 }}
        >
          <span className="ic"><FbIcon name={active || isOpen ? "folder-open" : "folder"} size={16} /></span>
          <span className="nm">{name}</span>
        </button>
      </div>
      {isOpen && dirs.length > 0 && (
        <div>
          {dirs.map((k) => (
            <TreeNode
              key={k.id}
              api={api}
              rev={rev}
              path={childPath(path, k.name)}
              name={k.name}
              view={view}
              curPath={curPath}
              expanded={expanded}
              onNavigate={onNavigate}
              onToggle={onToggle}
              onDropInto={onDropInto}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  api,
  rev,
  view,
  path,
  expanded,
  starCount,
  trashCount,
  onNavigate,
  onToggle,
  onDropInto,
  onReload,
  onCollapse,
}: {
  api: DriveApi;
  rev: number;
  view: ViewType;
  path: string;
  expanded: Set<string>;
  starCount: number;
  trashCount: number;
  onNavigate: (view: ViewType, path?: string) => void;
  onToggle: (path: string) => void;
  onDropInto: (destPath: string, e: React.DragEvent) => void;
  onReload: () => void;
  onCollapse: () => void;
}) {
  const roots = useAsync<FileEntry[]>(
    () => api.listDir("/").then((d) => d.entries.filter((e) => e.kind === "dir").sort((a, b) => a.name.localeCompare(b.name))),
    ["/", rev],
  );
  return (
    <aside className="fb-sidebar" data-screen-label="Sidebar">
      <div className="sb-headbar">
        <button className="icon-btn ghost" title="Collapse sidebar" aria-label="Collapse sidebar" onClick={onCollapse}>
          <FbIcon name="chevron-left" size={16} />
        </button>
      </div>
      <div className="sb-scroll">
        <div className="sb-group">
          <div className="sb-h">Locations</div>
          <Loc
            icon="cloud"
            label="All files"
            active={view === "folder" && path === "/"}
            onClick={() => onNavigate("folder", "/")}
            onDrop={(e) => onDropInto("/", e)}
            canDrop
          />
          <Loc icon="clock" label="Recent" active={view === "recent"} onClick={() => onNavigate("recent")} />
          <Loc icon="star" label="Starred" active={view === "starred"} count={starCount || null} onClick={() => onNavigate("starred")} />
          <Loc
            icon="trash"
            label="Trash"
            active={view === "trash"}
            count={trashCount || null}
            onClick={() => onNavigate("trash")}
            onDrop={(e) => onDropInto("trash", e)}
            canDrop
          />
        </div>
        <div className="sb-group">
          <div className="sb-h">Folders</div>
          {(roots.data ?? []).map((r) => (
            <TreeNode
              key={r.id}
              api={api}
              rev={rev}
              path={childPath("/", r.name)}
              name={r.name}
              view={view}
              curPath={path}
              expanded={expanded}
              onNavigate={onNavigate}
              onToggle={onToggle}
              onDropInto={onDropInto}
            />
          ))}
        </div>
      </div>
      <div className="sb-foot">
        <span className="mono">SHAREDOCK DRIVE</span>
        <button className="icon-btn ghost" title="Refresh" aria-label="Refresh" onClick={onReload}>
          <FbIcon name="refresh" size={15} />
        </button>
      </div>
    </aside>
  );
}
