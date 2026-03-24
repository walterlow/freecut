/**
 * Fetch Daydream stream status (GET /v1/streams/:id/status).
 * Used for diagnostics while output is buffering (e.g. cold start).
 * See: https://docs.daydream.live/api-reference/stream-status
 */
const DAYDREAM_API_BASE = 'https://api.daydream.live/v1';

function getApiKey(): string | undefined {
  return import.meta.env.VITE_DAYDREAM_API_KEY as string | undefined;
}

export interface StreamStatusData {
  stream_id?: string;
  inference_status?: {
    pipeline?: string;
    input_fps?: number;
    output_fps?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface StreamStatusResponse {
  success: boolean;
  error?: string | null;
  data?: StreamStatusData;
}

export async function getStreamStatus(streamId: string): Promise<StreamStatusResponse | null> {
  const apiKey = getApiKey();
  if (!apiKey?.trim()) return null;

  const response = await fetch(`${DAYDREAM_API_BASE}/streams/${streamId}/status`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    try {
      const json = (await response.json()) as { error?: string; message?: string };
      return {
        success: false,
        error: json.error ?? json.message ?? `HTTP ${response.status}`,
      };
    } catch {
      return { success: false, error: `HTTP ${response.status}` };
    }
  }

  try {
    return (await response.json()) as StreamStatusResponse;
  } catch {
    return null;
  }
}

export const DAYDREAM_API_LOGS_URL = 'https://app.daydream.live/dashboard/api-logs';
