# Build the `pc-daemon` SIDECAR for the Windows desktop app. The PowerShell twin of
# build-desktop-sidecars.sh: Tauri expects
# `apps/desktop/src-tauri/binaries/pc-daemon-<target-triple>.exe`, and refuses to build the
# app until it exists.
#
# Run this BEFORE `pnpm -C apps/desktop tauri build` (or `cargo tauri build`).
#
# Prereqs: rustup with the MSVC toolchain, Visual Studio Build Tools (C++), and for the
# target's `ring` build NASM (x86_64) or LLVM/clang (ARM64).
# Usage:   scripts\build-desktop-sidecars.ps1 [-Target x86_64-pc-windows-msvc]
param(
  # Default: this machine's own triple.
  [string]$Target = ((rustc -vV | Select-String "^host:").ToString().Split(" ")[1])
)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$out = "apps/desktop/src-tauri/binaries"
New-Item -ItemType Directory -Force $out | Out-Null
Write-Host "==> pc-daemon ($Target)"
cargo build --release --bin pc-daemon --target $Target
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Copy-Item "target/$Target/release/pc-daemon.exe" "$out/pc-daemon-$Target.exe" -Force

Write-Host "sidecars ready in $out/:"
Get-ChildItem $out | Format-Table Name, Length -AutoSize
