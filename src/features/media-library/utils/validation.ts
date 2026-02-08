/**
 * Media file validation utilities
 */

import { formatBytes } from '@/utils/format-utils';

// Supported file types based on requirements
const SUPPORTED_VIDEO_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime', // .mov files
  'video/x-matroska', // .mkv files
];

const SUPPORTED_AUDIO_TYPES = [
  'audio/mp3',
  'audio/mpeg', // MP3 also uses audio/mpeg
  'audio/wav',
  'audio/aac',
  'audio/ogg', // Opus codec in Ogg container
];

const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
];

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB

// Extension to MIME type mapping for fallback when browser doesn't provide MIME type
const EXTENSION_TO_MIME: Record<string, string> = {
  // Video
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  // Image
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * Get MIME type from file, falling back to extension-based detection
 */
export function getMimeType(file: File): string {
  if (file.type) {
    return file.type;
  }
  // Fallback to extension-based detection
  const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0];
  return ext ? EXTENSION_TO_MIME[ext] || '' : '';
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a media file before upload
 */
export function validateMediaFile(file: File): ValidationResult {
  // Check file size
  if (file.size === 0) {
    return { valid: false, error: 'File is empty' };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File too large. Maximum size is ${formatBytes(MAX_FILE_SIZE)}`,
    };
  }

  // Check MIME type (with extension-based fallback for files like .mkv where browser doesn't provide MIME)
  // SECURITY NOTE: This validation relies on client-provided MIME types which can be spoofed.
  // For production use, consider adding server-side validation that checks file headers/magic numbers.
  // Additional validation with mediabunny.canDecode() is performed during metadata extraction.
  const allSupportedTypes = [
    ...SUPPORTED_VIDEO_TYPES,
    ...SUPPORTED_AUDIO_TYPES,
    ...SUPPORTED_IMAGE_TYPES,
  ];

  const mimeType = getMimeType(file);
  if (!allSupportedTypes.includes(mimeType)) {
    return {
      valid: false,
      error: `Unsupported file type: ${mimeType || file.name.split('.').pop()}. Supported types: video (mp4, webm, mov, mkv), audio (mp3, wav, aac, ogg/opus), image (jpg, png, gif, webp)`,
    };
  }

  // Check filename
  if (file.name.length > 255) {
    return {
      valid: false,
      error: 'Filename too long (max 255 characters)',
    };
  }

  return { valid: true };
}

/**
 * Get media type from MIME type
 */
export function getMediaType(
  mimeType: string
): 'video' | 'audio' | 'image' | 'unknown' {
  if (SUPPORTED_VIDEO_TYPES.includes(mimeType)) {
    return 'video';
  }
  if (SUPPORTED_AUDIO_TYPES.includes(mimeType)) {
    return 'audio';
  }
  if (SUPPORTED_IMAGE_TYPES.includes(mimeType)) {
    return 'image';
  }
  return 'unknown';
}

/**
 * Format duration in seconds to MM:SS or HH:MM:SS format
 */
export function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) {
    return '0:00';
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return `${minutes}:${String(secs).padStart(2, '0')}`;
}
