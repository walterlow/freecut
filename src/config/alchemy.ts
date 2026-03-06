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

const apiKey = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined;
const isProd = import.meta.env.PROD;

/** Testnets for development: Story Aeneid, Base Sepolia, Arbitrum Sepolia */
export const DEVELOPMENT_CHAINS = [
  storyAeneid,
  baseSepolia,
  arbitrumSepolia,
] as const;

/** Mainnets for production: Arbitrum, Base, Story */
export const PRODUCTION_CHAINS = [arbitrum, base, storyMainnet] as const;

/** Default chain: Base Sepolia in dev, Base in production */
const defaultChain = isProd ? base : baseSepolia;

export const queryClient = new QueryClient();

const policyId = import.meta.env.VITE_ALCHEMY_POLICY_ID as string | undefined;

function getAlchemyConfig() {
  if (!apiKey) return null;
  return createConfig(
    {
      transport: alchemy({ apiKey }),
      chain: defaultChain,
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
