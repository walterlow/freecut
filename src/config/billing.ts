/**
 * Billing constants for Live AI render (USDC, 6 decimals).
 * Premium = Creative Organization DAO members (Unlock on Base).
 * Retail = non-members.
 */
export const USDC_DECIMALS = 6;

/** $0.125 USDC per 5-minute interval (premium / cost basis). */
export const INTERVAL_COST_PREMIUM_USDC6 = 125_000;

/** $0.25 USDC per 5-minute interval (retail). */
export const INTERVAL_COST_RETAIL_USDC6 = 250_000;

/** Max USDC per session for Session Key allowance (10 USDC). */
export const SESSION_CAP_USDC6 = 10_000_000;

/** Payment contract on Arbitrum (env: VITE_ARBITRUM_PAYMENT_CONTRACT). */
export function getPaymentContractAddress(): `0x${string}` | undefined {
  const v = import.meta.env.VITE_ARBITRUM_PAYMENT_CONTRACT as string | undefined;
  if (!v || !v.startsWith('0x')) return undefined;
  return v as `0x${string}`;
}

/** Stylus Style Registry on Arbitrum (env: VITE_STYLUS_STYLE_REGISTRY). Phase 2: style_id → creator for royalties. */
export function getStyleRegistryAddress(): `0x${string}` | undefined {
  const v = import.meta.env.VITE_STYLUS_STYLE_REGISTRY as string | undefined;
  if (!v || !v.startsWith('0x')) return undefined;
  return v as `0x${string}`;
}
