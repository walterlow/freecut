import { createLogger } from '@/shared/logging/logger';
import { useSettingsStore } from '../deps/settings';

const log = createLogger('EvolinkClient');

const BASE_URL = 'https://api.evolink.ai/v1';

/** Resolve the API key: settings store → env var fallback. */
function getApiKey(): string | null {
  const key = useSettingsStore.getState().evolinkApiKey;
  if (key?.trim()) return key.trim();

  // Fallback to env var (dev convenience)
  const envKey = import.meta.env.VITE_EVOLINK_API_KEY as string | undefined;
  return envKey?.trim() || null;
}

export function isEvolinkConfigured(): boolean {
  return getApiKey() !== null;
}

export class EvolinkApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly type: string,
  ) {
    super(message);
    this.name = 'EvolinkApiError';
  }
}

async function handleErrorResponse(response: Response): Promise<never> {
  let code = 'unknown';
  let message = `Evolink API error (${response.status})`;
  let type = 'api_error';

  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string; type?: string };
    };
    if (body.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      type = body.error.type ?? type;
    }
  } catch {
    // body wasn't JSON — use defaults
  }

  throw new EvolinkApiError(message, response.status, code, type);
}

export async function evolinkPost<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new EvolinkApiError(
      'Evolink API key not configured. Add it in Settings → AI Generation.',
      401,
      'missing_api_key',
      'authentication_error',
    );
  }

  log.debug('POST', path);

  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as T;
}

export async function evolinkGet<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new EvolinkApiError(
      'Evolink API key not configured. Add it in Settings → AI Generation.',
      401,
      'missing_api_key',
      'authentication_error',
    );
  }

  log.debug('GET', path);

  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal,
  });

  if (!response.ok) return handleErrorResponse(response);
  return (await response.json()) as T;
}
