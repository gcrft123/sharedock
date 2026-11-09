/**
 * ZIP writer tests, validated against the system `unzip`.
 *
 * Hand-rolled binary formats fail quietly: a wrong offset or a bad CRC produces a file that
 * looks like an archive, downloads without complaint, and only refuses to open later on
 * somebody else's machine. Asserting our own bytes against our own reader would prove
 * nothing, so the archive is written to disk and handed to a real unarchiver.
 *
 * Run: node test/zip.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, globSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");
const out = mkdtempSync(join(tmpdir(), "pc-zip-"));

function esbuildBin() {
  const direct = join(root, "node_modules/.bin/esbuild");
  if (existsSync(direct)) return direct;
  const found = globSync("node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild", { cwd: root });
  if (!found.length) throw new Error("esbuild not found; run pnpm install");
  return join(root, found.sort().reverse()[0]);
}

const bundle = join(out, "zip.mjs");
execFileSync(
  esbuildBin(),
  [join(here, "../src/files/zip.ts"), "--bundle", "--format=esm", "--platform=node", `--outfile=${bundle}`, "--log-level=error"],
  { stdio: "inherit" },
);
const Z = await import(bundle);

let passed = 0;
let failed = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}  ${detail}`);
  }
};

console.log("\nZIP writer\n");

const enc = new TextEncoder();
const entries = [
  { path: "project/readme.txt", bytes: enc.encode("hello sharedock") },
  { path: "project/src/main.rs", bytes: enc.encode("fn main() {}\n") },
  { path: "project/src/nested/deep/notes.md", bytes: enc.encode("# notes") },
  // Non-ASCII, to prove the UTF-8 name flag is doing its job.
  { path: "project/café/résumé.txt", bytes: enc.encode("accents survive") },
  // Binary, to prove nothing is being treated as text.
  { path: "project/blob.bin", bytes: new Uint8Array([0, 1, 2, 253, 254, 255, 0, 0, 10, 13]) },
];

const zip = Z.makeZip(entries);
const zipPath = join(out, "test.zip");
writeFileSync(zipPath, zip);

// The real test: does an actual unarchiver accept it?
let ok = false;
try {
  execFileSync("unzip", ["-t", zipPath], { stdio: "pipe" });
  ok = true;
} catch (e) {
  ok = false;
}
check("a real unzip accepts the archive and its CRCs", ok);

// Second, independent reader for names and content. Info-ZIP on macOS cannot WRITE UTF-8
// filenames unless the shell locale says so, which is a property of that extractor rather
// than of the archive, and would otherwise look like a bug here. Python's zipfile has no
// such constraint, and being a wholly separate implementation it is a stronger check.
const py = `
import json, zipfile
z = zipfile.ZipFile(${JSON.stringify(zipPath)})
print(json.dumps({
  "names": z.namelist(),
  "bad": z.testzip(),
  "blob": list(z.read("project/blob.bin")),
  "notes": z.read("project/src/nested/deep/notes.md").decode(),
  "accents": z.read("project/caf\u00e9/r\u00e9sum\u00e9.txt").decode(),
}))
`;
const info = JSON.parse(execFileSync("python3", ["-c", py], { encoding: "utf8" }));

check("every entry is present", info.names.length === entries.length, info.names.join(","));
check("a second reader finds no corrupt entry", info.bad === null, String(info.bad));
check("folder structure is preserved", info.names.includes("project/src/nested/deep/notes.md"), info.names.join(","));
check("non-ASCII names survive", info.names.some((n) => n.includes("résumé")), info.names.join(","));
check("nested text content round-trips", info.notes === "# notes", info.notes);
check("non-ASCII file content round-trips", info.accents === "accents survive", info.accents);
check(
  "binary content round-trips byte for byte",
  Buffer.compare(Buffer.from(info.blob), Buffer.from(entries[4].bytes)) === 0,
  info.blob.join(","),
);

// Path safety: an unarchiver must never be handed a traversal.
check("path traversal is stripped", Z.safeZipPath(["..", "..", "etc", "passwd"]) === "etc/passwd", Z.safeZipPath(["..", "..", "etc", "passwd"]));
check("leading slashes do not make entries absolute", Z.safeZipPath(["/abs", "x.txt"]) === "abs/x.txt", Z.safeZipPath(["/abs", "x.txt"]));

// Collisions: the same full path twice would silently drop a file.
const d = Z.dedupePaths(["a/n.txt", "a/n.txt", "a/n.txt", "b/n.txt"]);
check("duplicate paths are disambiguated, not dropped", new Set(d).size === 4, d.join(","));
check("the counter goes before the extension", d[1] === "a/n (1).txt", d[1]);

// An oversized archive must be refused rather than silently wrapping its 32-bit offsets.
let threw = false;
try {
  Z.makeZip([{ path: "big", bytes: { length: Z.ZIP_MAX_BYTES + 1 } }]);
} catch {
  threw = true;
}
check("an archive too large for the format is refused", threw);

rmSync(out, { recursive: true, force: true });
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
