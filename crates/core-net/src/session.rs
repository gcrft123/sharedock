//! The AEAD session between a client and a host.
//!
//! Establishment: the client generates a random session key, seals it to the
//! host's X25519 key (so only the host can unwrap it), and signs the sealed blob
//! with its Ed25519 identity. The host verifies the signature, checks the device
//! is authorized, and unwraps the session key. Thereafter every RPC frame is
//! AEAD-sealed under the session key with a per-direction counter in the AAD, so
//! the relay in the middle only ever sees ciphertext and frames can't be replayed
//! or reordered.
//!
//! REPLAY PROTECTION ON THE HANDSHAKE. Frames were always replay-proof, because the
//! counter is in the AAD. The `Hello` was not: it was a bare signature over the sealed
//! session key, with no freshness and no statement of who it was for. A captured Hello
//! could therefore be resent to the same host forever.
//!
//! The impact was bounded — the replayer cannot unwrap the session key, so it could not
//! impersonate the client or read anything, and a revoked device fails the authorization
//! check — but it let anyone who had once observed a connection make a host set up sessions
//! on demand. The signed message now covers a timestamp, a random nonce, and the HOST's
//! identity, and the host rejects anything stale or already seen.

use core_crypto::{seal_to, verify, AgreementPublic, CryptoError, DeviceId, DeviceKeypair, SymKey};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct Hello {
    #[serde(with = "core_proto::b64")]
    pub client_id: Vec<u8>,
    #[serde(with = "core_proto::b64")]
    pub sealed_session: Vec<u8>,
    /// Unix milliseconds when this Hello was built. The host rejects anything outside
    /// [`HELLO_MAX_SKEW_MS`], which is what stops a captured Hello working tomorrow.
    #[serde(default)]
    pub ts: i64,
    /// 16 random bytes, so two Hellos in the same millisecond are still distinguishable and
    /// the host can remember which it has already accepted.
    #[serde(default, with = "core_proto::b64")]
    pub nonce: Vec<u8>,
    /// Ed25519 signature (64 bytes) over [`hello_signing_bytes`].
    #[serde(with = "core_proto::b64")]
    pub sig: Vec<u8>,
}

/// How far a Hello's timestamp may be from the host's clock. Generous enough for a laptop
/// whose clock drifts, tight enough that a captured Hello is useless within minutes.
pub const HELLO_MAX_SKEW_MS: i64 = 120_000;

/// How many recent nonces a host remembers. At the skew window above this is far more than
/// any real client produces, and it bounds the memory an attacker can make a host spend.
const NONCE_MEMORY: usize = 4096;

/// The bytes a Hello signs: the sealed key, when it was made, its nonce, and WHO IT IS FOR.
///
/// Binding the host's id is what makes a Hello non-transferable. Without it a signature is a
/// statement that "this client wanted a session", with no statement of with whom; the sealing
/// already prevented another host from opening it, but the signature should say so too rather
/// than relying on that alone.
pub fn hello_signing_bytes(sealed_session: &[u8], ts: i64, nonce: &[u8], host: &AgreementPublic) -> Vec<u8> {
    let mut m = Vec::with_capacity(sealed_session.len() + 8 + nonce.len() + 32 + 8);
    m.extend_from_slice(b"pc/hello/v2");
    m.extend_from_slice(sealed_session);
    m.extend_from_slice(&ts.to_be_bytes());
    m.extend_from_slice(nonce);
    m.extend_from_slice(host.as_bytes());
    m
}

/// Remembers recently accepted Hello nonces, so a Hello inside the freshness window still
/// cannot be used twice.
#[derive(Default)]
pub struct ReplayGuard {
    seen: std::collections::VecDeque<(Vec<u8>, i64)>,
}

impl ReplayGuard {
    pub fn new() -> Self {
        Self { seen: std::collections::VecDeque::new() }
    }

    /// Record `nonce` at `now_ms`. Returns false if it has already been seen.
    pub fn accept(&mut self, nonce: &[u8], now_ms: i64) -> bool {
        // Drop anything older than the window: outside it, the timestamp check rejects the
        // Hello anyway, so remembering the nonce adds nothing.
        while let Some((_, t)) = self.seen.front() {
            if now_ms - *t > HELLO_MAX_SKEW_MS {
                self.seen.pop_front();
            } else {
                break;
            }
        }
        if self.seen.iter().any(|(n, _)| n == nonce) {
            return false;
        }
        if self.seen.len() >= NONCE_MEMORY {
            self.seen.pop_front();
        }
        self.seen.push_back((nonce.to_vec(), now_ms));
        true
    }
}

#[derive(Debug)]
pub enum SessionError {
    Unauthorized,
    BadKey,
    /// The Hello's timestamp is outside the freshness window, or its nonce was already used.
    Replay,
}

/// A live AEAD session. `tx`/`rx` are independent frame counters bound into the
/// AAD; the two peers' counters mirror each other (client.tx ↔ host.rx, etc.).
pub struct Session {
    key: SymKey,
    tx: u64,
    rx: u64,
}

impl Session {
    pub fn seal(&mut self, plaintext: &[u8]) -> Vec<u8> {
        let aad = self.tx.to_be_bytes();
        self.tx += 1;
        self.key.seal(&aad, plaintext)
    }

    pub fn open(&mut self, blob: &[u8]) -> Result<Vec<u8>, CryptoError> {
        let aad = self.rx.to_be_bytes();
        let pt = self.key.open(&aad, blob)?;
        self.rx += 1;
        Ok(pt)
    }
}

/// Client side: build the `Hello` and the matching session.
pub fn client_hello(client: &DeviceKeypair, host_pub: &AgreementPublic) -> (Hello, Session) {
    let session_key = SymKey::generate();
    let sealed_session = seal_to(host_pub, &session_key);
    let ts = now_ms();
    let mut nonce = vec![0u8; 16];
    core_crypto::fill_random(&mut nonce);
    let sig = client.sign(&hello_signing_bytes(&sealed_session, ts, &nonce, host_pub)).to_vec();
    let hello = Hello {
        client_id: client.id.as_bytes().to_vec(),
        sealed_session,
        ts,
        nonce,
        sig,
    };
    (hello, Session { key: session_key, tx: 0, rx: 0 })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Host side: verify + authorize the `Hello`, unwrap the session key.
pub fn host_accept(
    hello: &Hello,
    host_pub: &AgreementPublic,
    guard: &mut ReplayGuard,
    open_sealed: impl Fn(&[u8]) -> Result<SymKey, CryptoError>,
    is_authorized: impl Fn(&DeviceId) -> bool,
) -> Result<(DeviceId, Session), SessionError> {
    let cid: [u8; 32] = hello
        .client_id
        .as_slice()
        .try_into()
        .map_err(|_| SessionError::Unauthorized)?;
    let client_id = DeviceId::from_bytes(cid);
    let sig: [u8; 64] = hello.sig.as_slice().try_into().map_err(|_| SessionError::Unauthorized)?;

    // Freshness first: cheapest check, and it rejects a replayed Hello before spending an
    // Ed25519 verification or an X25519 unwrap on it.
    let now = now_ms();
    if hello.nonce.len() != 16 || (now - hello.ts).abs() > HELLO_MAX_SKEW_MS {
        return Err(SessionError::Replay);
    }

    let msg = hello_signing_bytes(&hello.sealed_session, hello.ts, &hello.nonce, host_pub);
    if !verify(&client_id, &msg, &sig) {
        return Err(SessionError::Unauthorized);
    }
    if !is_authorized(&client_id) {
        return Err(SessionError::Unauthorized);
    }
    // Only burn the nonce once the Hello is otherwise valid, so a forged Hello cannot be used
    // to consume a nonce a legitimate client is about to present.
    if !guard.accept(&hello.nonce, now) {
        return Err(SessionError::Replay);
    }
    let key = open_sealed(&hello.sealed_session).map_err(|_| SessionError::BadKey)?;
    Ok((client_id, Session { key, tx: 0, rx: 0 }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_establish_and_frame_roundtrip() {
        let host = DeviceKeypair::generate();
        let client = DeviceKeypair::generate();

        let (hello, mut cs) = client_hello(&client, &host.agreement_public());
        let (cid, mut hs) =
            host_accept(&hello, &host.agreement_public(), &mut ReplayGuard::new(), |b| host.open_sealed(b), |id| *id == client.id)
                .unwrap();
        assert_eq!(cid, client.id);

        // client -> host
        let f1 = cs.seal(b"list /Docs");
        assert_eq!(hs.open(&f1).unwrap(), b"list /Docs");
        // host -> client
        let f2 = hs.seal(b"here are the entries");
        assert_eq!(cs.open(&f2).unwrap(), b"here are the entries");

        // an unauthorized device is rejected
        assert!(host_accept(&hello, &host.agreement_public(), &mut ReplayGuard::new(), |b| host.open_sealed(b), |_| false).is_err());
        // a forged signature is rejected
        let mut forged = hello.clone();
        forged.sig[0] ^= 0xff;
        assert!(host_accept(&forged, &host.agreement_public(), &mut ReplayGuard::new(), |b| host.open_sealed(b), |_| true).is_err());
    }

    /// The point of the whole change: a captured Hello must not work twice.
    #[test]
    fn a_replayed_hello_is_rejected() {
        let host = DeviceKeypair::generate();
        let client = DeviceKeypair::generate();
        let hp = host.agreement_public();
        let mut guard = ReplayGuard::new();

        let (hello, _cs) = client_hello(&client, &hp);
        assert!(
            host_accept(&hello, &hp, &mut guard, |b| host.open_sealed(b), |_| true).is_ok(),
            "the first use of a Hello must succeed"
        );
        // Byte-identical resend, exactly what an eavesdropper would have captured.
        let err = host_accept(&hello, &hp, &mut guard, |b| host.open_sealed(b), |_| true);
        assert!(matches!(err, Err(SessionError::Replay)), "a replayed Hello was accepted");
    }

    /// A Hello is bound to the host it was made for, so one captured from a connection to
    /// host A cannot be presented to host B.
    #[test]
    fn a_hello_for_one_host_is_not_valid_at_another() {
        let host_a = DeviceKeypair::generate();
        let host_b = DeviceKeypair::generate();
        let client = DeviceKeypair::generate();

        let (hello, _cs) = client_hello(&client, &host_a.agreement_public());
        let at_b = host_accept(
            &hello,
            &host_b.agreement_public(),
            &mut ReplayGuard::new(),
            |b| host_b.open_sealed(b),
            |_| true,
        );
        assert!(at_b.is_err(), "a Hello for host A was accepted by host B");
    }

    /// Stale Hellos are refused, which is what stops a capture being useful tomorrow.
    #[test]
    fn a_stale_hello_is_rejected() {
        let host = DeviceKeypair::generate();
        let client = DeviceKeypair::generate();
        let hp = host.agreement_public();

        let (mut hello, _cs) = client_hello(&client, &hp);
        // Re-sign at an old timestamp, so this is a VALID signature over stale content
        // rather than merely a corrupted one.
        hello.ts -= HELLO_MAX_SKEW_MS + 60_000;
        hello.sig = client
            .sign(&hello_signing_bytes(&hello.sealed_session, hello.ts, &hello.nonce, &hp))
            .to_vec();

        let err = host_accept(&hello, &hp, &mut ReplayGuard::new(), |b| host.open_sealed(b), |_| true);
        assert!(matches!(err, Err(SessionError::Replay)), "a stale Hello was accepted");
    }

    /// A forged Hello must not be able to burn a nonce a real client is about to use.
    #[test]
    fn a_rejected_hello_does_not_consume_its_nonce() {
        let host = DeviceKeypair::generate();
        let client = DeviceKeypair::generate();
        let hp = host.agreement_public();
        let mut guard = ReplayGuard::new();

        let (mut hello, _cs) = client_hello(&client, &hp);
        let good_sig = hello.sig.clone();
        hello.sig[0] ^= 0xff; // same nonce, broken signature
        assert!(host_accept(&hello, &hp, &mut guard, |b| host.open_sealed(b), |_| true).is_err());

        hello.sig = good_sig;
        assert!(
            host_accept(&hello, &hp, &mut guard, |b| host.open_sealed(b), |_| true).is_ok(),
            "a forged Hello consumed the nonce of a legitimate one"
        );
    }
}
