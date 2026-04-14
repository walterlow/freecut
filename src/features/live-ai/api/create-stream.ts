import type { CreateStreamParams, CreateStreamResponse, StreamData } from '../types';

const DAYDREAM_API_BASE = 'https://api.daydream.live/v1';

function getApiKey(): string | undefined {
  return import.meta.env.VITE_DAYDREAM_API_KEY as string | undefined;
}

function normalizeResponse(res: CreateStreamResponse): StreamData {
  return {
    id: res.id,
    whipUrl: res.whip_url,
    outputPlaybackId: res.output_playback_id,
  };
}

/**
 * Create a Daydream stream (client-side MVP).
 * Uses VITE_DAYDREAM_API_KEY. For production, call a backend that holds the key instead.
 */
export async function createStream(params: CreateStreamParams): Promise<StreamData> {
  const apiKey = getApiKey();
  if (!apiKey?.trim()) {
    throw new Error('Daydream API key is not configured. Set VITE_DAYDREAM_API_KEY in .env.local.');
  }

  const response = await fetch(`${DAYDREAM_API_BASE}/streams`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const text = await response.text();
    let message = `Daydream API error (${response.status})`;
    try {
      const json = JSON.parse(text) as { message?: string; error?: string };
      message = json.message ?? json.error ?? message;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }

  const data = (await response.json()) as CreateStreamResponse;
  return normalizeResponse(data);
}

/**
 * Check if the Daydream API key is configured (for showing setup message in UI).
 */
export function isDaydreamConfigured(): boolean {
  const key = getApiKey();
  return Boolean(key?.trim());
}
