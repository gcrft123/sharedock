#!/usr/bin/env bash
# Build the `pc-daemon` SIDECAR for both macOS arches so the desktop app can bundle it
# (host mode / "Store my files" spawns it). Tauri expects
# `apps/desktop/src-tauri/binaries/pc-daemon-<target-triple>`. A universal build
# (`tauri build --target universal-apple-darwin`) needs a `pc-daemon-universal-apple-darwin`
# sidecar — Tauri does NOT lipo external binaries for you — so this script also lipos the
# two per-arch slices into that combined binary.
#
# Run this BEFORE `pnpm -C apps/desktop tauri build|dev` (the externalBin config in
# tauri.conf.json requires these files to exist).
#
# Prereqs (one-time):  rustup target add aarch64-apple-darwin x86_64-apple-darwin
# Usage:               scripts/build-desktop-sidecars.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# rustup cargo/rustc (Homebrew's single-target Rust can't cross-compile std).
CARGO="${CARGO:-$HOME/.cargo/bin/cargo}"
export RUSTC="${RUSTC:-$HOME/.cargo/bin/rustc}"
export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-10.13}"

[ -x "$CARGO" ] || { echo "rustup cargo not found at $CARGO (install rustup, or set \$CARGO)"; exit 1; }

OUT="apps/desktop/src-tauri/binaries"
mkdir -p "$OUT"
for TRIPLE in aarch64-apple-darwin x86_64-apple-darwin; do
  echo "==> pc-daemon ($TRIPLE)"
  "$CARGO" build --release --bin pc-daemon --target "$TRIPLE"
  cp "target/$TRIPLE/release/pc-daemon" "$OUT/pc-daemon-$TRIPLE"
done

# Tauri's `--target universal-apple-darwin` bundle looks for a sidecar named for the
# universal triple; combine the two slices into it (harmless for single-arch builds too).
echo "==> pc-daemon (universal-apple-darwin, lipo)"
lipo -create \
  "$OUT/pc-daemon-aarch64-apple-darwin" \
  "$OUT/pc-daemon-x86_64-apple-darwin" \
  -output "$OUT/pc-daemon-universal-apple-darwin"

echo "sidecars ready in $OUT/:"
ls -la "$OUT"
