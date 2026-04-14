# Upgradeable Contracts — Reference

## Storage Layout Rules

Proxy upgrades use **delegatecall**: the implementation runs in the proxy’s storage context. The implementation assumes a fixed layout of state variables. Breaking that layout corrupts state.

### Safe

- **Append** new state variables at the end of the contract (and of each inherited contract’s declared storage).
- **Add** new parent contracts if they append their storage after your existing storage (follow OZ upgradeable inheritance order).
- Keep **packing** and **types** of existing variables unchanged.

### Unsafe

- **Reorder** state variables.
- **Remove** state variables.
- **Change** type or size of existing state variables (e.g. `uint256` → `uint128`, adding/removing packing).
- **Insert** new state variables in the middle of existing ones.

### Base contract storage

Inherited contracts contribute their own state in inheritance order. When adding or changing parents, ensure their storage is appended after your contract’s storage (or that you follow the same layout as the previous implementation). OpenZeppelin upgradeable bases are designed to be composed in a known order; follow the same order when adding new bases.

### Gap (reserved storage)

Some OZ upgradeable contracts define a `__gap` array (e.g. `uint256[50] __gap`) to reserve slots for future variables without breaking layout. Do not remove or shrink `__gap` in upgrades.

## Initializer vs Constructor

| | Constructor | Initializer |
|--|-------------|-------------|
| Runs | Once, on implementation deploy | Once, when proxy is first used (or when you call it from deploy script) |
| Purpose | Disable initializers on implementation (`_disableInitializers()`) | Set initial state (owner, treasury, etc.) |
| Writes to | Implementation’s storage (irrelevant for proxy) | Proxy’s storage (via delegatecall) |

Always have a constructor that only calls `_disableInitializers()` so the implementation cannot be initialized directly. Put all real setup in `initialize(...)` and call it once after deploying the proxy.

## UUPS vs Transparent (Quick Reference)

| | UUPS | Transparent |
|--|------|-------------|
| Upgrade function on | Implementation | Proxy (ProxyAdmin) |
| Gas | Lower (no ProxyAdmin call routing) | Higher |
| Upgrade auth | `_authorizeUpgrade` in implementation | ProxyAdmin owner |
| Selector clash | Possible (admin must not call implementation) | Avoided (admin never forwarded to impl) |

## One Level Deep

This file is the single reference linked from SKILL.md. Do not add further nested reference files.
