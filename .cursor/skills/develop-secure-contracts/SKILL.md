---
name: develop-secure-contracts
description: "Develop secure smart contracts using OpenZeppelin Contracts libraries. Use when users need to integrate OpenZeppelin library components — including token standards (ERC20, ERC721, ERC1155), access control (Ownable, AccessControl, AccessManager), security primitives (Pausable, ReentrancyGuard), governance (Governor, timelocks), or accounts (multisig, account abstraction) — into existing or new contracts. Covers pattern discovery from library source, MCP generators, and library-first integration. Supports Solidity, Cairo, Stylus, and Stellar."
license: AGPL-3.0-only
metadata:
  author: OpenZeppelin
---

# Develop Secure Smart Contracts with OpenZeppelin

## Core Workflow

### Understand the Request Before Responding

For conceptual questions ("How does Ownable work?"), explain without generating code. For implementation requests, proceed with the workflow below.

### CRITICAL: Always Read the Project First

Before generating code or suggesting changes:

1. **Search the user's project** for existing contracts (`Glob` for `**/*.sol`, `**/*.cairo`, `**/*.rs`, etc.)
2. **Read the relevant contract files** to understand what already exists
3. **Default to integration, not replacement** — when users say "add pausability" or "make it upgradeable", they mean modify their existing code, not generate something new. Only replace if explicitly requested ("start fresh", "replace this").

If a file cannot be read, surface the failure explicitly — report the path attempted and the reason. Ask whether the path is correct. Never silently fall back to a generic response as if the file does not exist.

### Fundamental Rule: Prefer Library Components Over Custom Code

Before writing ANY logic, search the OpenZeppelin library for an existing component:

1. **Exact match exists?** Import and use it directly — inherit, implement its trait, compose with it. Done.
2. **Close match exists?** Import and extend it — override only functions the library marks as overridable (virtual, hooks, configurable parameters).
3. **No match exists?** Only then write custom logic. Confirm by browsing the library's directory structure first.

**NEVER copy or embed library source code into the user's contract.** Always import from the dependency so the project receives security updates. Never hand-write what the library already provides:
- Never write a custom `paused` modifier when `Pausable` or `ERC20Pausable` exists
- Never write `require(msg.sender == owner)` when `Ownable` exists
- Never implement ERC165 logic when the library's base contracts already handle it

### Methodology

The primary workflow is **pattern discovery from library source code**:

1. Inspect what the user's project already imports
2. Read the dependency source and docs in the project's installed packages
3. Identify what functions, modifiers, hooks, and storage the dependency requires
4. Apply those requirements to the user's contract

See [Pattern Discovery and Integration](#pattern-discovery-and-integration) below for the full step-by-step procedure.

### MCP Generators as an Optional Shortcut

If MCP generator tools are available at runtime, use them to accelerate pattern discovery:
generate a baseline, generate with a feature enabled, compare the diff, and apply the changes to the user's code. This replaces the manual source-reading step but follows the same principle — discover patterns, then integrate them.

See [MCP Generators (Optional)](#mcp-generators-optional) for details on checking availability and using the generate-compare-apply shortcut.

If no MCP tool exists for what's needed, use the generic pattern discovery methodology from [Pattern Discovery and Integration](#pattern-discovery-and-integration). The absence of an MCP tool does not mean the library lacks support — it only means there is no generator.

## Pattern Discovery and Integration

Procedural guide for discovering and applying OpenZeppelin contract integration patterns
by reading dependency source code. Works for any ecosystem and any library version.

**Prerequisite:** Always follow the library-first decision tree above
(prefer library components over custom code, never copy/embed source).

### Step 1: Identify Dependencies and Search the Library

1. Search the project for contract files: `Glob` for `**/*.sol`, `**/*.cairo`, `**/*.rs`,
   or the relevant extension from the lookup table below.
2. Read import/use statements in existing contracts to identify which OpenZeppelin components
   are already in use.
3. Locate the installed dependency in the project's dependency tree:
   - Solidity: `node_modules/@openzeppelin/contracts/` (Hardhat/npm) or
     `lib/openzeppelin-contracts/` (Foundry/forge)
   - Cairo: resolve from `Scarb.toml` dependencies — source cached by Scarb
   - Stylus: resolve from `Cargo.toml` — source in `target/` or the cargo registry cache
     (`~/.cargo/registry/src/`)
   - Stellar: resolve from `Cargo.toml` — same cargo cache locations as Stylus
4. Browse the dependency's directory listing to discover available components. Use `Glob`
   patterns against the installed source (e.g., `node_modules/@openzeppelin/contracts/**/*.sol`).
   Do not assume knowledge of the library's contents — always verify by listing directories.
5. If the dependency is not installed locally, clone or browse the canonical repository
   (see lookup table below).

### Step 2: Read the Dependency Source and Documentation

1. Read the source file of the component relevant to the user's request.
2. Look for documentation within the source: NatSpec comments (`///`, `/** */`) in Solidity,
   doc comments (`///`) in Rust and Cairo, and README files in the component's directory.
3. Determine the integration strategy using the decision tree from the Critical Principle:
   - If the component satisfies the need directly → import and use as-is.
   - If customization is needed → identify extension points the library provides (virtual
     functions, hook functions, configurable constructor parameters). Import and extend.
   - Only if no component covers the need → write custom logic.
4. Identify the **public API**: functions/methods exposed, events emitted, errors defined.
5. Identify **integration requirements** — this is the critical step:
   - Functions the integrator MUST implement (abstract functions, trait methods, hooks)
   - Modifiers, decorators, or guards that must be applied to the integrator's functions
   - Constructor or initializer parameters that must be passed
   - Storage variables or state that must be declared
   - Inheritance or trait implementations required (always via import, never via copy)
6. Search for example contracts or tests in the same repository that demonstrate correct
   usage. Look in `test/`, `tests/`, `examples/`, or `mocks/` directories.

### Step 3: Extract the Minimal Integration Pattern

From Step 2, construct the minimal set of changes needed:

- **Imports / use statements** to add
- **Inheritance / trait implementations** to add (always via import from the dependency)
- **Storage** to declare
- **Constructor / initializer** changes (new parameters, initialization calls)
- **New functions** to add (required overrides, hooks, public API)
- **Existing functions to modify** (add modifiers, call hooks, emit events)

If the contract is upgradeable, any of the above may affect storage compatibility. Consult the relevant upgrade skill before applying.

Do not include anything beyond what the dependency requires. This is the minimal diff
between "contract without the feature" and "contract with the feature."

### Step 4: Apply Patterns to the User's Contract

1. Read the user's existing contract file.
2. Apply the changes from Step 3 using the `Edit` tool. Do not replace the entire file —
   integrate into existing code.
3. Check for conflicts: duplicate access control systems, conflicting function overrides,
   incompatible inheritance. Resolve before finishing.
4. Do not ask the user to make changes themselves — apply directly.

### Repository and Documentation Lookup Table

| Ecosystem | Repository | Documentation | File Extension | Dependency Location |
|-----------|-----------|---------------|----------------|-------------------|
| Solidity | [openzeppelin-contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) | [docs.openzeppelin.com/contracts](https://docs.openzeppelin.com/contracts) | `.sol` | `node_modules/@openzeppelin/contracts/` or `lib/openzeppelin-contracts/` |
| Cairo | [cairo-contracts](https://github.com/OpenZeppelin/cairo-contracts) | [docs.openzeppelin.com/contracts-cairo](https://docs.openzeppelin.com/contracts-cairo) | `.cairo` | Scarb cache (resolve from `Scarb.toml`) |
| Stylus | [rust-contracts-stylus](https://github.com/OpenZeppelin/rust-contracts-stylus) | [docs.openzeppelin.com/contracts-stylus](https://docs.openzeppelin.com/contracts-stylus) | `.rs` | Cargo cache (`~/.cargo/registry/src/`) |
| Stellar | [stellar-contracts](https://github.com/OpenZeppelin/stellar-contracts) ([Architecture](https://github.com/OpenZeppelin/stellar-contracts/blob/main/Architecture.md)) | [docs.openzeppelin.com/stellar-contracts](https://docs.openzeppelin.com/stellar-contracts) | `.rs` | Cargo cache (`~/.cargo/registry/src/`) |

### Directory Structure Conventions

Where to find components within each repository:

| Category | Solidity | Cairo | Stylus | Stellar |
|----------|---------|-------|--------|---------|
| Tokens | `contracts/token/{ERC20,ERC721,ERC1155}/` | `packages/token/` | `contracts/src/token/` | `packages/tokens/` |
| Access control | `contracts/access/` | `packages/access/` | `contracts/src/access/` | `packages/access/` |
| Governance | `contracts/governance/` | `packages/governance/` | — | `packages/governance/` |
| Proxies / Upgrades | `contracts/proxy/` | `packages/upgrades/` | `contracts/src/proxy/` | `packages/contract-utils/` |
| Utilities / Security | `contracts/utils/` | `packages/utils/`, `packages/security/` | `contracts/src/utils/` | `packages/contract-utils/` |
| Accounts | `contracts/account/` | `packages/account/` | — | `packages/accounts/` |

Browse these paths first when searching for a component.

### Known Version-Specific Considerations

Do not assume override points from prior knowledge — always verify by reading the installed source. Functions that were `virtual` in an older version may no longer be in the current one, making them non-overridable. The source NatSpec will indicate the correct override point (e.g., `NOTE: This function is not virtual, {X} should be overridden instead`).

A known example: the Solidity ERC-20 transfer hook changed between v4 and v5. Read the installed `ERC20.sol` to confirm which function is `virtual` before recommending an override.

## MCP Generators (Optional)

MCP generators are template/scaffolding tools that produce OpenZeppelin contract boilerplate. They are **not required** — they accelerate pattern discovery when available.

### Checking Availability

Discover MCP tools dynamically at runtime. Look for tools with names matching patterns like `solidity-erc20`, `cairo-erc721`, `stellar-fungible`, etc. Server names follow patterns like `OpenZeppelinSolidityContracts`, `OpenZeppelinCairoContracts`, or `OpenZeppelinContracts`.

MCP tool schemas are self-describing. To learn what a generator supports, inspect its parameter list — each boolean parameter (e.g., `pausable`, `mintable`, `upgradeable`) corresponds to a feature toggle. Do not rely on prior knowledge of what parameters exist; read the schema each time, since tools are updated independently of this skill.

### Generate-Compare-Apply Shortcut

When an MCP generator exists for the contract type:

1. **Generate baseline** — call with only required parameters, all features disabled
2. **Generate with feature** — call again with one feature enabled
3. **Compare** — diff baseline vs. variant to identify exactly what changed (imports, inheritance, state, constructor, functions, modifiers)
4. **Apply** — edit the user's existing contract to add the discovered changes

For interacting features (e.g., access control + upgradeability), generate a combined variant as well.

### When No MCP Tool Exists or a Feature Is Not Covered

The absence of an MCP tool does NOT mean the library lacks support. It only means there is no generator for that contract type. Always fall back to the generic pattern discovery methodology in [Pattern Discovery and Integration](#pattern-discovery-and-integration).

Similarly, when an MCP tool exists but does not expose a parameter for a specific feature, do not stop there. Fall back to pattern discovery for that feature: read the installed library source to find the relevant component, extract the integration requirements, and apply them to the user's contract.