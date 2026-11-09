# Architecture

A summary of how the pieces fit. [threat-model.md](threat-model.md) covers what each
party is trusted with.

## Guiding insight

The host is the user's **own trusted hardware**; only *our* cloud is untrusted.
So "zero-knowledge" means the control plane + relay never see plaintext or keys —
the host can and does hold the user's keys. Every encrypted channel runs between
`{host}` and `{the user's client}`; the middle only forwards ciphertext.

## Three planes

```
CONTROL PLANE (Cloudflare, untrusted for data)
  Worker (stateless API)   Durable Object / account      D1
   auth · pairing · billing  signaling + MVP relay (WSS)   users · device pubkeys
   serves SPA                presence · endpoint exchange  licenses · share meta
  stores: accounts, device PUBLIC keys, one-time license state, wrapped-key mailboxes
  never: file plaintext, content keys, account root key in the clear
        |  signaling + relay (WSS)                |  signaling
  WEB CLIENT (relay-only, WASM crypto)      DESKTOP CLIENT (Tauri, native)
        |                                        |  direct / LAN
        +----------------- overlay (Iroh/QUIC) --+--> HOST AGENT (user's machine)
          direct P2P when possible, relay fallback     encrypted chunk store
                                                        SQLite metadata + quota
                                                        WebDAV · versioning · trash
                                                        Iroh node (device keypair = id)
```

- **From anywhere (browser):** master-password login → get host NodeId + relay token →
  WSS to the account DO → signed, E2E-encrypted RPC → relay forwards ciphertext →
  host verifies device signature, quota-checks writes, streams ciphertext back →
  browser decrypts in a Web Worker.
- **Fast path (desktop/LAN):** both are Iroh nodes bound to the account; signaling
  exchanges endpoints; QUIC hole-punching opens a direct path (local link on LAN);
  the client speaks the host RPC directly. Relay only on hole-punch failure.

## Key technology choices

| Area | Choice |
|---|---|
| Overlay transport | Iroh (QUIC/quinn): dial-by-pubkey, hole-punch + relay fallback |
| Native app | Tauri (one Rust core = host + client roles) |
| Finder/Explorer (v1) | WebDAV (127.0.0.1 proxy bridged over the Iroh tunnel) |
| Frontend | Vite + React static SPA (shared by web + both Tauri webviews) |
| Rust core | Tokio · Axum · `dav-server` · rusqlite (WAL + FTS5) · fastcdc + BLAKE3 |
| Crypto | X25519 · XChaCha20-Poly1305 · Ed25519 · scrypt (KDF) · HKDF-SHA256 · BLAKE3 |
| Control plane | Cloudflare Workers + Durable Objects + D1 |
| Billing | Stripe one-time payment → perpetual signed license token |

## Quota ("partition")

The host DB (`crates/core-fs`) enforces the cap with **reserve → commit**:
an upload reserves bytes up front (rejected if it would overshoot), writes chunks,
then commits (reserved → committed) or releases on failure. See
`quota_reserve_commit_enforced` in `crates/core-fs/src/lib.rs`.
