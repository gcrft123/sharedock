// SelectionBar.tsx — floating multi-select action bar. Ported from fb-panels.jsx.

import { FbIcon } from "./icons";
import { fmtBytes } from "./kinds";

export function SelectionBar({
  count,
  size,
  onDownload,
  onMove,
  onStar,
  onShare,
  onDelete,
  onRestore,
  onClear,
  inTrash,
  allStarred,
  canShare,
}: {
  count: number;
  size: number;
  onDownload: () => void;
  onMove: () => void;
  onStar: () => void;
  onShare: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onClear: () => void;
  inTrash: boolean;
  allStarred: boolean;
  /** Show the Share action (exactly one file selected, outside Trash). */
  canShare: boolean;
}) {
  return (
    <div className="fb-selbar" role="toolbar" aria-label="Selection actions">
      <span className="n">
        <b>{count}</b> {count === 1 ? "ITEM" : "ITEMS"}{size ? " · " + fmtBytes(size) : ""}
      </span>
      <button className="sb-act" onClick={onDownload}><FbIcon name="download" size={15} /> Download</button>
      {canShare && (
        <button className="sb-act" onClick={onShare}><FbIcon name="link" size={15} /> Share</button>
      )}
      <button className="sb-act" onClick={onMove}><FbIcon name="move" size={15} /> Move</button>
      <button className="sb-act" onClick={onStar}>
        <FbIcon name={allStarred ? "star-fill" : "star"} size={15} style={allStarred ? { color: "var(--amber)" } : undefined} />{" "}
        {allStarred ? "Unstar" : "Star"}
      </button>
      {inTrash && (
        <button className="sb-act" onClick={onRestore}>
          <FbIcon name="check-circle" size={15} /> Restore
        </button>
      )}
      <button className="sb-act danger" onClick={onDelete}>
        <FbIcon name="trash" size={14} /> {inTrash ? "Delete" : "Trash"}
      </button>
      <button className="sb-act x" onClick={onClear} aria-label="Clear selection"><FbIcon name="x" size={15} /></button>
    </div>
  );
}
