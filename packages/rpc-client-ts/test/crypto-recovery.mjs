/**
 * Recovery-key crypto round-trip.
 *
 * The control-plane e2e proves the SERVER contract, but the server sees only opaque
 * blobs — it cannot tell a correct wrapping from a broken one. This exercises the actual
 * shipped primitives, because a bug here does not throw an error, it permanently locks a
 * customer out of every file they own.
 *
 * Run: node test/crypto-recovery.mjs   (bundles ../src/crypto.ts with esbuild first)
 */
import { execFileSync } from "node:child_process";
import { existsSync, globSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");
const out = mkdtempSync(join(tmpdir(), "pc-crypto-"));
const bundle = join(out, "crypto.mjs");

/** esbuild ships as a native binary, and is a transitive dep of vite rather than a direct
 *  one, so locate it rather than hardcoding a version-pinned pnpm path. */
function esbuildBin() {
  const direct = join(root, "node_modules/.bin/esbuild");
  if (existsSync(direct)) return direct;
  const found = globSync("node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild", { cwd: root });
  if (!found.length) throw new Error("esbuild not found; run pnpm install");
  return join(root, found.sort().reverse()[0]);
}

// Node 22.5 has no type stripping, so bundle the real module rather than reimplementing it.
execFileSync(
  esbuildBin(),
  [
    join(here, "../src/crypto.ts"),
    "--bundle",
    "--format=esm",
    "--platform=node",
    `--outfile=${bundle}`,
    "--log-level=error",
  ],
  { stdio: "inherit" },
);

const C = await import(bundle);

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
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

console.log("\nRecovery-key crypto\n");

// The shape of a real signup: a random ARK, and a recovery key that wraps it.
const ark = C.randomKey();
const rk = C.newRecoveryKey();
check("a recovery key is 32 bytes", rk.length === 32, `got ${rk.length}`);
check("a recovery key is not the ARK", !same(rk, ark));

const { encKey, authKey } = C.splitRecoveryKey(rk);
check("the wrapping half and the server proof are different keys", !same(encKey, authKey));
check("neither half is the recovery key itself", !same(encKey, rk) && !same(authKey, rk));

// Deterministic: the same key must split the same way on another device, or recovery
// performed anywhere other than the original machine would fail.
const again = C.splitRecoveryKey(rk);
check("splitting is deterministic across calls", same(encKey, again.encKey) && same(authKey, again.authKey));

// The round trip that recovery depends on.
const wrapped = C.wrapArkForRecovery(encKey, ark);
check("the wrapped ARK is not the ARK in the clear", !same(wrapped.slice(0, 32), ark));
const opened = C.unwrapArkForRecovery(encKey, wrapped);
check("the recovery key recovers the exact ARK", same(opened, ark));

// A wrong key must fail loudly (AEAD tag), never return plausible garbage that would be
// written back as a corrupt ARK.
let threw = false;
try {
  C.unwrapArkForRecovery(C.splitRecoveryKey(C.newRecoveryKey()).encKey, wrapped);
} catch {
  threw = true;
}
check("a wrong recovery key fails closed", threw);

// The two wrappings of the same ARK are separately keyed and separately domained, so a
// password blob can never be opened as a recovery blob or vice versa.
const pwEnc = C.splitKeys(C.deriveMasterKey("correct horse battery", C.randomKey())).encKey;
const pwWrapped = C.wrapArk(pwEnc, ark);
check("password and recovery wrappings differ", !same(pwWrapped, wrapped));
let crossFailed = false;
try {
  C.unwrapArkForRecovery(pwEnc, pwWrapped);
} catch {
  crossFailed = true;
}
check("a password-wrapped ARK cannot be opened as a recovery blob", crossFailed);

// Recovery re-wraps the SAME ARK under a new password: no file is ever re-encrypted.
const newEnc = C.splitKeys(C.deriveMasterKey("a whole new password", C.randomKey())).encKey;
const rewrapped = C.wrapArk(newEnc, C.unwrapArkForRecovery(encKey, wrapped));
check("after recovery the new password yields the original ARK", same(C.unwrapArk(newEnc, rewrapped), ark));

// ---- account-key rotation ----------------------------------------------------
// The property that matters: NO SEQUENCE of rotation steps, including an interrupted one,
// may make a file unreadable. A bug here does not throw at the time; it silently strands
// data under a key nobody keeps.
console.log("\nAccount-key rotation\n");

const arkA = C.randomKey();
const arkB = C.randomKey();
const te = new TextEncoder();
const AAD_FILE = te.encode("file");
const content = te.encode("the file body never changes during rotation");

// A file written under key A.
const ckA = C.randomKey();
const body = C.symSeal(ckA, AAD_FILE, content);
let wrappedCk = C.wrapContentKey(arkA, ckA);

// Mid-rotation: the ring holds BOTH keys and this file is still on the old one.
const mid = C.unwrapContentKeyAny([arkB, arkA], wrappedCk);
check("a not-yet-rotated file still opens mid-rotation", same(mid.ck, ckA));
check("the ring reports which key opened it", mid.keyIndex === 1, String(mid.keyIndex));

// Re-wrap under the new key. The CONTENT KEY and the body are unchanged.
wrappedCk = C.wrapContentKey(arkB, mid.ck);
const after = C.unwrapContentKeyAny([arkB, arkA], wrappedCk);
check("a re-wrapped file opens under the new key", same(after.ck, ckA) && after.keyIndex === 0);
check("the file body is untouched by rotation", same(C.symOpen(after.ck, AAD_FILE, body), content));

// Once rotation completes and the old key is dropped, the OLD key must no longer open it.
// This is the entire security purpose: a device holding only arkA is now locked out.
let oldFails = false;
try {
  C.unwrapContentKeyAny([arkA], wrappedCk);
} catch {
  oldFails = true;
}
check("after rotation the old key cannot open the file", oldFails);
check("the new key alone is sufficient", same(C.unwrapContentKeyAny([arkB], wrappedCk).ck, ckA));

// The keyring survives a storage round trip, including the legacy single-key shape.
const ringEnc = C.splitKeys(C.deriveMasterKey("pw", C.randomKey())).encKey;
const ringBlob = C.wrapKeyring(ringEnc, [arkB, arkA]);
const ringBack = C.unwrapKeyring(ringEnc, ringBlob);
check("a keyring round-trips through storage", ringBack.length === 2 && same(ringBack[0], arkB) && same(ringBack[1], arkA));
const legacyBlob = C.wrapArk(ringEnc, arkA);
const legacyBack = C.unwrapKeyring(ringEnc, legacyBlob);
check("a legacy single-key account reads as a one-entry ring", legacyBack.length === 1 && same(legacyBack[0], arkA));

let wrongPw = false;
try {
  C.unwrapKeyring(C.splitKeys(C.deriveMasterKey("wrong", C.randomKey())).encKey, ringBlob);
} catch {
  wrongPw = true;
}
check("a keyring cannot be opened with the wrong password", wrongPw);

rmSync(out, { recursive: true, force: true });
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
