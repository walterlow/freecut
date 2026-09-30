/**
 * Media file validation utilities
 */

import { parseLottieFileBytes } from '@/infrastructure/lottie/lottie-metadata'

// Supported file types based on requirements
const SUPPORTED_VIDEO_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime', // .mov files
  'video/x-matroska', // .mkv files
  'video/matroska', // .mkv files (alternate browser MIME)
  'video/x-msvideo', // .avi files
]

const SUPPORTED_AUDIO_TYPES = [
  'audio/mp3',
  'audio/mpeg', // MP3 also uses audio/mpeg
  'audio/wav',
  'audio/aac',
  'audio/x-m4a', // .m4a files
  'audio/mp4', // .m4a also reported as audio/mp4
  'audio/ogg', // Opus codec in Ogg container
  'audio/webm', // Opus codec in WebM container (MediaRecorder voiceover output)
]

const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml', // .svg files
]

const SUPPORTED_LOTTIE_TYPES = ['application/lottie+json']

const GENERIC_BROWSER_MIME_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream'])
// Extensions whose browser-reported MIME must be overridden by the extension
// mapping. `.mkv`/`.m4a` vary across browsers; `.json` is reported as the
// non-media `application/json`, so a Lottie `.json` would otherwise be rejected
// as unsupported before the content sniff in `validateMediaFileContent` runs.
const EXTENSION_PREFERRED_MIME_TYPES = new Set(['.mkv', '.m4a', '.json', '.insv', '.insp'])

// Extension to MIME type mapping for fallback when browser doesn't provide MIME type
const EXTENSION_TO_MIME: Record<string, string> = {
  // Video
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.insv': 'video/mp4',
  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.m4a': 'audio/x-m4a',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  // Image
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.insp': 'image/jpeg',
  // Lottie
  '.json': 'application/lottie+json',
  '.lottie': 'application/lottie+json',
}

/**
 * Get MIME type from file, falling back to extension-based detection
 */
export function getMimeType(file: File): string {
  const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0]
  const extensionMimeType = ext ? EXTENSION_TO_MIME[ext] : undefined

  // Prefer the extension for formats whose browser-reported MIME can't be
  // trusted for the media kind (see EXTENSION_PREFERRED_MIME_TYPES).
  if (ext && extensionMimeType && EXTENSION_PREFERRED_MIME_TYPES.has(ext)) {
    return extensionMimeType
  }

  if (!GENERIC_BROWSER_MIME_TYPES.has(file.type)) {
    return file.type
  }

  return extensionMimeType || ''
}

interface ValidationResult {
  valid: boolean
  error?: string
}

/**
 * Validate a media file before upload
 */
export function validateMediaFile(file: File): ValidationResult {
  // Check file size
  if (file.size === 0) {
    return { valid: false, error: 'File is empty' }
  }

  // Check MIME type (with extension-based fallback for files like .mkv where browser doesn't provide MIME)
  // SECURITY NOTE: This validation relies on client-provided MIME types which can be spoofed.
  // For production use, consider adding server-side validation that checks file headers/magic numbers.
  // SVG files must be treated as untrusted content downstream; render them as image sources and avoid
  // inline DOM injection where embedded scripts or event handlers could execute.
  // Additional validation with mediabunny.canDecode() is performed during metadata extraction.
  const allSupportedTypes = [
    ...SUPPORTED_VIDEO_TYPES,
    ...SUPPORTED_AUDIO_TYPES,
    ...SUPPORTED_IMAGE_TYPES,
    ...SUPPORTED_LOTTIE_TYPES,
  ]

  const mimeType = getMimeType(file)
  if (!allSupportedTypes.includes(mimeType)) {
    return {
      valid: false,
      error: `Unsupported file type: ${mimeType || file.name.split('.').pop()}. Supported types: video (mp4, webm, mov, mkv, avi), audio (mp3, wav, aac, m4a, ogg/opus), image (jpg/jpeg, png, gif, webp, svg), lottie (json, lottie)`,
    }
  }

  // Check filename
  if (file.name.length > 255) {
    return {
      valid: false,
      error: 'Filename too long (max 255 characters)',
    }
  }

  return { valid: true }
}

/**
 * Content-aware validation. Runs the synchronous checks, then — for anything
 * admitted as Lottie — confirms the bytes actually parse as a Lottie animation.
 *
 * A `.json` (or any file the browser reported with a generic MIME) is typed as
 * `application/lottie+json` purely from its extension, so ordinary JSON would
 * otherwise slip through the sync gate and only fail deep in the import pipeline
 * with an opaque "Not a valid Lottie animation" error. Sniffing here keeps
 * non-Lottie files out of the Lottie import path entirely. `parseLottieFileBytes`
 * is WASM-free (fflate only), so this stays cheap.
 */
export async function validateMediaFileContent(file: File): Promise<ValidationResult> {
  const base = validateMediaFile(file)
  if (!base.valid) {
    return base
  }

  if (isLottieMime(getMimeType(file))) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!parseLottieFileBytes(bytes)) {
      return { valid: false, error: `Not a valid Lottie animation: ${file.name}` }
    }
  }

  return base
}

/**
 * Get media type from MIME type
 */
export function getMediaType(mimeType: string): 'video' | 'audio' | 'image' | 'lottie' | 'unknown' {
  // Strip codec parameters (e.g. `audio/webm;codecs=opus` from MediaRecorder)
  // so the base container type matches the supported-type lists.
  const baseType = mimeType.split(';')[0]?.trim() ?? mimeType
  if (SUPPORTED_VIDEO_TYPES.includes(baseType)) {
    return 'video'
  }
  if (SUPPORTED_AUDIO_TYPES.includes(baseType)) {
    return 'audio'
  }
  if (SUPPORTED_IMAGE_TYPES.includes(baseType)) {
    return 'image'
  }
  if (SUPPORTED_LOTTIE_TYPES.includes(baseType)) {
    return 'lottie'
  }
  return 'unknown'
}

/**
 * Whether a MIME type is a Lottie animation (`application/lottie+json`).
 */
export function isLottieMime(mimeType: string): boolean {
  return SUPPORTED_LOTTIE_TYPES.includes(mimeType)
}

/**
 * Format duration in seconds to MM:SS or HH:MM:SS format
 */
export function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) {
    return '0:00'
  }

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  return `${minutes}:${String(secs).padStart(2, '0')}`
}
