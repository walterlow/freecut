# Secure Contracts — Reference

## Vulnerability Quick Reference

| Category | Risk | Mitigation |
|----------|------|------------|
| Reentrancy | Callback re-enters before state update | CEI; optional `nonReentrant` |
| Access control | Unauthorized state change | Modifier/role check on every state-changing function |
| Integer overflow/underflow | Wrong math, unexpected state | Solidity ^0.8+ or checked math in Rust |
| Front-running | Order-dependent logic exploited | Commit–reveal, deadlines, or accept MEV |
| Oracle / price | Stale or manipulated data | Use decentralized oracle; sanity checks |
| Signature replay | Reuse of signatures across chains/forks | Nonce or block.chainid in signed message |
| Delegatecall / proxy | Wrong context, storage collision | Document storage layout; use established proxy pattern |
| Token assumptions | Non-standard return values | SafeERC20 or explicit checks |

## CEI Pattern Example (Solidity)

```solidity
// BAD: external call before state update
function withdraw(uint256 amount) external {
    (bool ok,) = msg.sender.call{value: amount}("");
    require(ok);
    balance[msg.sender] -= amount;
}

// GOOD: effects then interaction
function withdraw(uint256 amount) external {
    uint256 b = balance[msg.sender];
    require(amount <= b, "insufficient");
    balance[msg.sender] = b - amount;
    (bool ok,) = msg.sender.call{value: amount}("");
    require(ok);
}
```

## Custom Errors (Solidity)

```solidity
error OnlyOwner();
error TransferFailed();
error InsufficientBalance();

modifier onlyOwner() {
    if (msg.sender != owner) revert OnlyOwner();
    _;
}
```

## Stylus: Checked Math (Rust)

Prefer checked or saturating ops; avoid plain `+`/`-` on untrusted inputs:

```rust
let new_balance = balance.checked_add(amount).ok_or(Error::Overflow)?;
// or
let new_balance = balance.saturating_add(amount);
```

## One Level Deep

This file is the single reference linked from SKILL.md. Do not add further nested reference files.
