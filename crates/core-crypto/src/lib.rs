//! Cryptographic identity, content addressing, and the E2EE key hierarchy.
//!
//! Constructions (all audited primitives, no invention):
//!   - Ed25519  — device identity (= Iroh NodeId) + request signing
//!   - X25519   — key agreement for sealed-box key wrapping
//!   - XChaCha20-Poly1305 — AEAD for chunks and wrapped keys (192-bit nonce)
//!   - HKDF-SHA256 — derive the sealed-box AEAD key from the DH shared secret
//!   - BLAKE3   — content addressing
//!
//! Key hierarchy: an Account Root Key (ARK) wraps per-file content keys, and only
//! ciphertext is ever handed to the control plane.
//!
//! WHERE THE ARK IS WRAPPED, AND WHY NOT HERE. The two live wrappings of the ARK — under
//! the password and under the recovery key — happen in the TypeScript client
//! (`packages/rpc-client-ts/src/crypto.ts`), because that is where a password is typed. That
//! client uses **scrypt**, not Argon2id: the KDF has to run in old WebViews with no BigInt,
//! which the available Argon2id builds require. See `docs/threat-model.md`.

use aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{aead, XChaCha20Poly1305, XNonce};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use x25519_dalek::{EphemeralSecret, PublicKey as XPublic, StaticSecret};

pub const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 24;
const SEALED_KDF_INFO: &[u8] = b"personal-cloud/sealed-box/v1";

pub type CryptoResult<T> = Result<T, CryptoError>;

#[derive(Debug)]
pub enum CryptoError {
    Aead,
    Format,
    BadKey,
    Signature,
    Kdf,
}

impl std::fmt::Display for CryptoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "crypto error: {self:?}")
    }
}
impl std::error::Error for CryptoError {}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/// A device's public identity: the Ed25519 verifying key bytes (= Iroh NodeId).
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceId([u8; KEY_LEN]);

impl DeviceId {
    pub fn from_bytes(b: [u8; KEY_LEN]) -> Self {
        Self(b)
    }
    pub fn as_bytes(&self) -> &[u8; KEY_LEN] {
        &self.0
    }
    /// Short fingerprint for UI display, e.g. `7f3a…d21c`.
    pub fn short(&self) -> String {
        let h = to_hex(&self.0);
        format!("{}…{}", &h[..4], &h[h.len() - 4..])
    }
}

impl std::fmt::Debug for DeviceId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "DeviceId({})", self.short())
    }
}

/// A device's X25519 public key (recipients wrap keys to this).
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgreementPublic([u8; KEY_LEN]);

impl AgreementPublic {
    pub fn from_bytes(b: [u8; KEY_LEN]) -> Self {
        Self(b)
    }
    pub fn as_bytes(&self) -> &[u8; KEY_LEN] {
        &self.0
    }
}

/// A device keypair: an Ed25519 identity/signing key + an X25519 agreement key.
/// Secrets stay on-device (OS keychain in the real build); only the public
/// halves (`id`, `agreement_public()`) are registered with the control plane.
pub struct DeviceKeypair {
    signing: SigningKey,
    agreement: StaticSecret,
    pub id: DeviceId,
}

impl DeviceKeypair {
    pub fn generate() -> Self {
        let signing = SigningKey::generate(&mut OsRng);
        let id = DeviceId(signing.verifying_key().to_bytes());
        let agreement = StaticSecret::random_from_rng(OsRng);
        Self { signing, agreement, id }
    }

    pub fn agreement_public(&self) -> AgreementPublic {
        AgreementPublic(XPublic::from(&self.agreement).to_bytes())
    }

    /// Serialize the secret keys (signing seed || agreement secret) so the host
    /// can persist a stable identity across restarts. Store securely (OS keychain
    /// in the real build; a 0600 file for the dev daemon).
    pub fn to_bytes(&self) -> [u8; 64] {
        let mut out = [0u8; 64];
        out[..32].copy_from_slice(&self.signing.to_bytes());
        out[32..].copy_from_slice(&self.agreement.to_bytes());
        out
    }

    pub fn from_bytes(b: &[u8; 64]) -> Self {
        let mut sk = [0u8; 32];
        sk.copy_from_slice(&b[..32]);
        let mut ak = [0u8; 32];
        ak.copy_from_slice(&b[32..]);
        let signing = SigningKey::from_bytes(&sk);
        let id = DeviceId(signing.verifying_key().to_bytes());
        let agreement = StaticSecret::from(ak);
        Self { signing, agreement, id }
    }

    pub fn sign(&self, msg: &[u8]) -> [u8; 64] {
        self.signing.sign(msg).to_bytes()
    }

    /// Unwrap a sealed box addressed to this device.
    pub fn open_sealed(&self, blob: &[u8]) -> CryptoResult<SymKey> {
        open_sealed_with(&self.agreement, blob)
    }
}

/// Verify a signature against a device id. Constant-time inside dalek.
pub fn verify(id: &DeviceId, msg: &[u8], sig: &[u8; 64]) -> bool {
    let Ok(vk) = VerifyingKey::from_bytes(&id.0) else {
        return false;
    };
    vk.verify(msg, &Signature::from_bytes(sig)).is_ok()
}

// ---------------------------------------------------------------------------
// Symmetric key + AEAD
// ---------------------------------------------------------------------------

/// A 256-bit symmetric key (content key, ARK, or a derived key).
#[derive(Clone)]
pub struct SymKey([u8; KEY_LEN]);

impl SymKey {
    pub fn generate() -> Self {
        let mut k = [0u8; KEY_LEN];
        OsRng.fill_bytes(&mut k);
        Self(k)
    }
    pub fn from_bytes(b: [u8; KEY_LEN]) -> Self {
        Self(b)
    }
    pub fn as_bytes(&self) -> &[u8; KEY_LEN] {
        &self.0
    }

    /// AEAD-seal `plaintext` with associated data `aad`. Output = nonce || ct.
    pub fn seal(&self, aad: &[u8], plaintext: &[u8]) -> Vec<u8> {
        let cipher = XChaCha20Poly1305::new(self.0.as_ref().into());
        let mut nonce = [0u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce);
        let ct = cipher
            .encrypt(XNonce::from_slice(&nonce), Payload { msg: plaintext, aad })
            .expect("aead encrypt");
        let mut out = Vec::with_capacity(NONCE_LEN + ct.len());
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&ct);
        out
    }

    /// Open a `nonce || ct` blob produced by [`SymKey::seal`].
    pub fn open(&self, aad: &[u8], blob: &[u8]) -> CryptoResult<Vec<u8>> {
        if blob.len() < NONCE_LEN {
            return Err(CryptoError::Format);
        }
        let (nonce, ct) = blob.split_at(NONCE_LEN);
        let cipher = XChaCha20Poly1305::new(self.0.as_ref().into());
        cipher
            .decrypt(XNonce::from_slice(nonce), Payload { msg: ct, aad })
            .map_err(|_| CryptoError::Aead)
    }
}

// ---------------------------------------------------------------------------
// Sealed box (wrap a key to a recipient's X25519 public key)
// ---------------------------------------------------------------------------

fn kdf_shared(shared: &[u8], eph_pub: &[u8; KEY_LEN]) -> CryptoResult<SymKey> {
    let hk = hkdf::Hkdf::<sha2::Sha256>::new(Some(eph_pub), shared);
    let mut okm = [0u8; KEY_LEN];
    hk.expand(SEALED_KDF_INFO, &mut okm).map_err(|_| CryptoError::Kdf)?;
    Ok(SymKey(okm))
}

/// Seal `key` to `recipient`. Output = eph_pub(32) || nonce || ct.
pub fn seal_to(recipient: &AgreementPublic, key: &SymKey) -> Vec<u8> {
    let eph = EphemeralSecret::random_from_rng(OsRng);
    let eph_pub = XPublic::from(&eph);
    let recipient_pub = XPublic::from(*recipient.as_bytes());
    let shared = eph.diffie_hellman(&recipient_pub);
    let wrap = kdf_shared(shared.as_bytes(), &eph_pub.to_bytes()).expect("kdf");
    let sealed = wrap.seal(&eph_pub.to_bytes(), key.as_bytes());
    let mut out = Vec::with_capacity(KEY_LEN + sealed.len());
    out.extend_from_slice(&eph_pub.to_bytes());
    out.extend_from_slice(&sealed);
    out
}

fn open_sealed_with(secret: &StaticSecret, blob: &[u8]) -> CryptoResult<SymKey> {
    if blob.len() < KEY_LEN {
        return Err(CryptoError::Format);
    }
    let (eph_pub_bytes, sealed) = blob.split_at(KEY_LEN);
    let mut eph_pub = [0u8; KEY_LEN];
    eph_pub.copy_from_slice(eph_pub_bytes);
    let shared = secret.diffie_hellman(&XPublic::from(eph_pub));
    let wrap = kdf_shared(shared.as_bytes(), &eph_pub)?;
    let key_bytes = wrap.open(&eph_pub, sealed)?;
    let arr: [u8; KEY_LEN] = key_bytes.as_slice().try_into().map_err(|_| CryptoError::BadKey)?;
    Ok(SymKey(arr))
}

// ---------------------------------------------------------------------------
// Account Root Key hierarchy
// ---------------------------------------------------------------------------

/// The Account Root Key. Wraps per-file content keys; itself only ever stored as
/// ciphertext (wrapped to a device key).
pub struct AccountRootKey(SymKey);

impl AccountRootKey {
    pub fn generate() -> Self {
        Self(SymKey::generate())
    }

    pub fn wrap_content_key(&self, ck: &SymKey) -> Vec<u8> {
        self.0.seal(b"content-key", ck.as_bytes())
    }
    pub fn unwrap_content_key(&self, blob: &[u8]) -> CryptoResult<SymKey> {
        let bytes = self.0.open(b"content-key", blob)?;
        let arr: [u8; KEY_LEN] = bytes.as_slice().try_into().map_err(|_| CryptoError::BadKey)?;
        Ok(SymKey(arr))
    }

    /// The raw 32-byte key. Dev/local persistence only — in production the ARK is
    /// stored WRAPPED (to a device key), never bare on disk.
    pub fn to_bytes(&self) -> [u8; KEY_LEN] {
        *self.0.as_bytes()
    }
    pub fn from_bytes(b: [u8; KEY_LEN]) -> Self {
        Self(SymKey::from_bytes(b))
    }

    /// Wrap the ARK to a device's X25519 public key (so approved devices unwrap it).
    pub fn wrap_to_device(&self, device: &AgreementPublic) -> Vec<u8> {
        seal_to(device, &self.0)
    }
    pub fn unwrap_from_device(device: &DeviceKeypair, blob: &[u8]) -> CryptoResult<Self> {
        Ok(Self(device.open_sealed(blob)?))
    }
}

// ---------------------------------------------------------------------------
// Per-chunk content AEAD (streamed transfer)
// ---------------------------------------------------------------------------

/// Seal one plaintext chunk under content key `ck`. The AAD is the chunk's
/// sequence index as a u32 big-endian, binding each chunk to its position so
/// chunks cannot be reordered, dropped, or duplicated. Output = nonce || ct.
///
/// Byte-compatible with the TypeScript client's `encryptChunk` (see
/// `packages/rpc-client-ts/src/crypto.ts`), so a file streamed by the WebDAV
/// mount and one streamed by the browser are mutually readable.
pub fn seal_chunk(ck: &SymKey, seq: u32, plaintext: &[u8]) -> Vec<u8> {
    ck.seal(&seq.to_be_bytes(), plaintext)
}

/// Reverse of [`seal_chunk`]: open chunk `seq`'s ciphertext under `ck`.
pub fn open_chunk(ck: &SymKey, seq: u32, ciphertext: &[u8]) -> CryptoResult<Vec<u8>> {
    ck.open(&seq.to_be_bytes(), ciphertext)
}

// ---------------------------------------------------------------------------
// License token (perpetual, one-time-purchase entitlement)
// ---------------------------------------------------------------------------

/// A perpetual entitlement minted by the control plane after a one-time purchase.
/// Signed with the control plane's Ed25519 key; the host verifies it OFFLINE with
/// the pinned public key and enforces `quota_bytes` — no renewal, no round-trip.
#[derive(Clone, Debug, Deserialize)]
pub struct License {
    pub v: u32,
    pub typ: String,
    pub account: String,
    pub tier: String,
    pub quota_bytes: u64,
    /// Host machines this license covers. `None` on tokens minted before seats existed;
    /// those were sold without a host limit and are left unenforced rather than
    /// retroactively capped. Seats are enforced at enrolment by the control plane, so a
    /// host only needs to be able to read and report its own entitlement.
    #[serde(default)]
    pub host_seats: Option<u32>,
    pub payment_ref: String,
    pub iat: i64,
}

/// Verify a `payload.sig` license token against the control plane's public key.
///
/// The signed message is the ASCII of the base64url payload segment (matching the
/// control-plane signer), so this is: split on '.', Ed25519-verify `sig` over the
/// payload segment's bytes, then base64url-decode the payload to the claims JSON.
pub fn verify_license(token: &str, cp_pubkey: &[u8; KEY_LEN]) -> CryptoResult<License> {
    use base64::Engine;
    let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let (payload_b64, sig_b64) = token.split_once('.').ok_or(CryptoError::Format)?;
    let sig_bytes = engine.decode(sig_b64).map_err(|_| CryptoError::Format)?;
    let sig: [u8; 64] = sig_bytes.as_slice().try_into().map_err(|_| CryptoError::Format)?;
    let id = DeviceId(*cp_pubkey);
    if !verify(&id, payload_b64.as_bytes(), &sig) {
        return Err(CryptoError::Signature);
    }
    let payload = engine.decode(payload_b64).map_err(|_| CryptoError::Format)?;
    let lic: License = serde_json::from_slice(&payload).map_err(|_| CryptoError::Format)?;
    if lic.typ != "license" {
        return Err(CryptoError::Format);
    }
    Ok(lic)
}

// ---------------------------------------------------------------------------
// Content addressing
// ---------------------------------------------------------------------------

/// Fill `buf` with cryptographically secure random bytes.
pub fn fill_random(buf: &mut [u8]) {
    OsRng.fill_bytes(buf);
}

pub fn content_hash(bytes: &[u8]) -> [u8; 32] {
    *blake3::hash(bytes).as_bytes()
}

pub fn to_hex(b: &[u8]) -> String {
    let mut s = String::with_capacity(b.len() * 2);
    for x in b {
        s.push_str(&format!("{x:02x}"));
    }
    s
}

pub fn from_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keypairs_are_unique() {
        assert_ne!(DeviceKeypair::generate().id, DeviceKeypair::generate().id);
    }

    #[test]
    fn content_hash_is_stable() {
        assert_eq!(content_hash(b"hello"), content_hash(b"hello"));
        assert_ne!(content_hash(b"hello"), content_hash(b"world"));
    }

    #[test]
    fn aead_roundtrip_and_tamper() {
        let k = SymKey::generate();
        let ct = k.seal(b"aad", b"secret payload");
        assert_eq!(k.open(b"aad", &ct).unwrap(), b"secret payload");
        // wrong aad fails
        assert!(k.open(b"other", &ct).is_err());
        // tamper fails
        let mut bad = ct.clone();
        *bad.last_mut().unwrap() ^= 0xff;
        assert!(k.open(b"aad", &bad).is_err());
        // wrong key fails
        assert!(SymKey::generate().open(b"aad", &ct).is_err());
    }

    #[test]
    fn sealed_box_to_device() {
        let device = DeviceKeypair::generate();
        let key = SymKey::generate();
        let blob = seal_to(&device.agreement_public(), &key);
        let opened = device.open_sealed(&blob).unwrap();
        assert_eq!(opened.as_bytes(), key.as_bytes());
        // a different device cannot open it
        assert!(DeviceKeypair::generate().open_sealed(&blob).is_err());
    }

    #[test]
    fn ark_wraps_content_keys_and_devices() {
        let ark = AccountRootKey::generate();
        let ck = SymKey::generate();
        let wrapped = ark.wrap_content_key(&ck);
        assert_eq!(ark.unwrap_content_key(&wrapped).unwrap().as_bytes(), ck.as_bytes());

        // ARK delivered to a new device via its X25519 key
        let device = DeviceKeypair::generate();
        let ark_for_device = ark.wrap_to_device(&device.agreement_public());
        let recovered = AccountRootKey::unwrap_from_device(&device, &ark_for_device).unwrap();
        // the recovered ARK unwraps the same content key
        assert_eq!(recovered.unwrap_content_key(&wrapped).unwrap().as_bytes(), ck.as_bytes());
    }

    #[test]
    fn license_verify_roundtrip_and_tamper() {
        use base64::Engine;
        let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
        // Stand in for the control-plane signing key.
        let cp = DeviceKeypair::generate();
        let claims = serde_json::json!({
            "v": 1, "typ": "license", "account": "acct-1", "tier": "personal",
            "quota_bytes": 8_589_934_592u64, "payment_ref": "pi_test", "iat": 1_700_000_000
        });
        let payload_b64 = engine.encode(serde_json::to_vec(&claims).unwrap());
        let sig = cp.sign(payload_b64.as_bytes());
        let token = format!("{payload_b64}.{}", engine.encode(sig));

        let lic = verify_license(&token, cp.id.as_bytes()).expect("valid license");
        assert_eq!(lic.account, "acct-1");
        assert_eq!(lic.quota_bytes, 8_589_934_592);
        assert_eq!(lic.tier, "personal");

        // wrong key rejected
        let other = DeviceKeypair::generate();
        assert!(matches!(verify_license(&token, other.id.as_bytes()), Err(CryptoError::Signature)));
        // tampered payload rejected
        let tampered = format!("{}.{}", engine.encode(b"{\"typ\":\"license\"}"), token.split('.').nth(1).unwrap());
        assert!(verify_license(&tampered, cp.id.as_bytes()).is_err());
    }

    #[test]
    fn sign_and_verify() {
        let device = DeviceKeypair::generate();
        let msg = b"list_dir /Documents";
        let sig = device.sign(msg);
        assert!(verify(&device.id, msg, &sig));
        // tampered message fails
        assert!(!verify(&device.id, b"list_dir /Secrets", &sig));
        // other device's id fails
        assert!(!verify(&DeviceKeypair::generate().id, msg, &sig));
    }

    #[test]
    fn chunk_seq_binding() {
        let ck = SymKey::generate();
        let pt = b"a streamed chunk of plaintext";
        let ct = seal_chunk(&ck, 3, pt);
        // round-trips under the correct seq
        assert_eq!(open_chunk(&ck, 3, &ct).unwrap(), pt);
        // wrong seq (reorder/replay) is rejected by the AEAD
        assert!(open_chunk(&ck, 4, &ct).is_err());
    }
}
