/* eslint-disable no-console -- deploy script output */
import { network } from "hardhat";

const USDC_ARBITRUM_ONE = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const;

async function main() {
  const { viem, networkName } = await network.connect();
  const treasuryRaw = process.env.VITE_TREASURY_ADDRESS?.trim() ?? "";
  const treasury =
    treasuryRaw && treasuryRaw.length === 42
      ? treasuryRaw
      : "0x0ab9c993Cd5Fe24017b86f78d18deCB3C6CB7dc1";
  const platform = "0x1Fde40a4046Eda0cA0539Dd6c77ABF8933B94260";

  console.log(`Deploying PaymentContract to ${networkName}...`);
  const paymentContract = await viem.deployContract("PaymentContract", [
    USDC_ARBITRUM_ONE,
    treasury as `0x${string}`,
    platform as `0x${string}`,
  ]);
  console.log("PaymentContract deployed to:", paymentContract.address);
}

main().catch(console.error);
