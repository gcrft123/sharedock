# Two-device end-to-end test — runbook + test plan

Run the real product across two Macs — one **host**, one **client** — against a live control
plane, and exercise the whole frontend integration (onboarding → dashboard → files → sharing →
mount).

Setup: **desktop app on both**, control plane via **`wrangler dev` + a Cloudflare tunnel**
(dev mode), mixed Intel/Apple-Silicon Macs → **universal** signed build.

Three enhancements (A/B/C) make this clean:
- **(A) The host talks TLS** — `pc-daemon` now uses a real HTTPS/WSS client, so the host reaches
  a deployed/tunnelled control plane directly (it no longer has to sit on the wrangler-dev box).
- **(B) The app bundles `pc-daemon`** — "Store my files" (host mode) works out of the box; nothing
  to place on `PATH`.
- **(C) The Worker serves the web app** — one origin covers API + relay + the SPA + the share-redeem
  origin + share-redeem links. No second tunnel.

**Resolved (kept for history):** the desktop webview could not run passkeys, so sign-in had to happen
once in a browser and the desktop app imported the resulting session token and account key by hand.
Auth is now email + master password, which works natively in the webview, so each device just signs
in. See `docs/auth-redesign.md` for why.

---

## 1. Control plane — ONE origin (run anywhere reachable; e.g. a laptop)

This step stands up a single HTTPS origin that is the **API**, **WebSocket relay**, and **web app**
together. Both Macs talk only to that origin. You can run it on either
test laptop — it does not need to be the host machine.

### Why one origin?

- Share-redeem links are `#share=…` fragments on the SPA origin; the SPA decrypts in the browser.
- Hosts and clients connect to `wss://$CP/signal` and `https://$CP/api/*`. One tunnel = one `$CP`.
- The Worker’s `[assets]` config serves `apps/web/dist` for non-API paths (`run_worker_first` so
  `/api` and `/signal` still hit the Worker).

### Prerequisites

| Tool | Why | Quick install (macOS) |
|---|---|---|
| Node ≥ 20 | build SPA + run wrangler | `nvm` / official installer |
| `pnpm` | monorepo scripts | `corepack enable && corepack prepare pnpm@latest --activate` |
| `wrangler` | local Worker + D1 | comes via `services/control-plane` deps, or `brew install cloudflare-wrangler` |
| `cloudflared` | public HTTPS → local `:8787` | `brew install cloudflared` |
| `rustup` + Apple targets | desktop build (step 2) | `rustup target add aarch64-apple-darwin x86_64-apple-darwin` |
| Xcode CLT | signed macOS build | `xcode-select --install` |

From the **repo root** (the worktree / clone you are testing from):

```bash
cd /path/to/personal-cloud
pnpm install   # once per clone, if you haven’t already
```

You need **two long-running terminals** for the rest of this step: one for `wrangler dev`, one for
`cloudflared`. Keep both up for the whole two-device session.

### 1a. Build the web app (same-origin client)

The Worker serves static files from `apps/web/dist` (see `services/control-plane/wrangler.toml`
`[assets] directory = "../../apps/web/dist"`). Build the SPA **before** starting wrangler so the
assets exist.

```bash
# Leave VITE_CONTROL_URL unset so the built app calls window.location.origin
# (i.e. whatever $CP the browser is on — not a hard-coded localhost).
pnpm -C apps/web build
```

✅ **Pass:** `apps/web/dist/` exists and contains `index.html` (and assets).  
❌ If wrangler starts without a prior build, non-API routes may 404 or show a blank page.

Rebuild after any web UI change you care about in this session; wrangler will pick up the new
`dist` on the next request (restart if in doubt).

### 1b. Apply local D1 migrations

Local `wrangler dev` uses a **local** D1 database (not the production remote). Apply migrations so
auth, hosts, topology, and sharing tables exist:

```bash
pnpm -C services/control-plane db:migrate:local
# equivalent: wrangler d1 migrations apply personal-cloud --local
```

Migrations live under `services/control-plane/migrations/` (`0001` … `0006_share_content`). Safe to
re-run; already-applied ones are skipped.

✅ **Pass:** wrangler reports migrations applied (or “no pending migrations”).

### 1c. Start the Worker in development mode

`wrangler.toml` pins `ENVIRONMENT = "production"` for deploys. For this test you **override** it to
`development` so you get:

- **Tokenless relay** on `/signal` (hosts/clients can connect without production-grade session gates)
- **`dev-complete` billing** (purchase step works without Stripe secrets)
- Local D1 + Durable Objects (AccountDO for presence / pairing / relay)

```bash
pnpm -C services/control-plane exec wrangler dev \
  --var ENVIRONMENT:development \
  --port 8787
```

Leave this running. You should see wrangler ready on `http://127.0.0.1:8787`.

Quick local smoke (optional, before the tunnel):

```bash
curl -s http://127.0.0.1:8787/health   # → {"ok":true,...}
curl -sI http://127.0.0.1:8787/        # SPA via [assets]
```

### 1d. Expose HTTPS with a quick tunnel → `$CP`

Passkeys and real devices need a public **HTTPS** origin. In a **second terminal**:

```bash
cloudflared tunnel --url http://localhost:8787
# prints something like: https://random-words-here.trycloudflare.com
```

Export that URL as `$CP` everywhere you will need it (third terminal, shell profile for the
session, or a sticky note):

```bash
export CP=https://random-words-here.trycloudflare.com   # no trailing slash
echo "$CP"
```

✅ **Pass:** `curl -sI "$CP"` returns `200` (or a Worker response); opening `$CP` in a browser loads
the Sharedock SPA.

> **Quick tunnels are ephemeral.** Restarting `cloudflared` mints a **new** hostname. Keep this
> process up for the whole session, or use a named tunnel / `wrangler deploy` for a stable `$CP`
> (see tip below).

### 1e. Point `RP_ORIGIN` at `$CP` (restart wrangler)

No longer about passkeys, which are gone: sign-in is email + master password and is not
origin-bound. `RP_ORIGIN` still matters because Stripe redirects and the email confirmation
link are built from it, and it defaults to `http://localhost:5173`.

1. Stop the first `wrangler dev` (Ctrl+C). Leave **cloudflared** running so `$CP` stays valid.
2. Restart wrangler with the tunnel hostname baked in:

```bash
# RP_ID = hostname only (no https://)
# RP_ORIGIN = full origin, same as $CP
pnpm -C services/control-plane exec wrangler dev \
  --var ENVIRONMENT:development \
  --var RP_ID:random-words-here.trycloudflare.com \
  --var RP_ORIGIN:$CP \
  --port 8787
```

Example if `$CP` is `https://foo-bar-baz.trycloudflare.com`:

```bash
pnpm -C services/control-plane exec wrangler dev \
  --var ENVIRONMENT:development \
  --var RP_ID:foo-bar-baz.trycloudflare.com \
  --var RP_ORIGIN:https://foo-bar-baz.trycloudflare.com \
  --port 8787
```

✅ **Pass:** browser at `$CP` → Create account → sign-in succeeds and the recovery-key screen
appears. After a tunnel restart, update `RP_ORIGIN` to the **new** hostname and restart wrangler,
or purchase redirects and confirmation links will point at the old one.

### What `$CP` now serves

| Path | Role |
|---|---|
| `$CP/` | Web app (SPA) — onboarding, dashboard, share redeem UI |
| `$CP/api/*` | Control plane REST (auth, account, hosts, billing, shares, …) |
| `$CP/signal` | WebSocket relay (`wss://…` from daemons/clients) |
| `$CP/#share=…` | E2EE share links (secret in the fragment; decrypted in-browser) |

Billing in this mode uses **`dev-complete`** — no Stripe keys required.

### Stable `$CP` (optional)

A quick tunnel’s URL changes on every `cloudflared` restart. Alternatives:

- **Named cloudflared tunnel** (fixed hostname you control) → set `RP_ID` / `RP_ORIGIN` once.
- **`wrangler deploy`** to `*.workers.dev` or a custom domain (production `ENVIRONMENT`; no
  tokenless relay / `dev-complete` unless you intentionally configure otherwise).

A stable `$CP` is what you want if you will **bake** `VITE_CONTROL_URL=$CP` into the desktop build
in step 2. With a quick tunnel, either keep it up for the whole session or set
`pc.control_url` at runtime in the app (step 4).

---

## 2. Build the signed universal desktop app

On a Mac with your Developer cert in the keychain. Set the signing identity in
`apps/desktop/src-tauri/tauri.conf.json` (`bundle.macOS.signingIdentity`) or via env.

```bash
# once: the two Apple targets
rustup target add aarch64-apple-darwin x86_64-apple-darwin

# build the bundled pc-daemon sidecar for both arches (required by externalBin):
scripts/build-desktop-sidecars.sh
#   → apps/desktop/src-tauri/binaries/pc-daemon-{aarch64,x86_64}-apple-darwin

# build the universal, signed .dmg pointed at your control plane:
VITE_CONTROL_URL=$CP pnpm -C apps/desktop tauri build --target universal-apple-darwin
#   → apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg
```

Install the `.dmg` on **both** Macs. `pc-daemon` is bundled inside the app, so host mode is
self-contained. (If `$CP` later changes, either rebuild, or in the app open the webview devtools
console and run `localStorage.setItem("pc.control_url","<new $CP>"); location.reload();`.)

---

## 3. Sign in once (in a browser) → get a session token + ARK

Passkeys can't run in the desktop webview, so mint the session at the control-plane origin (which
now serves the web app):

1. Open a browser at **`$CP`**.
2. Onboarding → **Create account** with an email + master password.
3. **Recovery key** screen → **Copy** the key. NOTE: this is the RECOVERY KEY, not the ARK. It is a
   separate secret that unwraps a server-held copy of the account key; the ARK itself never leaves
   the device. Other devices do not need it: they sign in with the same email and password and
   unwrap the ARK locally. Save it anyway — it is the only way back in after a forgotten password.
4. Continue → **purchase** (dev `dev-complete` issues a license).
5. In devtools console at `$CP`: `JSON.parse(localStorage["pc.session"]).token` and `.account`.

You now have: **account id**, **session token**, **ARK (hex)**.

---

## 4. Host — Mac A (desktop app, host mode)

1. Launch the app. If you didn't bake `$CP`, set it: devtools console →
   `localStorage.setItem("pc.control_url","$CP"); location.reload();`
2. Sign in with the **same email + master password** as §3. The paste-session-token workaround is
   gone: the desktop webview does master-password auth natively, and signing in is what delivers
   the account key to this machine.
3. Onboarding → **Set up a host → This computer** → allocate storage → the app spawns the **bundled**
   `pc-daemon` (it reaches `$CP` over HTTPS and serves over `wss://$CP/signal`). Wait for "host online."

## 5. Client — Mac B (desktop app)

1. Launch, set control URL to `$CP` (as above), import the same token + account + **ARK**.
2. It discovers Mac A's host and connects. Browsing goes over the relay (`wss://$CP/signal`); **Mount
   in Finder** uses Iroh direct-P2P (relay fallback).

---

## 6. Step-by-step test checklist

Run on the **client** (Mac B) unless noted. ✅/❌ each.

### A. Onboarding
1. Fresh app → **Sign in** screen (app rail pinned open on the left).
2. Error handling: a bad server URL → the shard-loader **error state** (not a crash).
3. Recovery-key screen shows the real ARK (hex grid); Copy + Download work; checkbox gates Continue.
4. Purchase step completes (dev) and caches a license.
5. Add-host: "Another machine" shows a **pairing code** + waits; "This computer" appears (desktop).
6. Topology step appears only with >1 host; Pool/Mirror + Balanced/Sequential persist.
7. "Open Sharedock" lands in the dashboard.

### B. Dashboard (live data from the host)
8. **Capacity** = the host's real quota; **Used %** + **files** track uploads; **Uptime** = host uptime.
9. **Latency** shows real ms (timed RPC); `--` when disconnected.
10. **Throughput** Read/Write move during transfers; the wave feed animates; idle → ~0.
11. **Hosts panel**: connected host shows real read/write; others `-- / --`; transport chip = real (`RELAY`).
12. **Devices**: both devices appear; approve/revoke a pending device works.
13. **Topology**: drag to pan; select a node; toggle Pool/Mirror (persists via `setTopology`).
14. **Activity / terminal log**: real events (upload/download/delete/mkdir) appear as you act.
15. **Transfers panel**: real in-flight + recent transfers during file ops.
16. **Add host** modal mints a code; **Settings** → Account shows email + license; Drive & storage shows Mount controls.

### C. Files — core (real E2EE host)
17. Browse folders, breadcrumb, lazy sidebar tree.
18. **Upload** (button + drag-drop) → encrypts client-side; verify at-rest ciphertext on Mac A's `~/.sharedock/host` (files unreadable).
19. **Download** a file → decrypts byte-identical to the original.
20. **New folder**, **rename** (F2), **Move** (drag/dialog), **Delete → Trash** (Undo toast).
21. **Star**; **Trash** view lists it; **Restore** (selection bar + context menu); **Delete forever** / **Empty trash**.
22. Multi-select (shift/cmd), column sort, filter chips, grid ↔ list, preview drawer (image thumbnail).

### D. Files — global views + folder download
23. **Search** finds matches **across all folders** (recursive), not just the current one.
24. **Recent** = most-recently-modified files, globally.
25. **Starred** = all starred items globally; sidebar badge = true global count.
26. **Folder download** recursively downloads the subtree as a single `.zip` with its folder structure intact.

### E. Sharing links (E2EE)
27. Select one **file** → **Share** (selection bar / context menu / preview) → dialog shows a **URL**; Copy.
28. Open the URL (browser at `$CP`, any device) → **decrypts in the browser** (secret in the `#fragment`) and downloads. Content matches.
29. **Shares** manager (toolbar): lists shares (name/views/size/created); **Revoke** → the link then 404s.
30. Share a **large file** (>1 MB) → succeeds via R2 blob storage; the redeem page fetches
    the ciphertext from `/api/share/:token/blob`. Only a file past the deployment limit
    (see `GET /api/share-limits`) gives the "too large to share as a link" error.

### F. Native mount (desktop)
31. Mac B → Settings → Drive & storage → **Mount remote in Finder** → mounts `~/.sharedock/Sharedock` over Iroh (relay fallback).
32. In Finder: create/read/write/delete on the volume → syncs to the host (verify on the Files page + Mac A).
33. **Unmount** → the volume disappears.

### G. Two-device sync + mirror
34. Upload on Mac B → appears on Mac A's host + Files page.
35. (Multi-host) Add a 2nd host, set **Mirror**; a file written on one replicates to the other; **star/trash converges** across hosts after a sync cycle.

---

## 7. Gotchas
- Keep the `$CP` tunnel up for the session (quick-tunnel URLs change on restart; use `wrangler deploy`
  or a named tunnel for a stable URL you can bake into the desktop build).
- Desktop sign-in is the **same email + master password** as the browser. Nothing is pasted between
  devices any more, and nothing has to be kept in sync by hand: signing in unwraps the account key
  locally on each machine. Two devices that share an account therefore always share an ARK, which is
  what the old "invalid tag" failures came from getting wrong.
- `RP_ORIGIN` must match `$CP` or purchase redirects and email confirmation links point elsewhere.
- `pc-daemon` now speaks TLS, so the host can run on any machine and reach `$CP` directly.
