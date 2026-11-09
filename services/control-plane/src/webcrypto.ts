/**
 * WebCrypto wrappers used by the control plane.
 *
 *  - HMAC-SHA256 — symmetric tokens the Worker both issues and verifies
 *    (session tokens, relay-admission tokens).
 *  - Ed25519 — the control plane's asymmetric signing key for the **perpetual
 *    license token**, which the Rust host verifies offline with only the public
 *    key (see `core-crypto::verify_license`). Also used to verify EdDSA passkeys.
 *  - ES256 (P-256) — verify ES256 passkey assertions (the common authenticator
 *    algorithm).
 *
 * workerd exposes `crypto.subtle` with "Ed25519", "ECDSA"/P-256, and "HMAC".
 */
import { b64uDecode, b64uEncode, concatBytes } from "./util";

// --- HMAC ------------------------------------------------------------------

async function hmacKey(secret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function hmacSign(secret: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, msg);
  return new Uint8Array(sig);
}

export async function hmacVerify(secret: Uint8Array, msg: Uint8Array, mac: Uint8Array): Promise<boolean> {
  const key = await hmacKey(secret);
  return crypto.subtle.verify("HMAC", key, mac, msg);
}

// --- Ed25519 ---------------------------------------------------------------

// PKCS#8 DER prefix for an Ed25519 private key carrying a raw 32-byte seed.
const ED25519_PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

export async function ed25519ImportSeed(seed: Uint8Array): Promise<CryptoKey> {
  if (seed.length !== 32) throw new Error("ed25519 seed must be 32 bytes");
  const pkcs8 = concatBytes(ED25519_PKCS8_PREFIX, seed);
  return crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);
}

/** Recover the 32-byte raw public key from an (extractable) Ed25519 private key. */
export async function ed25519PublicRaw(priv: CryptoKey): Promise<Uint8Array> {
  const jwk = (await crypto.subtle.exportKey("jwk", priv)) as JsonWebKey;
  if (!jwk.x) throw new Error("no public component in jwk");
  return b64uDecode(jwk.x);
}

export async function ed25519Sign(priv: CryptoKey, msg: Uint8Array): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign("Ed25519", priv, msg);
  return new Uint8Array(sig);
}

export async function ed25519VerifyRaw(
  pubRaw: Uint8Array,
  msg: Uint8Array,
  sig: Uint8Array,
): Promise<boolean> {
  const pub = await crypto.subtle.importKey("raw", pubRaw, { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify("Ed25519", pub, sig, msg);
}

// --- ES256 (P-256) — WebAuthn assertion verification -----------------------

/** Import a raw P-256 public key from its (x, y) affine coordinates (32 bytes each). */
export async function importEs256Public(x: Uint8Array, y: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: b64uEncode(x), y: b64uEncode(y), ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

/**
 * Verify an ES256 WebAuthn assertion signature. WebAuthn signs
 * `authenticatorData || SHA-256(clientDataJSON)`; the signature is DER-encoded,
 * so we convert it to the raw r||s form WebCrypto's ECDSA verify expects.
 */
export async function es256Verify(
  pub: CryptoKey,
  signedData: Uint8Array,
  derSig: Uint8Array,
): Promise<boolean> {
  const raw = derToRawEcdsaSig(derSig);
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, raw, signedData);
}

/** DER (SEQUENCE of two INTEGERs) → fixed 64-byte r||s for P-256. */
function derToRawEcdsaSig(der: Uint8Array): Uint8Array {
  let off = 0;
  if (der[off++] !== 0x30) throw new Error("bad DER sig: no SEQUENCE");
  // length byte (assume short form; ECDSA P-256 sigs are < 128 bytes)
  off++;
  const readInt = (): Uint8Array => {
    if (der[off++] !== 0x02) throw new Error("bad DER sig: no INTEGER");
    let len = der[off++];
    let bytes = der.slice(off, off + len);
    off += len;
    // strip leading zero padding, then left-pad to 32 bytes
    while (bytes.length > 32 && bytes[0] === 0x00) bytes = bytes.slice(1);
    const padded = new Uint8Array(32);
    padded.set(bytes, 32 - bytes.length);
    return padded;
  };
  const r = readInt();
  const s = readInt();
  return concatBytes(r, s);
}
