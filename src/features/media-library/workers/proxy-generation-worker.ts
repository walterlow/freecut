/**
 * Proxy Generation Worker
 *
 * Transcodes video to 720p proxy using mediabunny's Conversion API
 * and saves the result to OPFS. Used for preview playback optimization
 * — preview uses the proxy while export uses the original full-res source.
 *
 * Storage structure:
 *   proxies/{proxyKey}/
 *     proxy.mp4
 *     meta.json - { width, height, status, createdAt, version, sourceWidth, sourceHeight }
 */

import type { Conversion as ConversionType } from 'mediabunny';
import { PROXY_DIR, PROXY_SCHEMA_VERSION } from '../proxy-constants';

const PROXY_WIDTH = 1280;
const PROXY_HEIGHT = 720;

// Message types
export interface ProxyGenerateRequest {
  type: 'generate';
  mediaId: string; // proxyKey (kept as mediaId for message compatibility)
  blobUrl: string;
  sourceWidth: number;
  sourceHeight: number;
}

export interface ProxyCancelRequest {
  type: 'cancel';
  mediaId: string; // proxyKey (kept as mediaId for message compatibility)
}

export interface ProxyProgressResponse {
  type: 'progress';
  mediaId: string;
  progress: number;
}

export interface ProxyCompleteResponse {
  type: 'complete';
  mediaId: string;
}

export interface ProxyErrorResponse {
  type: 'error';
  mediaId: string;
  error: string;
}

export type ProxyWorkerRequest = ProxyGenerateRequest | ProxyCancelRequest;
export type ProxyWorkerResponse = ProxyProgressResponse | ProxyCompleteResponse | ProxyErrorResponse;

// Track active conversions for cancel support
const activeConversions = new Map<string, { cancel: () => Promise<void> }>();

// Dynamically import mediabunny + register AC-3 decoder
let ac3Registered = false;
const loadMediabunny = async () => {
  const mb = await import('mediabunny');
  if (!ac3Registered) {
    const { registerAc3Decoder } = await import('@mediabunny/ac3');
    registerAc3Decoder();
    ac3Registered = true;
  }
  return mb;
};

/**
 * Get or create OPFS directory for proxy storage
 */
async function getProxyDir(mediaId: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const proxyRoot = await root.getDirectoryHandle(PROXY_DIR, { create: true });
  return proxyRoot.getDirectoryHandle(mediaId, { create: true });
}

/**
 * Save proxy metadata to OPFS
 */
async function saveMetadata(
  dir: FileSystemDirectoryHandle,
  metadata: {
    version: number;
    width: number;
    height: number;
    sourceWidth: number;
    sourceHeight: number;
    status: string;
    createdAt: number;
  }
): Promise<void> {
  const fileHandle = await dir.getFileHandle('meta.json', { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(JSON.stringify(metadata));
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
}

function toEven(value: number): number {
  const rounded = Math.max(2, Math.floor(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function calculateProxyDimensions(sourceWidth: number, sourceHeight: number): { width: number; height: number } {
  const safeSourceWidth = Math.max(1, sourceWidth);
  const safeSourceHeight = Math.max(1, sourceHeight);
  const scale = Math.min(PROXY_WIDTH / safeSourceWidth, PROXY_HEIGHT / safeSourceHeight, 1);

  const width = toEven(safeSourceWidth * scale);
  const height = toEven(safeSourceHeight * scale);

  return {
    width,
    height,
  };
}

/**
 * Generate a 720p proxy video via mediabunny Conversion
 */
async function generateProxy(request: ProxyGenerateRequest): Promise<void> {
  const { mediaId, blobUrl, sourceWidth, sourceHeight } = request;

  const {
    Input, UrlSource, Output, Mp4OutputFormat, BufferTarget, StreamTarget, Conversion,
    QUALITY_LOW, MP4, WEBM, MATROSKA,
  } = await loadMediabunny();

  const dir = await getProxyDir(mediaId);
  const proxyDimensions = calculateProxyDimensions(sourceWidth, sourceHeight);
  const createdAt = Date.now();

  // Save initial metadata
  await saveMetadata(dir, {
    version: PROXY_SCHEMA_VERSION,
    width: proxyDimensions.width,
    height: proxyDimensions.height,
    sourceWidth,
    sourceHeight,
    status: 'generating',
    createdAt,
  });

  const input = new Input({
    source: new UrlSource(blobUrl),
    formats: [MP4, WEBM, MATROSKA],
  });

  let conversion: ConversionType | null = null;
  let streamedToFile = false;
  let bufferTarget: InstanceType<typeof BufferTarget> | null = null;
  let writable: FileSystemWritableFileStream | undefined;

  try {
    const buildConversion = async (
      outputTarget: InstanceType<typeof StreamTarget> | InstanceType<typeof BufferTarget>,
      useInMemoryFastStart: boolean,
    ) => {
      const output = new Output({
        format: new Mp4OutputFormat({ fastStart: useInMemoryFastStart ? 'in-memory' : false }),
        target: outputTarget,
      });

      return Conversion.init({
        input,
        output,
        video: {
          width: proxyDimensions.width,
          height: proxyDimensions.height,
          fit: 'contain',
          codec: 'avc',
          // Faster proxy generation preset.
          bitrate: QUALITY_LOW,
          hardwareAcceleration: 'prefer-hardware',
          // Short GOP to speed up random-access decode during scrubbing.
          keyFrameInterval: 1,
        },
        audio: {
          // Scrub proxy is video-only for faster generation and smaller files.
          discard: true,
        },
      });
    };

    const fileHandle = await dir.getFileHandle('proxy.mp4', { create: true });
    try {
      writable = await fileHandle.createWritable();
      const streamTarget = new StreamTarget(writable);
      streamedToFile = true;
      conversion = await buildConversion(streamTarget, false);
    } catch {
      // Close leaked writable before falling back to buffer target.
      if (writable) {
        try { await writable.abort(); } catch { /* best-effort cleanup */ }
      }
      streamedToFile = false;
      bufferTarget = new BufferTarget();
      conversion = await buildConversion(bufferTarget, true);
    }

    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks.map(
        (d) => `${d.track.type ?? 'unknown'}: ${d.reason}`
      ).join('; ');
      throw new Error(`Proxy conversion invalid: ${reasons || 'no usable tracks'}`);
    }

    // Store cancel handle
    activeConversions.set(mediaId, {
      cancel: () => conversion!.cancel(),
    });

    // Wire up progress
    conversion.onProgress = (progress: number) => {
      self.postMessage({
        type: 'progress',
        mediaId,
        progress,
      } as ProxyProgressResponse);
    };

    try {
      await conversion.execute();
    } catch (execError) {
      // If cancel() was invoked, activeConversions entry is already deleted.
      if (!activeConversions.has(mediaId)) {
        if (streamedToFile) {
          await dir.removeEntry('proxy.mp4').catch(() => undefined);
        }
        return;
      }
      throw execError;
    }

    // Check if cancelled during execution (resolved without throwing)
    if (!activeConversions.has(mediaId)) {
      if (streamedToFile) {
        await dir.removeEntry('proxy.mp4').catch(() => undefined);
      }
      return;
    }

    if (!streamedToFile) {
      // Buffer fallback mode: flush conversion result to OPFS.
      const buffer = bufferTarget?.buffer;
      if (!buffer) {
        throw new Error('Conversion produced no output buffer');
      }

      const bufferWritable = await fileHandle.createWritable();
      try {
        await bufferWritable.write(buffer);
        await bufferWritable.close();
      } catch (error) {
        await bufferWritable.abort().catch(() => undefined);
        throw error;
      }
    }

    // Update metadata
    await saveMetadata(dir, {
      version: PROXY_SCHEMA_VERSION,
      width: proxyDimensions.width,
      height: proxyDimensions.height,
      sourceWidth,
      sourceHeight,
      status: 'ready',
      createdAt,
    });

    self.postMessage({
      type: 'complete',
      mediaId,
    } as ProxyCompleteResponse);
  } finally {
    activeConversions.delete(mediaId);
    if (writable) {
      try { await writable.abort(); } catch { /* may already be closed/aborted */ }
    }
    input.dispose();
  }
}

/**
 * Message handler
 */
self.onmessage = async (event: MessageEvent<ProxyWorkerRequest>) => {
  const { type } = event.data;

  try {
    switch (type) {
      case 'generate': {
        await generateProxy(event.data as ProxyGenerateRequest);
        break;
      }

      case 'cancel': {
        const { mediaId } = event.data as ProxyCancelRequest;
        const active = activeConversions.get(mediaId);
        if (active) {
          activeConversions.delete(mediaId);
          await active.cancel();
        }
        break;
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    const mediaId = (event.data as ProxyGenerateRequest).mediaId;
    self.postMessage({
      type: 'error',
      mediaId,
      error: error instanceof Error ? error.message : String(error),
    } as ProxyErrorResponse);
  }
};

export {};
