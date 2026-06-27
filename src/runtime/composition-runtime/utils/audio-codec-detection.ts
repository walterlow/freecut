/**
 * Detects whether a media item's audio codec requires custom decoding
 * for preview playback (browser can't natively decode it).
 *
 * We route AC-3/E-AC-3, Vorbis, and PCM endian variants through the
 * mediabunny decode path so preview audio remains reliable across
 * containers and seeking-heavy playback.
 */

const AC3_CODEC_PATTERN = /(^|[^a-z0-9])(ac-?3|ec-?3|e-?ac-?3|eac3)([^a-z0-9]|$)/i
const VORBIS_CODEC_PATTERN = /(^|[^a-z0-9])vorbis([^a-z0-9]|$)/i

// Mediabunny-style PCM codec IDs, e.g. pcm-s16be, pcm-s24le, pcm-f32be.
const PCM_ENDIAN_CODEC_PATTERN =
  /(^|[^a-z0-9])pcm[-_](?:[su](?:8|16|24|32|64)|f(?:32|64))(?:be|le)([^a-z0-9]|$)/i

// Common QuickTime/AIFF PCM aliases seen in metadata.
const PCM_ALIAS_CODEC_PATTERN = /(^|[^a-z0-9])(lpcm|twos|sowt|in24|in32|fl32|fl64)([^a-z0-9]|$)/i

export function needsCustomAudioDecoder(audioCodec: string | undefined): boolean {
  if (!audioCodec) return false

  const normalized = audioCodec.toLowerCase().trim()

  if (AC3_CODEC_PATTERN.test(normalized)) return true
  if (VORBIS_CODEC_PATTERN.test(normalized)) return true
  if (PCM_ENDIAN_CODEC_PATTERN.test(normalized)) return true
  if (PCM_ALIAS_CODEC_PATTERN.test(normalized)) return true

  // Some containers expose human-readable codec labels instead of short IDs.
  const separatorNormalized = normalized.replace(/[_-]+/g, ' ')
  if (separatorNormalized.includes('dolby digital')) return true
  if (
    normalized.includes('pcm') &&
    (separatorNormalized.includes('little endian') || separatorNormalized.includes('big endian'))
  ) {
    return true
  }

  return false
}

/**
 * Detects whether a media item's *container* can't be demuxed by the browser's
 * native media element, so its audio must go through the mediabunny decode path
 * regardless of the audio codec.
 *
 * The Matroska container (`.mkv`) is the common offender: Chrome can decode
 * VP9/Opus, but only inside WebM — it returns "" from canPlayType for Matroska
 * and never reaches `loadedmetadata`. Without this, an MKV whose audio codec is
 * otherwise browser-friendly (e.g. Opus) routes to the native element and plays
 * silently. WebM (`.webm`) is natively supported and intentionally excluded.
 */
const MATROSKA_MIME_PATTERN = /x-matroska/i
const MATROSKA_EXTENSION_PATTERN = /\.mk[av]$/i

export function isNonNativeAudioContainer(
  mimeType: string | undefined,
  fileName: string | undefined,
): boolean {
  if (mimeType && MATROSKA_MIME_PATTERN.test(mimeType)) return true
  if (fileName && MATROSKA_EXTENSION_PATTERN.test(fileName.trim())) return true
  return false
}
