// MoveDialog.tsx — "Move to…" folder picker. Ported from fb-ui.jsx, but the flat
// pre-walked tree is replaced by a LAZY tree: each branch fetches its child dirs from
// api.listDir(path) on expand (the path API has no cheap whole-tree walk). Targets are
// PATHS we control — the source parent (CURRENT) and any moving folder + its subtree
// are disabled, so we never need to parse an opaque id.

import React from "react";
import { useModalLayer } from "../shared/modal";
import type { DriveApi, FileEntry } from "@app/rpc-client";
import { useAsync } from "../hooks";
import { FbIcon } from "./icons";
import { childPath } from "./types";

interface BranchProps {
  api: DriveApi;
  path: string;
  name: string;
  depth: number;
  rev: number;
  target: string | null;
  isBlocked: (p: string) => boolean;
  isCurrent: (p: string) => boolean;
  onPick: (p: string) => void;
}

function Branch({ api, path, name, depth, rev, target, isBlocked, isCurrent, onPick }: BranchProps) {
  const [open, setOpen] = React.useState(false);
  const kids = useAsync<FileEntry[] | null>(
    () => (open ? api.listDir(path).then((d) => d.entries) : Promise.resolve(null)),
    [open, path, rev],
  );
  const dirs = (kids.data ?? [])
    .filter((e) => e.kind === "dir")
    .sort((a, b) => a.name.localeCompare(b.name));
  const disabled = isBlocked(path);
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", paddingLeft: depth * 16 }}>
        <button className="tw" onClick={() => setOpen((o) => !o)} aria-label={open ? "Collapse" : "Expand"}>
          <FbIcon name="chevron-right" size={13} style={{ transform: open ? "rotate(90deg)" : "none" }} />
        </button>
        <button
          className={"mv-item" + (target === path ? " on" : "")}
          disabled={disabled}
          style={{ flex: 1, minWidth: 0 }}
          onClick={() => onPick(path)}
        >
          <span className="ic"><FbIcon name="folder" size={16} /></span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
          {isCurrent(path) && (
            <span className="ind" style={{ marginLeft: "auto", fontSize: 9, letterSpacing: ".12em" }}>CURRENT</span>
          )}
        </button>
      </div>
      {open &&
        dirs.map((d) => (
          <Branch
            key={d.id}
            api={api}
            path={childPath(path, d.name)}
            name={d.name}
            depth={depth + 1}
            rev={rev}
            target={target}
            isBlocked={isBlocked}
            isCurrent={isCurrent}
            onPick={onPick}
          />
        ))}
    </>
  );
}

export function MoveDialog({
  api,
  movingEntries,
  sourcePath,
  rev,
  onMove,
  onClose,
}: {
  api: DriveApi;
  movingEntries: FileEntry[];
  sourcePath: string;
  rev: number;
  onMove: (targetPath: string) => void;
  onClose: () => void;
}) {
  const dlg = React.useRef<HTMLDivElement>(null);
  // Focus in on open, Tab stays inside, focus restored on close. Escape is central
  // (ModalProvider closes only the topmost layer).
  useModalLayer(true, onClose, dlg);
  const [target, setTarget] = React.useState<string | null>(null);
  const root = useAsync<FileEntry[]>(() => api.listDir("/").then((d) => d.entries), ["/", rev]);
  const rootDirs = (root.data ?? [])
    .filter((e) => e.kind === "dir")
    .sort((a, b) => a.name.localeCompare(b.name));

  // The moving folders' own paths (and their subtrees) can't be a destination.
  const movingFolderPaths = movingEntries
    .filter((e) => e.kind === "dir")
    .map((e) => childPath(sourcePath, e.name));
  const isBlocked = (p: string) => movingFolderPaths.some((mp) => p === mp || p.startsWith(mp + "/"));
  const isCurrent = (p: string) => p === sourcePath;
  const canMove = target !== null && target !== sourcePath && !isBlocked(target);

  const count = movingEntries.length;
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dlg} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-label="Move to">
        <div className="modal-h">
          <span className="t">Move {count} {count === 1 ? "item" : "items"}</span>
          <button className="x" onClick={onClose}><FbIcon name="x" size={16} /></button>
        </div>
        <div className="modal-body">
          <button
            className={"mv-item" + (target === "/" ? " on" : "")}
            disabled={sourcePath === "/"}
            onClick={() => setTarget("/")}
          >
            <span className="ic"><FbIcon name="cloud" size={16} /></span>
            <span>All files</span>
            {sourcePath === "/" && (
              <span className="ind" style={{ marginLeft: "auto", fontSize: 9, letterSpacing: ".12em" }}>CURRENT</span>
            )}
          </button>
          {rootDirs.map((d) => (
            <Branch
              key={d.id}
              api={api}
              path={childPath("/", d.name)}
              name={d.name}
              depth={0}
              rev={rev}
              target={target}
              isBlocked={isBlocked}
              isCurrent={isCurrent}
              onPick={setTarget}
            />
          ))}
        </div>
        <div className="modal-foot">
          <button className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" disabled={!canMove} onClick={() => target && onMove(target)}>
            Move here
          </button>
        </div>
      </div>
    </div>
  );
}
