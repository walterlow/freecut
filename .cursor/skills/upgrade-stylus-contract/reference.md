# Stylus Upgrades — Reference

## OpenZeppelin Stylus docs

- [Proxy patterns](https://docs.openzeppelin.com/contracts-stylus/proxy) — IProxy, delegate_call, storage layout
- [UUPS Proxy](https://docs.openzeppelin.com/contracts-stylus/uups-proxy) — UUPSUpgradeable, set_version, logic_flag, upgrade_to_and_call
- [ERC-1967 Proxy](https://docs.openzeppelin.com/contracts-stylus/erc1967) — Erc1967Proxy, standard slots
- [Beacon Proxy](https://docs.openzeppelin.com/contracts-stylus/beacon-proxy) — multiple proxies, single beacon

## cargo-stylus (deploy / activate)

From the Stylus project directory (where `Stylus.toml` lives):

| Command | Purpose |
|--------|---------|
| `cargo stylus check` | Validate contract compiles to valid Stylus WASM |
| `cargo stylus deploy --endpoint=<RPC> --private-key=<HEX>` | Deploy; Docker often required for full deploy/verify |
| `cargo stylus activate --address=<ADDRESS>` | Activate deployed contract |
| `cargo stylus export-abi` | Export ABI for proxy init encoding |

Deploy the **implementation** first, then deploy the **proxy** with implementation address and init calldata (e.g. `set_version` + optional `initialize`).

## Related skills

- **setup-stylus-contracts** — project init, cargo-stylus, Stylus.toml, lib.rs/main.rs
- **setup-solidity-contracts** — OpenZeppelin Stylus deps (openzeppelin-stylus), `#[storage]` / `#[entrypoint]`
- **upgrade-solidity-contracts** — Solidity UUPS/Transparent/Beacon, Hardhat/Foundry plugins, storage layout validation
