import { base } from '@account-kit/infra';
import { createPublicClient, http } from 'viem';

const apiKey = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined;

function getBaseRpcUrl(): string {
  const alchemyHttp = base.rpcUrls?.alchemy?.http?.[0];
  if (!alchemyHttp) {
    throw new Error('Base chain has no Alchemy RPC URL');
  }
  if (!apiKey) {
    throw new Error('VITE_ALCHEMY_API_KEY is required for Base client');
  }
  return `${alchemyHttp}/${apiKey}`;
}

/**
 * Read-only viem public client for Base (mainnet).
 * Uses the same VITE_ALCHEMY_API_KEY as Account Kit for deterministic behavior.
 */
export function getBasePublicClient() {
  const rpcUrl = getBaseRpcUrl();
  return createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });
}

export { base as baseChain };
