// Subbar.tsx — breadcrumb + view controls (grid/list, preview toggle).
// Ported from fb-panels.jsx. Crumbs are built from the navigation `path`.

import React from "react";
import { FbIcon } from "./icons";
import { useDrop } from "./drop";
import type { ViewType } from "./types";

export interface Crumb {
  name: string;
  path: string;
}

function CrumbButton({
  label,
  icon,
  cur,
  onClick,
  onDrop,
  canDrop,
}: {
  label: string;
  icon?: string;
  cur?: boolean;
  onClick?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  canDrop?: boolean;
}) {
  const [over, dh] = useDrop((e) => onDrop && onDrop(e), !!canDrop && !!onDrop);
  return (
    <button className={"crumb" + (cur ? " cur" : "") + (over ? " drop-into" : "")} onClick={cur ? undefined : onClick} {...dh}>
      {icon && <FbIcon name={icon} size={14} />}
      <span>{label}</span>
    </button>
  );
}

export function Subbar({
  crumbs,
  onCrumb,
  view,
  viewMode,
  onViewMode,
  previewOpen,
  onTogglePreview,
  onDropInto,
  onToggleSidebar,
}: {
  crumbs: Crumb[];
  onCrumb: (path: string) => void;
  view: ViewType;
  viewMode: "grid" | "list";
  onViewMode: (m: "grid" | "list") => void;
  previewOpen: boolean;
  onTogglePreview: () => void;
  onDropInto: (destPath: string, e: React.DragEvent) => void;
  onToggleSidebar: () => void;
}) {
  return (
    <div className="fb-subbar" data-screen-label="Location bar">
      <button className="sb-reexpand" title="Expand sidebar" aria-label="Expand sidebar" onClick={onToggleSidebar}>
        <FbIcon name="chevron-right" size={16} />
      </button>
      <nav className="crumbs" aria-label="Breadcrumb">
        {view === "folder" ? (
          <>
            <CrumbButton
              label="All files"
              icon="cloud"
              cur={crumbs.length === 0}
              onClick={() => onCrumb("/")}
              onDrop={(e) => onDropInto("/", e)}
              canDrop
            />
            {crumbs.map((c, i) => (
              <React.Fragment key={c.path}>
                <span className="crumb-sep"><FbIcon name="chevron-right" size={12} /></span>
                <CrumbButton
                  label={c.name}
                  cur={i === crumbs.length - 1}
                  onClick={() => onCrumb(c.path)}
                  onDrop={(e) => onDropInto(c.path, e)}
                  canDrop={i !== crumbs.length - 1}
                />
              </React.Fragment>
            ))}
          </>
        ) : (
          <CrumbButton
            label={view === "recent" ? "Recent" : view === "starred" ? "Starred" : "Trash"}
            icon={view === "recent" ? "clock" : view === "starred" ? "star" : "trash"}
            cur
          />
        )}
      </nav>
      <div className="subbar-right">
        <div className="chip-seg" role="group" aria-label="View">
          <button className={viewMode === "grid" ? "on" : ""} onClick={() => onViewMode("grid")} aria-pressed={viewMode === "grid"} title="Grid view">
            <FbIcon name="view-grid" size={14} />
          </button>
          <button className={viewMode === "list" ? "on" : ""} onClick={() => onViewMode("list")} aria-pressed={viewMode === "list"} title="List view">
            <FbIcon name="view-list" size={14} />
          </button>
        </div>
        <button className={"icon-btn" + (previewOpen ? " on" : "")} title="Toggle preview" aria-label="Toggle preview panel" onClick={onTogglePreview}>
          <FbIcon name="eye" size={16} />
        </button>
      </div>
    </div>
  );
}
