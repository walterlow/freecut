/**
 * Read PaymentContract state from chain to validate deployment.
 * Usage: npx hardhat run scripts/validate-payment.ts --network arbitrumOne
 */
/* eslint-disable no-console -- script output */
import { network } from "hardhat";

const PAYMENT_CONTRACT_ADDRESS =
  process.env.VITE_ARBITRUM_PAYMENT_CONTRACT?.trim() ||
  "0x9ee018d172ba70abe216fdea1893076ccb60f612";

async function main() {
  const { viem, networkName } = await network.connect();
  const publicClient = await viem.getPublicClient();

  const address = PAYMENT_CONTRACT_ADDRESS as `0x${string}`;
  console.log(`Validating PaymentContract at ${address} on ${networkName}\n`);

  const [usdc, treasury, platform, owner] = await Promise.all([
    publicClient.readContract({
      address,
      abi: [
        {
          type: "function",
          name: "USDC",
          inputs: [],
          outputs: [{ type: "address", name: "" }],
          stateMutability: "view",
        },
      ],
      functionName: "USDC",
    }),
    publicClient.readContract({
      address,
      abi: [
        {
          type: "function",
          name: "treasury",
          inputs: [],
          outputs: [{ type: "address", name: "" }],
          stateMutability: "view",
        },
      ],
      functionName: "treasury",
    }),
    publicClient.readContract({
      address,
      abi: [
        {
          type: "function",
          name: "platform",
          inputs: [],
          outputs: [{ type: "address", name: "" }],
          stateMutability: "view",
        },
      ],
      functionName: "platform",
    }),
    publicClient.readContract({
      address,
      abi: [
        {
          type: "function",
          name: "owner",
          inputs: [],
          outputs: [{ type: "address", name: "" }],
          stateMutability: "view",
        },
      ],
      functionName: "owner",
    }),
  ]);

  const expectedUsdc = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
  const ok =
    usdc.toLowerCase() === expectedUsdc.toLowerCase() &&
    treasury !== "0x0000000000000000000000000000000000000000" &&
    platform !== "0x0000000000000000000000000000000000000000" &&
    owner !== "0x0000000000000000000000000000000000000000";

  console.log("USDC():    ", usdc);
  console.log("treasury():", treasury);
  console.log("platform():", platform);
  console.log("owner():   ", owner);
  console.log(ok ? "\nValidation passed." : "\nValidation failed (check addresses).");
}

main().catch(console.error);
