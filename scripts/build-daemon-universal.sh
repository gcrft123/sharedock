#!/usr/bin/env bash
# Build a UNIVERSAL (x86_64 + arm64) `pc-daemon` that runs on old Intel Macs — down
# to macOS 10.12 Sierra — as well as Apple Silicon.
#
# WHY: the host role (an always-on, self-hosted personal-cloud server) is the whole
# point of putting this on an old machine. `pc-daemon` is pure Rust — no Tauri, no
# WebView — so it targets far lower than the desktop GUI (Tauri/WKWebView, 10.13+).
#   - x86_64 slice: floored at macOS 10.12 — the Rust toolchain's own minimum for
#     x86_64-apple-darwin. (10.12 Sierra runs on Macs back to ~2009.) Reaching 10.10
#     would require an ancient Rust that can't compile iroh/quinn — not worth it.
#   - arm64 slice: floored at 11.0 (Apple Silicon never ran anything older);
#     MACOSX_DEPLOYMENT_TARGET=10.12 is silently clamped up to 11.0 on that slice.
#
# Homebrew Rust can't cross-compile (it ships a single host target), so this uses a
# rustup toolchain explicitly and a SEPARATE target dir, leaving the user's default
# Homebrew `cargo` and its build cache untouched.
#
# Prereqs (one-time):
#   rustup target add x86_64-apple-darwin aarch64-apple-darwin
#
# Usage:  scripts/build-daemon-universal.sh
set -euo pipefail
cd "$(dirname "$0")/.."

CARGO="${CARGO:-$HOME/.cargo/bin/cargo}"
# Pin rustc to the rustup toolchain. cargo invokes bare `rustc`, and if Homebrew's
# Rust (single host target, no cross std) is earlier in PATH, the cross build fails
# with "can't find crate for std". The rustup rustc has both Apple targets' std.
export RUSTC="${RUSTC:-$HOME/.cargo/bin/rustc}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-target-cross}"
export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-10.12}"

[ -x "$CARGO" ] || { echo "rustup cargo not found at $CARGO (install rustup, or set \$CARGO)"; exit 1; }
[ -x "$RUSTC" ] || { echo "rustup rustc not found at $RUSTC (install rustup, or set \$RUSTC)"; exit 1; }

echo "==> building pc-daemon (release) for x86_64 + arm64 · min macOS $MACOSX_DEPLOYMENT_TARGET"
"$CARGO" build --release --bin pc-daemon --target x86_64-apple-darwin
"$CARGO" build --release --bin pc-daemon --target aarch64-apple-darwin

OUT="$CARGO_TARGET_DIR/pc-daemon-universal"
lipo -create \
  "$CARGO_TARGET_DIR/x86_64-apple-darwin/release/pc-daemon" \
  "$CARGO_TARGET_DIR/aarch64-apple-darwin/release/pc-daemon" \
  -output "$OUT"

echo ""
echo "==> universal binary: $OUT"
echo -n "    archs: "; lipo -archs "$OUT"
# Pre-10.14 targets record the floor in LC_VERSION_MIN_MACOSX ("version X"), newer
# ones in LC_BUILD_VERSION ("minos X") — vtool surfaces both, so match either.
for a in x86_64 arm64; do
  mn=$(vtool -arch "$a" -show-build "$OUT" 2>/dev/null | awk '/ minos | version /{print $2; exit}')
  echo "    $a: minimum macOS ${mn:-unknown}"
done
echo ""
echo "NOTE: cross-compiling proves it LINKS for 10.12 — it does not prove it RUNS."
echo "      Verify on a real Sierra/High Sierra Intel Mac (quinn/iroh may have their"
echo "      own runtime floors) before claiming support."
