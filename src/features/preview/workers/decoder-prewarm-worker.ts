/**
 * Web Worker for background mediabunny decoder pre-seeking.
 *
 * Decodes video frames off the main thread so pre-seeking occluded
 * variable-speed clips doesn't block the render loop's rAF callbacks.
 * Returns decoded ImageBitmaps that the render loop can draw directly.
 */

// Lazy-load mediabunny (same pattern as filmstrip and proxy workers)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mb: any = null;
async function getMediabunny() {
  if (!mb) mb = await import('mediabunny');
  return mb;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const extractors = new Map<string, { sink: any; canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D }>();
type ExtractorResult = { sink: unknown; canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } | null;
const initPromises = new Map<string, Promise<ExtractorResult>>();

async function getExtractor(src: string, blob?: Blob) {
  const existing = extractors.get(src);
  if (existing) return existing;

  // Deduplicate concurrent init calls for the same source
  const inflight = initPromises.get(src);
  if (inflight) return inflight;

  const promise = (async () => {
    const mediabunny = await getMediabunny();
    // Prefer BlobSource (direct memory access) over UrlSource (fetch + parse).
    // BlobSource avoids the streaming fetch overhead and is much faster.
    const source = blob
      ? new mediabunny.BlobSource(blob)
      : new mediabunny.UrlSource(src);
    const input = new mediabunny.Input({
      formats: mediabunny.ALL_FORMATS,
      source,
    });

    self.postMessage({ type: 'debug', step: 'init_started' });
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) return null;

    if (typeof videoTrack.canDecode === 'function') {
      if (!(await videoTrack.canDecode())) return null;
    }

    const sink = await videoTrack.createVideoSampleSink();
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d')!;

    self.postMessage({ type: 'debug', step: 'init_complete' });
    const state = { sink, canvas, ctx };
    extractors.set(src, state);
    return state;
  })();

  initPromises.set(src, promise);
  try {
    return await promise;
  } finally {
    initPromises.delete(src);
  }
}

async function preseek(src: string, timestamp: number, blob?: Blob): Promise<ImageBitmap | null> {
  const ext = await getExtractor(src, blob);
  if (!ext) return null;

  const streamStart = Math.max(0, timestamp - 1.0);
  const iterator = ext.sink.samples(streamStart, Infinity);

  let lastFrame: VideoFrame | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const sample of iterator as AsyncIterable<any>) {
    if (lastFrame) lastFrame.close();
    lastFrame = sample.frame ?? null;
    if (sample.timestamp >= timestamp - 0.001) break;
  }

  if (lastFrame) {
    const w = lastFrame.displayWidth;
    const h = lastFrame.displayHeight;
    ext.canvas.width = w;
    ext.canvas.height = h;
    ext.ctx.drawImage(lastFrame, 0, 0, w, h);
    lastFrame.close();
    return ext.canvas.transferToImageBitmap();
  }
  return null;
}

// Signal worker is alive
self.postMessage({ type: 'ready' });

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data;
  if (msg.type === 'preseek') {
    try {
      const bitmap = await preseek(msg.src, msg.timestamp, msg.blob);
      if (bitmap) {
        self.postMessage(
          { type: 'preseek_done', id: msg.id, success: true, timestamp: msg.timestamp, bitmap },
          { transfer: [bitmap] },
        );
      } else {
        self.postMessage({ type: 'preseek_done', id: msg.id, success: false, timestamp: msg.timestamp });
      }
    } catch (error) {
      self.postMessage({
        type: 'preseek_done', id: msg.id, success: false, timestamp: msg.timestamp,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
};
