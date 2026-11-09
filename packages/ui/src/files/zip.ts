// A minimal ZIP writer, so downloading a folder gives you back a folder.
//
// Folder download used to save every file in the subtree individually, flat, which meant a
// nested project came back as a heap of files with the structure gone and same-named files
// in different folders overwriting each other. That is quiet data loss dressed as a feature.
//
// STORE only, no compression. Two reasons: the payloads are already-encrypted bytes, which
// do not compress, and `CompressionStream` is unavailable on the old WebViews this app
// deliberately still supports. An uncompressed zip is a real zip; every unarchiver opens it.
//
// BigInt-free on purpose, matching `crypto.ts`: the Mojave-era JavaScriptCore has no BigInt,
// and a download path that throws there would be worse than the flat files it replaces.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ZIP stores time as two packed 16-bit DOS fields, at two-second resolution. */
function dosDateTime(d: Date): { time: number; date: number } {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const year = Math.max(0, d.getFullYear() - 1980);
  const date = ((year & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

class Writer {
  private parts: Uint8Array[] = [];
  private len = 0;
  push(b: Uint8Array) {
    this.parts.push(b);
    this.len += b.length;
  }
  get offset() {
    return this.len;
  }
  concat(): Uint8Array {
    const out = new Uint8Array(this.len);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

function u32(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
}
function u16(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
}
function join(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export interface ZipEntry {
  /** Path inside the archive, using forward slashes. */
  path: string;
  bytes: Uint8Array;
}

/**
 * ZIP is a 32-bit format without the ZIP64 extensions, which this writer does not emit. Past
 * 4 GB the offsets silently wrap and produce an archive that looks fine and is corrupt, so
 * the caller is stopped before that rather than handed one.
 */
export const ZIP_MAX_BYTES = 0xffffffff;

/** Names are stored UTF-8 (flag bit 11), so non-ASCII filenames survive the round trip. */
const UTF8_FLAG = 0x0800;

/** Build a ZIP archive. Throws if the total would exceed what a non-ZIP64 archive can address. */
export function makeZip(entries: ZipEntry[], now: Date = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const local = new Writer();
  const central = new Writer();

  let total = 0;
  for (const e of entries) total += e.bytes.length;
  if (total > ZIP_MAX_BYTES) {
    throw new Error("This folder is too large to download as a single archive.");
  }

  for (const e of entries) {
    const name = enc.encode(e.path);
    const crc = crc32(e.bytes);
    const size = e.bytes.length;
    const offset = local.offset;

    local.push(
      join(
        u32(0x04034b50), // local file header
        u16(20), // version needed
        u16(UTF8_FLAG),
        u16(0), // method: stored
        u16(time),
        u16(date),
        u32(crc),
        u32(size), // compressed
        u32(size), // uncompressed
        u16(name.length),
        u16(0), // extra length
        name,
      ),
    );
    local.push(e.bytes);

    central.push(
      join(
        u32(0x02014b50), // central directory header
        u16(20), // version made by
        u16(20), // version needed
        u16(UTF8_FLAG),
        u16(0),
        u16(time),
        u16(date),
        u32(crc),
        u32(size),
        u32(size),
        u16(name.length),
        u16(0), // extra
        u16(0), // comment
        u16(0), // disk number
        u16(0), // internal attrs
        u32(0), // external attrs
        u32(offset),
        name,
      ),
    );
  }

  const cdOffset = local.offset;
  const cd = central.concat();
  const eocd = join(
    u32(0x06054b50), // end of central directory
    u16(0), // this disk
    u16(0), // disk with central directory
    u16(entries.length),
    u16(entries.length),
    u32(cd.length),
    u32(cdOffset),
    u16(0), // comment length
  );

  return join(local.concat(), cd, eocd);
}

/**
 * Make a path safe to write inside an archive.
 *
 * A name arriving as `../../etc/passwd` must not become a path traversal when the recipient
 * unzips it, and a leading slash must not make the entry absolute. Segments are cleaned and
 * anything that empties out is dropped.
 */
export function safeZipPath(segments: string[]): string {
  const clean = segments
    .flatMap((s) => s.split("/"))
    .map((s) => s.replace(/\\/g, "_").trim())
    .filter((s) => s && s !== "." && s !== "..");
  return clean.join("/");
}

/**
 * Disambiguate entries that would collide. Two files called `notes.txt` in different folders
 * are fine, but the same full path twice would silently drop one, so later duplicates get a
 * counter before the extension.
 */
export function dedupePaths(paths: string[]): string[] {
  const seen = new Map<string, number>();
  return paths.map((p) => {
    const n = seen.get(p);
    if (n === undefined) {
      seen.set(p, 1);
      return p;
    }
    seen.set(p, n + 1);
    const dot = p.lastIndexOf(".");
    const slash = p.lastIndexOf("/");
    return dot > slash && dot > 0 ? `${p.slice(0, dot)} (${n})${p.slice(dot)}` : `${p} (${n})`;
  });
}
