# Two-device test with a Mojave Intel Mac as a headless host

Use this when one of your Macs can't run the desktop **GUI** (e.g. an Intel Mac on
macOS 10.14 Mojave, whose WKWebView is too old — see `host-compatibility.md`). The host
role doesn't need a GUI: it's just the pure-Rust `pc-daemon`. The GUI runs only on your
modern Mac, which mounts the remote drive in Finder.

| | Machine | Role |
|---|---|---|
| 🖥️ **Host** | Mojave Intel Mac (no GUI) | runs `pc-daemon`, holds the encrypted store |
| 💻 **Client** | Apple-Silicon Mac (macOS 27) | desktop app — mounts the host's drive in Finder |

Same LAN. Data goes over **Iroh direct QUIC** (no relay needed for the transfer). The
transport is E2EE; the host only ever stores ciphertext.

---

## 1. Build a fresh daemon and copy it to the host — 💻 Client

The daemon must be built from *current* `main` (it carries all the latest fixes). Homebrew
Rust can't cross-compile, so this uses your rustup toolchain:

```bash
cd path/to/sharedock
export PATH="$HOME/.cargo/bin:$PATH"
scripts/build-daemon-universal.sh
#   → target-cross/pc-daemon-universal   (x86_64 + arm64, min macOS 10.12)
lipo -archs target-cross/pc-daemon-universal   # expect: x86_64 arm64
```

Copy it to the host (AirDrop the file, or `scp`):

```bash
open -R target-cross/pc-daemon-universal   # Finder → right-click → Share → AirDrop → host
```

## 2. Stage + smoke-test on the host — 🖥️ Host

AirDrop lands in `~/Downloads`. De-quarantine and confirm it even runs on Mojave:

```bash
mkdir -p ~/pc && mv ~/Downloads/pc-daemon-universal ~/pc/pc-daemon && cd ~/pc
chmod +x pc-daemon
xattr -dr com.apple.quarantine pc-daemon 2>/dev/null || true

PC_DATA_DIR="$HOME/pc/data" ./pc-daemon
```
✅ **Pass:** it prints the banner, `device id:`, `agreement pubkey:`, then
`PC_RELAY_URL not set → init only.` and exits cleanly — **no "Bad CPU type" or
"Illegal instruction."** That proves crypto + SQLite + identity all run on this Mac.

## 3. Start the host serving (Iroh LAN) — 🖥️ Host

```bash
cd ~/pc
PC_DATA_DIR="$HOME/pc/data" PC_ACCOUNT=demo \
PC_DEV_ACCEPT_ANY=1 PC_IROH=1 PC_RELAY_URL=ws://127.0.0.1:1 \
  ./pc-daemon
```
`PC_RELAY_URL=ws://127.0.0.1:1` is a deliberately-dead relay — **Iroh serves regardless**,
and the relay loop failing to reach `:1` is expected/harmless. Leave it running; **record**
the three values it prints:

```
  agreement pubkey: <HOST_PUB>           ← host pubkey (hex)
  iroh: EndpointId <EID>  (account=demo) ← EndpointId
        direct <HOST_ADDR>               ← e.g. 192.168.x.y:49xxx
```

> **Firewall:** System Preferences → Security & Privacy → Firewall. If it's on, **allow
> incoming connections for `pc-daemon`** (or disable it for the test) — otherwise the
> client's QUIC/UDP can't reach the host.

## 4. Onboard the desktop app so it has an ARK — 💻 Client

The Finder mount encrypts with your **account key (ARK)**, so the app must be onboarded
first. Follow the main runbook `two-device-test.md` §3–5 once: sign in at `$CP` in a
**browser**, do the dev purchase, then **import the session token + ARK** into the desktop
app. (Skipping this leaves the ARK empty and the mount can't encrypt consistently.)

## 5. Mount the host's drive in Finder — 💻 Client

In the desktop app: **Settings → Drive & storage → Remote host**, fill in:

| Field | Value |
|---|---|
| `ws://relay:port` | `ws://127.0.0.1:1` (unused — Iroh wins) |
| account | `demo` |
| host pubkey (hex) | **`HOST_PUB`** |
| iroh EndpointId | **`EID`** |
| iroh addrs | **`HOST_ADDR`** |

Click **Mount remote in Finder**.
✅ **Pass:** the panel flips to *"Mounted — In Finder — /Users/…/.sharedock/Sharedock"* and Finder opens it.

## 6. Verify round-trip + E2EE-at-rest

```bash
# 💻 Client — write & read through the Finder mount
echo "hello over iroh" > ~/Personal\ Cloud/iroh-test.txt
cat ~/Personal\ Cloud/iroh-test.txt

# 🖥️ Host — the plaintext must NOT be on disk (ciphertext only)
grep -rl "hello over iroh" ~/pc/data && echo "LEAK ✗" || echo "ciphertext only ✓"

# 💻 Client — ~200 MB streaming round-trip (4 MiB chunks over Iroh)
dd if=/dev/urandom of=/tmp/big.bin bs=1m count=200
cp /tmp/big.bin ~/Personal\ Cloud/big.bin && cp ~/Personal\ Cloud/big.bin /tmp/big.out
shasum /tmp/big.bin /tmp/big.out   # ✅ the two hashes match
```

Then **Unmount** in the app.
✅ **Covered:** remote host over Iroh direct P2P · encrypted RPC · WebDAV Finder mount ·
chunked/streaming transfer · E2EE at rest · cross-machine.

## Optional — test the deployed relay path too

To also exercise the `wss://` relay (not just Iroh), restart the host pointed at your
deployed control plane (the daemon now speaks TLS), keeping `account=demo`:

```bash
PC_DATA_DIR="$HOME/pc/data" PC_ACCOUNT=demo PC_DEV_ACCEPT_ANY=1 PC_IROH=1 \
PC_RELAY_URL=wss://<your-control-plane> ./pc-daemon
```
On the client, set the mount's relay field to the same `wss://…` URL. With the control
plane in `ENVIRONMENT=development`, the relay admits the connection tokenless. Iroh still
wins on the LAN; kill it (or use a WAN client) to force the relay path.

## Cleanup — 🖥️ Host

`Ctrl-C` the daemon. The encrypted store stays in `~/pc/data` (safe to delete to reset).

---

_This is the "Mojave-as-host" variant of `two-device-test.md`. The client's Finder-mount
panel is manual (host pubkey + Iroh endpoint), so it needs no control-plane discovery,
license, or pairing — those are only for the full GUI onboarding flow._
