import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  storyAeneid,
  storyMainnet,
  alchemy,
} from '@account-kit/infra';
import { createConfig } from '@account-kit/react';
import { QueryClient } from '@tanstack/react-query';
import { robinhoodTestnet } from '@/config/chains';

const apiKey = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined;
const isProd = import.meta.env.PROD;

/** Set to "true" in .env.local to use mainnet chains (Base, Arbitrum, Story) while running dev server. */
const useMainnetChains =
  isProd || import.meta.env.VITE_USE_MAINNET === 'true';

/** Testnets for development: Story Aeneid, Base Sepolia, Arbitrum Sepolia, Robinhood Testnet */
export const DEVELOPMENT_CHAINS = [
  storyAeneid,
  baseSepolia,
  arbitrumSepolia,
  robinhoodTestnet,
] as const;

/** Mainnets: Base (creator economy), Arbitrum (Stylus / AI logic & datasets), Story (IP). */
export const PRODUCTION_CHAINS = [arbitrum, base, storyMainnet] as const;

/** Chains shown in the wallet network selector. Mainnet when PROD or VITE_USE_MAINNET=true. */
export const SWITCHABLE_CHAINS = useMainnetChains
  ? ([...PRODUCTION_CHAINS] as const)
  : ([...DEVELOPMENT_CHAINS] as const);

/** Default chain: Arbitrum Sepolia in dev (unless VITE_USE_MAINNET), Arbitrum One in production. */
const defaultChain = useMainnetChains ? arbitrum : arbitrumSepolia;

export const queryClient = new QueryClient();

const policyId = import.meta.env.VITE_ALCHEMY_POLICY_ID as string | undefined;

function getAlchemyConfig() {
  if (!apiKey) return null;
  const chains = useMainnetChains
    ? PRODUCTION_CHAINS.map((chain) => ({ chain }))
    : DEVELOPMENT_CHAINS.map((chain) => ({ chain }));
  return createConfig(
    {
      transport: alchemy({ apiKey }),
      chain: defaultChain,
      chains,
      ssr: false,
      enablePopupOauth: true,
      ...(policyId ? { policyId } : {}),
      sessionConfig: {
        expirationTimeMs: 1000 * 60 * 60, // 1 hour
      },
    },
    {
      illustrationStyle: 'linear',
      auth: {
        sections: [
          [{ type: 'email' }],
          [
            { type: 'passkey' },
            { type: 'social', authProviderId: 'google', mode: 'popup' },
          ],
        ],
        addPasskeyOnSignup: true,
      },
    }
  );
}

/** Alchemy config when VITE_ALCHEMY_API_KEY is set; null otherwise so app can still render */
export const alchemyConfig = getAlchemyConfig();
