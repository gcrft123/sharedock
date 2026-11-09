# Iroh LAN fast path (P2)

Direct peer-to-peer QUIC between a client and its host, keyed by device identity —
the "dial keys, not IPs" path. It **bypasses the relay** (same LAN → near wire
speed; across NATs → hole-punched), relaying only as a fallback. This is the
recurring-cost lever behind the one-time-purchase model: bytes go direct, the
relay stays a rare fallback.

It is **not a protocol change** — the session handshake, RPC, framing, and E2EE
(`crates/core-net/src/session.rs`) are transport-agnostic. Iroh just carries the
same tagged AEAD frames over a QUIC bi-stream (u32-BE length-prefixed).

## Pieces

- **`crates/core-net/src/iroh.rs`** (`iroh` feature, off by default so the heavy
  quinn/rustls tree stays out of the WebDAV runner / desktop-mount / default
  builds):
  - `secret_from_device(&DeviceKeypair)` → the iroh `SecretKey` from the device's
    Ed25519 seed, so **EndpointId == device id**.
  - `bind_endpoint(secret, offline)` — `offline=true` = `RelayMode::Disabled`
    (LAN/loopback, dial by direct addr); `false` = n0 relays (WAN NAT traversal).
  - `IrohClient::{connect, request}` and `serve_iroh(endpoint, open_sealed,
    is_authorized, handler)` — mirror `relay::RelayClient` / `relay::serve`.
  - `endpoint_addr(id, direct_addrs, relay_url)` — build an `EndpointAddr` from
    control-plane discovery fields (the client side of discovery).
- **`client-core`** (`iroh` feature): `RemoteDrive` is transport-agnostic
  (`Wire { Ws | Iroh }`); `connect_iroh` + **`connect_auto`** (Iroh-first, relay
  fallback).
- **`apps/daemon`**: opt-in `PC_IROH` (+ `PC_IROH_RELAY=1` for n0 relays) →
  serves Iroh concurrently with the relay and publishes its `EndpointAddr` to the
  control plane.
- **control plane**: `POST /api/host/endpoint` (host publishes; license auth) +
  `GET /api/host/endpoint?account=` (client fetches; session/license) backed by
  the D1 `host_endpoints` table.

## Discovery + connect flow

1. Host (daemon with `PC_IROH`) binds its endpoint and `POST`s
   `{endpoint_id, direct_addrs, relay_url}` to `/api/host/endpoint`.
2. Client `GET`s `/api/host/endpoint?account=…`, rebuilds the `EndpointAddr` with
   `core_net::iroh::endpoint_addr(...)`, and calls
   `RemoteDrive::connect_auto(Some((&endpoint, addr)), relay_url, account, device,
   host_pub, token)`.
3. `connect_auto` tries the direct QUIC path; on any failure it falls back to the
   relay. The same `RemoteDrive` API (incl. chunked transfer) then runs unchanged.

## Consumers

**`pc-webdav` runner (done, feature-gated).** Build it with `--features iroh` and,
in remote mode (`PC_RELAY_URL` set), supply the host's discovery via env — exactly
what `pc-daemon` prints on startup:

```
PC_HOST_EID=<host EndpointId>          # == host device id
PC_HOST_ADDRS=192.168.1.20:5000,...    # host direct ip:port addrs
PC_IROH_RELAY=<relay url>              # optional; LAN-direct only if unset
```

The runner binds an endpoint from its own device key, rebuilds the host
`EndpointAddr`, and `connect_auto`s (direct → relay fallback). **Without** the
`iroh` feature the runner builds lean (no quinn/rustls) and is relay-only — so the
default mount path is unaffected.

**Desktop app (done, GUI-verified).** The Tauri app's Drive Console has a "Remote
host" panel (relay URL / account / host pubkey / optional iroh EndpointId + addrs)
that calls the `mount_remote_start` command → `mount::mount_remote` →
`connect_auto` → `core_webdav::RemoteDrive` → `spawn_server` → `mount_webdav`, so a
remote host mounts natively in Finder over the fast path. The desktop crate enables
the `iroh` feature unconditionally (it's the production client) and persists a
stable client identity at `<data_dir>/client.key`. Verified end-to-end: filled the
panel against a live `pc-daemon`, mounted at `~/.sharedock/Sharedock`, round-tripped a
file through Finder byte-exact with the host holding ciphertext only, then
unmounted. (Dev caveat: the desktop still loads its own `ark.key`; a real remote
mount needs the account's ARK.)

The generic recipe any consumer follows: `bind_endpoint(secret_from_device(&device),
…)` once, obtain the host endpoint (env, or `GET /api/host/endpoint` from the
control plane), `endpoint_addr(...)`, `connect_auto(...)`, then hand the
`RemoteDrive` to `core_webdav::RemoteDrive::new`.

## Relays (production)

Default is n0's public relays (`RelayMode::Default`). For production the plan is
**self-hosted `iroh-relay`** (bulk relay self-hosting reinforces the cheap-at-rest
economics) — set it via a custom `RelayMap`. Discovery here rides the control
plane (we publish/fetch the `EndpointAddr`), independent of n0's DNS/pkarr.

## Verification

- `cargo test -p core-net --features iroh` — direct-QUIC RPC round-trip +
  unauthorized-rejected on loopback.
- `cargo test -p client-core --features iroh` — real host-agent over `serve_iroh`,
  discovery-string → `endpoint_addr` → `connect_auto`, whole-file + 9 MB
  multi-chunk round-trip + remote MOVE, **no relay**.
- `pnpm --filter @app/control-plane test:e2e` — publish + fetch host endpoint.
- **Manual / real** (not CI): two machines same LAN (direct, near wire speed) and
  across NATs (hole-punch → relay fallback); measure throughput vs the relay.
