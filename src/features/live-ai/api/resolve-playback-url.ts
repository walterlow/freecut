/**
 * Resolve the WebRTC (WHEP) playback URL for a stream from Livepeer's playback API.
 * Daydream streams use Livepeer for delivery; the output_playback_id from stream create
 * is used to fetch playback sources. The WebRTC URL is required for usePlayer().
 * See: Daydream delivery outputs docs (meta.source with hrn "WebRTC (H264)").
 */
const LIVEPEER_PLAYBACK_BASE = 'https://livepeer.studio/api/playback';
const WEBRTC_SOURCE_HRN = 'WebRTC (H264)';

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

export async function resolvePlaybackWhepUrl(outputPlaybackId: string): Promise<string | null> {
  const url = `${LIVEPEER_PLAYBACK_BASE}/${outputPlaybackId}`;
  const response = await fetch(url);
  if (!response.ok) {
    console.warn(
      '[resolvePlaybackWhepUrl] Playback API returned',
      response.status,
      'for',
      outputPlaybackId
    );
    return null;
  }
  const data = (await response.json()) as PlaybackResponse;
  const source = data.meta?.source?.find((s) => s.hrn === WEBRTC_SOURCE_HRN);
  if (!source?.url) {
    console.warn(
      '[resolvePlaybackWhepUrl] No WebRTC (H264) source in playback response for',
      outputPlaybackId
    );
    return null;
  }
  return source.url;
}
