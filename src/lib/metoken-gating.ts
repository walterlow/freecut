import { getBasePublicClient } from '@/config/base-client';
import { parseAbi } from 'viem';

const raw = import.meta.env.VITE_METOKEN_REGISTRY_BASE as string | undefined;
/**
 * MeToken registry / lock address on Base for gated styles.
 * Set VITE_METOKEN_REGISTRY_BASE to the full Base address when confirmed (plan had 0xb31A...).
 */
export const METOKEN_REGISTRY_BASE: `0x${string}` | undefined =
  raw && raw.startsWith('0x') && raw.length > 10 ? (raw as `0x${string}`) : undefined;

const BALANCE_OF_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
]);

/**
 * Returns true if the given address holds at least one token from the MeToken registry on Base.
 * Used to unlock gated styles in the UI. When true, billing uses payWithRoyalty instead of payAiRender.
 */
export async function checkMeTokenHolder(address: `0x${string}`): Promise<boolean> {
  if (!METOKEN_REGISTRY_BASE) return false;
  const client = getBasePublicClient();
  const balance = await client.readContract({
    address: METOKEN_REGISTRY_BASE,
    abi: BALANCE_OF_ABI,
    functionName: 'balanceOf',
    args: [address],
  });
  return balance > 0n;
}
