# Solidity Setup Reference

Detailed config options for Hardhat and Foundry. Use when the agent needs to tweak compiler, networks, or paths beyond the quick setup in SKILL.md.

## Hardhat

### hardhat.config.js / .ts

```javascript
require("@nomicfoundation/hardhat-toolbox"); // or import for TS

module.exports = {
  solidity: {
    version: "0.8.23",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
  },
  networks: {
    hardhat: {},
    arbitrumOne: {
      url: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: { arbitrumOne: process.env.ARBISCAN_API_KEY || "" },
  },
};
```

- Use `process.env` for RPC URL, private key, and Etherscan API key. Add `.env` to `.gitignore`.
- Optional: `@nomicfoundation/hardhat-verify` for contract verification after deploy.

### Scripts

- Deploy: `scripts/deploy.js` or `deploy.ts` that gets signer via `ethers.getSigners()`, connects to a network, and deploys. Run with `npx hardhat run scripts/deploy.js --network arbitrumOne`.

## Foundry

### foundry.toml

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.23"
optimizer = true
optimizer_runs = 200

remappings = [
  "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/"
]
```

- Add more remappings for other libs (e.g. `forge install uniswap/v3-core` then map `@uniswap/...`).

### Networks (cast / forge script)

- Use env for RPC and key: `--rpc-url $ARBITRUM_RPC_URL` and `--private-key $PRIVATE_KEY`.
- Testnet deploy example: `forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --private-key $PRIVATE_KEY`.

### Running tests

- `forge test` runs everything in `test/`. Use `forge test -vvv` for traces. Add `-m TestContractName` to run a single contract.

## Multi-chain / existing app

- If the app already has a `contracts/` folder with raw `.sol` files (e.g. `contracts/arbitrum/PaymentContract.sol`), add `hardhat.config.*` or `foundry.toml` in the same root as those contracts and set `sources`/`src` to include that path (e.g. `contracts` or `./arbitrum` as needed). This keeps one toolchain and one compile command for the repo.
