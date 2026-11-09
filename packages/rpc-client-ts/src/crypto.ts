// Browser-side E2EE, byte-compatible with the Rust `core-crypto`/`core-net`
// constructions so it interoperates with the real host:
//   - X25519 sealed box  (eph X25519 -> DH -> HKDF-SHA256(salt=eph_pub,
//     info="personal-cloud/sealed-box/v1") -> XChaCha20-Poly1305, AAD=eph_pub)
//   - Ed25519 signing (device identity)
//   - XChaCha20-Poly1305 AEAD frames (nonce||ct, AAD = per-direction u64 BE counter)
//   - file E2EE: content key seals plaintext (AAD "file"); ARK wraps the key (AAD "content-key")
//
// BigInt-free: uses StableLib (Ed25519/X25519/XChaCha20-Poly1305) + @noble/hashes
// (sha256/hkdf/scrypt), so it parses and runs on old WebViews (Mojave/High Sierra,
// whose JavaScriptCore has no BigInt). StableLib is verified byte-identical to the
// previous @noble primitives (see _interop test), so Rust interop is preserved.

import { XChaCha20Poly1305 } from "@stablelib/xchacha20poly1305";
import * as x25519 from "@stablelib/x25519";
import * as ed25519 from "@stablelib/ed25519";
import { HKDF } from "@stablelib/hkdf";
import { SHA256 } from "@stablelib/sha256";
import { deriveKey as scryptDeriveKey } from "@stablelib/scrypt";
import { randomBytes } from "@stablelib/random";

const NONCE = 24;
const enc = new TextEncoder();
const SEALED_INFO = enc.encode("personal-cloud/sealed-box/v1");
const AAD_FILE = enc.encode("file");
const AAD_CK = enc.encode("content-key");

export function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

// ---- base64 / hex (base64 matches Rust's STANDARD engine) ----
export function toB64(bytes: Uint8Array): string {
  // chunked: char-by-char concat is O(n^2)-ish and freezes on large files
  let binary = "";
  const CHUNK = 0x8000; // 32 KB
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(binary);
}
export function fromB64(str: string): Uint8Array {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim().replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- symmetric AEAD (matches SymKey::seal/open) ----
export function symSeal(key: Uint8Array, aad: Uint8Array, msg: Uint8Array): Uint8Array {
  const nonce = randomBytes(NONCE);
  const ct = new XChaCha20Poly1305(key).seal(nonce, msg, aad);
  return concatBytes(nonce, ct);
}
export function symOpen(key: Uint8Array, aad: Uint8Array, blob: Uint8Array): Uint8Array {
  const nonce = blob.slice(0, NONCE);
  const ct = blob.slice(NONCE);
  const pt = new XChaCha20Poly1305(key).open(nonce, ct, aad);
  if (!pt) throw new Error("AEAD authentication failed (invalid tag)");
  return pt;
}

// ---- sealed box to a recipient X25519 public key (matches seal_to) ----
export function sealTo(recipientPub: Uint8Array, key: Uint8Array): Uint8Array {
  const eph = x25519.generateKeyPair();
  const ephPub = eph.publicKey;
  const shared = x25519.sharedKey(eph.secretKey, recipientPub);
  const wrap = new HKDF(SHA256, shared, ephPub, SEALED_INFO).expand(32);
  const sealed = symSeal(wrap, ephPub, key);
  return concatBytes(ephPub, sealed);
}

// ---- device identity (Ed25519) ----
export interface ClientKeys {
  edPriv: Uint8Array; // 64-byte StableLib secret key (seed||pub)
  edPub: Uint8Array; // 32 bytes == DeviceId
}
export function generateClientKeys(): ClientKeys {
  const kp = ed25519.generateKeyPair();
  return { edPriv: kp.secretKey, edPub: kp.publicKey };
}
export function sign(edPriv: Uint8Array, msg: Uint8Array): Uint8Array {
  return ed25519.sign(edPriv, msg);
}

// ---- AEAD session (matches core-net::session::Session) ----
// Counter is a JS number (exact to 2^53 — far beyond any session's frame count),
// serialized big-endian to match the Rust u64 `to_be_bytes()`. BigInt-free.
export class Session {
  private tx = 0;
  private rx = 0;
  constructor(private key: Uint8Array) {}

  seal(plaintext: Uint8Array): Uint8Array {
    const aad = u64be(this.tx);
    this.tx += 1;
    return symSeal(this.key, aad, plaintext);
  }
  open(blob: Uint8Array): Uint8Array {
    const aad = u64be(this.rx);
    this.rx += 1;
    return symOpen(this.key, aad, blob);
  }
}

function u64be(n: number): Uint8Array {
  const b = new Uint8Array(8);
  const hi = Math.floor(n / 0x100000000); // high 32 bits
  const lo = n >>> 0; // low 32 bits
  b[0] = (hi >>> 24) & 0xff;
  b[1] = (hi >>> 16) & 0xff;
  b[2] = (hi >>> 8) & 0xff;
  b[3] = hi & 0xff;
  b[4] = (lo >>> 24) & 0xff;
  b[5] = (lo >>> 16) & 0xff;
  b[6] = (lo >>> 8) & 0xff;
  b[7] = lo & 0xff;
  return b;
}

export function randomKey(): Uint8Array {
  return randomBytes(32);
}

// ---- master-password auth (KDF + ARK wrapping) --------------------------------
// A master password derives a 32-byte key (scrypt) that is split into two
// independent sub-keys: `encKey` wraps the random ARK (never leaves the device),
// `authKey` is the login proof sent to the zero-knowledge control plane (which
// stores only its hash). Changing the password re-wraps the *same* ARK, so no
// files are ever re-encrypted. scrypt (not Argon2id) is used because it is
// BigInt-free and so runs on old WebViews; the KDF is client-only, so it needs no
// Rust interop.
const AAD_ARK = enc.encode("ark-wrap/v1");
const KDF_ENC_INFO = enc.encode("pc/enc/v1");
const KDF_AUTH_INFO = enc.encode("pc/auth/v1");

export interface KdfParams {
  algo: "scrypt";
  N: number; // CPU/memory cost (power of 2)
  r: number; // block size
  p: number; // parallelism
}
/** Tuned so a modern browser derives in ~0.2–0.5s; stored per-account so it stays adjustable. */
export const DEFAULT_KDF: KdfParams = { algo: "scrypt", N: 32768, r: 8, p: 1 };

/** Derive the 32-byte master key from a password + per-account salt (scrypt). */
export function deriveMasterKey(password: string, salt: Uint8Array, params: KdfParams = DEFAULT_KDF): Uint8Array {
  return scryptDeriveKey(enc.encode(password), salt, params.N, params.r, params.p, 32);
}

/** Split the master key into independent encryption + auth sub-keys (HKDF, distinct info). */
export function splitKeys(masterKey: Uint8Array): { encKey: Uint8Array; authKey: Uint8Array } {
  const salt = new Uint8Array(0);
  return {
    encKey: new HKDF(SHA256, masterKey, salt, KDF_ENC_INFO).expand(32),
    authKey: new HKDF(SHA256, masterKey, salt, KDF_AUTH_INFO).expand(32),
  };
}

/** Wrap / unwrap the ARK under the password-derived encryption key. */
export function wrapArk(encKey: Uint8Array, ark: Uint8Array): Uint8Array {
  return symSeal(encKey, AAD_ARK, ark);
}
export function unwrapArk(encKey: Uint8Array, wrapped: Uint8Array): Uint8Array {
  return symOpen(encKey, AAD_ARK, wrapped);
}

// ---- recovery key -------------------------------------------------------------
// A SECOND, independent wrapping of the same ARK, under a random 256-bit key held only
// by the user. It is what makes "forgot my password" survivable in a design where the
// server cannot reset anything.
//
// The recovery key is deliberately NOT the ARK. An earlier build showed the raw ARK and
// called it a recovery key, which meant the file in someone's Downloads folder decrypted
// every file they owned, forever, with no way to rotate it. Here the ARK never leaves the
// device, and the recovery key only unwraps a blob the server stores.
//
// It splits exactly like the password-derived master key: `encKey` unwraps the blob and
// never leaves the device, `authKey` is the proof sent to the server (which stores only
// its hash). So handing the server a proof of possession reveals nothing that could open
// the blob, and a database leak yields neither.
const AAD_ARK_REC = enc.encode("ark-wrap-recovery/v1");
const KDF_REC_ENC_INFO = enc.encode("pc/recovery-enc/v1");
const KDF_REC_AUTH_INFO = enc.encode("pc/recovery-auth/v1");

/** A fresh recovery key. 32 bytes of randomness, shown to the user once, as hex. */
export function newRecoveryKey(): Uint8Array {
  return randomKey();
}

/** Split a recovery key into an independent wrapping key + server proof. */
export function splitRecoveryKey(recoveryKey: Uint8Array): { encKey: Uint8Array; authKey: Uint8Array } {
  const salt = new Uint8Array(0);
  return {
    encKey: new HKDF(SHA256, recoveryKey, salt, KDF_REC_ENC_INFO).expand(32),
    authKey: new HKDF(SHA256, recoveryKey, salt, KDF_REC_AUTH_INFO).expand(32),
  };
}

/**
 * Wrap / unwrap the ARK under a recovery key's encryption half.
 *
 * A distinct AAD from `wrapArk`, so a password-wrapped blob and a recovery-wrapped blob
 * can never be silently interchanged even if the two ciphertexts were ever swapped.
 */
export function wrapArkForRecovery(recEncKey: Uint8Array, ark: Uint8Array): Uint8Array {
  return symSeal(recEncKey, AAD_ARK_REC, ark);
}
export function unwrapArkForRecovery(recEncKey: Uint8Array, wrapped: Uint8Array): Uint8Array {
  return symOpen(recEncKey, AAD_ARK_REC, wrapped);
}

// ---- file E2EE (matches client_core::encrypt_file/decrypt_file) ----
export interface WirePayload {
  wrapped_ck: Uint8Array;
  plaintext_len: number;
  ciphertext: Uint8Array;
}
export function encryptFile(ark: Uint8Array, plaintext: Uint8Array): WirePayload {
  const ck = randomKey();
  const ciphertext = symSeal(ck, AAD_FILE, plaintext);
  const wrapped_ck = symSeal(ark, AAD_CK, ck);
  return { wrapped_ck, plaintext_len: plaintext.length, ciphertext };
}
export function decryptFile(ark: Uint8Array, wrapped_ck: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const ck = symOpen(ark, AAD_CK, wrapped_ck);
  return symOpen(ck, AAD_FILE, ciphertext);
}

// ---- content key wrapping + per-chunk E2EE (for streamed transfer) ----
export function wrapContentKey(ark: Uint8Array, ck: Uint8Array): Uint8Array {
  return symSeal(ark, AAD_CK, ck);
}
export function unwrapContentKey(ark: Uint8Array, wrapped: Uint8Array): Uint8Array {
  return symOpen(ark, AAD_CK, wrapped);
}

// ---- account-key rotation ---------------------------------------------------
//
// Revoking a device removes it from every host's allowlist, but it does not take back the
// account key that device already holds. The only thing that does is rotating the key: mint
// a new one and re-wrap every file's content key under it. File bodies are untouched, since
// each file has its own content key and only its WRAPPING changes.
//
// Rotation cannot be atomic across a whole drive, so the design assumes it will be
// interrupted. The device therefore holds a KEYRING, newest first, and tries every key when
// opening a content key. A half-finished rotation leaves some files under the new key and
// some under the old; with both in the ring, every file still opens. The old key is dropped
// only once no file needs it, which is the moment rotation has actually achieved anything.

/**
 * Open a wrapped content key with whichever keyring entry wrapped it.
 *
 * Returns the content key and the index of the key that worked; index > 0 means this file
 * has not been re-wrapped yet, which is how a rotation knows what is left to do.
 */
export function unwrapContentKeyAny(
  keyring: Uint8Array[],
  wrapped: Uint8Array,
): { ck: Uint8Array; keyIndex: number } {
  for (let i = 0; i < keyring.length; i++) {
    try {
      return { ck: symOpen(keyring[i], AAD_CK, wrapped), keyIndex: i };
    } catch {
      // Wrong key for this file: an AEAD tag failure is the expected signal, not an error.
    }
  }
  throw new Error("No account key in this keyring can open this file.");
}

const AAD_KEYRING = enc.encode("keyring/v1");

/**
 * Wrap a keyring for storage on the control plane.
 *
 * Stored as JSON so the ring can grow and shrink. A legacy account holds a bare 32-byte key
 * instead; `unwrapKeyring` accepts both, so an account created before rotation existed keeps
 * working and is upgraded the first time it rotates.
 */
export function wrapKeyring(encKey: Uint8Array, keyring: Uint8Array[]): Uint8Array {
  const json = JSON.stringify(keyring.map((k) => toHex(k)));
  return symSeal(encKey, AAD_KEYRING, enc.encode(json));
}

/** Open a stored keyring, accepting the legacy single-key form. */
export function unwrapKeyring(encKey: Uint8Array, blob: Uint8Array): Uint8Array[] {
  // Legacy first: a single ARK sealed under the older AAD, which is what every account
  // created before rotation has.
  try {
    const legacy = symOpen(encKey, AAD_ARK, blob);
    if (legacy.length === 32) return [legacy];
  } catch {
    // Not the legacy form; fall through to the keyring form.
  }
  const raw = symOpen(encKey, AAD_KEYRING, blob);
  const hexes = JSON.parse(new TextDecoder().decode(raw)) as string[];
  if (!Array.isArray(hexes) || !hexes.length) throw new Error("Malformed keyring.");
  const keys = hexes.map((h) => fromHex(h));
  if (keys.some((k) => k.length !== 32)) throw new Error("Malformed keyring.");
  return keys;
}
/** AAD binds a chunk to its sequence index so order can't be tampered. */
function chunkAad(seq: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, seq >>> 0, false);
  return b;
}
export function encryptChunk(ck: Uint8Array, seq: number, plaintext: Uint8Array): Uint8Array {
  return symSeal(ck, chunkAad(seq), plaintext);
}
export function decryptChunk(ck: Uint8Array, seq: number, ciphertext: Uint8Array): Uint8Array {
  return symOpen(ck, chunkAad(seq), ciphertext);
}
