import { useQuery } from '@tanstack/react-query';
import {
  INTERVAL_COST_PREMIUM_USDC6,
  INTERVAL_COST_RETAIL_USDC6,
} from '@/config/billing';
import { checkPremiumMembership } from '@/infrastructure/unlock/membership';

export interface UsePremiumMembershipResult {
  isPremiumMember: boolean;
  intervalCostUsdc6: number;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Resolves Creative Organization DAO membership on Base (Unlock Protocol)
 * and returns the 5-minute interval cost in USDC (6 decimals).
 * Premium = $0.125, Retail = $0.25.
 */
export function usePremiumMembership(
  address: `0x${string}` | undefined
): UsePremiumMembershipResult {
  const apiKey = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined;
  const { data: isPremiumMember, isLoading, isError } = useQuery({
    queryKey: ['premium-membership', address],
    queryFn: () => checkPremiumMembership(address!),
    enabled: Boolean(address && apiKey),
    staleTime: 60_000,
  });

  const intervalCostUsdc6 =
    isPremiumMember === true
      ? INTERVAL_COST_PREMIUM_USDC6
      : INTERVAL_COST_RETAIL_USDC6;

  return {
    isPremiumMember: isPremiumMember === true,
    intervalCostUsdc6,
    isLoading,
    isError,
  };
}
