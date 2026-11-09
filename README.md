# Sharedock

Sharedock turns machines you already own into one private, end-to-end encrypted cloud drive. A host agent runs on each machine (an old Mac, a spare laptop, a home server) and lends a slice of its disk. You reach the files from a web console, a desktop app for macOS and Windows, or a drive mounted in Finder or File Explorer.

A small control plane on Cloudflare handles accounts, device pairing, and a relay fallback. It stores public keys and wrapped (encrypted) key blobs, never file contents or content keys. Clients connect to hosts directly over peer-to-peer QUIC when they can, and through the relay when they can't. Either way, the relay forwards only ciphertext.

> **Status: no longer maintained.** Sharedock was built as a commercial product and is now released as-is under the AGPL. It works end to end and has tests, but nobody is triaging issues or reviewing pull requests. Fork it.

## What works

- Encrypted storage: content-addressed, encrypted chunk store with SQLite metadata and a per-host quota, so the host holds only ciphertext.
- Master-password accounts with a recovery key. The password never leaves the client, and the server can't reset it.
- Pairing new hosts and devices with a one-time code and approval from an existing device.
- Direct peer-to-peer transport over [Iroh](https://iroh.computer) (LAN and hole-punched), with an honest readout of whether a connection is direct or relayed.
- Pooling several hosts into one drive, or mirroring between them.
- A web and desktop console: files, uploads and downloads in 4 MiB streamed chunks, trash, stars, search, folder zip download, and end-to-end encrypted share links.
- Mounting the drive in Finder (macOS) and Explorer (Windows) through a local WebDAV bridge.
- Running the desktop app as a background host service (launchd on macOS, Task Scheduler on Windows).
- Optional Stripe billing for one-time licenses by host seat. It's off by default.

[docs/not-yet-built.md](docs/not-yet-built.md) lists known gaps and limitations.

## Architecture

```
          control plane (Cloudflare Worker + Durable Objects + D1)
          accounts · pairing · licenses · relay · serves the web console
               │ relay (ciphertext only)          │ signaling
     ┌─────────┴─────────┐              ┌─────────┴─────────┐
     │ web console       │              │ desktop app       │
     │ (browser, relay)  │              │ (Tauri, native)   │
     └─────────┬─────────┘              └─────────┬─────────┘
               └──────────── E2EE RPC ────────────┤ direct QUIC (Iroh)
                                                  ▼
                                         host agent (pc-daemon)
                                         encrypted chunk store
```

Both consoles render the same React UI (`packages/ui`) over a swappable transport (`packages/rpc-client-ts`). The browser always goes through the relay. The desktop app proxies the same API over native Iroh and falls back to the relay. [docs/architecture.md](docs/architecture.md) and [docs/threat-model.md](docs/threat-model.md) have the details.

## Repository layout

```
crates/
  core-proto      RPC wire types shared by host and clients
  core-crypto     Ed25519, X25519, XChaCha20-Poly1305, key hierarchy, license verification
  core-fs         SQLite metadata, encrypted chunk store, quota accounting
  core-net        AEAD session, relay transport, Iroh transport
  core-webdav     WebDAV filesystem over the encrypted drive
  host-agent      host role: answers file RPCs over the store
  client-core     client role: file encryption and a typed remote-drive API
  e2e             integration tests (host + relay + client in one process)
apps/
  daemon          pc-daemon, the headless host agent
  desktop         Tauri desktop app (client, host service, Finder/Explorer mount)
  web             Vite SPA that hosts the console in a browser
  site            marketing site
  webdav          pc-webdav, a standalone WebDAV server for a drive
  relay           pc-relay, a local stand-in for the Cloudflare relay
  cli             pc-cli, a round-trip self-test client
packages/
  ui              the console UI (onboarding, dashboard, files, settings)
  rpc-client-ts   control-plane client, drive API, and TypeScript E2EE
  design-system   the Halfsteel design system, as a written spec
services/
  control-plane   Cloudflare Worker: auth, pairing, billing, relay Durable Object
docs/             architecture, threat model, platform notes, runbooks
scripts/          release and sidecar builds, font download
```

## Prerequisites

- Node 20 or newer, and pnpm 9 (`corepack enable pnpm`)
- Rust 1.85 or newer through [rustup](https://rustup.rs). A C compiler is needed for the bundled SQLite. Xcode's command-line tools cover it on macOS, and MSVC on Windows.
- For the desktop app: the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform.

```sh
pnpm install
scripts/fetch-fonts.sh   # optional: the marketing site's Satoshi font, see THIRD_PARTY_NOTICES.md
```

## Run it locally

Three terminals give you the whole stack on your machine, with no Cloudflare account.

```sh
# 1. Control plane on http://localhost:8787 (local D1 and Durable Objects via Miniflare)
pnpm --filter @app/control-plane db:migrate:local
pnpm cp:dev

# 2. Web console on http://localhost:5173
pnpm dev

# 3. A host. Get the pairing code from the console ("set up a host"), then:
cargo build -p pc-daemon
PC_DATA_DIR=.pc-data PC_CLAIM=<code> PC_CONTROL_URL=http://localhost:8787 \
  PC_RELAY_URL=ws://localhost:8787 PC_IROH=1 ./target/debug/pc-daemon
```

Create an account in the console, set up a host, start the daemon with the code it shows, and approve the host. The local control plane runs with billing off, so there's no purchase step.

The desktop app runs against the same local control plane:

```sh
scripts/build-desktop-sidecars.sh   # macOS; on Windows use scripts\build-desktop-sidecars.ps1
pnpm --filter @app/desktop tauri dev
```

## Tests

```sh
cargo test --workspace                          # Rust: crypto, store, quota, sessions, e2e loop, failure drill
pnpm typecheck                                  # every TypeScript package
pnpm test                                       # recovery-key crypto and zip packing
pnpm --filter @app/control-plane test:e2e       # control-plane API suite plus a real pc-daemon
```

The control-plane end-to-end suite needs the web app built first (`VITE_CONTROL_URL="" pnpm build`). CI (`.github/workflows/ci.yml`) runs all of these on Linux, and the Rust and desktop tests on Windows.

## Deploy your own

[docs/self-hosting.md](docs/self-hosting.md) covers deploying the control plane to Cloudflare, adding hosts, building and signing the desktop app, publishing updates, email, and turning billing on.

## Documentation

- [docs/architecture.md](docs/architecture.md): the three planes and the technology choices
- [docs/threat-model.md](docs/threat-model.md): what each party can and can't see
- [docs/self-hosting.md](docs/self-hosting.md): deployment
- [docs/host-onboarding.md](docs/host-onboarding.md): how pairing a host works
- [docs/iroh-fast-path.md](docs/iroh-fast-path.md): the direct peer-to-peer path
- [docs/host-compatibility.md](docs/host-compatibility.md): macOS version floors, Intel builds
- [docs/windows-port.md](docs/windows-port.md): the Windows host, service, and mount
- [docs/failure-drill.md](docs/failure-drill.md): behavior under disk, network, and crash failures
- [docs/two-device-test.md](docs/two-device-test.md) and [docs/mojave-standalone-host.md](docs/mojave-standalone-host.md): manual two-machine test runbooks
- [docs/auth-redesign.md](docs/auth-redesign.md): why auth moved from passkeys to a master password
- [docs/design.md](docs/design.md) and [docs/product.md](docs/product.md): the visual system and product principles
- [docs/not-yet-built.md](docs/not-yet-built.md): known gaps

## License

Sharedock is licensed under the [GNU Affero General Public License v3.0](LICENSE). If you run a modified control plane as a service for other people, the AGPL requires you to offer them your source. Bundled fonts, icons, and one vendored component keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
