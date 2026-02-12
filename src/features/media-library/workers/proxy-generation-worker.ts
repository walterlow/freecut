/**
 * Proxy Generation Worker
 *
 * Transcodes video to 720p proxy using mediabunny's Conversion API
 * and saves the result to OPFS. Used for preview playback optimization
 * — preview uses the proxy while export uses the original full-res source.
 *
 * Storage structure:
 *   proxies/{mediaId}/
 *     proxy.mp4
 *     meta.json - { width, height, status, createdAt }
 */

const PROXY_DIR = 'proxies';
const PROXY_WIDTH = 1280;
const PROXY_HEIGHT = 720;

// Message types
export interface ProxyGenerateRequest {
  type: 'generate';
  mediaId: string;
  blobUrl: string;
  sourceWidth: number;
  sourceHeight: number;
}

export interface ProxyCancelRequest {
  type: 'cancel';
  mediaId: string;
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

// Dynamically import mediabunny
const loadMediabunny = () => import('mediabunny');

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
  metadata: { width: number; height: number; status: string; createdAt: number }
): Promise<void> {
  const fileHandle = await dir.getFileHandle('meta.json', { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(metadata));
  await writable.close();
}

/**
 * Generate a 720p proxy video via mediabunny Conversion
 */
async function generateProxy(request: ProxyGenerateRequest): Promise<void> {
  const { mediaId, blobUrl } = request;

  const {
    Input, UrlSource, Output, Mp4OutputFormat, BufferTarget, Conversion,
    QUALITY_MEDIUM, MP4, WEBM, MATROSKA,
  } = await loadMediabunny();

  const dir = await getProxyDir(mediaId);

  // Save initial metadata
  await saveMetadata(dir, {
    width: PROXY_WIDTH,
    height: PROXY_HEIGHT,
    status: 'generating',
    createdAt: Date.now(),
  });

  const input = new Input({
    source: new UrlSource(blobUrl),
    formats: [MP4, WEBM, MATROSKA],
  });

  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let conversion: any = null;

  try {
    conversion = await Conversion.init({
      input,
      output,
      video: {
        width: PROXY_WIDTH,
        height: PROXY_HEIGHT,
        fit: 'contain',
        codec: 'avc',
        bitrate: QUALITY_MEDIUM,
      },
      audio: {
        codec: 'aac',
        bitrate: 128_000,
      },
    });

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

    await conversion.execute();

    // Check if cancelled during execution
    if (!activeConversions.has(mediaId)) return;

    // Get the output buffer
    const buffer = target.buffer;
    if (!buffer) {
      throw new Error('Conversion produced no output buffer');
    }

    // Write proxy video to OPFS
    const fileHandle = await dir.getFileHandle('proxy.mp4', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(buffer);
    await writable.close();

    // Update metadata
    await saveMetadata(dir, {
      width: PROXY_WIDTH,
      height: PROXY_HEIGHT,
      status: 'ready',
      createdAt: Date.now(),
    });

    self.postMessage({
      type: 'complete',
      mediaId,
    } as ProxyCompleteResponse);
  } finally {
    activeConversions.delete(mediaId);
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
          await active.cancel();
          activeConversions.delete(mediaId);
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
