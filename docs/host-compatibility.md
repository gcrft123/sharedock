# macOS compatibility — giving old Macs a use

The product's premise is "your machine, from anywhere": an old Mac can become an
always-on, self-hosted personal-cloud **host**. Because the surfaces have very
different OS floors, "what macOS does this support?" has three different answers.

| Surface | Binary | Stack | macOS floor | Why |
|---|---|---|---|---|
| **Host / server** | `pc-daemon` | pure Rust (host-agent + core-net/iroh + core-crypto) | **10.12 Sierra** (Intel) · 11.0 (Apple Silicon) | The Rust toolchain's own minimum for `x86_64-apple-darwin` is 10.12; arm64 never ran below 11.0. No WebView/GUI involved. |
| **Desktop client (GUI)** | `pc-desktop` | Tauri 2 + wry (WKWebView) | **10.13 High Sierra** | Tauri serves its UI through a WKWebView custom URL-scheme handler (`WKURLSchemeHandler`), an API Apple shipped in 10.13. |
| **Web client** | — | browser | browser-dependent | Runs anywhere with a browser the SPA bundle parses. Sign-in is email + master password, so it needs no OS passkey support: that requirement is what the auth change removed. |

**Key point:** the old-machine use case is the **host**, and it does *not* run the
Tauri GUI. An old Mac runs the headless `pc-daemon` (as a `launchd` service); you
manage it from the web client or CLI on a modern device. So the desktop GUI's
10.13 floor does not constrain the "old Mac as a server" scenario.

## Why 10.12, not 10.10

- macOS **10.12 Sierra runs on Macs back to ~2009** — already 15-year-old hardware.
- **10.10 Yosemite** would only add 2007–2009 models (Core 2 Duo, ~2 GB RAM), which
  are barely viable as an always-on server anyway.
- Reaching 10.10 would require a pre-2023 Rust toolchain that **cannot compile
  iroh/quinn/rustls** (the P2P fast path) or the edition-2024 crates — i.e. gutting
  the core of the product for a sliver of unusable machines. Not worth it.

## Building the host for old Intel Macs

Homebrew Rust ships only the host target and can't cross-compile, so use a `rustup`
toolchain with both Apple targets installed:

```sh
rustup target add x86_64-apple-darwin aarch64-apple-darwin
scripts/build-daemon-universal.sh   # → target-cross/pc-daemon-universal (x86_64 + arm64)
```

The script pins `MACOSX_DEPLOYMENT_TARGET=10.12` (clamped up to 11.0 on the arm64
slice) and `lipo`s both slices into one universal binary.

## Caveats

- Cross-compiling proves the daemon **links** for 10.12 — not that it **runs**.
  Verify on a real Sierra/High Sierra Intel Mac; quinn/iroh's UDP/QUIC stack may
  have its own runtime floor.
- An always-on service on an OS with no security patches since ~2017 carries real
  OS-level risk. It's mitigated here — the host stores only ciphertext (E2EE) and is
  reached via P2P/relay with no inbound open ports — but the unpatched-OS exposure
  is worth stating to users.
