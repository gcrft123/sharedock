// Toolbar.tsx — top chrome: menu, wordmark, search, upload/new. Ported from
// fb-panels.jsx. RE-SKIN: the prototype wordmark "HALFSTEEL /// DRIVE®" becomes
// "SHAREDOCK /// DRIVE®" (same treatment + cloud mark).

import React from "react";
import { FbIcon } from "./icons";

export function Toolbar({
  onMenu,
  query,
  onQuery,
  onUpload,
  onNewFolder,
  onManageShares,
  showEmptyTrash,
  onEmptyTrash,
}: {
  onMenu: () => void;
  query: string;
  onQuery: (v: string) => void;
  onUpload: (files: FileList) => void;
  onNewFolder: () => void;
  onManageShares: () => void;
  showEmptyTrash: boolean;
  onEmptyTrash: () => void;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  return (
    <header className="fb-toolbar" data-screen-label="Toolbar">
      <button className="icon-btn ghost fb-menu-btn" title="Menu" onClick={onMenu} aria-label="Toggle sidebar">
        <FbIcon name="menu" size={17} />
      </button>
      <a className="fb-brand" href="#" onClick={(e) => e.preventDefault()}>
        <span className="mk"><FbIcon name="cloud" size={17} /></span>
        <span><b>SHAREDOCK</b> <span className="sub">/// DRIVE</span></span>
        <sup>®</sup>
      </a>
      <div className="fb-tspace" />
      <label className="fb-search">
        <FbIcon name="search" size={15} />
        <input
          type="text"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search files"
          aria-label="Search files"
          spellCheck={false}
        />
        {query && (
          <button className="clr" onClick={() => onQuery("")} aria-label="Clear search">
            <FbIcon name="x" size={13} />
          </button>
        )}
      </label>
      <input
        ref={fileRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files) onUpload(e.target.files);
          e.target.value = "";
        }}
      />
      {showEmptyTrash && (
        <button className="btn btn-sm" onClick={onEmptyTrash} style={{ borderColor: "transparent", color: "var(--muted)" }}>
          <FbIcon name="trash" size={15} /> Empty trash
        </button>
      )}
      <button className="btn btn-sm" onClick={onManageShares} title="Manage shared links" aria-label="Manage shared links">
        <FbIcon name="link" size={15} /> Shares
      </button>
      <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
        <FbIcon name="upload" size={15} /> Upload
      </button>
      <button className="btn btn-sm btn-primary" onClick={onNewFolder}>
        <FbIcon name="folder-plus" size={15} /> New
      </button>
    </header>
  );
}
