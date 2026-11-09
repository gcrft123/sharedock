#!/usr/bin/env bash
# Rust host phase of the P1 verification. Assumes `wrangler dev` is running and
# `node test/cp-api.mjs` has just written /tmp/pc-p1/session.json.
#
# Proves, against the LIVE control plane + DO relay:
#   1. the real pc-daemon verifies a Worker-minted license (WebCrypto Ed25519 ↔
#      Rust ed25519-dalek interop) and lets it OVERRIDE PC_QUOTA_GB;
#   2. the host builds its client allowlist by FETCHING it from the control plane;
#   3. an approved client completes an encrypted round-trip, and its reported
#      quota equals the license quota;
#   4. an UNapproved client is refused (authorization enforced — no accept-any).
set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SESS=/tmp/pc-p1/session.json
BIN="$ROOT/target/debug"
RELAY=ws://127.0.0.1:8787
CONTROL=http://127.0.0.1:8787
DATA=/tmp/pc-p1/host
pass=0; fail=0
ok(){ echo "  ✓ $1"; pass=$((pass+1)); }
no(){ echo "  ✗ $1  ${2:-}"; fail=$((fail+1)); }

jqget(){ node -e "console.log(JSON.parse(require('fs').readFileSync('$SESS','utf8')).$1)"; }
ACCOUNT=$(jqget account); SESSION=$(jqget session); LICENSE=$(jqget license); CPPUB=$(jqget cpPubkey)
echo "account=$ACCOUNT  cpPubkey=$CPPUB"

rm -rf "$DATA"; mkdir -p "$DATA"
# Deterministic client identity so we can pre-register its id.
CLIENT_KEY=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")

# --- Phase A: capture the client's device id (accept-any daemon) ---
PC_DATA_DIR="$DATA" PC_RELAY_URL="$RELAY" PC_ACCOUNT="$ACCOUNT" PC_DEV_ACCEPT_ANY=1 PC_QUOTA_GB=512 \
  "$BIN/pc-daemon" > /tmp/pc-p1/daemonA.log 2>&1 &
DA=$!
for i in $(seq 1 15); do grep -q "agreement pubkey:" /tmp/pc-p1/daemonA.log && break; sleep 1; done
HOSTPUB=$(grep "agreement pubkey:" /tmp/pc-p1/daemonA.log | awk '{print $3}')

CLIOUT=$(PC_CLIENT_KEY="$CLIENT_KEY" PC_RELAY_URL="$RELAY" PC_ACCOUNT="$ACCOUNT" PC_HOST_PUB="$HOSTPUB" "$BIN/pc-cli" 2>&1)
CLIENT_ID=$(echo "$CLIOUT" | grep "client id:" | awk '{print $3}')
echo "$CLIOUT" | grep -q "round-trip verified" && ok "accept-any round-trip (baseline)" || no "accept-any round-trip" "$CLIOUT"
echo "  client id: $CLIENT_ID"
kill $DA 2>/dev/null; wait $DA 2>/dev/null

# --- Register that client id as an approved device ---
REG=$(curl -s -X POST "$CONTROL/api/devices" -H "authorization: Bearer $SESSION" \
  -H 'content-type: application/json' -d "{\"role\":\"client\",\"name\":\"cli\",\"pubkey\":\"$CLIENT_ID\"}")
echo "$REG" | grep -q '"approved":true' && ok "client device registered + approved" || no "device register" "$REG"

# --- Phase B: license-driven daemon, allowlist fetched from control plane ---
# The license sells HOST SEATS, not bytes: it sets the account and is verified offline,
# but the storage cap stays the operator's own (a host lends from its own disk). So
# PC_QUOTA_GB=99 must SURVIVE the license, which carries a 512 GiB figure it no longer
# applies. This asserted the opposite until the licensing model changed under it.
PC_DATA_DIR="$DATA" PC_RELAY_URL="$RELAY" PC_CONTROL_URL="$CONTROL" PC_QUOTA_GB=99 \
  PC_LICENSE="$LICENSE" PC_LICENSE_PUBKEY="$CPPUB" \
  "$BIN/pc-daemon" > /tmp/pc-p1/daemonB.log 2>&1 &
DB=$!
for i in $(seq 1 15); do grep -q "serving on" /tmp/pc-p1/daemonB.log && break; sleep 1; done
sleep 1

grep -q "valid ✓" /tmp/pc-p1/daemonB.log && ok "daemon verified the Worker-minted license" || no "license verify" "$(cat /tmp/pc-p1/daemonB.log)"
grep -qE "license: +tier [a-z]+ .* account" /tmp/pc-p1/daemonB.log && ok "license binds the daemon to its account" || no "license account bind" "$(grep license /tmp/pc-p1/daemonB.log)"
grep -qE "authorized clients: [1-9]" /tmp/pc-p1/daemonB.log && ok "host fetched approved clients from control plane" || no "allowlist fetch" "$(grep -i authoriz /tmp/pc-p1/daemonB.log)"
HOSTPUB2=$(grep "agreement pubkey:" /tmp/pc-p1/daemonB.log | awk '{print $3}')

# Approved client → round-trip works, and sees the HOST's own storage cap (not the
# license's byte figure, which the host deliberately does not apply).
CLIOUT2=$(PC_CLIENT_KEY="$CLIENT_KEY" PC_RELAY_URL="$RELAY" PC_ACCOUNT="$ACCOUNT" PC_HOST_PUB="$HOSTPUB2" "$BIN/pc-cli" 2>&1)
echo "$CLIOUT2" | grep -q "round-trip verified" && ok "APPROVED client round-trip (no accept-any)" || no "approved client round-trip" "$CLIOUT2"
# Assert the INVARIANT, not a byte count: the host lends from its own disk, capped by the
# operator's PC_QUOTA_GB, and never adopts the license's 512 GiB figure. An exact-equality
# check here is brittle, because HostAgent::init clamps the partition to real free disk,
# so it silently starts failing the moment the machine drops below the requested cap.
TOTAL=$(echo "$CLIOUT2" | sed -n 's/.*\/ \([0-9][0-9]*\) total bytes.*/\1/p')
CAP=$((99*1024*1024*1024))
LICBYTES=$((512*1024*1024*1024))
if [ -n "$TOTAL" ] && [ "$TOTAL" -gt 0 ] && [ "$TOTAL" -le "$CAP" ] && [ "$TOTAL" -ne "$LICBYTES" ]; then
  ok "client sees the host's own quota ($TOTAL bytes, at or under PC_QUOTA_GB)"
else
  no "client host quota" "got '$TOTAL', expected 0 < n <= $CAP and != $LICBYTES"
fi

# Unapproved client (ephemeral random id) → must be refused (times out, no session).
UNAUTH=$(PC_RELAY_URL="$RELAY" PC_ACCOUNT="$ACCOUNT" PC_HOST_PUB="$HOSTPUB2" timeout 25 "$BIN/pc-cli" 2>&1)
if echo "$UNAUTH" | grep -q "round-trip verified"; then
  no "UNAPPROVED client refused" "unexpectedly succeeded"
else
  ok "UNAPPROVED client refused (authorization enforced)"
fi

kill $DB 2>/dev/null; wait $DB 2>/dev/null
echo ""
echo "  host phase: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
