/**
 * Thumbnail generation utilities for media library
 *
 * Uses mediabunny for video frame extraction with proper aspect ratio preservation.
 * Images use browser's Image API with aspect ratio preservation.
 * Audio files get a generated waveform placeholder.
 */

import { getMimeType } from './validation';

interface ThumbnailOptions {
  maxSize?: number; // Max dimension (width or height) - aspect ratio preserved
  quality?: number;
  timestamp?: number; // For video, timestamp in seconds
}

const DEFAULT_THUMBNAIL_OPTIONS: Required<ThumbnailOptions> = {
  maxSize: 320,
  quality: 0.6,
  timestamp: 1,
};

// Dynamically import mediabunny (heavy library)
const loadMediabunny = () => import('mediabunny');

/**
 * Generate thumbnail for video file using mediabunny
 * Preserves aspect ratio - portrait videos stay portrait, landscape stays landscape
 */
async function generateVideoThumbnail(
  file: File,
  options: ThumbnailOptions = {}
): Promise<Blob> {
  const opts = { ...DEFAULT_THUMBNAIL_OPTIONS, ...options };

  const { Input, BlobSource, CanvasSink, ALL_FORMATS } = await loadMediabunny();
  let input: InstanceType<typeof Input> | null = null;
  let sink: InstanceType<typeof CanvasSink> | null = null;

  try {
    input = new Input({
      source: new BlobSource(file),
      formats: ALL_FORMATS,
    });

    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) {
      throw new Error('No video track found');
    }

    // Calculate dimensions preserving aspect ratio - larger dimension = maxSize
    const dw = videoTrack.displayWidth || 1;
    const dh = videoTrack.displayHeight || 1;
    const width = dw > dh
      ? opts.maxSize
      : Math.floor(opts.maxSize * dw / dh);
    const height = dh > dw
      ? opts.maxSize
      : Math.floor(opts.maxSize * dh / dw);

    sink = new CanvasSink(videoTrack, {
      width,
      height,
      fit: 'fill',
    });

    // Get timestamp, clamped to valid range
    const duration = await input.computeDuration();
    const timestamp = Math.min(opts.timestamp, Math.max(0, duration - 0.1));

    const wrapped = await sink.getCanvas(timestamp);
    if (!wrapped) {
      throw new Error('Failed to extract frame from video');
    }

    const canvas = wrapped.canvas as OffscreenCanvas | HTMLCanvasElement;

    // Convert to blob
    if ('convertToBlob' in canvas) {
      return canvas.convertToBlob({ type: 'image/webp', quality: opts.quality });
    }

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
            return;
          }
          reject(new Error('Failed to create blob'));
        },
        'image/webp',
        opts.quality
      );
    });
  } finally {
    (sink as unknown as { dispose?: () => void } | null)?.dispose?.();
    input?.dispose?.();
  }
}

/**
 * Generate thumbnail for audio file (waveform placeholder)
 */
async function generateAudioThumbnail(
  file: File,
  options: ThumbnailOptions = {}
): Promise<Blob> {
  const opts = { ...DEFAULT_THUMBNAIL_OPTIONS, ...options };
  const width = opts.maxSize;
  const height = Math.round(opts.maxSize * (9 / 16));

  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }

    canvas.width = width;
    canvas.height = height;

    // Gradient background
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#1a1a1a');
    gradient.addColorStop(1, '#0a0a0a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Waveform
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const amplitude = height * 0.3;
    const centerY = height / 2;
    for (let x = 0; x < width; x++) {
      const y = centerY + Math.sin(x * 0.02) * amplitude;
      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Filename
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px "IBM Plex Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const displayName = file.name.length > 30 ? file.name.substring(0, 27) + '...' : file.name;
    ctx.fillText(displayName, width / 2, height - 20);

    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Failed to create blob')),
      'image/webp',
      opts.quality
    );
  });
}

/**
 * Generate thumbnail for image file (resized, preserving aspect ratio)
 */
async function generateImageThumbnail(
  file: File,
  options: ThumbnailOptions = {}
): Promise<Blob> {
  const opts = { ...DEFAULT_THUMBNAIL_OPTIONS, ...options };

  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }

    img.onload = () => {
      // Calculate dimensions - larger dimension = maxSize
      const width = img.naturalWidth > img.naturalHeight
        ? opts.maxSize
        : Math.floor(opts.maxSize * img.naturalWidth / img.naturalHeight);
      const height = img.naturalHeight > img.naturalWidth
        ? opts.maxSize
        : Math.floor(opts.maxSize * img.naturalHeight / img.naturalWidth);

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(img.src);
          if (blob) {
            resolve(blob);
            return;
          }
          reject(new Error('Failed to create blob'));
        },
        'image/webp',
        opts.quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load image'));
    };

    img.src = URL.createObjectURL(file);
  });
}

/**
 * Generate thumbnail based on file type
 */
export async function generateThumbnail(
  file: File,
  options: ThumbnailOptions = {}
): Promise<Blob> {
  const mimeType = getMimeType(file);

  if (mimeType.startsWith('video/')) {
    return generateVideoThumbnail(file, options);
  } else if (mimeType.startsWith('audio/')) {
    return generateAudioThumbnail(file, options);
  } else if (mimeType.startsWith('image/')) {
    return generateImageThumbnail(file, options);
  } else {
    throw new Error(`Unsupported file type: ${mimeType}`);
  }
}
