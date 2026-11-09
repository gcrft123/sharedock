fn main() {
    // `host_mode::fallback_launch_config` bakes this in via `option_env!` so a pre-existing host
    // auto-restarts against the right control plane. Cargo doesn't track `option_env!` for
    // rebuilds on its own, so tell it to rebuild when the value changes (matches the UI's
    // VITE_CONTROL_URL, set by the desktop build command).
    println!("cargo:rerun-if-env-changed=VITE_CONTROL_URL");
    tauri_build::build()
}
