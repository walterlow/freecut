/**
 * Vercel serverless endpoint: returns a Coinbase-hosted onramp URL for buying USDC on Arbitrum.
 * Requires COINBASE_CDP_API_KEY_NAME and COINBASE_CDP_API_KEY_SECRET in env.
 * Optional query: ?address=0x... for destination wallet and partnerUserRef (truncated to 50 chars).
 */

import { generateJwt } from '@coinbase/cdp-sdk/auth';

const ONRAMP_TOKEN_HOST = 'api.developer.coinbase.com';
const ONRAMP_TOKEN_PATH = '/onramp/v1/token';
const ONRAMP_BASE_URL = 'https://pay.coinbase.com/buy/select-asset';
const DEFAULT_NETWORK = 'arbitrum';
const DEFAULT_ASSET = 'USDC';

export async function GET(request: Request): Promise<Response> {
  const apiKeyName = process.env.COINBASE_CDP_API_KEY_NAME;
  const apiKeySecret = process.env.COINBASE_CDP_API_KEY_SECRET;

  if (!apiKeyName || !apiKeySecret) {
    return Response.json(
      { error: 'Onramp not configured: missing CDP API credentials' },
      { status: 503 }
    );
  }

  try {
    const url = new URL(request.url);
    const address = url.searchParams.get('address')?.trim();
    const redirectUrl = url.searchParams.get('redirectUrl')?.trim() || undefined;

    const body: {
      assets: string[];
      addresses?: Array<{ address: string; blockchains: string[] }>;
    } = {
      assets: [DEFAULT_ASSET],
    };
    if (address && /^0x[a-fA-F0-9]{40}$/.test(address)) {
      body.addresses = [{ address, blockchains: [DEFAULT_NETWORK] }];
    }

    const jwt = await generateJwt({
      apiKeyId: apiKeyName,
      apiKeySecret,
      requestMethod: 'POST',
      requestHost: ONRAMP_TOKEN_HOST,
      requestPath: ONRAMP_TOKEN_PATH,
      expiresIn: 120,
    });

    const tokenRes = await fetch(`https://${ONRAMP_TOKEN_HOST}${ONRAMP_TOKEN_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('Coinbase onramp token error', tokenRes.status, errText);
      return Response.json(
        { error: 'Failed to create onramp session' },
        { status: 502 }
      );
    }

    const data = (await tokenRes.json()) as { token?: string };
    const sessionToken = data?.token;
    if (!sessionToken || typeof sessionToken !== 'string') {
      return Response.json(
        { error: 'Invalid onramp session response' },
        { status: 502 }
      );
    }

    const params = new URLSearchParams({
      sessionToken,
      defaultAsset: DEFAULT_ASSET,
      defaultNetwork: DEFAULT_NETWORK,
    });
    if (address) {
      params.set('partnerUserRef', address.slice(0, 50));
    }
    if (redirectUrl) {
      params.set('redirectUrl', redirectUrl);
    }

    const onrampUrl = `${ONRAMP_BASE_URL}?${params.toString()}`;
    return Response.json({ url: onrampUrl });
  } catch (e) {
    console.error('Onramp URL error', e);
    return Response.json(
      { error: 'Failed to generate onramp URL' },
      { status: 500 }
    );
  }
}
