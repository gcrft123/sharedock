import "./files.css";

import React from "react";
import type { FileEntry } from "@app/rpc-client";
import { MAX_SHARE_BYTES } from "@app/rpc-client";
import { useApi } from "../shared/ApiProvider";
import { useAnyModalOpen } from "../shared/modal";
import { share } from "../shared/share";
import { useAsync, useTransfers } from "../hooks";
import { FbIcon } from "./icons";
import { FILTERS, kindOf } from "./kinds";
import { fmtBytes } from "./kinds";
import { FB_IDS_MIME, useDrop } from "./drop";
import { parentPathOf } from "./types";
import { dedupePaths, makeZip, safeZipPath, type ZipEntry } from "./zip";
import { Toolbar } from "./Toolbar";
import { Sidebar } from "./Sidebar";
import { Subbar, type Crumb } from "./Subbar";
import { FilterChips } from "./FilterChips";
import { GridView } from "./GridView";
import { ListView } from "./ListView";
import { PreviewDrawer, type PreviewActions } from "./PreviewDrawer";
import { SelectionBar } from "./SelectionBar";
import { EmptyState } from "./EmptyState";
import { ContextMenu } from "./ContextMenu";
import { MoveDialog } from "./MoveDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { ShareDialog } from "./ShareDialog";
import { SharesDialog } from "./SharesDialog";
import { Toasts, useToasts } from "./Toasts";
import {
  childPath,
  pathSegments,
  type ConfirmRequest,
  type ContextMenuItem,
  type ItemFlags,
  type ItemHandlers,
  type SortState,
  type ViewType,
} from "./types";

// ── The real file browser. Ported faithfully from the file-browser prototype and
// wired to the path-based DriveApi (via useApi). Navigation state (`path` + `view`)
// is the source of truth; entry ids are treated as OPAQUE and never parsed.
//
// Recent / Starred / Search are now GLOBAL (whole-partition, recursive) via the
// dedicated RPCs — api.listRecent() / api.listStarred() / api.search(query) — instead
// of filtering the current folder. The type-filter chips + sort stay client-side over
// whatever the active listing returns.
//
// Entries in a global view can live in any folder, and `FileEntry.path` is how they say so.
// The id is NOT used for this: the mock and the real host encode ids differently, so parsing
// one would break against the other. With a real path, open-into-folder, rename and
// recursive download work from Recent, Starred and Search exactly as they do in a folder.
// `pathResolvable` survives only as the fallback for hosts that predate the field; the
// per-entry test is `canResolve`.
//   • Folder download produces a real .zip with the structure intact (see `zip.ts`).
//   • Grid tiles show "FOLDER" (no cheap per-folder child count).
//   • Move has no Undo (a real host's id == path changes on move; the old id goes stale).
//
// Share links: a single selected FILE can be published as a zero-knowledge link via the
// app-wide ShareClient (share()); "Manage shares" lists/revokes them.

const errText = (prefix: string, err: unknown): string =>
  `${prefix}: ${err instanceof Error ? err.message : String(err)}`;

function uniqueName(name: string, siblings: string[]): string {
  const lower = siblings.map((s) => s.toLowerCase());
  if (!lower.includes(name.toLowerCase())) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let i = 2;
  while (lower.includes((stem + " (" + i + ")" + ext).toLowerCase())) i++;
  return stem + " (" + i + ")" + ext;
}

export function Files(): JSX.Element {
  const { api, rev, reload } = useApi();
  const { toasts, push, dismiss } = useToasts();
  // True while any modal layer is open, including ones this page doesn't own (Settings).
  const anyModalOpen = useAnyModalOpen();

  // ── navigation + view state (path is the source of truth) ──
  const [path, setPath] = React.useState("/");
  const [view, setView] = React.useState<ViewType>("folder");
  const [selection, setSelection] = React.useState<Set<string>>(() => new Set());
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState("all");
  const [sort, setSort] = React.useState<SortState>({ key: "name", dir: "asc" });
  const [viewMode, setViewMode] = React.useState<"grid" | "list">("grid");
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [ctx, setCtx] = React.useState<{ x: number; y: number; entries: FileEntry[]; entry: FileEntry | null } | null>(null);
  const [moveReq, setMoveReq] = React.useState<{ entries: FileEntry[]; sourcePath: string } | null>(null);
  const [confirm, setConfirm] = React.useState<ConfirmRequest | null>(null);
  const [shareInfo, setShareInfo] = React.useState<{ url: string; name: string } | null>(null);
  const [sharesOpen, setSharesOpen] = React.useState(false);
  const [dragIds, setDragIds] = React.useState<string[] | null>(null);
  const [pendingRename, setPendingRename] = React.useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = React.useState(() => window.innerWidth >= 901);
  const [previewOpen, setPreviewOpen] = React.useState(() => window.innerWidth >= 1200);
  const anchor = React.useRef<string | null>(null);
  const hiddenUpload = React.useRef<HTMLInputElement>(null);

  const transfers = useTransfers();

  // Debounce the search box so a global api.search() isn't fired on every keystroke.
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  React.useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query.trim()), 220);
    return () => window.clearTimeout(id);
  }, [query]);
  const searching = debouncedQuery.length > 0;

  // ── data: the active listing. Search wins over the location (it spans the whole
  //    partition); otherwise recent/starred/trash use their GLOBAL RPCs and folder uses
  //    listDir(path). Re-lists on `rev`, which useApi bumps after every mutation. ──
  const listing = useAsync(() => {
    if (searching) return api.search(debouncedQuery);
    if (view === "trash") return api.listTrash();
    if (view === "recent") return api.listRecent();
    if (view === "starred") return api.listStarred();
    return api.listDir(path);
  }, [searching, debouncedQuery, view, path, rev, api]);
  const entries = listing.data?.entries;
  const baseEntries = React.useMemo(() => entries ?? [], [entries]);
  // The parent path shared by the listing. Meaningful ONLY for the plain folder view;
  // in global views (recent/starred/search) it's a synthetic label ("recent"/…), so
  // per-entry paths can't be derived from it — see `pathResolvable`.
  const currentParent = listing.data?.path ?? path;
  // True when the active listing is a real directory, so childPath(currentParent, name)
  // yields a genuine path. In the global views it's false and path-dependent features
  // (open-into-folder, recursive folder download, rename) degrade.
  const pathResolvable = view === "folder" && !searching;
  /**
   * The folder an entry actually lives in.
   *
   * Prefers the entry's own path, which the host now sends, so a result found in Recent,
   * Starred or Search can still be acted on. Falls back to the folder being browsed for
   * hosts that predate the field. `null` means the location is genuinely unknown and the
   * action must stay hidden rather than guess.
   */
  const parentOf = (e: FileEntry): string | null =>
    e.path ? parentPathOf(e.path) : pathResolvable ? currentParent : null;
  /** Whether an individual entry can be acted on, regardless of which view found it. */
  const canResolve = (e: FileEntry): boolean => parentOf(e) !== null;

  // trash count for the sidebar badge (kept live via rev)
  const trashListing = useAsync(() => api.listTrash(), [rev, api]);
  const trashCount = trashListing.data?.entries.length ?? 0;
  // global starred count for the sidebar badge (kept live via rev)
  const starredListing = useAsync(() => api.listStarred(), [rev, api]);
  const starCount = starredListing.data?.entries.length ?? 0;

  // ── derived, client-side items: type-filter chips + sort over the active listing.
  //    (Recent/Starred/Search filtering now happens server-side via the global RPCs.) ──
  const items = React.useMemo(() => {
    let base = baseEntries;
    if (filter !== "all") {
      const g = FILTERS.find((f) => f.id === filter);
      if (g && g.kinds) {
        const kinds = g.kinds;
        base = base.filter((e) => kinds.includes(kindOf(e)));
      }
    }
    const rank = (e: FileEntry) => (e.kind === "dir" ? 0 : 1);
    const val = (e: FileEntry): string | number =>
      sort.key === "name"
        ? e.name.toLowerCase()
        : sort.key === "size"
          ? e.sizeBytes
          : sort.key === "modified"
            ? e.modified
            : kindOf(e);
    return [...base].sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      const av = val(a), bv = val(b);
      let r = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      if (r === 0) r = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      return sort.dir === "asc" ? r : -r;
    });
  }, [baseEntries, filter, sort]);
  const selectedEntries = React.useCallback(
    () => baseEntries.filter((e) => selection.has(e.id)),
    [baseEntries, selection],
  );
  const selSize = selectedEntries().reduce((s, e) => s + e.sizeBytes, 0);
  const allStarred = selection.size > 0 && selectedEntries().every((e) => e.starred);
  const previewEntry =
    selection.size === 1 ? baseEntries.find((e) => e.id === [...selection][0]) ?? null : null;

  const counts = React.useMemo(() => {
    let f = 0, d = 0;
    items.forEach((n) => (n.kind === "dir" ? d++ : f++));
    return { f, d };
  }, [items]);
  const note = searching
    ? `${items.length} ${items.length === 1 ? "RESULT" : "RESULTS"}`
    : `${counts.d} ${counts.d === 1 ? "FOLDER" : "FOLDERS"} · ${counts.f} ${counts.f === 1 ? "FILE" : "FILES"}`;

  const crumbs = React.useMemo<Crumb[]>(() => {
    const out: Crumb[] = [];
    let acc = "";
    for (const s of pathSegments(path)) {
      acc = acc + "/" + s;
      out.push({ name: s, path: acc });
    }
    return out;
  }, [path]);

  // ── navigation ──
  const expandAncestors = React.useCallback((p: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      let acc = "";
      for (const s of pathSegments(p)) {
        acc = acc + "/" + s;
        n.add(acc);
      }
      return n;
    });
  }, []);
  const navigate = (nextView: ViewType, nextPath?: string) => {
    setView(nextView);
    if (nextPath !== undefined) setPath(nextPath);
    setSelection(new Set());
    anchor.current = null;
    setQuery("");
    setRenamingId(null);
    if (nextView === "recent") setSort({ key: "modified", dir: "desc" });
    if (nextView === "folder" && nextPath) expandAncestors(nextPath);
    if (window.innerWidth < 901) setSidebarOpen(false);
  };
  const openFolder = (p: string) => navigate("folder", p);
  const onOpen = (entry: FileEntry) => {
    if (entry.kind === "dir") {
      // A folder opens at its own path when the host sent one, so this works from a global
      // view too. Trash folders have no browsable path, so those are only selected.
      const target = entry.path ?? (pathResolvable ? childPath(currentParent, entry.name) : null);
      if (target && view !== "trash") openFolder(target);
      else if (view !== "trash") {
        setSelection(new Set([entry.id]));
        anchor.current = entry.id;
        setPreviewOpen(true);
      }
    } else {
      setSelection(new Set([entry.id]));
      anchor.current = entry.id;
      setPreviewOpen(true);
    }
  };

  // ── selection ──
  const onSelect = (id: string, e: React.MouseEvent) => {
    const idx = items.findIndex((n) => n.id === id);
    if (e.shiftKey && anchor.current != null) {
      const a = items.findIndex((n) => n.id === anchor.current);
      if (a !== -1 && idx !== -1) {
        const [lo, hi] = a < idx ? [a, idx] : [idx, a];
        setSelection(new Set(items.slice(lo, hi + 1).map((n) => n.id)));
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      setSelection((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
      anchor.current = id;
      return;
    }
    setSelection(new Set([id]));
    anchor.current = id;
  };
  const onToggle = (id: string) => {
    setSelection((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    anchor.current = id;
  };
  const clearSel = () => {
    setSelection(new Set());
    anchor.current = null;
  };
  const selectAll = () => {
    setSelection(new Set(items.map((n) => n.id)));
    anchor.current = null;
  };

  // ── rename (move to same parent, new name) ──
  // Rename is a move to the entry's OWN parent path, so it's only safe where that path is
  // known (folder view). In a global view we can't derive the parent from an opaque id,
  // so the affordance is hidden there; this guard is the belt-and-suspenders backstop.
  const commitRename = async (entry: FileEntry, name: string | null) => {
    setRenamingId(null);
    if (!name) return;
    const parent = parentOf(entry);
    if (!parent) {
      push({ msg: "Open the file’s folder to rename it", icon: "info" });
      return;
    }
    try {
      await api.move(entry.id, parent, name);
      reload();
      push({ msg: <>Renamed to <b>{name}</b></>, kind: "ok", icon: "pen" });
    } catch (err) {
      push({ msg: errText("Rename failed", err), icon: "info" });
      reload();
    }
  };

  // ── move (drag-drop or dialog). No Undo: on a real host id == path, so the old id
  //    goes stale after a move and can't be moved back reliably. ──
  const doMove = async (moving: FileEntry[], targetPath: string) => {
    const src = currentParent;
    const eligible = moving.filter((e) => {
      if (targetPath === src) return false; // already here
      if (e.kind === "dir") {
        const ep = childPath(src, e.name);
        if (targetPath === ep || targetPath.startsWith(ep + "/")) return false; // into self/descendant
      }
      return true;
    });
    if (!eligible.length) {
      push({ msg: "Nothing to move here", icon: "info" });
      return;
    }
    try {
      for (const e of eligible) await api.move(e.id, targetPath, e.name);
      reload();
      clearSel();
      const dest = targetPath === "/" ? "All files" : pathSegments(targetPath).pop() ?? "folder";
      push({ msg: <>Moved {eligible.length} to <b>{dest}</b></>, kind: "ok", icon: "move" });
    } catch (err) {
      push({ msg: errText("Move failed", err), icon: "info" });
      reload();
    }
  };
  const openMove = (moving: FileEntry[]) => setMoveReq({ entries: moving, sourcePath: currentParent });

  // ── drag & drop ──
  const onDragStart = (id: string, e: React.DragEvent) => {
    const ids = selection.has(id) && selection.size > 1 ? [...selection] : [id];
    if (!selection.has(id)) {
      setSelection(new Set([id]));
      anchor.current = id;
    }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(FB_IDS_MIME, JSON.stringify(ids));
    setDragIds(ids);
  };
  const onDragEnd = () => setDragIds(null);
  const dropOnFolder = (destPath: string, e: React.DragEvent) => {
    setDragIds(null);
    const files = e.dataTransfer.files;
    if (files && files.length) {
      if (destPath === "trash") {
        push({ msg: "Can’t upload to Trash", icon: "info" });
        return;
      }
      uploadFiles(files, destPath);
      return;
    }
    let ids: string[] = [];
    try {
      ids = JSON.parse(e.dataTransfer.getData(FB_IDS_MIME) || "[]");
    } catch {
      ids = [];
    }
    if (!ids.length) return;
    const moving = ids
      .map((id) => baseEntries.find((x) => x.id === id))
      .filter((x): x is FileEntry => !!x);
    if (!moving.length) return;
    if (destPath === "trash") {
      removeItems(moving);
      return;
    }
    doMove(moving, destPath);
  };

  // ── upload ──
  const uploadFiles = async (fileList: FileList | File[], targetPath: string) => {
    const files = [...fileList];
    if (!files.length) return;
    try {
      for (const f of files) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        await api.uploadFile(targetPath, f.name, bytes);
      }
      reload();
      const here = targetPath === currentParent;
      const destName = targetPath === "/" ? "All files" : pathSegments(targetPath).pop() ?? "folder";
      push({
        msg: (
          <>
            Uploaded <b>{files.length}</b> {files.length === 1 ? "file" : "files"}
            {here ? "" : ` to ${destName}`}
          </>
        ),
        kind: "ok",
        icon: "upload",
      });
    } catch (err) {
      push({ msg: errText("Upload failed", err), icon: "info" });
      reload();
    }
  };
  const openHiddenUpload = () => hiddenUpload.current?.click();

  // ── new folder (creates in the current path, then inline-renames once it lists) ──
  const newFolder = async () => {
    if (view !== "folder") navigate("folder", path);
    const parent = path;
    const name = uniqueName("New folder", baseEntries.map((e) => e.name));
    try {
      await api.createFolder(parent, name);
      setPendingRename(name);
      reload();
    } catch (err) {
      push({ msg: errText("New folder failed", err), icon: "info" });
    }
  };
  // Once the new folder appears in the listing, select it and open inline rename.
  React.useEffect(() => {
    if (!pendingRename) return;
    const match = baseEntries.find((e) => e.name === pendingRename);
    if (match) {
      setSelection(new Set([match.id]));
      anchor.current = match.id;
      setRenamingId(match.id);
      setPendingRename(null);
    }
  }, [baseEntries, pendingRename]);

  // ── star ──
  const toggleStar = async (targets: FileEntry[]) => {
    if (!targets.length) return;
    const all = targets.every((e) => e.starred);
    try {
      for (const e of targets) await api.star(e.id, !all);
      reload();
    } catch (err) {
      push({ msg: errText("Star failed", err), icon: "info" });
      reload();
    }
  };

  // ── download ──
  // A single file saves directly. Anything else (several files, or a folder) is packed into
  // a real .zip with its structure intact.
  //
  // It used to save every file in the subtree individually and flat, so a nested project came
  // back as a heap with the folders gone and same-named files in different folders silently
  // overwriting each other. That is data loss wearing a feature's clothes.
  //
  // Recursion still needs a real path, so it only applies in the folder view; in a global
  // view (Recent, Starred, Search) folders are skipped and we say so.
  const MAX_DOWNLOAD_FILES = 2000;
  /** The archive is assembled in memory, so this is a memory ceiling, not a format one. */
  const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024;

  const saveBlob = (bytes: Uint8Array, filename: string) => {
    const url = URL.createObjectURL(new Blob([bytes]));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const saveFile = async (e: FileEntry) => {
    try {
      saveBlob(await api.downloadFile(e.id), e.name);
    } catch (err) {
      push({ msg: errText(`Download failed (${e.name})`, err), icon: "info" });
    }
  };

  const download = async (targets: FileEntry[]) => {
    const directFiles = targets.filter((e) => e.kind === "file");
    const folders = targets.filter((e) => e.kind === "dir");
    // A folder is walkable when its own path is known, which the host now sends, so this
    // works from a global view too. Only genuinely unlocatable folders are skipped.
    const walkable = folders.filter((f) => f.path ?? (pathResolvable ? childPath(currentParent, f.name) : null));
    const skippedFolders = folders.length - walkable.length;

    // One file, chosen on its own: hand it over as itself. Wrapping a single download in an
    // archive is a step the person then has to undo.
    if (directFiles.length === 1 && !folders.length) {
      await saveFile(directFiles[0]);
      return;
    }

    // Each collected file carries where it sits RELATIVE to the selection, which is what
    // rebuilds the tree inside the archive.
    const collected: { entry: FileEntry; segs: string[] }[] = directFiles.map((e) => ({ entry: e, segs: [e.name] }));
    let truncated = false;

    if (walkable.length) {
      // Iterative DFS. Ids stay opaque; each root starts from the folder's own path, and
      // `rel` is carried alongside so the archive mirrors the folder layout.
      const stack = walkable.map((f) => ({
        path: f.path ?? childPath(currentParent, f.name),
        rel: [f.name],
      }));
      while (stack.length && collected.length < MAX_DOWNLOAD_FILES) {
        const { path: p, rel } = stack.pop()!;
        let entriesHere: FileEntry[];
        try {
          entriesHere = (await api.listDir(p)).entries;
        } catch (err) {
          push({ msg: errText(`Couldn’t read ${pathSegments(p).pop() ?? p}`, err), icon: "info" });
          continue;
        }
        for (const e of entriesHere) {
          if (e.kind === "dir") stack.push({ path: childPath(p, e.name), rel: [...rel, e.name] });
          else if (collected.length < MAX_DOWNLOAD_FILES) collected.push({ entry: e, segs: [...rel, e.name] });
          else truncated = true;
        }
      }
      if (stack.length) truncated = true; // subtree left unwalked at the cap
    }

    // A file can be both directly selected and inside a selected folder — dedupe by id.
    const seen = new Set<string>();
    const items = collected.filter((c) => (seen.has(c.entry.id) ? false : (seen.add(c.entry.id), true)));

    if (!items.length) {
      push({ msg: skippedFolders ? "Folders here can’t be downloaded" : "No files to download", icon: "info" });
      return;
    }

    push({
      msg: (
        <>
          Preparing <b>{items.length}</b> {items.length === 1 ? "file" : "files"}
          {skippedFolders ? " · folders skipped" : ""}
        </>
      ),
      kind: "ok",
      icon: "download",
    });

    // Fetch, then pack. A file that fails to download is reported and skipped rather than
    // failing the whole archive, so one unreadable file does not cost you the other 900.
    const zipEntries: ZipEntry[] = [];
    const paths = dedupePaths(items.map((c) => safeZipPath(c.segs)));
    let bytesSoFar = 0;
    let overSize = false;
    const failed: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const { entry } = items[i];
      try {
        const bytes = await api.downloadFile(entry.id);
        if (bytesSoFar + bytes.length > MAX_DOWNLOAD_BYTES) {
          overSize = true;
          break;
        }
        bytesSoFar += bytes.length;
        zipEntries.push({ path: paths[i] || entry.name, bytes });
      } catch {
        failed.push(entry.name);
      }
    }

    if (!zipEntries.length) {
      push({ msg: "Nothing could be downloaded", icon: "info" });
      return;
    }

    const base =
      walkable.length === 1 && !directFiles.length ? walkable[0].name : "sharedock-files";
    try {
      saveBlob(makeZip(zipEntries), `${base}.zip`);
    } catch (err) {
      push({ msg: errText("Could not build the archive", err), icon: "info" });
      return;
    }

    // Say what was left out. A silently short archive is the failure this whole change is
    // about, so a partial result has to announce itself.
    if (truncated || overSize || failed.length) {
      const why = overSize
        ? `stopped at ${Math.round(MAX_DOWNLOAD_BYTES / (1024 * 1024 * 1024))} GB`
        : truncated
          ? `stopped at ${MAX_DOWNLOAD_FILES} files`
          : `${failed.length} file${failed.length === 1 ? "" : "s"} could not be read`;
      push({ msg: `Archive is incomplete: ${why}.`, icon: "info" });
    }
  };

  // ── share link (single file → zero-knowledge public URL via the app-wide ShareClient) ──
  const shareEntry = async (entry: FileEntry) => {
    if (entry.kind !== "file") return;
    // Cheap early-out before fetching bytes; the authoritative cap check is in create().
    if (entry.sizeBytes > MAX_SHARE_BYTES) {
      push({
        msg: `“${entry.name}” is too large to share as a link (max ${Math.round(MAX_SHARE_BYTES / (1024 * 1024))} MB)`,
        icon: "info",
      });
      return;
    }
    try {
      const bytes = await api.downloadFile(entry.id);
      const { url } = await share().create(entry.id, entry.name, "view", bytes);
      setShareInfo({ url, name: entry.name });
    } catch (err) {
      // Covers "too large", "not connected", and "not signed in".
      push({ msg: errText("Share failed", err), icon: "info" });
    }
  };

  // ── delete → soft-trash + Undo (hard delete only inside Trash, behind a confirm) ──
  const removeItems = (targets: FileEntry[]) => {
    if (!targets.length) return;
    if (view === "trash") {
      setConfirm({
        title: "Delete forever",
        danger: true,
        confirmLabel: "Delete forever",
        body: (
          <>
            Permanently delete <b>{targets.length}</b> {targets.length === 1 ? "item" : "items"}? This cannot be undone.
          </>
        ),
        onConfirm: async () => {
          setConfirm(null);
          try {
            for (const e of targets) await api.deleteEntry(e.id);
            reload();
            clearSel();
            push({ msg: <>Deleted <b>{targets.length}</b> forever</>, icon: "trash" });
          } catch (err) {
            push({ msg: errText("Delete failed", err), icon: "info" });
            reload();
          }
        },
      });
    } else {
      const ids = targets.map((e) => e.id);
      (async () => {
        try {
          for (const e of targets) await api.trash(e.id);
          reload();
          clearSel();
          push({
            msg: <>Moved <b>{targets.length}</b> to trash</>,
            kind: "ok",
            icon: "trash",
            undo: async () => {
              try {
                for (const id of ids) await api.restore(id);
                reload();
              } catch (err) {
                push({ msg: errText("Undo failed", err), icon: "info" });
                reload();
              }
            },
          });
        } catch (err) {
          push({ msg: errText("Trash failed", err), icon: "info" });
          reload();
        }
      })();
    }
  };
  const emptyTrash = () => {
    setConfirm({
      title: "Empty trash",
      danger: true,
      confirmLabel: "Empty trash",
      body: <>Permanently delete everything in trash? This cannot be undone.</>,
      onConfirm: async () => {
        setConfirm(null);
        try {
          await api.emptyTrash();
          reload();
          clearSel();
          push({ msg: "Trash emptied", icon: "trash" });
        } catch (err) {
          push({ msg: errText("Empty trash failed", err), icon: "info" });
          reload();
        }
      },
    });
  };

  // Restore trashed entries back to their original location.
  const restoreItems = (targets: FileEntry[]) => {
    if (!targets.length) return;
    (async () => {
      try {
        for (const e of targets) await api.restore(e.id);
        reload();
        clearSel();
        push({ msg: <>Restored <b>{targets.length}</b></>, kind: "ok", icon: "check-circle" });
      } catch (err) {
        push({ msg: errText("Restore failed", err), icon: "info" });
        reload();
      }
    })();
  };

  // ── context menu ──
  const openContext = (entry: FileEntry | null, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    let ctxEntries: FileEntry[];
    if (entry && selection.has(entry.id)) ctxEntries = selectedEntries();
    else if (entry) {
      setSelection(new Set([entry.id]));
      anchor.current = entry.id;
      ctxEntries = [entry];
    } else ctxEntries = [];
    setCtx({ x: e.clientX, y: e.clientY, entries: ctxEntries, entry });
  };
  const ctxItems = (): ContextMenuItem[] => {
    if (!ctx) return [];
    if (!ctx.entry)
      return [
        { label: "New folder", icon: "folder-plus", onClick: newFolder },
        { label: "Upload files", icon: "upload", onClick: openHiddenUpload },
        { sep: true },
        { label: "Select all", icon: "check", kbd: "⌘A", onClick: selectAll },
      ];
    const { entries: ents, entry } = ctx;
    const one = ents.length === 1;
    const inTrash = view === "trash";
    const oneFile = one && entry.kind === "file";
    const allStar = ents.every((e) => e.starred);
    const raw: (ContextMenuItem | null)[] = [
      one && entry.kind === "dir" && !inTrash ? { label: "Open", icon: "folder-open", onClick: () => onOpen(entry) } : null,
      { label: ents.length > 1 ? `Download (${ents.length})` : "Download", icon: "download", onClick: () => download(ents) },
      oneFile && !inTrash ? { label: "Share link…", icon: "link", onClick: () => shareEntry(entry) } : null,
      { sep: true },
      // Rename needs the entry's own parent path — only offered in the folder view.
      one && canResolve(entry) ? { label: "Rename", icon: "pen", kbd: "F2", onClick: () => setRenamingId(entry.id) } : null,
      { label: allStar ? "Remove star" : "Add star", icon: allStar ? "star-fill" : "star", onClick: () => toggleStar(ents) },
      { label: "Move to…", icon: "move", onClick: () => openMove(ents) },
      inTrash ? { label: "Restore", icon: "check-circle", onClick: () => restoreItems(ents) } : null,
      { sep: true },
      { label: inTrash ? "Delete forever" : "Move to trash", icon: "trash", danger: true, kbd: "⌦", onClick: () => removeItems(ents) },
    ];
    return raw.filter((x): x is ContextMenuItem => !!x);
  };

  // ── keyboard (no-op while typing or when ANY modal layer is open) ──
  // `anyModalOpen` covers modals this component doesn't own — Settings lives in AppRoot and
  // opens from the rail on any page. Without it, Escape here cleared the selection behind an
  // open Settings modal and Delete/Backspace trashed it behind one.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = (el?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || el?.isContentEditable) return;
      if (moveReq || confirm || anyModalOpen) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAll();
      } else if (e.key === "Escape") {
        if (ctx) setCtx(null);
        else clearSel();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selection.size) {
        e.preventDefault();
        removeItems(selectedEntries());
      } else if (e.key === "F2" && selection.size === 1 && pathResolvable) {
        e.preventDefault();
        setRenamingId([...selection][0]);
      } else if (e.key === "Enter" && selection.size === 1) {
        const en = baseEntries.find((x) => x.id === [...selection][0]);
        if (en) onOpen(en);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── list-area drop target (folder/recent/starred upload/move to current path) ──
  const [, listDrop, listFileOver] = useDrop((e) => dropOnFolder(path, e), view !== "trash");

  const handlers: ItemHandlers = {
    onSelect,
    onToggle: (id) => onToggle(id),
    onOpen,
    onContext: openContext,
    onDragStart,
    onDragEnd,
    dropOnFolder,
    onRenameCommit: commitRename,
    onRenameCancel: () => setRenamingId(null),
  };
  const flagsFor = (entry: FileEntry): ItemFlags => ({
    selected: selection.has(entry.id),
    renaming: renamingId === entry.id,
    dragging: !!dragIds && dragIds.includes(entry.id),
  });
  const pvActions: PreviewActions = {
    download: (e) => download([e]),
    rename: (e) => setRenamingId(e.id),
    move: (e) => openMove([e]),
    star: (e) => toggleStar([e]),
    remove: (e) => removeItems([e]),
    open: (e) => onOpen(e),
    share: (e) => shareEntry(e),
  };

  // Folder-count fetch + location label only make sense with a real path (folder view).
  const previewEntryPath =
    previewEntry && pathResolvable ? childPath(currentParent, previewEntry.name) : null;
  const previewLocation = pathResolvable
    ? currentParent === "/"
      ? "All files"
      : "All files / " + pathSegments(currentParent).join(" / ")
    : searching
      ? "Search results"
      : view === "recent"
        ? "Recent"
        : view === "starred"
          ? "Starred"
          : "Trash";

  const listError = listing.error && baseEntries.length === 0;

  return (
    <div
      className="fb"
      data-sb={sidebarOpen ? "1" : "0"}
      data-pv={previewOpen ? "1" : "0"}
      onDragOver={(e) => {
        if (e.dataTransfer.types && [...e.dataTransfer.types].includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files && e.dataTransfer.files.length) e.preventDefault();
      }}
    >
      <input
        ref={hiddenUpload}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files) uploadFiles(e.target.files, path);
          e.target.value = "";
        }}
      />

      <Toolbar
        onMenu={() => setSidebarOpen((v) => !v)}
        query={query}
        onQuery={setQuery}
        onUpload={(f) => uploadFiles(f, path)}
        onNewFolder={newFolder}
        onManageShares={() => setSharesOpen(true)}
        showEmptyTrash={view === "trash" && items.length > 0}
        onEmptyTrash={emptyTrash}
      />

      <div className="fb-body">
        <div className={"fb-sidebar" + (sidebarOpen ? "" : " off")}>
          <Sidebar
            api={api}
            rev={rev}
            view={view}
            path={path}
            expanded={expanded}
            starCount={starCount}
            trashCount={trashCount}
            onNavigate={navigate}
            onToggle={(p) =>
              setExpanded((prev) => {
                const n = new Set(prev);
                if (n.has(p)) n.delete(p);
                else n.add(p);
                return n;
              })
            }
            onDropInto={dropOnFolder}
            onReload={reload}
            onCollapse={() => setSidebarOpen(false)}
          />
        </div>

        <div className="fb-content">
          <Subbar
            crumbs={crumbs}
            onCrumb={openFolder}
            view={view}
            viewMode={viewMode}
            onViewMode={setViewMode}
            previewOpen={previewOpen}
            onTogglePreview={() => setPreviewOpen((v) => !v)}
            onDropInto={dropOnFolder}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
          />
          <FilterChips filter={filter} onFilter={setFilter} note={note} />
          <div
            className={"fb-list-wrap" + (listFileOver ? " dragover" : "")}
            {...listDrop}
            onClick={(e) => {
              const t = e.target as HTMLElement;
              if (t.classList.contains("fb-list-wrap") || t.classList.contains("fb-grid")) clearSel();
            }}
            onContextMenu={(e) => {
              const t = e.target as HTMLElement;
              if ((t.classList.contains("fb-list-wrap") || t.classList.contains("fb-grid")) && view === "folder")
                openContext(null, e);
            }}
          >
            <div className="fb-drop-hint">
              <FbIcon name="upload" size={30} />
              <span>{view === "trash" ? "DROP TO TRASH" : "DROP TO UPLOAD HERE"}</span>
            </div>
            {listError ? (
              <div className="fb-empty">
                <span className="ring"><FbIcon name="info" size={22} /></span>
                <h3>Couldn’t load</h3>
                <p>{listing.error?.message}</p>
                <button className="btn btn-sm" onClick={reload} style={{ marginTop: 4 }}>
                  <FbIcon name="refresh" size={15} /> Retry
                </button>
              </div>
            ) : items.length === 0 ? (
              <EmptyState searching={searching} view={view} onUpload={openHiddenUpload} />
            ) : viewMode === "grid" ? (
              <GridView items={items} flagsFor={flagsFor} urls={{}} h={handlers} path={currentParent} />
            ) : (
              <ListView items={items} flagsFor={flagsFor} h={handlers} path={currentParent} sort={sort} onSort={setSort} />
            )}
          </div>
        </div>

        <div className={"fb-preview" + (previewOpen ? "" : " off")}>
          <PreviewDrawer
            entry={previewEntry}
            api={api}
            rev={rev}
            entryPath={previewEntryPath}
            location={previewLocation}
            inTrash={view === "trash"}
            onClose={() => setPreviewOpen(false)}
            actions={pvActions}
          />
        </div>

        <div
          className="fb-scrim"
          onClick={() => {
            setSidebarOpen(window.innerWidth >= 901);
            setPreviewOpen(window.innerWidth >= 1200 ? previewOpen : false);
          }}
        />

        {selection.size > 0 && (
          <SelectionBar
            count={selection.size}
            size={selSize}
            inTrash={view === "trash"}
            allStarred={allStarred}
            canShare={!!previewEntry && previewEntry.kind === "file" && view !== "trash"}
            onDownload={() => download(selectedEntries())}
            onMove={() => openMove(selectedEntries())}
            onStar={() => toggleStar(selectedEntries())}
            onShare={() => { if (previewEntry) shareEntry(previewEntry); }}
            onDelete={() => removeItems(selectedEntries())}
            onRestore={() => restoreItems(selectedEntries())}
            onClear={clearSel}
          />
        )}
      </div>

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems()} onClose={() => setCtx(null)} />}
      {moveReq && (
        <MoveDialog
          api={api}
          rev={rev}
          movingEntries={moveReq.entries}
          sourcePath={moveReq.sourcePath}
          onMove={(target) => {
            doMove(moveReq.entries, target);
            setMoveReq(null);
          }}
          onClose={() => setMoveReq(null)}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          danger={confirm.danger}
          confirmLabel={confirm.confirmLabel}
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        >
          {confirm.body}
        </ConfirmDialog>
      )}
      {shareInfo && (
        <ShareDialog url={shareInfo.url} name={shareInfo.name} onClose={() => setShareInfo(null)} />
      )}
      {sharesOpen && <SharesDialog onClose={() => setSharesOpen(false)} onToast={push} />}

      <Toasts toasts={toasts} dismiss={dismiss} />
      <TransfersHud transfers={transfers} />
    </div>
  );
}

// Compact live-transfer HUD. Real uploads/downloads through the adapter populate the
// global transfers store (useTransfers); shown here so progress is visible in-page.
function TransfersHud({ transfers }: { transfers: ReturnType<typeof useTransfers> }) {
  const active = transfers.filter((t) => t.state === "active" || t.state === "queued" || t.state === "paused");
  if (!active.length) return null;
  return (
    <div
      style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        zIndex: 3000,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        width: "min(320px,80vw)",
        pointerEvents: "none",
      }}
      aria-live="polite"
    >
      {active.slice(0, 4).map((t) => (
        <div
          key={t.id}
          style={{
            background: "var(--bg-deep)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-1)",
            padding: "10px 12px",
            boxShadow: "0 16px 40px -22px rgba(0,0,0,.9)",
            font: "500 10.5px/1 var(--mono)",
            letterSpacing: ".06em",
            color: "var(--fg-dim)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ color: "var(--o)", display: "flex" }}>
              <FbIcon name={t.direction === "up" ? "upload" : "download"} size={13} />
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{t.name}</span>
            <span style={{ color: "var(--muted)" }}>{Math.round(t.progress * 100)}%</span>
          </div>
          <div style={{ height: 3, background: "var(--bg-well)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.round(t.progress * 100)}%`, background: "var(--o)" }} />
          </div>
          {t.bytesPerSec > 0 && (
            <div style={{ marginTop: 6, color: "var(--muted)", fontSize: 9, letterSpacing: ".1em", textTransform: "uppercase" }}>
              {fmtBytes(t.bytesPerSec)}/S
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
