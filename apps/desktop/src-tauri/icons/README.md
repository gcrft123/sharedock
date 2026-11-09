# App icons

These are not committed yet. Generate the full icon set (referenced by
`tauri.conf.json`) from a single 1024×1024 PNG once branding exists:

```sh
cargo tauri icon path/to/personal-cloud-1024.png
```

Until then, `cargo tauri build` will fail on the missing icons (by design —
`cargo build --workspace` skips this crate, so the rest of the repo is unaffected).
