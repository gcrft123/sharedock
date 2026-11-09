// types.ts — shared shapes for the file-browser components. Navigation is
// path-based (the `path` string is the source of truth); ids are treated as opaque
// tokens from the DriveApi and never parsed.

import type React from "react";
import type { FileEntry } from "@app/rpc-client";

/** The four sidebar "locations". `folder` browses `path`; the others transform it. */
export type ViewType = "folder" | "recent" | "starred" | "trash";

export type SortKey = "name" | "kind" | "size" | "modified";
export interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

export interface ItemFlags {
  selected: boolean;
  renaming: boolean;
  dragging: boolean;
}

/** Handlers threaded from the top-level `Files` component into each tile/row. */
export interface ItemHandlers {
  onSelect(id: string, e: React.MouseEvent): void;
  onToggle(id: string, e: React.MouseEvent): void;
  onOpen(entry: FileEntry): void;
  onContext(entry: FileEntry, e: React.MouseEvent): void;
  onDragStart(id: string, e: React.DragEvent): void;
  onDragEnd(): void;
  /** Drop onto a folder/location target identified by its PATH (not id). */
  dropOnFolder(destPath: string, e: React.DragEvent): void;
  onRenameCommit(entry: FileEntry, name: string | null): void;
  onRenameCancel(): void;
}

export interface ToastItem {
  id: string;
  msg: React.ReactNode;
  kind?: "ok";
  icon?: string;
  undo?: () => void;
  duration?: number;
}

/** New toast payload (id is assigned by `useToasts`). */
export type ToastInput = Omit<ToastItem, "id">;

export interface ContextMenuItem {
  label?: string;
  icon?: string;
  kbd?: string;
  danger?: boolean;
  disabled?: boolean;
  sep?: boolean;
  onClick?: () => void;
}

/** A pending confirm-dialog request (hard delete / empty trash). */
export interface ConfirmRequest {
  title: string;
  danger?: boolean;
  confirmLabel: string;
  body: React.ReactNode;
  onConfirm: () => void;
}

// ── path helpers (ids stay opaque; folder paths come from navigation state) ──
export const childPath = (parent: string, name: string): string =>
  parent === "/" ? "/" + name : parent + "/" + name;

/** Split a path into breadcrumb segments (excludes the implicit root). */
export const pathSegments = (path: string): string[] => path.split("/").filter(Boolean);

/**
 * The folder containing `path`. "/Docs/a.txt" → "/Docs"; a top-level entry → "/".
 *
 * Paired with `FileEntry.path`, this is what makes rename, open-into-folder and recursive
 * download work in the global views (Recent, Starred, Search), where the entry can live in
 * any folder and the current listing says nothing about where.
 */
export const parentPathOf = (path: string): string => {
  const segs = pathSegments(path);
  segs.pop();
  return segs.length ? `/${segs.join("/")}` : "/";
};
