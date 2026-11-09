#!/usr/bin/env bash
# Download Satoshi, the marketing site's body face, from Fontshare.
#
# Satoshi is under the ITF Free Font License, which allows self-hosting but not
# redistribution through a repository, so the file is not committed. Each developer
# fetches the official copy. Without it the site falls back to system-ui.
#
# Usage: scripts/fetch-fonts.sh
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="apps/site/public/brand/satoshi.woff2"
if [ -f "$DEST" ]; then
  echo "$DEST already exists"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/satoshi.zip" "https://api.fontshare.com/v2/fonts/download/satoshi"
unzip -q -j "$TMP/satoshi.zip" "*/WEB/fonts/Satoshi-Variable.woff2" -d "$TMP"
mv "$TMP/Satoshi-Variable.woff2" "$DEST"
echo "wrote $DEST (ITF Free Font License, https://www.fontshare.com/fonts/satoshi)"
