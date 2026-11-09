#!/usr/bin/env bash
# Self-contained P1 end-to-end verification.
#
# Boots a local `wrangler dev` (miniflare) control plane + DO relay, applies the
# D1 migrations, then runs:
#   - test/cp-api.mjs   — passkey auth, device pairing, one-time-purchase license,
#                         relay admission (software WebAuthn authenticator)
#   - test/host-phase.sh — the REAL pc-daemon verifying a Worker-minted license,
#                          fetching its allowlist, and doing an authorized
#                          encrypted round-trip through the DO relay
#
# Usage:  bash test/e2e-p1.sh
set -u
cd "$(dirname "$0")/.."
ROOT="$(cd ../.. && pwd)"
WLOG=/tmp/pc-p1/wrangler.log
mkdir -p /tmp/pc-p1

echo "==> building Rust host + client"
( cd "$ROOT" && cargo build -q --bin pc-daemon --bin pc-cli ) || { echo "cargo build failed"; exit 1; }

echo "==> applying D1 migrations (local)"
node_modules/.bin/wrangler d1 migrations apply personal-cloud --local >/dev/null 2>&1

echo "==> starting wrangler dev"
# Force development mode locally (wrangler.toml pins ENVIRONMENT=production for the
# real deploy; the local e2e needs dev mode so the dev-complete license path works).
# Billing is switched on because the suite covers tiers, seat limits, and refunds; the
# self-hosted default (BILLING=off) would license every account as unlimited. The webhook
# secret matches the constant in cp-api.mjs; it is a test value and gates nothing real.
node_modules/.bin/wrangler dev --port 8787 --local --ip 127.0.0.1 --var ENVIRONMENT:development --var BILLING:stripe \
  --var STRIPE_WEBHOOK_SECRET:whsec_dev_test_secret_do_not_use_in_prod > "$WLOG" 2>&1 &
WPID=$!
trap 'kill $WPID 2>/dev/null; pkill -f pc-daemon 2>/dev/null' EXIT
for i in $(seq 1 40); do grep -qiE "Ready on http" "$WLOG" && break; sleep 1; done
grep -qiE "Ready on http" "$WLOG" || { echo "wrangler dev did not start"; cat "$WLOG"; exit 1; }

# The limiter is stateful by design and the local D1 persists between runs, so a second run
# would be throttled by the first one's traffic (every request here shares one address).
# Clearing it is the test equivalent of waiting an hour.
node_modules/.bin/wrangler d1 execute personal-cloud --local --command "DELETE FROM rate_limit" >/dev/null 2>&1

echo "==> control-plane API tests"
node test/cp-api.mjs || exit 1

echo ""
echo "==> Rust host phase"
bash test/host-phase.sh || exit 1

echo ""
echo "==> P1 end-to-end verification PASSED"
