import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local so ARBITRUM_RPC_URL and DEPLOYER_PRIVATE_KEY are available
try {
  const envLocal = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of envLocal.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const value = t.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
} catch {
  // .env.local optional
}

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  paths: {
    sources: "./contracts/arbitrum",
  },
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
    },
    arbitrumOne: {
      type: "http",
      chainType: "l1",
      chainId: 42161,
      url: configVariable("ARBITRUM_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
  },
  chainDescriptors: {
    42161: {
      name: "Arbitrum One",
      blockExplorers: {
        etherscan: {
          name: "Arbiscan",
          url: "https://arbiscan.io",
          // Etherscan API V2 (V1 deprecated Aug 2025); use chainid=42161 for Arbitrum One
          apiUrl: "https://api.etherscan.io/v2/api",
        },
      },
    },
  },
  verify: {
    etherscan: {
      // V2 uses ETHERSCAN_API_KEY (get from https://etherscan.io/apidashboard); or set ARBISCAN_API_KEY if you only have that
      apiKey:
        process.env.ETHERSCAN_API_KEY ?? process.env.ARBISCAN_API_KEY ?? "",
    },
  },
});
