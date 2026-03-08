import { useQuery } from '@tanstack/react-query';
import type { Chain } from 'viem';
import { createPublicClient, formatUnits, http, parseAbi } from 'viem';
import { USDC_ADDRESS_BY_CHAIN_ID } from '@/config/chains';

const ERC20_BALANCE_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
]);

const USDC_DECIMALS = 6;

const apiKey = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined;

function getRpcUrl(chain: Chain): string {
  const alchemyHttp = chain.rpcUrls?.alchemy?.http?.[0];
  const defaultHttp = chain.rpcUrls?.default?.http?.[0];
  if (alchemyHttp && apiKey) {
    return `${alchemyHttp}/${apiKey}`;
  }
  return defaultHttp ?? alchemyHttp ?? '';
}

async function fetchUsdcBalance(
  chain: Chain,
  address: `0x${string}`
): Promise<string> {
  const usdcAddress = USDC_ADDRESS_BY_CHAIN_ID[chain.id];
  if (!usdcAddress) {
    return '0';
  }
  const rpcUrl = getRpcUrl(chain);
  if (!rpcUrl) {
    throw new Error(`No RPC URL for chain ${chain.id}`);
  }
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  const balance = await client.readContract({
    address: usdcAddress,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [address],
  });
  return formatUnits(balance, USDC_DECIMALS);
}

export interface UseUsdcBalanceResult {
  balance: string | null;
  formatted: string;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Returns USDC balance for the given address on the given chain.
 * Returns formatted display string and loading/error state.
 * Chains without a configured USDC address return "0" and no error.
 */
export function useUsdcBalance(
  chain: Chain | undefined,
  address: `0x${string}` | undefined
): UseUsdcBalanceResult {
  const hasUsdc = chain ? chain.id in USDC_ADDRESS_BY_CHAIN_ID : false;
  const { data, isLoading, isError } = useQuery({
    queryKey: ['usdc-balance', chain?.id, address],
    queryFn: () => fetchUsdcBalance(chain!, address!),
    enabled: Boolean(chain && address && hasUsdc && getRpcUrl(chain)),
    staleTime: 30_000,
  });

  const balance = data ?? null;
  let formatted = '—';
  if (balance !== null) {
    const n = Number(balance);
    formatted = n.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  } else if (!hasUsdc && chain) {
    formatted = '—';
  }

  return {
    balance,
    formatted,
    isLoading,
    isError,
  };
}
