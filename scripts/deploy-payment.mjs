#!/usr/bin/env node
/**
 * Deploy PaymentContract to Arbitrum. Loads .env.local and runs forge create with --broadcast.
 * Requires: VITE_ALCHEMY_API_KEY, DEPLOYER_PRIVATE_KEY in .env.local
 */
import { readFileSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Load .env.local into process.env
try {
  const envPath = join(root, ".env.local");
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) process.env[key] = value;
  }
} catch (e) {
  console.error("Failed to load .env.local:", e.message);
  process.exit(1);
}

const { VITE_ALCHEMY_API_KEY, DEPLOYER_PRIVATE_KEY } = process.env;
if (!VITE_ALCHEMY_API_KEY || !DEPLOYER_PRIVATE_KEY) {
  console.error("Missing VITE_ALCHEMY_API_KEY or DEPLOYER_PRIVATE_KEY in .env.local");
  process.exit(1);
}

// Ensure nothing forces dry run (e.g. CI or IDE env)
delete process.env.FOUNDRY_DRY_RUN;

const rpcUrl = `https://arb-mainnet.g.alchemy.com/v2/${VITE_ALCHEMY_API_KEY}`;
const treasury = process.env.VITE_TREASURY_ADDRESS || "0x0ab9c993Cd5Fe24017b86f78d18deCB3C6CB7dc1";
const platform = "0x1Fde40a4046Eda0cA0539Dd6c77ABF8933B94260";
const usdc = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

// Pass secrets via env so we don't embed them in the command string
process.env.ETH_RPC_URL = rpcUrl;

// Single shell command with --broadcast at the end (env vars expanded by shell)
const cmd = `forge create contracts/arbitrum/PaymentContract.sol:PaymentContract --rpc-url "$ETH_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --constructor-args ${usdc} ${treasury} ${platform} --broadcast`;

console.log("Broadcasting deployment (--broadcast enabled)...");
execSync(cmd, { cwd: root, stdio: "inherit", env: process.env, shell: true });
