// PreviewDrawer.tsx — single-item readout. Ported from fb-panels.jsx, wired to the
// real API: image previews fetch bytes via api.downloadFile → object URL (revoked on
// change/unmount); folder "Contains" counts come from an immediate api.listDir (not
// recursive — the path API has no recursive size/count). Folder SIZE uses the API's
// reported sizeBytes (may be 0) since a recursive walk isn't available. Dimensions are
// omitted (FileEntry carries no width/height).

import React from "react";
import type { DriveApi, FileEntry } from "@app/rpc-client";
import { useAsync } from "../hooks";
import { FbIcon } from "./icons";
import { KindGlyph } from "./ui";
import { KIND_META, kindOf, tagOf, fmtBytes, timeAgo, fmtDate, tileStyle } from "./kinds";

export interface PreviewActions {
  star: (e: FileEntry) => void;
  open: (e: FileEntry) => void;
  download: (e: FileEntry) => void;
  rename: (e: FileEntry) => void;
  move: (e: FileEntry) => void;
  remove: (e: FileEntry) => void;
  share: (e: FileEntry) => void;
}

export function PreviewDrawer({
  entry,
  api,
  rev,
  entryPath,
  location,
  inTrash,
  onClose,
  actions,
}: {
  entry: FileEntry | null;
  api: DriveApi;
  rev: number;
  entryPath: string | null;
  location: string;
  inTrash: boolean;
  onClose: () => void;
  actions: PreviewActions;
}) {
  const isDir = entry?.kind === "dir";
  const kind = entry ? kindOf(entry) : "file";
  const isImage = kind === "image";

  // image object-URL (E2EE bytes fetched on demand; revoked on change/unmount)
  const [imgUrl, setImgUrl] = React.useState<string | null>(null);
  const entryId = entry?.id;
  React.useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setImgUrl(null);
    if (entry && isImage) {
      api
        .downloadFile(entry.id)
        .then((bytes) => {
          if (cancelled) return;
          url = URL.createObjectURL(new Blob([bytes]));
          setImgUrl(url);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, isImage, api]);

  // immediate folder counts (not recursive)
  const counts = useAsync<{ files: number; folders: number } | null>(
    () =>
      entry && isDir && entryPath
        ? api.listDir(entryPath).then((d) => {
            let f = 0, dd = 0;
            d.entries.forEach((e) => (e.kind === "dir" ? dd++ : f++));
            return { files: f, folders: dd };
          })
        : Promise.resolve(null),
    [entryId, entryPath, isDir, rev],
  );

  if (!entry) {
    return (
      <aside className="fb-preview" data-screen-label="Preview">
        <div className="pv-head">
          <span className="t"><FbIcon name="eye" size={13} /> Preview</span>
          <button className="icon-btn ghost" onClick={onClose} aria-label="Close preview"><FbIcon name="x" size={15} /></button>
        </div>
        <div className="fb-empty" style={{ padding: "60px 20px" }}>
          <span className="ring"><FbIcon name="eye" size={22} /></span>
          <p>Select a single item to inspect its readout.</p>
        </div>
      </aside>
    );
  }

  const meta = KIND_META[kind] ?? KIND_META.file;
  const cnt = counts.data;
  const rows: { k: string; v: React.ReactNode }[] = [
    { k: "Type", v: <>{meta.label}{!isDir && <em>{tagOf(entry)}</em>}</> },
    { k: "Size", v: fmtBytes(entry.sizeBytes) },
    ...(isDir && cnt ? [{ k: "Contains", v: `${cnt.files} files · ${cnt.folders} folders` }] : []),
    { k: "Modified", v: timeAgo(entry.modified) },
    { k: "Date", v: fmtDate(entry.modified) },
    { k: "Location", v: location },
  ];

  const isMedia = kind === "image" || kind === "video";
  return (
    <aside className="fb-preview" data-screen-label="Preview">
      <div className="pv-head">
        <span className="t"><FbIcon name="eye" size={13} /> Preview</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button className="icon-btn ghost" onClick={() => actions.star(entry)} title="Star" aria-label="Star">
            <FbIcon name={entry.starred ? "star-fill" : "star"} size={15} style={entry.starred ? { color: "var(--amber)" } : undefined} />
          </button>
          <button className="icon-btn ghost" onClick={onClose} aria-label="Close preview"><FbIcon name="x" size={15} /></button>
        </div>
      </div>
      <div className="pv-thumb" style={isMedia && !imgUrl ? tileStyle(entry.name) : undefined}>
        {imgUrl ? (
          <img src={imgUrl} alt="" />
        ) : isDir ? (
          <span style={{ color: "var(--o)", display: "flex" }}>
            <FbIcon name={cnt && cnt.files + cnt.folders ? "folder-open" : "folder"} size={54} />
          </span>
        ) : (
          <span style={{ color: isMedia ? "var(--cream)" : "var(--fg-dim)", display: "flex" }}>
            <KindGlyph entry={entry} size={isMedia ? 40 : 52} />
          </span>
        )}
        {!isMedia && <div className="g" />}
      </div>
      <div className="pv-name">{entry.name}</div>
      <div className="pv-sub">
        <span>{meta.label}</span>
        <span className="crumb-sep">·</span>
        <span>{fmtBytes(entry.sizeBytes)}</span>
        {entry.starred && (
          <span style={{ color: "var(--amber)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <FbIcon name="star-fill" size={11} /> STARRED
          </span>
        )}
      </div>
      <div className="pv-readout">
        <div className="g" />
        <div className="pv-rhead"><span>◊ FILE READOUT</span><span className="live"><i />META</span></div>
        {rows.map((r) => (
          <div key={r.k} className="pv-row"><span className="k">{r.k}</span><span className="v">{r.v}</span></div>
        ))}
      </div>
      <div className="pv-actions">
        {isDir ? (
          <button className="btn btn-sm btn-primary wide" onClick={() => actions.open(entry)}>
            <FbIcon name="folder-open" size={15} /> Open folder
          </button>
        ) : (
          <button className="btn btn-sm btn-primary wide" onClick={() => actions.download(entry)}>
            <FbIcon name="download" size={15} /> Download
          </button>
        )}
        {!isDir && !inTrash && (
          <button className="btn btn-sm wide" onClick={() => actions.share(entry)}>
            <FbIcon name="link" size={14} /> Share link
          </button>
        )}
        <button className="btn btn-sm" onClick={() => actions.rename(entry)}><FbIcon name="pen" size={14} /> Rename</button>
        <button className="btn btn-sm" onClick={() => actions.move(entry)}><FbIcon name="move" size={15} /> Move</button>
        <button className="btn btn-sm wide" style={{ borderColor: "transparent", color: "var(--muted)" }} onClick={() => actions.remove(entry)}>
          <FbIcon name="trash" size={14} /> {inTrash ? "Delete forever" : "Move to trash"}
        </button>
      </div>
    </aside>
  );
}
