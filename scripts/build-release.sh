#!/usr/bin/env bash
# Build a RELEASE Sharedock.app that a stranger can download and open.
#
# The difference between this and a plain `tauri build` is notarization. A Developer ID
# signature alone is not enough: Gatekeeper refuses an unnotarized download with a message
# that reads like malware, which is why the testing docs used to tell people to strip the
# quarantine attribute by hand. That is fine for you; a customer will not do it.
#
# Prereqs (one-time):
#   rustup target add aarch64-apple-darwin x86_64-apple-darwin
#   An app-specific password for your Apple ID (appleid.apple.com → Sign-In and Security)
#
# Usage:
#   export APPLE_ID="you@example.com"
#   export APPLE_PASSWORD="abcd-efgh-ijkl-mnop"   # app-specific, NOT the Apple ID password
#   export APPLE_TEAM_ID="ABCDE12345"
#   export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (ABCDE12345)"
#   scripts/build-release.sh [target-triple]
#
# Without those three the build still runs and still signs, but the result is NOT
# distributable, and the script says so rather than letting you discover it from a customer.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-universal-apple-darwin}"

echo "==> sidecars"
# tauri does not lipo external binaries, so a universal bundle needs a universal sidecar.
scripts/build-desktop-sidecars.sh

NOTARIZE=1
for v in APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
  if [ -z "${!v:-}" ]; then
    echo "!!  $v is not set: this build will NOT be notarized."
    NOTARIZE=0
  fi
done

echo "==> building ($TARGET)"
# Notarization is driven entirely by the APPLE_* variables above: tauri submits and staples
# when they are present, and quietly skips when they are not.
pnpm -C apps/desktop tauri build --target "$TARGET" --bundles app,dmg

APP=$(find "apps/desktop/src-tauri/target/$TARGET/release/bundle/macos" -maxdepth 1 -name "*.app" | head -1)
[ -n "$APP" ] || { echo "no .app produced"; exit 1; }
echo "==> built $APP"

echo "==> signature"
codesign --verify --deep --strict "$APP" || { echo "signature invalid"; exit 1; }

if [ "$NOTARIZE" = "1" ]; then
  echo "==> gatekeeper"
  # The real test: what Gatekeeper says on a machine that has never seen your certificate.
  if ! spctl -a -vv "$APP" 2>&1 | tee /dev/stderr | grep -q "accepted"; then
    echo "!!  Gatekeeper REJECTED this bundle. It is signed but not notarized."
    echo "!!  A common cause is a sidecar binary built without the hardened runtime."
    exit 1
  fi
  xcrun stapler validate "$APP" || { echo "!!  the notarization ticket is not stapled"; exit 1; }
  echo "==> OK: signed, notarized, stapled. This opens on a clean Mac."
else
  echo "==> Signed but NOT notarized. Fine for machines you control; a downloader sees"
  echo "    \"Sharedock cannot be opened because Apple cannot check it for malicious software\"."
fi
