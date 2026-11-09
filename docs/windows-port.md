# Windows port

Status: **working, verified on a Windows 11 ARM64 VM, unsigned.** The host daemon, the
service that keeps it alive, and the Explorer drive mapping all run natively and are covered by
tests that execute on Windows. What remains is packaging polish: a code-signing certificate,
and a first hands-on pass through the installed GUI on real hardware.

## What was verified, and how

Every row below ran on the VM (Windows 11 26200, ARM64, UAC off) against this branch.

| Piece | How it is verified |
|---|---|
| Workspace build + all 65 tests | `cargo test --workspace`, natively on ARM64. |
| Free disk via `GetDiskFreeSpaceExW` | Daemon status line reports the partition clamped to real free space (70,580 MiB against Windows' own 74.0 GB figure). |
| Owner-only key files (`core_fs::write_private`) | `icacls` on `identity.key` shows inheritance removed and exactly owner + SYSTEM + Administrators; unit test asserts no inherited entry survives. |
| Daemon as a GUI-subsystem exe | Prints to a terminal it was launched from (attaches to the parent console), to a file when the parent redirects (the desktop app), and to `PC_LOG_FILE` under Task Scheduler. No console window in any case. |
| `--env-file` | Runs with an empty environment from a `KEY=VALUE` file; a malformed file exits 1 with the line quoted. |
| Explorer drive mapping | `mount_round_trip_through_a_drive_letter`: in-process WebDAV server → `net use S:` → a file written and read back through the letter with plain `std::fs` → plaintext absent from the blob store → unmapped. |
| Task Scheduler service | `service_round_trip_registers_runs_and_removes`: registers the real task, the task starts the daemon through the env file, output reaches `daemon.log`, uninstall leaves the library clean. |
| Desktop crate | Compiles (debug and release) and its unit tests pass on Windows; `tauri build --bundles nsis` produces `Sharedock_0.1.0_arm64-setup.exe`. |

The two round-trip tests are `#[ignore]` because they touch the machine (a real drive letter,
the real task library). Run them on a Windows box with:

```powershell
$env:PC_DAEMON_BIN = "$PWD\target\debug\pc-daemon.exe"
cd apps\desktop\src-tauri
cargo test --lib -- --ignored service_round_trip
cargo test --lib -- --ignored mount_round_trip
```

CI (`.github/workflows/ci.yml`, "Windows") builds and tests the workspace on x86_64, builds
the desktop crate against a real frontend and sidecar, and runs the service round trip on the
runner. The mount round trip stays local: a Server image does not ship the WebClient service.

## How each platform gap was closed

**Data directories.** Everything lives under `%LOCALAPPDATA%\app.sharedock.desktop` (`host\`
for the host store, `drive\` for the local drive) — the identifier-named directory every Tauri
app uses, and deliberately not `%LOCALAPPDATA%\Sharedock`, which is where the per-user
installer puts the program. Program and data must not share a directory: the uninstaller
removes what it installed unconditionally, and removes the identifier directory only when the
user ticks "delete application data". `HOME` is unset on Windows; `paths::home` reads
`USERPROFILE`. There is no legacy directory to migrate — the Windows build never shipped under
the old name.

**Service.** A Task Scheduler task named `\Sharedock Host`, registered from XML. The principal
is the user's SID (names fail: `USERDOMAIN` reads `WORKGROUP` in some sessions). It tries S4U
first — runs at boot with nobody logged in, no stored password — and falls back to an
interactive-logon task for accounts without the batch-logon right. Settings match the launchd
agent: unlimited run time, restart a minute after a failure, ignore duplicate starts. Task
Scheduler cannot set per-task environment variables, so the daemon's configuration is written to
`daemon.env` and passed with `--env-file`; `PC_LOG_FILE` in that file is what makes a task-run
daemon observable. A task that exited cleanly sits idle until its next trigger, so the app kicks
it (`schtasks /Run`, a no-op while running) on every launch.

**Daemon.** `#![windows_subsystem = "windows"]` so neither the app nor the task opens a console
window. A GUI-subsystem process has no stdio, so `main` attaches to the parent console when
launched from a terminal, and honours `PC_LOG_FILE` by pointing the standard handles at the
file (`dup2` on unix, `SetStdHandle` on Windows) so the pairing printout and the tracing log
interleave in one place, as launchd's single log path does.

**Mount.** `net use <letter>: http://127.0.0.1:<port>/`. `S:` when free, otherwise the highest
free letter (network-drive convention, clear of removable media). The letter is confirmed to
point at *our* server before the mount is reported, and a leftover mapping of ours is cleared
while anyone else's is refused. `explorer.exe` opens the drive, as `open` does in Finder.

**Windows-only commands avoid a console flash.** `sys::command` sets `CREATE_NO_WINDOW` on
every helper the GUI spawns (`net`, `schtasks`, `tasklist`, `icacls`, `reg`).

## Windows WebDAV caveats

These are defaults of the Windows WebDAV client, not bugs in Sharedock:

- The **WebClient** service trigger-starts on the first DAV path access, so mapping needs no
  elevation and no manual service setup. Verified with the service stopped beforehand.
- `HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters\FileSizeLimitInBytes` ships at
  **50,000,000** bytes. Explorer refuses to copy a larger file onto the drive. The mount reports
  this as a notice with a "Raise limit (admin)" button, which sets the value to its maximum
  through a UAC prompt and restarts the service; the drive is then re-mapped. The redirector's
  hard ceiling is **4 GB** per file regardless; larger files go through the app.
- `BasicAuthLevel` defaults to SSL-only Basic auth. Irrelevant here (loopback, no auth), but
  worth knowing before debugging an auth failure.

## Building

```powershell
scripts\build-desktop-sidecars.ps1          # release pc-daemon → binaries\pc-daemon-<triple>.exe
pnpm --filter @app/desktop tauri build --bundles nsis
```

Prerequisites: Visual Studio Build Tools with the C++ workload, rustup (MSVC toolchain), Node
with pnpm, and for `ring`: **NASM on x86_64, LLVM/clang on ARM64** — that split is easy to get
wrong, and the ARM64 error ("failed to find tool clang") does not say why. The MSI target
(`--bundles msi`) is x86_64/i686 only: WiX 3 has no ARM64 support, so ARM64 gets NSIS.

Two things to expect from `tauri build`:

- **On ARM64 the npm Tauri CLI cannot download NSIS** ("no TLS backend is configured"). Seed
  its cache once and it never asks again: unzip
  `github.com/tauri-apps/binary-releases/releases/download/nsis-3/nsis-3.zip` to
  `%LOCALAPPDATA%\tauri\` and rename `nsis-3.08` to `NSIS`, then put
  `github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.4.1/nsis_tauri_utils.dll`
  under `NSIS\Plugins\x86-unicode\`. The bundler checks the dll's SHA-1
  (`F99A50209A345185A84D34D0E5F66D04C75FF52F`), so it must be that exact release. x86_64 runners
  are unaffected.
- **The build exits 1 after the installer is written** until `TAURI_SIGNING_PRIVATE_KEY` is
  set: `createUpdaterArtifacts` wants to sign the update bundle, and that key is the owner's
  (`tauri signer generate`, see the release notes). The installer under
  `target\release\bundle\nsis\` is complete regardless; the same happens on macOS.

The installer is per-user (`installMode: currentUser`), consistent with the mount and the
service needing no elevation. WebView2 is installed by bootstrapper on the rare machine without
it.

`pnpm install` on ARM64 fails in `workerd`'s postinstall (no win32-arm64 binary); it is only the
local control plane, so use `pnpm install --filter "@app/web..." --filter "@app/desktop..."`.

## Still open

- **Code signing.** No certificate yet. An unsigned NSIS installer trips SmartScreen until the
  download builds reputation; an OV or EV certificate is the owner's to buy. Configure it under
  `bundle.windows.certificateThumbprint` in `tauri.conf.json`.
- **Hands-on GUI pass.** The mount and service backends are exercised by tests that run the
  real code path, and the crate builds and bundles, but nobody has yet clicked through the
  installed app on Windows. That pass belongs on real hardware (x86_64 — the VM is ARM64).
- **S4U fallback path.** Registration was verified S4U-first on an administrator account. The
  interactive-logon fallback was verified to register, not yet observed being chosen by
  `install()` for a standard-user account.
- **Updater.** The Tauri updater plugin is wired for all platforms but keyless until the signing
  key exists (see the release notes); Windows gets the same `.nsis.zip` update artifact once
  `createUpdaterArtifacts` has a key to sign with.

## Test VM

UTM on Apple Silicon, **virtualized Windows 11 ARM64** — not emulated x86_64, which would make
each Rust build take hours. Bridged networking rather than NAT, so the Iroh direct path is
exercised for real instead of silently falling back to the relay. OpenSSH Server with
key-only auth is how it is driven; the whole port above was done over that.

Note the architecture split: the VM is ARM64 for speed, but the shipping target is x86_64.
Windows 11 ARM64 runs x64 binaries under emulation, so a cross-built release can be smoke
tested there, and the CI job covers x86_64 compilation properly.
