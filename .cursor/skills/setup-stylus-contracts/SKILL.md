---
name: setup-stylus-contracts
description: "Set up an Arbitrum Stylus smart contract project in Rust (WASM). Use when users need to: (1) create a new Stylus project or init in an existing directory, (2) install and configure cargo-stylus and the wasm32 target, (3) understand Stylus.toml and the lib.rs/main.rs contract layout, or (4) work with Arbitrum Stylus Rust contracts."
---

# Stylus Contract Setup

Arbitrum Stylus compiles Rust to WASM for deployment on Arbitrum. Use **cargo-stylus** for project scaffolding, build, deploy, and ABI export.

## Prerequisites

- **Rust**: 1.80+ (see [rust-lang.org/tools/install](https://www.rust-lang.org/tools/install)).
- **WASM target**: Required for building Stylus contracts.
- **Optional**: Docker (for deploy/verify), Foundry Cast (EVM interaction), Nitro devnode (local testing).

## Install cargo-stylus

```bash
cargo install --force cargo-stylus
```

Add the WASM target for your toolchain (use the same version as `rustup default`):

```bash
rustup default 1.80
rustup target add wasm32-unknown-unknown --toolchain 1.80
```

Verify: `cargo stylus -V`.

## New project vs existing directory

**New project:**

```bash
cargo stylus new <project-name>
# Minimal scaffold (no example logic):
cargo stylus new <project-name> --minimal
```

**Existing directory:**

```bash
cd /path/to/existing-dir
cargo stylus init
cargo stylus init --minimal
```

## Project layout

After `new` or `init` you should have:

| Path | Purpose |
|------|--------|
| `Stylus.toml` | Workspace and contract config (networks, contract section) |
| `Cargo.toml` | Rust package; add `stylus-sdk` (or equivalent) as needed |
| `rust-toolchain.toml` | Pin Rust version and `wasm32-unknown-unknown` target |
| `src/lib.rs` | Contract logic (entrypoints, storage, helpers) |
| `src/main.rs` | WASM entrypoint and ABI export hook |

## Key files

**rust-toolchain.toml** — pin toolchain and target:

```toml
[toolchain]
channel = "1.80"
targets = ["wasm32-unknown-unknown"]
```

**Stylus.toml** — minimal workspace + contract:

```toml
[workspace]
[workspace.networks]
[contract]
```

**src/main.rs** — required pattern for Stylus entrypoint:

- `#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]`
- `#[cfg(not(any(test, feature = "export-abi")))]` + `pub extern "C" fn main() {}`
- For ABI: `#[cfg(feature = "export-abi")] fn main() { stylus::print_from_args(); }`

Contract logic lives in `src/lib.rs`; `main` is the WASM entrypoint only.

## Detecting an existing Stylus project

Look for **Stylus.toml** in the project root (or in a subdirectory such as `contracts/stylus/`). If present, treat as Stylus; use `cargo stylus` from that directory for `check`, `deploy`, `export-abi`, etc.

## Common next steps

- **Export ABI**: `cargo stylus export-abi --json`
- **Build / check**: `cargo build --release` (produces WASM); `cargo stylus check` to validate
- **Deploy**: `cargo stylus deploy --endpoint=<RPC> --private-key=<HEX>` (Docker required for full deploy/verify)

## Additional resources

- Command reference and docs links: [reference.md](reference.md)
