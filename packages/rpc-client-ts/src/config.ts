// Connection config + client identity, persisted in localStorage so a reload
// keeps the same device keypair + ARK (otherwise previously-uploaded files could
// not be decrypted).

import { fromB64, generateClientKeys, randomKey, toB64 } from "./crypto";

const CONN_KEY = "pc.conn";
const ID_KEY = "pc.identity";
const KEYRING_KEY = "pc.keyring";

export interface HostConnConfig {
  relayUrl: string; // e.g. ws://127.0.0.1:8790
  account: string; // rendezvous account id
  hostPub: string; // host agreement pubkey, hex (printed by pc-daemon)
  /** The owner's partition allocation in bytes. Set by DockAllocate; re-applied via
   *  `setQuota` on each connect so the host enforces it (clamped to the licensed quota).
   *  Absent for configs that only ADOPT an existing host (returning-user / second device). */
  quotaBytes?: number;
}

export function loadConfig(): HostConnConfig | null {
  try {
    const s = localStorage.getItem(CONN_KEY);
    return s ? (JSON.parse(s) as HostConnConfig) : null;
  } catch {
    return null;
  }
}
export function saveConfig(c: HostConnConfig): void {
  localStorage.setItem(CONN_KEY, JSON.stringify(c));
}
export function clearConfig(): void {
  localStorage.removeItem(CONN_KEY);
}

export interface Identity {
  edPriv: Uint8Array;
  edPub: Uint8Array;
  ark: Uint8Array;
}

export function loadOrCreateIdentity(): Identity {
  try {
    const s = localStorage.getItem(ID_KEY);
    if (s) {
      const o = JSON.parse(s);
      const ark = fromB64(o.ark);
      let edPriv = fromB64(o.edPriv);
      let edPub = fromB64(o.edPub);
      // Migrate a pre-StableLib 32-byte device key to the 64-byte format, keeping the ARK
      // so previously-encrypted files still decrypt.
      if (edPriv.length !== 64) {
        const k = generateClientKeys();
        edPriv = k.edPriv;
        edPub = k.edPub;
        localStorage.setItem(ID_KEY, JSON.stringify({ edPriv: toB64(edPriv), edPub: toB64(edPub), ark: toB64(ark) }));
      }
      return { edPriv, edPub, ark };
    }
  } catch {
    // fall through and regenerate
  }
  const k = generateClientKeys();
  const ark = randomKey();
  localStorage.setItem(
    ID_KEY,
    JSON.stringify({ edPriv: toB64(k.edPriv), edPub: toB64(k.edPub), ark: toB64(ark) }),
  );
  return { edPriv: k.edPriv, edPub: k.edPub, ark };
}

// --- Account key (ARK) export/import ------------------------------------------
// Every client encrypts with its Account Root Key; files are only decryptable by a
// client holding the SAME key. To share files across the console, the desktop mount,
// and the CLI, they must use one key — surfaced here as a 64-char hex string the user
// copies between clients (the CLI/desktop take it as `PC_ARK`).

function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
function fromHex(s: string): Uint8Array | null {
  const t = s.trim().toLowerCase();
  if (t.length % 2 !== 0 || !/^[0-9a-f]*$/.test(t)) return null;
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** This device's client id (its Ed25519 pubkey) as hex — used to register/authorize it. */
export function clientDeviceIdHex(): string {
  return toHex(loadOrCreateIdentity().edPub);
}

/** The current account key as hex (creating an identity if none yet). */
export function getAccountKeyHex(): string {
  return toHex(loadOrCreateIdentity().ark);
}

/**
 * The device's account-key KEYRING as hex, newest first.
 *
 * Rotation cannot be atomic across a whole drive, so a half-finished one leaves some files
 * wrapped under the new key and some under the old. Keeping both here is what makes that
 * survivable: every file still opens, and the old key is dropped only once nothing needs it.
 * A device that has never rotated has a ring of one, which is the legacy shape.
 */
export function getKeyringHex(): string[] {
  try {
    const raw = localStorage.getItem(KEYRING_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      if (Array.isArray(arr) && arr.length && arr.every((h) => typeof h === "string" && h.length === 64)) {
        return arr;
      }
    }
  } catch {
    /* fall through to the single key below */
  }
  return [getAccountKeyHex()];
}

/**
 * Replace the keyring. The FIRST entry becomes the account key used for new files, so
 * callers must put the newest key first.
 */
export function setKeyringHex(hexes: string[]): boolean {
  if (!hexes.length || hexes.some((h) => (fromHex(h)?.length ?? 0) !== 32)) return false;
  if (!setAccountKeyHex(hexes[0])) return false;
  try {
    localStorage.setItem(KEYRING_KEY, JSON.stringify(hexes));
  } catch {
    return false;
  }
  return true;
}

/** Set the account key from hex (32 bytes / 64 chars). Returns false if malformed. */
export function setAccountKeyHex(hex: string): boolean {
  const b = fromHex(hex);
  if (!b || b.length !== 32) return false;
  const id = loadOrCreateIdentity();
  localStorage.setItem(
    ID_KEY,
    JSON.stringify({ edPriv: toB64(id.edPriv), edPub: toB64(id.edPub), ark: toB64(b) }),
  );
  return true;
}
