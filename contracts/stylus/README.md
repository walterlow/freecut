# Style Registry (Arbitrum Stylus)

Registers AI pipeline styles (prompt hash, LoRA CID hash, config hash) and maps them to the creator address for Story Protocol IP and MeToken royalty gating.

## Build

Requires Rust 1.81+ with `wasm32-unknown-unknown` and `cargo stylus`:

```bash
rustup target add wasm32-unknown-unknown
cargo install cargo-stylus
cd contracts/stylus
cargo stylus check
```

## Deploy

Run from **this directory** (`contracts/stylus/`), so `Stylus.toml` is found:

```bash
cd contracts/stylus
cargo stylus deploy --endpoint <ARBITRUM_RPC> --private-key <KEY>
```

## Cache (optional)

Cached contracts have cheaper calls. The tool defaults to `http://localhost:8547`; use `--endpoint` to point at your Arbitrum RPC:

```bash
cargo stylus cache bid <CONTRACT_ADDRESS> 0 --endpoint <ARBITRUM_RPC> --private-key <KEY>
```

## API

- `register_style(prompt_hash: bytes32, lora_cid_hash: bytes32, config_json_hash: bytes32)` → style_id (bytes32). Caller becomes owner.
- `get_style_owner(style_id: bytes32)` → address.

Client should compute `lora_cid_hash = keccak256(lora_cid_bytes)` and `config_json_hash = keccak256(config_json_bytes)` off-chain.
