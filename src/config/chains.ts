import type { Chain } from 'viem';
import { defineChain } from 'viem/chains/utils';

/**
 * Robinhood Chain Testnet (EVM L2, chain ID 46630).
 * RPC: https://robinhood-testnet.g.alchemy.com/v2 (API key from env in transport).
 */
export const robinhoodTestnet: Chain = defineChain({
  id: 46_630,
  name: 'Robinhood Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://robinhood-testnet.g.alchemy.com/v2'],
    },
    alchemy: {
      http: ['https://robinhood-testnet.g.alchemy.com/v2'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Blockscout',
      url: 'https://explorer.testnet.chain.robinhood.com',
    },
  },
  testnet: true,
});

/**
 * USDC contract address by chain ID.
 * Used to display wallet USDC balance in the wallet dropdown.
 * Includes testnets (dev) and mainnets (Base = creator economy, Arbitrum = Stylus / AI logic & datasets).
 */
export const USDC_ADDRESS_BY_CHAIN_ID: Record<number, `0x${string}`> = {
  // Testnets
  [robinhoodTestnet.id]: '0x5B6C7cAF7F99f99154fD8375ec935Fcf03F326f5' as `0x${string}`,
  421_614: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d' as `0x${string}`, // Arbitrum Sepolia
  84_532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`, // Base Sepolia
  1_315: '0x70E5370b8981Abc6e14C91F4AcE823954EFC8eA3' as `0x${string}`, // Story Aeneid
  // Mainnets (native USDC)
  84_53: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as `0x${string}`, // Base
  42_161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as `0x${string}`, // Arbitrum One
};
