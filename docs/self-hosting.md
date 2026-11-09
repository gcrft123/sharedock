# Self-hosting

This guide deploys your own Sharedock: the control plane on Cloudflare, the web console served from it, and hosts on your machines. The defaults in `services/control-plane/wrangler.toml` run without billing, so every account gets a free license with no host limit.

## Requirements

- A Cloudflare account. The Workers free plan is enough to try it. Durable Objects with SQLite storage and D1 are both available on it.
- Node 20 or newer with pnpm (`corepack enable pnpm`), and Rust (see the [README](../README.md#prerequisites)).
- `pnpm install` run once at the repo root. It installs Wrangler into `services/control-plane`.

Run the Wrangler commands below from `services/control-plane`, with `pnpm exec wrangler …` or `npx wrangler …`. Sign in first with `wrangler login`.

## 1. Create the database and bucket

```sh
wrangler d1 create personal-cloud
```

Copy the `database_id` it prints into the `[[d1_databases]]` block of `wrangler.toml`, replacing the zero placeholder. Then apply the schema:

```sh
pnpm --filter @app/control-plane db:migrate
```

Large share links store their ciphertext in R2. Create the bucket, or delete the `[[r2_buckets]]` block to keep shares inline in D1 with a smaller size cap:

```sh
wrangler r2 bucket create sharedock-shares
```

## 2. Set the signing secrets

The Worker signs sessions with an HMAC secret and licenses with an Ed25519 seed. In production it refuses to start without both, because the fallback development values are public.

```sh
openssl rand -base64 32 | tr '+/' '-_' | tr -d '=' | wrangler secret put CP_TOKEN_SECRET
openssl rand -base64 32 | tr '+/' '-_' | tr -d '=' | wrangler secret put CP_LICENSE_SEED
```

Keep a copy of `CP_LICENSE_SEED`. Hosts pin the public key derived from it when they pair, so changing it later means re-pairing every host.

## 3. Set the origin

Set `RP_ORIGIN` under `[vars]` to the origin the console is served from. That's `https://personal-cloud-control-plane.<your-subdomain>.workers.dev` for a plain deploy. For a custom domain on a zone in the same Cloudflare account, add a route and use that origin:

```toml
routes = [{ pattern = "cloud.example.com", custom_domain = true }]

[vars]
RP_ORIGIN = "https://cloud.example.com"
```

## 4. Deploy

The Worker serves the SPA from `apps/web/dist`, so build it first. An empty `VITE_CONTROL_URL` makes the console call the origin it's served from.

```sh
VITE_CONTROL_URL="" pnpm -C apps/web build
pnpm --filter @app/control-plane run deploy
```

`curl https://<origin>/api/status` returns JSON with `"database": "ok"`. Open the origin in a browser and create an account.

## 5. Add a host

A host is any machine running `pc-daemon`. In the console, choose to set up a host from another machine. It shows a pairing code. On the host:

```sh
cargo build --release -p pc-daemon
PC_DATA_DIR="$HOME/.sharedock-host" \
PC_CLAIM=<pairing code> \
PC_CONTROL_URL=https://<origin> \
PC_RELAY_URL=wss://<origin> \
PC_HOST_NAME="Closet Mini" \
PC_IROH=1 \
./target/release/pc-daemon
```

Approve the host in the console. The daemon saves its credentials to `host.json` in the data directory, so later runs need no pairing code. `PC_IROH=1` turns on the direct peer-to-peer path and also publishes the host's endpoint. Without it the console can't list the host. The full list of variables is at the top of `apps/daemon/src/main.rs`. Old Macs have their own notes in [host-compatibility.md](host-compatibility.md).

The desktop app can also act as a host and installs itself as a login service (launchd on macOS, Task Scheduler on Windows).

## 6. Build the desktop app

The desktop app bakes the control-plane origin in at build time:

```sh
scripts/build-desktop-sidecars.sh
VITE_CONTROL_URL=https://<origin> pnpm --filter @app/desktop tauri build --bundles app
```

On Windows, run `scripts\build-desktop-sidecars.ps1` and build the `nsis` or `msi` bundle. [windows-port.md](windows-port.md) lists the prerequisites. Change `identifier` in `apps/desktop/src-tauri/tauri.conf.json` if you distribute your own build, so it doesn't collide with other Sharedock installs.

An unsigned build runs on your own machines. To distribute it:

- macOS: set `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID`, then run `scripts/build-release.sh`. It signs, notarizes, staples, and checks the result with Gatekeeper.
- Windows: sign the installer with Azure Trusted Signing (`bundle.windows.signCommand`) or an OV/EV certificate (`bundle.windows.certificateThumbprint`). Without it, SmartScreen warns on every download.

### Updates

The app checks `/api/updates` on the control plane. To turn updates on:

1. Generate a key pair with `pnpm -C apps/desktop tauri signer generate -w ~/.tauri/sharedock.key`. Back up the private key; losing it means installed apps can never update again.
2. Put the public key in `plugins.updater.pubkey` in `tauri.conf.json`, replace `REPLACE-WITH-YOUR-ORIGIN` in `plugins.updater.endpoints`, and set `bundle.createUpdaterArtifacts` to `true`.
3. `wrangler secret put RELEASE_TOKEN` with a long random string.
4. Build with `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` set. The build writes an update archive and a `.sig` file next to it.
5. Upload the archive to any HTTPS URL and publish it once per target (`darwin-aarch64`, `darwin-x86_64`, `windows-x86_64`):

```sh
curl -X POST https://<origin>/api/updates -H 'content-type: application/json' -d '{
  "token": "<RELEASE_TOKEN>", "version": "0.1.1", "target": "darwin-aarch64",
  "url": "https://…/Sharedock.app.tar.gz", "signature": "<contents of the .sig file>",
  "notes": "What changed" }'
```

Bump `version` in `tauri.conf.json` for every release. The endpoint compares versions.

## Optional: email

The control plane sends license receipts, address confirmations, and license re-delivery through Cloudflare Email Sending. Until a domain is onboarded, every send is a logged no-op and nothing else depends on it.

1. Cloudflare dashboard → Email → Email Sending → add your domain and confirm the SPF and DKIM records.
2. Set `EMAIL_FROM` under `[vars]` to an address on that domain, and deploy.

`/api/status` then reports email as configured.

## Optional: selling licenses

Billing sells one-time licenses by host seats: Solo (1 host), Home (3), and Max (6). The catalog is in `services/control-plane/src/tiers.ts`, and the display names and prices are in `packages/ui/src/onboarding/machine.tsx`.

1. In Stripe, create one product per tier, each with a one-time price.
2. In `wrangler.toml`, remove `BILLING = "off"` and set `STRIPE_PRICE_SOLO`, `STRIPE_PRICE_HOME` and `STRIPE_PRICE_MAX` to the price ids.
3. `wrangler secret put STRIPE_API_KEY`.
4. Add a webhook endpoint at `https://<origin>/api/billing/webhook` for `checkout.session.completed`, `charge.refunded`, `charge.dispute.created` and `charge.dispute.closed`, then `wrangler secret put STRIPE_WEBHOOK_SECRET` with its signing secret. Production refuses webhooks while the secret is missing.
5. Deploy and buy a tier in test mode with card `4242 4242 4242 4242`.

A refund revokes the license. Hosts re-read their allowlist every 30 seconds, so a refunded account's clients are dropped within a minute.

Accounts licensed while billing was off keep their free license after you turn billing on.

`apps/web/public/legal/` has draft terms, privacy, and refund pages with placeholder addresses. They have not been reviewed by a lawyer. Replace them before you sell anything.
