// EmptyState.tsx — empty-listing placeholders (search / trash / starred / folder).
// Ported from fb-panels.jsx.

import { FbIcon } from "./icons";
import type { ViewType } from "./types";

export function EmptyState({
  searching,
  view,
  onUpload,
}: {
  searching: boolean;
  view: ViewType;
  onUpload: () => void;
}) {
  if (searching)
    return (
      <div className="fb-empty">
        <span className="ring"><FbIcon name="search" size={22} /></span>
        <h3>No matches</h3>
        <p>No files match this search and filter in the current scope.</p>
      </div>
    );
  if (view === "trash")
    return (
      <div className="fb-empty">
        <span className="ring"><FbIcon name="trash" size={22} /></span>
        <h3>Trash is empty</h3>
        <p>Deleted items land here. Nothing to recover.</p>
      </div>
    );
  if (view === "starred")
    return (
      <div className="fb-empty">
        <span className="ring"><FbIcon name="star" size={22} /></span>
        <h3>Nothing starred</h3>
        <p>Star files and folders to pin them to this list.</p>
      </div>
    );
  return (
    <div className="fb-empty">
      <span className="ring"><FbIcon name="folder-open" size={22} /></span>
      <h3>Empty folder</h3>
      <p>Drop files here to upload, or create a new folder.</p>
      <button className="btn btn-sm" onClick={onUpload} style={{ marginTop: 4 }}>
        <FbIcon name="upload" size={15} /> Upload files
      </button>
    </div>
  );
}
