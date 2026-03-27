/**
 * Resolve the WebRTC (WHEP) playback URL for a stream from Livepeer's playback API.
 * Daydream streams use Livepeer for delivery; the output_playback_id from stream create
 * is used to fetch playback sources. The WebRTC URL is required for usePlayer().
 * See: Daydream delivery outputs docs (meta.source with hrn "WebRTC (H264)").
 */
const LIVEPEER_PLAYBACK_BASE = 'https://livepeer.studio/api/playback';
const WEBRTC_SOURCE_HRN = 'WebRTC (H264)';
const WEBRTC_TYPE = 'webrtc';
const MAX_ATTEMPTS = 6;
const RETRY_DELAY_MS = 1500;

interface PlaybackSource {
  hrn?: string;
  type?: string;
  url?: string;
}

interface PlaybackResponse {
  meta?: {
    source?: PlaybackSource[];
  };
}

export interface ResolvePlaybackWhepResult {
  url: string | null;
  error: string | null;
}

export async function resolvePlaybackWhepUrl(
  outputPlaybackId: string
): Promise<ResolvePlaybackWhepResult> {
  const url = `${LIVEPEER_PLAYBACK_BASE}/${outputPlaybackId}`;
  let lastError = `Could not resolve playback URL for ${outputPlaybackId}`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(url);
    if (!response.ok) {
      lastError = `Playback API returned ${response.status} for ${outputPlaybackId}`;
      const shouldRetry =
        response.status === 404 || (response.status >= 500 && response.status <= 599);
      if (shouldRetry && attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      console.warn('[resolvePlaybackWhepUrl]', lastError);
      return { url: null, error: lastError };
    }

    const data = (await response.json()) as PlaybackResponse;
    const sources = data.meta?.source ?? [];
    const primarySource = sources.find((s) => s.hrn === WEBRTC_SOURCE_HRN);
    const fallbackWebRtcSource = sources.find((s) => {
      const candidateUrl = String(s.url ?? '');
      const type = String(s.type ?? '').toLowerCase();
      return (
        candidateUrl.length > 0 &&
        (candidateUrl.includes('/webrtc/') ||
          type.includes(WEBRTC_TYPE) ||
          type.includes('h264'))
      );
    });
    const source = primarySource ?? fallbackWebRtcSource;
    if (source?.url) {
      return { url: source.url, error: null };
    }

    lastError = `No WebRTC playback source found for ${outputPlaybackId}`;
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      continue;
    }
    console.warn('[resolvePlaybackWhepUrl]', lastError);
    return { url: null, error: lastError };
  }

  return { url: null, error: lastError };
}
