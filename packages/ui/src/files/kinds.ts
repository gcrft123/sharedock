// kinds.ts — file-kind registry, chip filters, kind/tag derivation, and the
// display formatters. Ported from the prototype's fb-data.jsx, but adapted to the
// real `FileEntry` shape (kind: "file"|"dir", sizeBytes, category) instead of the
// prototype's in-memory {type,size} nodes. The pure helpers (kindOf/tagOf and the
// formatters) are reused verbatim in look; the seed-tree/store helpers are gone —
// data now comes from the DriveApi.

import type React from "react";
import type { FileEntry } from "@app/rpc-client";

/** The fine-grained kind that drives the glyph, the mono tag, and filter chips. */
export type Kind =
  | "folder"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "doc"
  | "sheet"
  | "code"
  | "archive"
  | "design"
  | "file";

// ── file-kind registry ──────────────────────────────────────────────────────
// Colors stay inside the Sharedock palette. Folders are the "lit object" (orange).
// Files read as phosphor/muted; the glyph + mono tag carry the type, not hue.
const EXT_KIND: Record<string, Kind> = {
  // images
  png: "image", jpg: "image", jpeg: "image", gif: "image", svg: "image", webp: "image", heic: "image",
  // video
  mp4: "video", mov: "video", webm: "video", avi: "video", mkv: "video",
  // audio
  mp3: "audio", wav: "audio", flac: "audio", aac: "audio", m4a: "audio",
  // docs
  pdf: "pdf",
  doc: "doc", docx: "doc", txt: "doc", md: "doc", rtf: "doc", pages: "doc",
  // sheets
  csv: "sheet", xls: "sheet", xlsx: "sheet", numbers: "sheet", tsv: "sheet",
  // code
  js: "code", jsx: "code", ts: "code", tsx: "code", py: "code", json: "code", html: "code", css: "code", sh: "code", go: "code", rs: "code", sql: "code",
  // archives
  zip: "archive", tar: "archive", gz: "archive", rar: "archive", "7z": "archive", dmg: "archive",
  // design
  fig: "design", sketch: "design", psd: "design", ai: "design", xd: "design",
};

/** Fallback when the extension is unknown: the API's coarse `category` → a Kind. */
const CATEGORY_KIND: Record<NonNullable<FileEntry["category"]>, Kind> = {
  image: "image",
  video: "video",
  audio: "audio",
  document: "doc",
  archive: "archive",
  code: "code",
  folder: "folder",
  other: "file",
};

export interface KindMeta {
  glyph: string;
  label: string;
}
export const KIND_META: Record<Kind, KindMeta> = {
  folder: { glyph: "folder", label: "Folder" },
  image: { glyph: "image", label: "Image" },
  video: { glyph: "video", label: "Video" },
  audio: { glyph: "audio", label: "Audio" },
  pdf: { glyph: "file-text", label: "Document" },
  doc: { glyph: "file-text", label: "Document" },
  sheet: { glyph: "sheet", label: "Spreadsheet" },
  code: { glyph: "code", label: "Code" },
  archive: { glyph: "archive", label: "Archive" },
  design: { glyph: "layers", label: "Design" },
  file: { glyph: "file", label: "File" },
};

// Filter groups map several kinds to one chip.
export interface FilterDef {
  id: string;
  label: string;
  kinds: Kind[] | null;
}
export const FILTERS: FilterDef[] = [
  { id: "all", label: "All", kinds: null },
  { id: "folder", label: "Folders", kinds: ["folder"] },
  { id: "doc", label: "Docs", kinds: ["pdf", "doc", "sheet"] },
  { id: "image", label: "Images", kinds: ["image"] },
  { id: "av", label: "Media", kinds: ["video", "audio"] },
  { id: "code", label: "Code", kinds: ["code"] },
  { id: "archive", label: "Archives", kinds: ["archive", "design"] },
];

export const extOf = (name: string): string => {
  const m = /\.([a-z0-9]+)$/i.exec(name || "");
  return m ? m[1].toLowerCase() : "";
};

/** Derive the display kind: extension first (rich), then the API category, then file. */
export const kindOf = (entry: FileEntry): Kind => {
  if (entry.kind === "dir") return "folder";
  const e = extOf(entry.name);
  if (e && EXT_KIND[e]) return EXT_KIND[e];
  if (entry.category && CATEGORY_KIND[entry.category]) return CATEGORY_KIND[entry.category];
  return "file";
};

export const tagOf = (entry: FileEntry): string => {
  if (entry.kind === "dir") return "DIR";
  const e = extOf(entry.name);
  return e ? e.toUpperCase() : "BIN";
};

// ── formatters (ported from fb-data.jsx for byte-identical display) ──────────
export const fmtBytes = (b: number | null | undefined): string => {
  if (b == null) return "—";
  if (b === 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  const v = b / Math.pow(1024, i);
  return (i === 0 ? v : v.toFixed(v >= 100 || v % 1 === 0 ? 0 : 1)) + " " + u[i];
};

export const timeAgo = (t: number): string => {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "JUST NOW";
  const m = s / 60; if (m < 60) return Math.floor(m) + "M AGO";
  const h = m / 60; if (h < 24) return Math.floor(h) + "H AGO";
  const d = h / 24; if (d < 7) return Math.floor(d) + "D AGO";
  const w = d / 7; if (w < 5) return Math.floor(w) + "W AGO";
  const mo = d / 30; if (mo < 12) return Math.floor(mo) + "MO AGO";
  return Math.floor(d / 365) + "Y AGO";
};

export const fmtDate = (t: number): string => {
  const d = new Date(t), p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} · ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// ── deterministic warm tile for media previews (no photography per the DS) ───
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function tileStyle(name: string): React.CSSProperties {
  const h = hashStr(name || "x");
  const ang = h % 360;
  const x1 = 20 + ((h >> 3) % 50), y1 = 18 + ((h >> 7) % 50);
  const warms = [
    ["rgba(199,55,11,.30)", "rgba(255,178,90,.12)"],
    ["rgba(255,90,31,.26)", "rgba(255,206,158,.10)"],
    ["rgba(255,126,51,.24)", "rgba(199,55,11,.14)"],
    ["rgba(255,178,90,.20)", "rgba(255,90,31,.16)"],
  ];
  const p = warms[h % warms.length];
  return {
    backgroundImage: `radial-gradient(circle at ${x1}% ${y1}%, ${p[0]}, transparent 62%), linear-gradient(${ang}deg, ${p[1]}, transparent 70%)`,
    backgroundColor: "var(--bg-well)",
  };
}
