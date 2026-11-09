# Phase 4 — Host Onboarding (client-initiated "add a storage device")

## Context

Multi-host pooling/mirroring works, but a host is still set up by hand (run `pc-daemon`
with env vars, copy its printed keys into clients). The product model we want is the
opposite and friendlier: **the client app is the hub**, and you *add hosts from it*.
Install the same software on an old computer, pair it with a code, approve it on your
main device, and it becomes storage.

This is a good fit for the architecture because **a host never needs the account key** —
it only ever stores ciphertext. So onboarding a host moves no secret to it, and a
compromised host is an availability/space risk, never a confidentiality one.

**Decisions locked (with the user):**
- **Form factor: app + headless.** Ship host-mode inside the desktop app *and* a
  lightweight headless daemon for screenless NAS/servers.
- **Explicit approve.** A valid pairing code self-enrolls a host as *pending*; it serves
  nothing and is invisible to clients until the owner taps Approve.
- **Client-initiated, code-based pairing.** The client mints a short-lived, single-use,
  account-scoped code; the host redeems it. The host generates its own identity locally.

### The gap this closes
`POST /api/devices` registers a device but is **session-gated** (`sessionAccount`, see
[pairing.ts](../services/control-plane/src/pairing.ts)) — a fresh host machine has no owner
session, so it can't self-register. The **claim/redeem** flow below lets a host enroll with
a code instead of the owner's session, landing as `approved = 0` (pending) until approved.

---

## Trust & credential model

```
 CLIENT (owner session)                CONTROL PLANE                 NEW HOST (no session)
   │  POST /api/host/claim  ───────────▶  mint code (store hash,
   │      { }                              account, exp, single-use)
   │  ◀── { code, expiresAt }
   │  show code / QR
   │                                                                   redeem code:
   │                                    ◀── POST /api/host/claim/redeem ── { code,
   │                                        verify code (hash, unexpired,    endpoint_id,
   │                                        unused) → mark used;             agreement_pub,
   │                                        INSERT devices(role=host,        name }
   │                                        approved=0) ── returns ──▶   { account, cp_pubkey,
   │                                                                       host_token }  ← NOT
   │                                                                       the license yet
   │  GET /api/devices (pending host)                                   ▶ poll GET /api/host/
   │  POST /api/devices/approve ───────▶  approved = 1                    credential (host_token)
   │                                       (discovery now includes it) ◀── { approved:false } …
   │                                    ── after approval ──────────────▶  { approved:true,
   │                                                                        license }
   ▼                                                                    ▶ store license; serve
```

Security refinement over the first sketch: **redeem does not hand out the license.** It
returns a scoped **host token**; the host polls `GET /api/host/credential` and only receives
the account license *after* the owner approves — so a leaked/guessed code can never obtain
the account credential (worst case it registers an inert pending host).

- **Serving credential = the account license (v1).** Redeem returns the account's perpetual
  license token (the daemon already consumes `PC_LICENSE`/`PC_LICENSE_PUBKEY` for offline
  quota). All hosts of an account share it.
- **Per-host authorization is the `devices.approved` flag**, enforced at two gates so the
  shared license can't add a host silently:
  1. **Discovery filter** — `GET /api/host/endpoint` returns only hosts whose device is
     `approved = 1` (JOIN `devices` on `endpoint_id = id`). Pending/revoked hosts are
     invisible, so clients never dial them.
  2. **Publish gate** — `POST /api/host/endpoint` rejects an endpoint whose `endpoint_id`
     isn't an approved host device. A pending/revoked host can't advertise itself.
- **Revoke a host** = set its device `approved = 0` (new revoke endpoint). It drops from
  discovery + publish and is removed from topology; the mesh stops treating it as a peer.
- **Code hygiene.** Store only a hash of the code; single-use (atomic mark-used);
  ~10-minute expiry; account-scoped. Redeem is unauthenticated *by design* (the code is
  the bearer proof) but does nothing dangerous — worst case an attacker registers a
  *pending* host that the owner never approves.
- **Hardening (later, not v1):** per-host scoped tokens instead of the shared license
  (individually revocable without a device-flag check), and signing endpoint-publish with
  the host device key so publish is provably from that host.

---

## Component changes

### 1. Control plane (`services/control-plane`)

- **Migration `0005_host_claims.sql`**:
  ```sql
  CREATE TABLE host_claim (
    code_hash   TEXT PRIMARY KEY,   -- sha256(code); never store the code itself
    account     TEXT NOT NULL,
    name        TEXT,               -- optional label the owner set
    expires_at  INTEGER NOT NULL,
    used_at     INTEGER             -- NULL until redeemed (single-use)
  );
  ```
  (`devices` already has the host role + `approved`; no change there.)
- **New `src/claim.ts`** (implemented in 4a):
  - `claimCreate` — `POST /api/host/claim` (session): random 12-char code (unambiguous
    alphabet), store `sha256(code)` + account + exp; return `{ code, expiresAt }`.
  - `claimRedeem` — `POST /api/host/claim/redeem` (no auth): look up by `sha256(normalized
    code)`, atomically mark used (single-use), upsert the host into `devices`
    (`role='host', approved=0`), return `{ account, cp_pubkey, host_token }` — **not** the
    license (see the refinement above).
  - `hostCredential` — `GET /api/host/credential` (host token): once the device is approved,
    return `{ approved:true, license }`; before that, `{ approved:false }`.
  - New `signHostToken`/`verifyHostToken` (typ `host`) in `tokens.ts`.
- **`src/endpoint.ts`** — add the two approval gates (discovery filter on GET, approved
  check on PUT) described above.
- **`src/pairing.ts`** — add `deviceRevoke` (`POST /api/devices/revoke`, session:
  `approved = 0`); extend `deviceList` to include hosts (it already lists all roles) so the
  Hosts panel can show pending hosts. Optionally add a `GET /api/account/hosts` convenience
  that joins `devices` (role=host) with `host_endpoints` for the panel.
- **`src/worker.ts`** — register `POST /api/host/claim`, `POST /api/host/claim/redeem`,
  `POST /api/devices/revoke`.
- **`test/cp-api.mjs`** — claim→redeem→pending→approve→discovered flow; expired/used code
  rejected; unapproved host filtered from discovery + blocked from publish; revoke drops it.

### 2. Host self-enrollment (`crates/host-agent`, `apps/daemon`)

- The daemon gains a **first-run enroll path** that replaces manual env config:
  - `PC_CLAIM=<code>` (or a `host.toml` with `claim`, `data_dir`, `quota_gb`, `control_url`)
    → the daemon `POST`s the code to `/api/host/claim/redeem`, receives `{account, license,
    cp_pubkey}`, and persists them next to its `identity.key` (a `host.json`), then proceeds
    to serve. Its identity key is generated locally on first run (already the case).
  - Once enrolled, subsequent runs read `host.json` (no code needed).
- Endpoint publish is updated for the approval gate (already sends `endpoint_id` +
  `agreement_pub`; the CP does the approved check).
- Small helper in `host-agent` to write/read the persisted host config.

### 3. Headless setup page (`apps/daemon`)

- On first run with no `host.json`, the daemon binds a **LAN setup server** (e.g.
  `http://0.0.0.0:4920`) serving one self-contained page: enter claim code, pick storage
  folder, set quota. Submit → redeem → write config → drop the setup server → start serving.
- **Config-file fallback** for fully scripted installs: dropping a `host.toml` with the
  claim skips the page entirely.
- Print the setup URL + LAN IP at startup so the user knows where to point a browser.

### 4. App host mode (`apps/desktop`)

- First-run role picker: **Access my files / Store my files / Both**.
- "Store my files" → an onboarding view: enter the claim code (shown on the hub device),
  pick a storage folder + quota, confirm.
- The app runs the host by **managing `pc-daemon` as a Tauri sidecar** (reuse the daemon
  binary; no logic fork) — configure it via the persisted `host.json`, start it in the
  background, and show a **status view** (online, capacity used/total, connected clients,
  Stop). Tauri's sidecar + background-process APIs cover start/stop/relaunch-on-login.
- macOS note: the desktop app floors at 10.13, the daemon at 10.12 — a High Sierra Mac mini
  can run either path.

### 5. Client onboarding UI (`packages/ui`, `packages/rpc-client-ts`) — folds into 2c-UI

- **Owner session in the app.** The Hosts-panel actions (mint claim, approve, revoke) are
  session-gated, so the desktop app needs the owner **signed in with their master password**. Reuse the
  web console's master-password sign-in through `rpc-client-ts` to obtain + store a session token.
  (This also satisfies the 2c-UI "desktop → CP auth for discovery" gap.)
- **Hosts panel additions** (on top of the 2c-UI panel):
  - **"Add a storage device"** → calls `claimCreate`, shows the code as words + a QR, with a
    live *"Waiting for the device…"* state (poll `GET /api/devices` for a new pending host).
  - **Pending-host card** — *"New storage device: '<name>' — Approve?"* → `deviceApprove`.
    On approving the **2nd+** host, prompt **Pool vs Mirror** (+ strategy) → `POST
    /api/account/topology`.
  - **Per-host row** gains **Revoke** → `deviceRevoke`.
- **`rpc-client-ts`** — add `createHostClaim`, `listDevices`, `approveDevice`,
  `revokeDevice`, plus the password-auth/session helpers.

---

## Phased delivery + verification

**4a — Claim protocol (control plane).** Migration `0005`; `claim.ts` (create/redeem);
endpoint approval gates; `deviceRevoke`; worker routes.
*Verify:* `cp-api.mjs` extended — claim→redeem→pending→approve→discovered; expired/used
code rejected; pending host filtered from discovery + blocked from publish; revoke drops it.
Run locally against `wrangler dev` + local D1 (as with `0004`).

**4b — Host self-enroll (daemon).** `PC_CLAIM` / `host.toml` redeem-on-first-run,
persist `host.json`, serve. Endpoint publish under the approval gate.
*Verify:* an e2e or scripted run — mint a claim (via the CP test), start a daemon with the
code, confirm it enrolls (pending → invisible), approve it via the API, confirm it becomes
discoverable and serves a client round-trip.

**4c — Headless setup page (daemon).** First-run LAN setup server + config-file fallback.
*Verify:* manual — start a fresh daemon, open the setup URL from a browser, paste a code,
confirm it enrolls and starts serving; and the `host.toml` path with no page.

**4d — App host mode (desktop).** Role picker + "Store my files" onboarding + `pc-daemon`
sidecar management + status view.
*Verify:* GUI on macOS — pick "Store my files", enter a code, choose a folder, see it go
online in the hub's Hosts panel; Stop/restart works; survives relaunch.

**4e — Client onboarding UI (console/desktop).** Passkey/session in the app; "Add a storage
device" (code + QR + waiting), pending-approval card, approve → pool/mirror prompt, revoke.
*Verify:* GUI end-to-end on two machines — add the Mac mini as a host entirely from the hub
app (code shown on hub, entered on the mini), approve, pick mirror, watch a file replicate;
then revoke and confirm it drops out.

---

## Security considerations

- The host receives **no account key** — only the account id, the license (quota), and its
  own identity. Confidentiality is unaffected by adding hosts.
- **Explicit approve** is the trust gate: a code only produces a *pending* host; nothing is
  discovered/served until the owner approves.
- Claim codes are **hashed at rest, single-use, short-lived, account-scoped**. Redeem is
  intentionally unauthenticated (the code is the proof) and can only create a pending host.
- **Revocation** is immediate at the discovery + publish gates; also drop the host from
  topology and stop the mesh treating it as a peer.
- The setup page binds to the LAN only and is torn down after enrollment.

## Non-goals / later

- Per-host scoped serving tokens (v1 shares the account license; revocation is via the
  approved flag).
- Signed endpoint-publish (device-key signature) — hardening on top of the approval check.
- Claim-code GC and host-side auto-update.
- Cross-account / multi-tenant hosting.
