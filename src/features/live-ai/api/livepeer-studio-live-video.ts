/**
 * Livepeer Studio live-video-to-video flow.
 * Creates input + output streams, then POSTs to live-video-to-video so the pipeline
 * pulls from our input and publishes to our output. Avoids ai.livepeer.com CORS.
 */

import type { StreamData } from '../types';

const LIVEPEER_STUDIO_API = 'https://livepeer.studio/api';
const LIVEPEER_GENERATE_BASE = 'https://livepeer.studio/api/beta/generate';
const WHIP_BASE = 'https://playback.livepeer.studio/webrtc';
const HLS_BASE = 'https://livepeercdn.studio/hls';
const RTMP_INGEST = 'rtmp://rtmp.livepeer.com/live';

function getApiKey(): string | undefined {
  return (
    (import.meta.env.VITE_LIVEPEER_STUDIO_API_KEY as string | undefined) ??
    (import.meta.env.LIVEPEER_STUDIO_API_KEY as string | undefined)
  );
}

function authHeaders(apiKey: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

interface LivepeerStreamResponse {
  id?: string;
  streamKey?: string;
  playbackId?: string;
  stream_key?: string;
  playback_id?: string;
  webrtcUrl?: string;
  webrtc_url?: string;
  ingest?: {
    webrtc?: string | { url?: string };
  };
}

function normalizeWhipUrl(
  candidateUrl: string,
  playbackId: string,
  streamKey: string
): string {
  const fallback = `${WHIP_BASE}/${playbackId}`;
  if (!candidateUrl.trim()) return fallback;
  try {
    const parsed = new URL(candidateUrl);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const webrtcIdx = parts.findIndex((p) => p === 'webrtc');
    const tail = webrtcIdx >= 0 ? parts[webrtcIdx + 1] : '';
    // Livepeer ingest can return stream-key shaped ids (e.g. video+abcd) that 404 on playback hosts.
    // Force a playback-compatible id in that case.
    if (!tail || tail === streamKey || tail.startsWith('video+')) {
      parsed.pathname = `/webrtc/${playbackId}`;
      return parsed.toString();
    }
    return parsed.toString();
  } catch {
    return fallback;
  }
}

async function createLivepeerStream(
  apiKey: string,
  name: string
): Promise<{ streamKey: string; playbackId: string; id: string; whipUrl: string }> {
  const res = await fetch(`${LIVEPEER_STUDIO_API}/stream`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = `Livepeer stream create failed (${res.status})`;
    try {
      const j = JSON.parse(text) as { message?: string; error?: string };
      msg = j.message ?? j.error ?? msg;
    } catch {
      if (text) msg = text;
    }
    throw new Error(msg);
  }
  const data = (await res.json()) as LivepeerStreamResponse;
  const streamKey = data.streamKey ?? data.stream_key ?? '';
  const playbackId = data.playbackId ?? data.playback_id ?? '';
  const id = data.id ?? playbackId;
  if (!streamKey || !playbackId) throw new Error('Livepeer stream response missing streamKey or playbackId');

  const ingestWebRtc =
    typeof data.ingest?.webrtc === 'string'
      ? data.ingest.webrtc
      : data.ingest?.webrtc?.url;
  const responseWhipUrl = data.webrtcUrl ?? data.webrtc_url ?? ingestWebRtc ?? '';
  const whipUrl = normalizeWhipUrl(responseWhipUrl, playbackId, streamKey).trim();
  if (!whipUrl) {
    throw new Error(`Livepeer stream response missing WHIP URL for stream "${name}"`);
  }

  return { streamKey, playbackId, id, whipUrl };
}

export interface LiveVideoToVideoParams {
  model_id: string;
  params?: Record<string, unknown>;
}

/**
 * Create a live-video-to-video session via Livepeer Studio.
 * 1) Create input and output streams.
 * 2) POST to /live-video-to-video with subscribe_url (input playback) and publish_url (output ingest).
 * Returns StreamData: broadcast to whipUrl (input WHIP), play outputPlaybackId.
 */
export async function createLiveVideoToVideoSession(
  params: LiveVideoToVideoParams
): Promise<StreamData> {
  const apiKey = getApiKey();
  if (!apiKey?.trim()) {
    throw new Error(
      'Livepeer Studio API key not set. Set VITE_LIVEPEER_STUDIO_API_KEY (or LIVEPEER_STUDIO_API_KEY) in .env.local.'
    );
  }

  const modelId = params.model_id?.trim();
  if (!modelId) {
    throw new Error('Livepeer live-video-to-video requires a model_id.');
  }

  const [inputStream, outputStream] = await Promise.all([
    createLivepeerStream(apiKey, 'live-ai-input'),
    createLivepeerStream(apiKey, 'live-ai-output'),
  ]);

  const subscribe_url = `${HLS_BASE}/${inputStream.playbackId}/index.m3u8`;
  const publish_url = `${RTMP_INGEST}/${outputStream.streamKey}`;

  const body = {
    subscribe_url,
    publish_url,
    control_url: '',
    events_url: '',
    model_id: modelId,
    params: params.params ?? {},
  };

  const res = await fetch(`${LIVEPEER_GENERATE_BASE}/live-video-to-video`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    let msg = `Livepeer live-video-to-video failed (${res.status})`;
    try {
      const j = JSON.parse(text) as { message?: string; error?: string };
      msg = j.message ?? j.error ?? msg;
    } catch {
      if (text) msg = text;
    }
    throw new Error(
      `Livepeer live-video-to-video failed (${res.status}) for model "${modelId}": ${msg}`
    );
  }

  const whipUrl = inputStream.whipUrl;
  return {
    id: outputStream.id,
    whipUrl,
    outputPlaybackId: outputStream.playbackId,
  };
}

export function isLivepeerStudioConfigured(): boolean {
  const key = getApiKey();
  return Boolean(key?.trim());
}
