# Threat model (working draft)

To be hardened before **sharing** ships (Phase 4); reviewed by a security pass.

## Trust boundaries

- **Trusted:** the host machine, and any device the user has explicitly paired.
  Plaintext and keys exist only here (and transiently in a logged-in browser tab).
- **Untrusted (honest-but-curious):** our control plane and relay. They broker
  connectivity and hold only public keys, license state, and *wrapped* (ciphertext)
  key blobs. They must never be able to derive plaintext or content keys.
- **Hostile:** the public internet, and anyone in possession of a share link who
  is not the intended recipient.

## Encryption

- **Transport:** Iroh/QUIC (native) or WSS/TLS (browser) protects each hop.
- **Content (E2EE):** payloads are encrypted *inside* the transport, so even where
  TLS terminates at the relay, only ciphertext crosses it.
- Primitives (reviewed by reading, not audited): X25519 key agreement ·
  XChaCha20-Poly1305 chunk AEAD (192-bit nonce) · Ed25519 device identity ·
  **scrypt** password KDF · HKDF-SHA256 for sub-key separation · BLAKE3 · sealed-box
  wrapping for shares. No hand-rolled crypto.
- **scrypt, not Argon2id.** The KDF runs in the browser and in the Tauri webview, and the
  old WebViews this product deliberately supports (Mojave-era JavaScriptCore) have no
  BigInt, which the available Argon2id implementations need. scrypt is memory-hard, has a
  BigInt-free implementation, and is client-only, so it needs no Rust interop. This is a
  real trade: Argon2id is the better modern choice, and it is given up to keep old
  machines — the product's whole premise — able to log in at all.

## Key hierarchy

- **Account Root Key (ARK):** random 256-bit, generated on the first device; stored only
  as ciphertext in the control plane, wrapped **two** ways:
  - **(a) under the password.** scrypt derives a master key from the password and a
    per-account salt; HKDF splits it into an encryption half that wraps the ARK and an auth
    half whose SHA-256 is the server's login verifier. The server sees neither the password
    nor the ARK.
  - **(b) under a recovery key.** A separate random 256-bit secret, shown to the user once.
    It splits the same way: an encryption half that unwraps a second stored copy of the ARK,
    and an auth half proving possession before the server hands that copy out.
  - There is deliberately **no per-device wrapping**. It was necessary under passkey auth,
    where no password existed to derive from; with a password, any device that can sign in
    can unwrap the ARK itself, so a third copy would be extra attack surface for no gain.
    The `devices.wrapped_ark_for_device` column is a leftover and is read by nothing.
- **Content keys:** per-file symmetric keys wrapped by the ARK; chunks encrypted
  with the file key. Dedup stays within one user's keyspace (no cross-user
  convergent encryption → no confirmation-of-file attack).

## Sharing (Phase 4)

- **Link share:** the share key lives in the URL **fragment** (`#…`) and never
  reaches the server; the server holds only the opaque token + wrapped-key blob +
  policy. Recipient's browser unwraps client-side.
- **Share-to-user:** wrap the file key to the recipient's device pubkey(s).

## Recovery posture (product decision)

True zero-knowledge: losing the passphrase **and** every device **and** the
recovery key means the data is unrecoverable, and support **cannot** reset it.
The "host holds keys" model narrows the blast radius (data stays accessible as
long as the user has their host machine). Mitigations: printable recovery code at
signup (now implemented and redeemable, not just displayed), blunt UX copy, optional
social/escrow recovery later. **No server-side
backdoor** — it would void the entire value proposition.

## Open items

- **Device revocation still does not take back what a device already has — but there is now
  a remedy.** Revoking drops the device from the allowlist, and every host re-reads that list
  within 30 seconds, so it can no longer reach anything. That is the whole story for a laptop
  sold or lost. It is not the story if that device later obtains ciphertext another way,
  because the account key is not wrapped per-device and revoking removes no wrapping.

  **Account-key rotation** now exists for that case (Settings → Security). It mints a new
  account key and re-wraps every file's content key under it; file bodies are untouched,
  since only the wrapping of each per-file key changes. After it completes, a device holding
  only the old key cannot read anything.

  It is built to be interrupted, because it cannot be atomic across a drive: the device keeps
  a KEYRING and tries every key on read, the whole ring is published to the control plane
  BEFORE any file is re-wrapped (so a device signing in mid-rotation gets both keys), and the
  old key is dropped only once every file is confirmed on the new one. A crash leaves a longer
  ring and nothing unreadable. Rotation also issues a fresh recovery key, because the old one
  unwraps the old account key.

  **Remaining:** rotation is per-host-connection, so an account with several hosts must be
  connected to each in turn; and a host that is offline during rotation keeps files on the old
  key, which is reported rather than silently ignored.

- **Formal review.** Still open, and now overdue by this document's own standard: it said
  "before Phase 4", and sharing shipped.

### Closed

- ~~Signed-request replay protection (nonce/expiry) on host RPC.~~ Frames were always
  replay-proof (a per-direction counter is in the AEAD's associated data), but the handshake
  was not: `Hello` was a bare signature over the sealed session key, with no freshness and no
  statement of which host it was for, so a captured one worked indefinitely. It now signs a
  timestamp, a random nonce and the host's identity; hosts reject anything stale, already
  seen, or addressed elsewhere. The exposure was bounded — a replayer cannot unwrap the
  session key, so it could never impersonate or read — but it let anyone who had observed a
  connection make a host set up sessions on demand.
- ~~Relay abuse / rate limiting.~~ Auth, recovery, pairing-code redemption, share reads and
  relay admission are all throttled (`services/control-plane/src/ratelimit.ts`). Login is
  limited per account AND per source address, because either alone leaves a hole.
- ~~No way to recover a forgotten password.~~ The recovery key is real and redeemable; see
  the key hierarchy above.
