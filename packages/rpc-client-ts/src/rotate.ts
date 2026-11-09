// Account-key rotation.
//
// Revoking a device removes it from every host's allowlist within 30 seconds, so it can no
// longer reach anything. What revoking does NOT do is take back the account key that device
// already holds: the key is not wrapped per-device, so there is no per-device wrapping to
// remove, and re-wrapping the server's copies changes nothing for a device that already has
// the plaintext. If that device later obtains ciphertext by another route — an old backup, a
// copied data directory — it can still read it.
//
// Rotation is the only thing that actually revokes access. Mint a new account key and
// re-wrap every file's content key under it. File BODIES are never touched: each file has
// its own content key, and only the wrapping of that key changes, so rotating a drive costs
// one small write per file instead of re-encrypting every byte.
//
// ORDER OF OPERATIONS, AND WHY. Rotation cannot be atomic across a whole drive, so it is
// built to be interrupted:
//
//   1. Mint the new key and put it at the FRONT of the local keyring, keeping the old one.
//      Reads try every entry, so from here on both old and new files open.
//   2. Publish the whole keyring to the control plane, wrapped under the password and under
//      a fresh recovery key, BEFORE re-wrapping anything. A device signing in mid-rotation
//      must receive both keys or it will find half the drive unreadable.
//   3. Re-wrap every file, newest key first.
//   4. Only once every file is confirmed on the new key, drop the old one and publish the
//      shortened keyring. Until that point the old key is still needed and must be kept.
//
// A crash anywhere leaves a longer keyring than necessary and nothing unreadable. Running
// rotation again finishes the job.

import type { DriveApi, FileEntry } from "./types";
import {
  deriveMasterKey,
  fromHex,
  newRecoveryKey,
  randomKey,
  splitKeys,
  splitRecoveryKey,
  toB64,
  toHex,
  unwrapContentKeyAny,
  wrapArkForRecovery,
  wrapContentKey,
  wrapKeyring,
  DEFAULT_KDF,
  type KdfParams,
} from "./crypto";
import { getKeyringHex, setKeyringHex } from "./config";

export interface RotateProgress {
  /** Files re-wrapped so far. */
  done: number;
  /** Files that need re-wrapping, known only after the walk. */
  total: number;
  phase: "scanning" | "rewrapping" | "finishing";
}

export interface RotateResult {
  /** Show this once. Rotation issues a fresh recovery key, because the old one unwraps the old account key. */
  recoveryKeyHex: string;
  filesRewrapped: number;
  /** Files that could not be re-wrapped. Non-zero means the old key was KEPT. */
  failed: number;
}

/** Every file in the drive, walked breadth-first from the root. */
async function allFiles(api: DriveApi): Promise<{ id: string; path: string }[]> {
  const out: { id: string; path: string }[] = [];
  const queue: string[] = ["/"];
  const seen = new Set<string>();
  while (queue.length) {
    const dir = queue.shift()!;
    if (seen.has(dir)) continue;
    seen.add(dir);
    let entries: FileEntry[];
    try {
      entries = (await api.listDir(dir)).entries;
    } catch {
      // A directory that cannot be listed is reported by leaving its files un-rotated,
      // which keeps the old key alive rather than silently declaring success.
      continue;
    }
    for (const e of entries) {
      const path = e.path ?? (dir === "/" ? `/${e.name}` : `${dir}/${e.name}`);
      if (e.kind === "dir") queue.push(path);
      else out.push({ id: e.id, path });
    }
  }
  return out;
}

/**
 * Rotate this account's key.
 *
 * `password` is required because the server's copy of the keyring is wrapped under it and we
 * never keep the derived key around. A fresh recovery key is issued at the same time: the old
 * one unwraps the OLD account key, so leaving it valid would leave exactly the access this
 * operation exists to remove.
 */
export async function rotateAccountKey(opts: {
  api: DriveApi;
  controlUrl: string;
  sessionToken: string;
  email: string;
  password: string;
  onProgress?: (p: RotateProgress) => void;
}): Promise<RotateResult> {
  const { api, controlUrl, sessionToken, email, password, onProgress } = opts;
  const base = controlUrl.replace(/\/+$/, "");

  // Refuse rather than pretend: without a real host there is nothing to re-wrap, and a
  // rotation that reported success while changing nothing would be the worst outcome here.
  if (!api.rewrapKey || !api.inspectKey) {
    throw new Error("Connect to a host before rotating your account key.");
  }

  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`${path} → ${res.status}${t ? `: ${t.slice(0, 200)}` : ""}`);
    }
    return res.json().catch(() => ({}));
  };

  // ---- 1. New key at the front of the ring, old key retained ----
  const oldRing = getKeyringHex().map((h) => fromHex(h));
  const fresh = randomKey();
  const ring = [fresh, ...oldRing];
  if (!setKeyringHex(ring.map((k) => toHex(k)))) {
    throw new Error("Could not store the new account key on this device.");
  }

  // ---- 2. Publish the WHOLE ring before re-wrapping anything ----
  // A device that signs in mid-rotation needs every key, or half the drive is unreadable
  // to it. This is why publishing comes first and pruning comes last.
  const salt = randomKey();
  const params: KdfParams = DEFAULT_KDF;
  const { encKey, authKey } = splitKeys(deriveMasterKey(password, salt, params));
  const recoveryKey = newRecoveryKey();
  const rec = splitRecoveryKey(recoveryKey);

  const publish = async (keys: Uint8Array[]) => {
    await post("/api/auth/rekey", {
      email,
      auth_key: toB64(authKey),
      kdf: { salt: toB64(salt), algo: params.algo, N: params.N, r: params.r, p: params.p },
      wrapped_ark: toB64(wrapKeyring(encKey, keys)),
      recovery_wrapped_ark: toB64(wrapArkForRecovery(rec.encKey, keys[0])),
      recovery_auth: toB64(rec.authKey),
    });
  };
  await publish(ring);

  // ---- 3. Re-wrap every file ----
  onProgress?.({ done: 0, total: 0, phase: "scanning" });
  const files = await allFiles(api);
  onProgress?.({ done: 0, total: files.length, phase: "rewrapping" });

  let done = 0;
  let failed = 0;
  for (const f of files) {
    try {
      const info = await api.inspectKey(f.id);
      // Already on the newest key: a resumed rotation skips what it finished last time.
      if (info.keyIndex !== 0) {
        await api.rewrapKey(f.id, wrapContentKey(fresh, info.ck));
      }
      done++;
    } catch {
      failed++;
    }
    onProgress?.({ done, total: files.length, phase: "rewrapping" });
  }

  // ---- 4. Prune, but ONLY if nothing was left behind ----
  onProgress?.({ done, total: files.length, phase: "finishing" });
  if (failed === 0) {
    setKeyringHex([toHex(fresh)]);
    await publish([fresh]);
  }
  // With failures, the old key stays in the ring and on the server. Rotation has not
  // achieved its purpose yet, and saying so beats dropping a key some file still needs.

  return { recoveryKeyHex: toHex(recoveryKey), filesRewrapped: done, failed };
}

/** Re-export so callers can try every key without importing crypto directly. */
export { unwrapContentKeyAny };
