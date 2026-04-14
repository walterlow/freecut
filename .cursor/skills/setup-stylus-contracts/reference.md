# Stylus Setup — Reference

## Official docs

- [Stylus quickstart](https://docs.arbitrum.io/stylus/quickstart) — write your first Stylus contract
- [Using Stylus CLI](https://docs.arbitrum.io/stylus/using-cli) — cargo-stylus install and commands
- [cargo-stylus repo](https://github.com/OffchainLabs/cargo-stylus) — source and issues

## cargo-stylus commands (summary)

| Command | Purpose |
|--------|---------|
| `cargo stylus new <name>` | Create new project; use `--minimal` for minimal scaffold |
| `cargo stylus init` | Init Stylus in current directory |
| `cargo stylus export-abi` | Export Solidity ABI; use `--json` for JSON output |
| `cargo stylus check` | Check contract (optional `--wasm-file`, `--contract-address`) |
| `cargo stylus deploy` | Deploy (needs `--endpoint`, auth e.g. `--private-key`) |
| `cargo stylus activate` | Activate deployed contract (`--address`) |
| `cargo stylus verify` | Verify deployment (`--deployment-tx`) |

Common options: `--endpoint` (RPC), `--private-key` / `--private-key-path` / `--keystore-path`, `--estimate-gas`, `--max-fee-per-gas-gwei`.

## Rust version

Docs recommend Rust 1.80 or newer. Pin in `rust-toolchain.toml` and add target:

```bash
rustup target add wasm32-unknown-unknown --toolchain 1.80
```
