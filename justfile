# Sharedock — cross-language task runner.
# `just` is optional; the same actions exist as pnpm scripts (see package.json).
set shell := ["bash", "-cu"]

# List recipes
default:
    @just --list

# Install JS deps
install:
    pnpm install

# Web SPA dev server (also what the Tauri app loads)
dev:
    pnpm --filter @app/web dev

# Build the web SPA (static assets for both browser + Tauri)
build-web:
    pnpm --filter @app/web build

# Compile the Rust workspace (core crates + headless daemon)
build-rust:
    cargo build --workspace

# Run Rust tests
test-rust:
    cargo test --workspace

# Control-plane (Cloudflare Worker + Durable Objects) local dev
cp-dev:
    pnpm --filter @app/control-plane dev

# Full P0 smoke: JS install + web build + rust build
smoke:
    pnpm install
    pnpm --filter @app/web build
    cargo build --workspace
