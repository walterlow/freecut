---
name: setup-stylus-contracts
description: "Set up a Stylus smart contract project with OpenZeppelin Contracts for Stylus on Arbitrum. Use when users need to: (1) install Rust toolchain and WASM target for Stylus, (2) create a new Cargo Stylus project, (3) add OpenZeppelin Stylus dependencies to Cargo.toml, or (4) understand Stylus import conventions and storage patterns for OpenZeppelin."
license: AGPL-3.0-only
metadata:
  author: OpenZeppelin
---

# Stylus Setup

## Rust & Cargo Stylus Setup

Install the Rust toolchain and WASM target:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown
```

Install the Cargo Stylus CLI:

```bash
cargo install --force cargo-stylus
```

Create a new Stylus project:

```bash
cargo stylus new my_project
```

> A Rust nightly toolchain is required. The project should include a `rust-toolchain.toml` specifying the nightly channel, `rust-src` component, and `wasm32-unknown-unknown` target. Check the [rust-contracts-stylus repo](https://github.com/OpenZeppelin/rust-contracts-stylus) for the current recommended nightly date.

## Adding OpenZeppelin Dependencies

Look up the current version from [crates.io/crates/openzeppelin-stylus](https://crates.io/crates/openzeppelin-stylus) before adding. Add to `Cargo.toml`:

```toml
[dependencies]
openzeppelin-stylus = "=<VERSION>"
```

Enable the `export-abi` feature flag for ABI generation:

```toml
[features]
export-abi = ["openzeppelin-stylus/export-abi"]
```

The crate must be compiled as both a library and a cdylib:

```toml
[lib]
crate-type = ["lib", "cdylib"]
```

## Import Conventions

Imports use `openzeppelin_stylus` (underscores) as the crate root:

```rust
use openzeppelin_stylus::token::erc20::{Erc20, IErc20};
use openzeppelin_stylus::access::ownable::{Ownable, IOwnable};
use openzeppelin_stylus::utils::pausable::{Pausable, IPausable};
use openzeppelin_stylus::utils::introspection::erc165::IErc165;
```

Contracts use `#[storage]` and `#[entrypoint]` on the main struct, embedding OpenZeppelin components as fields:

```rust
#[entrypoint]
#[storage]
struct MyToken {
    erc20: Erc20,
    ownable: Ownable,
}
```

Public methods are exposed with `#[public]` and `#[implements(...)]`. The canonical pattern uses an empty impl block for dispatch registration, plus separate trait impl blocks:

```rust
#[public]
#[implements(IErc20<Error = erc20::Error>, IOwnable<Error = ownable::Error>)]
impl MyToken {}

#[public]
impl IErc20 for MyToken {
    type Error = erc20::Error;
    // delegate to self.erc20 ...
}
```

Top-level modules: `access`, `finance`, `proxy`, `token`, `utils`.

## Build & Deploy Basics

Validate the contract compiles to valid Stylus WASM:

```bash
cargo stylus check
```

Export the Solidity ABI:

```bash
cargo stylus export-abi
```

Deploy to an Arbitrum Stylus endpoint:

```bash
cargo stylus deploy --endpoint="<RPC_URL>" --private-key-path="<KEY_FILE>"
```