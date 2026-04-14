import { getBasePublicClient } from '@/config/base-client';
import { parseAbi } from 'viem';

const UNLOCK_HAS_VALID_KEY_ABI = parseAbi([
  'function getHasValidKey(address) view returns (bool)',
]);

/**
 * Unlock Protocol Lock contract addresses on Base (Creative Organization DAO).
 */
export const UNLOCK_LOCK_ADDRESSES_BASE = [
  '0x9c3744c96200a52d05a630d4aec0db707d7509be' as `0x${string}`, // Brand
  '0x13b818daf7016b302383737ba60c3a39fef231cf' as `0x${string}`, // Investor
  '0xf7c4cd399395d80f9d61fde833849106775269c6' as `0x${string}`, // Creator
];

/**
 * Returns true if the given address holds a valid key on any of the
 * Creative Organization DAO Unlock locks on Base.
 */
export async function checkPremiumMembership(
  address: `0x${string}`
): Promise<boolean> {
  const client = getBasePublicClient();
  for (const lockAddress of UNLOCK_LOCK_ADDRESSES_BASE) {
    const hasKey = await client.readContract({
      address: lockAddress,
      abi: UNLOCK_HAS_VALID_KEY_ABI,
      functionName: 'getHasValidKey',
      args: [address],
    });
    if (hasKey) return true;
  }
  return false;
}
