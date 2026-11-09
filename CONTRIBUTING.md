# Working on Sharedock

The original project is no longer maintained, so these notes are for whoever forks it. They cover the conventions the code already follows and the places a change usually has to touch.

## Before you push

```sh
cargo test --workspace
pnpm typecheck
pnpm test
pnpm --filter @app/control-plane test:e2e   # after VITE_CONTROL_URL="" pnpm build
```

CI runs the same commands on every push. The Rust tree isn't rustfmt-formatted, so CI doesn't gate on `cargo fmt` or `clippy -D warnings`. Reformatting the whole tree in its own commit would make that possible.

## Adding a host RPC

A file operation crosses four layers, and all four have to agree:

1. `crates/core-proto/src/lib.rs`: add a variant to `Request` and, if needed, `Response`. These are the plaintext payloads; the session layer encrypts them.
2. `crates/host-agent/src/lib.rs`: handle it in `handle`, backed by `crates/core-fs` if it touches storage.
3. `packages/rpc-client-ts/src/wire.ts` and `real-api.ts`: the TypeScript encoding and the `DriveApi` method. `mock.ts` needs a matching fake so the console still renders with no host.
4. `packages/ui`: the screen that calls it.

The browser and the Rust host must produce identical bytes for anything encrypted. `packages/rpc-client-ts/src/crypto.ts` mirrors `crates/core-crypto`. No automated test checks the two against each other, so try a crypto change against a real `pc-daemon` before trusting it.

## Control-plane changes

Schema changes are numbered SQL files in `services/control-plane/migrations/`. Add a new file rather than editing an old one, then run `pnpm --filter @app/control-plane db:migrate:local`. New endpoints go in the `ROUTES` table in `src/worker.ts`, and `test/cp-api.mjs` is where their tests go.

The control plane never sees file contents or unwrapped keys. Anything new it stores should be a public key, a wrapped blob, or metadata. [docs/threat-model.md](docs/threat-model.md) states the rules.

## Old macOS

The host daemon runs on macOS 10.12 and the desktop app on 10.13, whose WebKit is roughly Safari 11 to 14. That rules out a few things in the UI bundle:

- No `BigInt`. The crypto uses StableLib for this reason.
- The build targets ES2019 (`apps/web/vite.config.ts`).
- CSS goes through `apps/web/postcss-mojave.cjs`, which rewrites `clamp()`, `inset`, flex `gap`, and logical margins into forms old WebKit understands.
- No Safari 15+ APIs such as `<dialog>.showModal()`.

[docs/host-compatibility.md](docs/host-compatibility.md) has the version floors and `scripts/build-daemon-universal.sh` builds an Intel daemon that runs on 10.12.

## Features that aren't finished

`packages/ui/src/shared/features.ts` holds flags for surfaces the UI can render but the backend doesn't fully support. [docs/not-yet-built.md](docs/not-yet-built.md) tracks them; keep the two in sync.

## License

Contributions to a fork are under the AGPL-3.0 unless the fork says otherwise. Keep third-party files' notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) current when you add fonts, icons, or vendored code.
