import { useCallback, useState } from 'react';
import { getOnrampApiBaseUrl } from '@/config/onramp';

export interface UseBuyUsdcOnrampResult {
  openBuyUsdc: (options?: { address?: string; redirectUrl?: string }) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

/**
 * Fetches a Coinbase-hosted onramp URL from the backend and opens it in a new tab.
 * Use in wallet dropdown and Live AI "Top up USDC" messaging.
 */
export function useBuyUsdcOnramp(): UseBuyUsdcOnrampResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openBuyUsdc = useCallback(
    async (options?: { address?: string; redirectUrl?: string }) => {
      setError(null);
      setIsLoading(true);
      try {
        const base = getOnrampApiBaseUrl();
        const url = new URL('/api/onramp-url', base || window.location.origin);
        if (options?.address) url.searchParams.set('address', options.address);
        if (options?.redirectUrl) url.searchParams.set('redirectUrl', options.redirectUrl);

        const res = await fetch(url.toString());
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          setError((data?.error as string) ?? 'Could not open buy USDC');
          return;
        }

        const targetUrl = data?.url;
        if (typeof targetUrl !== 'string') {
          setError('Invalid response from server');
          return;
        }

        window.open(targetUrl, '_blank', 'noopener,noreferrer');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to open buy USDC');
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  return { openBuyUsdc, isLoading, error };
}
