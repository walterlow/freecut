/**
 * Detects whether a media item's audio codec requires custom decoding
 * for preview playback (browser can't natively decode it).
 *
 * We route AC-3/E-AC-3 and PCM endian variants through the mediabunny
 * decode path so preview audio remains reliable across containers.
 */

const AC3_CODEC_PATTERN = /(^|[^a-z0-9])(ac-?3|ec-?3|e-?ac-?3|eac3)([^a-z0-9]|$)/i;

// Mediabunny-style PCM codec IDs, e.g. pcm-s16be, pcm-s24le, pcm-f32be.
const PCM_ENDIAN_CODEC_PATTERN =
  /(^|[^a-z0-9])pcm[-_](?:[su](?:8|16|24|32|64)|f(?:32|64))(?:be|le)([^a-z0-9]|$)/i;

// Common QuickTime/AIFF PCM aliases seen in metadata.
const PCM_ALIAS_CODEC_PATTERN = /(^|[^a-z0-9])(lpcm|twos|sowt|in24|in32|fl32|fl64)([^a-z0-9]|$)/i;

export function needsCustomAudioDecoder(audioCodec: string | undefined): boolean {
  if (!audioCodec) return false;

  const normalized = audioCodec.toLowerCase().trim();

  if (AC3_CODEC_PATTERN.test(normalized)) return true;
  if (PCM_ENDIAN_CODEC_PATTERN.test(normalized)) return true;
  if (PCM_ALIAS_CODEC_PATTERN.test(normalized)) return true;

  // Some containers expose human-readable codec labels instead of short IDs.
  const separatorNormalized = normalized.replace(/[_-]+/g, ' ');
  if (separatorNormalized.includes('dolby digital')) return true;
  if (
    normalized.includes('pcm')
    && (
      separatorNormalized.includes('little endian')
      || separatorNormalized.includes('big endian')
    )
  ) {
    return true;
  }

  return false;
}
