# Not yet built / deferred

This tracks what the Sharedock console shows but doesn't fully back. A large batch of the
original deferred items has since been **implemented** (see below); this file now lists only
what genuinely remains, plus the honest limitations of the newly-built features.

## Recently implemented (no longer deferred)

- **Sharing links** — real E2EE share links. The client wraps the file's content key to a
  random secret carried only in the URL fragment; the control plane stores ciphertext +
  wrapped key (zero-knowledge) via `POST /api/share` / `GET /api/shares` /
  `GET|DELETE /api/share/:token`; a `#share=…` link opens a decrypt-and-download page. Files
  page has a Share action + a "Shares" manager. Small shares stay inline in D1; larger ones
  go to R2 and stream back (see the large-file entry below).
- **Activity feed / terminal-log history** — the host keeps an append-only `activity` log
  (upload/download/delete/trash/mkdir) served by `GetActivity`; the dashboard terminal panel
  renders real events (`FEATURES.ACTIVITY_LOG = true`).
- **Per-host live read/write** — the connected host's row shows real read/write from
  `getConnection()` (the transfers store); other hosts show `--` (`PER_HOST_THROUGHPUT`).
- **Direct-P2P transport telemetry** — the console shows the real transport from
  `getConnection().path` (`RELAY` in the web build — honest; direct-P2P is the native path)
  (`DIRECT_P2P_TELEMETRY`).
- **Transfers panel** — driven by live `useTransfers()` (real client transfers), with the
  sample simulation only as a demo fallback.
- **Multi-host capacity math** — hosts publish `quota_bytes` to discovery; capacity =
  pool → Σ(quota), mirror → min(quota) over real per-host quotas.
- **Recent / Starred / Search** — now GLOBAL (whole-partition, recursive) via host RPCs
  `ListRecent` / `ListStarred` / `Search`, not current-folder approximations.
- **Folder download** — recursive (walks `listDir` over the subtree) and packed into a real
  `.zip` with the structure intact (`packages/ui/src/files/zip.ts`).
- **Mirror-consistent trash/star** — `starred` + `trashed_at` ride the replication manifest
  and converge across a mirror (state-diff push + apply, since they don't bump `mtime`).
- **Mirroring driven from the console** — the Layout switch used to write an
  `account_topology` row that nothing read: hosts learned their replication peers only from a
  hand-set `PC_PEERS`. A host now fetches its peers from `GET /api/account/peers`, which
  returns the account's other approved hosts only in `mirror` mode, so the switch actually
  turns replication on. **Limitation:** the mesh is built at daemon start, so a host adopts a
  topology change when it next starts rather than immediately; the console says so.

## Still deferred / known limitations

- **Physical disk free/total — POPULATED.** `HostStatus.disk_free_bytes/disk_total_bytes`
  come from `statvfs` on Unix and `GetDiskFreeSpaceExW` on Windows
  (`crates/host-agent/src/lib.rs`). Capacity still uses the partition **quota**, which is the
  right number for capacity; the disk figures are what the host clamps an allocation against.
- **Sharing of large files — BUILT.** Small shares stay inline in D1 (one round trip); past
  that the ciphertext goes to an R2 bucket and streams back on redeem via
  `GET /api/share/:token/blob`, which lifted the ~8 MB ceiling. Revoking deletes the object
  as well as the row. The client asks `GET /api/share-limits` so it refuses a file before
  encrypting it. **Needs the bucket to exist before deploy** (`wrangler r2 bucket create
  sharedock-shares`); remove the `[[r2_buckets]]` block to run without it, and shares fall
  back to the smaller inline cap rather than breaking.
- **Relay latency — APPROX.** Shown as a timed real-RPC round-trip, not a dedicated ping.
- **Global-view path features — FIXED.** `FileEntry` now carries an explicit `path`, so
  open-into-folder, rename and recursive download work inside Recent/Starred/Search exactly
  as in a folder view. The path is a real field rather than parsed out of `id`: the host's id
  happens to be the path, but the mock encodes ids differently, so parsing either would break
  against the other. `#[serde(default)]` keeps older hosts compatible; the UI falls back to
  the old per-view behaviour when the field is absent.
- **Recovery key — hex, not 24-word mnemonic.** No BIP39 wordlist is bundled.
- **Pairing QR — NOT BUILT, and probably not worth building.** The pairing code is 12
  characters from a deliberately unambiguous alphabet, and it is typed on the machine being
  paired. A QR shown on your main device cannot be scanned by the headless box that needs
  the code, so it would save a short piece of typing in the one case where you already have
  two screens. Revisit if host onboarding ever moves to a phone.
- **Passkeys — REMOVED, not deferred.** Auth is master-password everywhere (see
  `docs/auth-redesign.md`): WebAuthn does not work in the Tauri webview and did not exist on
  the old macOS this product targets. There is no passkey enrollment in the web app either,
  and no `webauthn.ts` in the control plane. The `credentials` and `challenges` tables are
  leftovers.
- **Device ARK auto-delivery — NO LONGER NEEDED (was never built).** This was a real gap
  under passkey auth, where there was no password to derive the account key from and each
  device needed its own wrapped copy. Master-password auth replaced that: signing in returns
  the wrapped ARK and the device unwraps it locally, so adding your own second device is
  already self-serve and nothing is shared by hand. The `devices.wrapped_ark_for_device`
  column is dead and is read by nothing. Covered by the "second device" checks in
  `test/cp-api.mjs`.
- **Settings — every category is now real.** Security (address confirmation, recovery-key
  state, session lifetime), Network (live transport path, why the web build is relayed,
  coordination origin) and About (surfaces, legal documents) were built on top of the
  endpoints added for email, recovery and account export. Account gained licence
  re-delivery, data download and a deletion flow that re-asks for the password; its previous
  "Delete account" button had no handler at all. Notifications, Appearance and General were
  REMOVED rather than filled: nothing real sits behind them, and a nav item that leads to an
  apology is worse than one that is not there.

---

_Keep this in sync with the `FEATURES` flags (`packages/ui/src/shared/features.ts`) and the
real-adapter stubs in `packages/rpc-client-ts/src/real-api.ts`._
