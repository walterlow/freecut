---
name: upgrade-stylus-contracts
description: "Upgrade Stylus smart contracts using OpenZeppelin proxy patterns on Arbitrum. Use when users need to: (1) make Stylus Rust contracts upgradeable with UUPS or Beacon proxies, (2) understand Stylus-specific proxy mechanics (logic_flag, WASM reactivation), (3) integrate UUPSUpgradeable with access control, (4) ensure storage compatibility across upgrades, or (5) test upgrade paths for Stylus contracts."
license: AGPL-3.0-only
metadata:
  author: OpenZeppelin
---

# Stylus Upgrades

## Contents

- [Stylus Upgrade Model](#stylus-upgrade-model)
- [Proxy Patterns](#proxy-patterns)
- [Access Control](#access-control)
- [Upgrade Safety](#upgrade-safety)

## Stylus Upgrade Model

Stylus contracts run on Arbitrum as WebAssembly (WASM) programs alongside the EVM. They share the same state trie, storage model, and account system as Solidity contracts. Because of this, **EVM proxy patterns work identically** for Stylus — a Solidity proxy can delegate to a Stylus implementation and vice versa.

| | Stylus | Solidity |
|---|---|---|
| **Proxy mechanism** | Same — `delegatecall` to implementation contract | `delegatecall` to implementation contract |
| **Storage layout** | `#[storage]` fields map to the same EVM slots as equivalent Solidity structs | Sequential slot allocation per Solidity rules |
| **EIP standards** | ERC-1967 storage slots, ERC-1822 proxiable UUID | Same |
| **Context detection** | `logic_flag` boolean in a unique storage slot (no `immutable` support) | `address(this)` stored as `immutable` |
| **Initialization** | Two-step: constructor sets `logic_flag`, then `set_version()` via proxy | Constructor + initializer via proxy |
| **Reactivation** | WASM contracts must be reactivated every 365 days or after a Stylus protocol upgrade | Not applicable |

Existing Solidity contracts can upgrade to a Stylus (Rust) implementation via proxy patterns. The `#[storage]` macro lays out fields in the EVM state trie identically to Solidity, so storage slots line up when type definitions match.

## Proxy Patterns

OpenZeppelin Contracts for Stylus provides three proxy patterns:

| Pattern | Key types | Best for |
|---------|----------|----------|
| **UUPS** | `UUPSUpgradeable`, `IErc1822Proxiable`, `Erc1967Proxy` | Most projects — upgrade logic in the implementation, lighter proxy |
| **Beacon** | `BeaconProxy`, `UpgradeableBeacon` | Multiple proxies sharing one implementation — updating the beacon upgrades all proxies atomically |
| **Basic Proxy** | `Erc1967Proxy`, `Erc1967Utils` | Low-level building block for custom proxy patterns |

### UUPS

The implementation contract composes `UUPSUpgradeable` in its `#[storage]` struct alongside access control (e.g., `Ownable`). Integration requires:

1. Add `UUPSUpgradeable` (and access control) as fields in the `#[storage]` struct
2. Call `self.uups.constructor()` and initialize access control in the constructor
3. Expose `initialize` calling `self.uups.set_version()` — invoked via proxy after deployment
4. Implement `IUUPSUpgradeable` — `upgrade_to_and_call` guarded by access control, `upgrade_interface_version` delegating to `self.uups`
5. Implement `IErc1822Proxiable` — `proxiable_uuid` delegating to `self.uups`

The proxy contract is a thin `Erc1967Proxy` with a constructor that takes the implementation address and initialization data, and a `#[fallback]` handler that delegates all calls.

Deploy the proxy with `set_version` as the initialization call data. Use `cargo stylus deploy` or a deployer contract. The initialization data is the ABI-encoded `setVersion` call:

```rust
let data = MyContractAbi::setVersionCall {}.abi_encode();
// Pass `data` as the proxy constructor's second argument at deployment time.
```

### Beacon

Multiple `BeaconProxy` contracts point to a single `UpgradeableBeacon` that stores the current implementation address. Updating the beacon upgrades all proxies in one transaction.

### Context detection (Stylus-specific)

Stylus does not support the `immutable` keyword. Instead of storing `__self = address(this)`, `UUPSUpgradeable` uses a `logic_flag` boolean in a unique storage slot:

- The implementation's **constructor** sets `logic_flag = true` in its own storage.
- When code runs via a proxy (`delegatecall`), the proxy's storage does not contain this flag, so it reads as `false`.
- `only_proxy()` checks this flag to ensure upgrade functions can only be called through the proxy, not directly on the implementation.

`only_proxy()` also verifies that the ERC-1967 implementation slot is non-zero and that the proxy-stored version matches the implementation's `VERSION_NUMBER`.

> **Examples:** See the `examples/` directory of the [rust-contracts-stylus repository](https://github.com/OpenZeppelin/rust-contracts-stylus) for full working integration examples of UUPS, Beacon, and related patterns.

## Access Control

Upgrade functions must be guarded with access control. OpenZeppelin's Stylus contracts do **not** embed access control into the upgrade logic itself — you must add it in `upgrade_to_and_call`:

```rust
fn upgrade_to_and_call(&mut self, new_implementation: Address, data: Bytes) -> Result<(), Vec<u8>> {
    self.ownable.only_owner()?; // or any access control check
    self.uups.upgrade_to_and_call(new_implementation, data)?;
    Ok(())
}
```

Common options:
- **Ownable** — single owner, simplest pattern
- **AccessControl / RBAC** — role-based, finer granularity
- **Multisig or governance** — for production contracts managing significant value

## Upgrade Safety

### Storage compatibility

Stylus `#[storage]` fields are laid out in the EVM state trie identically to Solidity. The same storage layout rules apply when upgrading:

- **Never** reorder, remove, or change the type of existing storage fields
- **Never** insert new fields before existing ones
- **Only** append new fields at the end of the struct
- ERC-1967 proxy storage slots are in high, standardized locations — they will not collide with implementation storage

One difference from Solidity: nested structs in Stylus `#[storage]` (e.g., composing `Erc20`, `Ownable`, `UUPSUpgradeable` as fields) are laid out with each nested struct starting at its own deterministic slot. This is consistent with regular struct nesting in Solidity, but not with Solidity's inheritance-based flat layout where all inherited variables share a single sequential slot range.

### Initialization safety

- The implementation **constructor** sets `logic_flag` and any implementation-only state. It runs once at implementation deployment.
- `set_version()` must be called via the proxy (during deployment or via `upgrade_to_and_call`) to write the `VERSION_NUMBER` into the proxy's storage.
- If additional initialization is needed (ownership, token supply), expose a protected initialization function and include `set_version()` in it.
- Failing to initialize properly can result in orphaned contracts with no owner, uninitialized state, or denied future upgrades.

### UUPS upgrade checks

The UUPS implementation enforces three safety checks:

1. **Access control** — restrict `upgrade_to_and_call` (e.g., `self.ownable.only_owner()`)
2. **Proxy context enforcement** — `only_proxy()` reverts if the call is not via `delegatecall`
3. **Proxiable UUID validation** — `proxiable_uuid()` must return the ERC-1967 implementation slot, confirming UUPS compatibility

### Reactivation

Stylus WASM contracts must be **reactivated once per year** (365 days) or after any Stylus protocol upgrade. Reactivation can be done using `cargo-stylus` or the `ArbWasm` precompile. If a contract is not reactivated, it becomes uncallable. This is orthogonal to proxy upgrades but must be factored into maintenance planning.

### Testing upgrade paths

Before upgrading a production contract:

- [ ] **Deploy V1 implementation and proxy** on a local Arbitrum devnet
- [ ] **Write state with V1**, upgrade to V2 via `upgrade_to_and_call`, and verify that all existing state reads correctly
- [ ] **Verify new functionality** works as expected after the upgrade
- [ ] **Confirm access control** — only authorized callers can invoke `upgrade_to_and_call`
- [ ] **Check storage layout** — ensure no reordering, removal, or type changes to existing fields
- [ ] **Verify `VERSION_NUMBER`** is incremented in the new implementation
- [ ] **Test reactivation** — ensure the upgraded contract can be reactivated
- [ ] **Manual review** — there is no automated storage layout validation for Stylus Rust contracts; rely on struct comparison and devnet testing