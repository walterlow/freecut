/**
 * Constructor args for PaymentContract (for Hardhat verify).
 * Used with: npx hardhat verify --network arbitrumOne --constructor-args-path scripts/payment-constructor-args.ts <CONTRACT_ADDRESS>
 */
export default [
  "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC Arbitrum One
  "0x0ab9c993Cd5Fe24017b86f78d18deCB3C6CB7dc1", // treasury
  "0x1Fde40a4046Eda0cA0539Dd6c77ABF8933B94260", // platform
];
