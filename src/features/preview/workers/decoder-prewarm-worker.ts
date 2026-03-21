/**
 * Web Worker for background mediabunny decoder pre-seeking.
 *
 * Runs mediabunny decode off the main thread so pre-seeking occluded
 * variable-speed clips doesn't block the render loop's rAF callbacks.
 */

// Polyfill: mediabunny checks `typeof window !== 'undefined'` for CORS detection.
type WorkerGlobalWithWindow = typeof globalThis & { window?: typeof globalThis };
const workerGlobal = globalThis as WorkerGlobalWithWindow;
if (typeof workerGlobal.window === 'undefined') {
  workerGlobal.window = workerGlobal;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mb: any = null;

async function ensureMb() {
  if (mb) return mb;
  mb = await import('mediabunny');
  return mb;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const extractors = new Map<string, { sink: any; canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D }>();

async function getExtractor(src: string) {
  const existing = extractors.get(src);
  if (existing) return existing;

  const mediabunny = await ensureMb();
  const input = new mediabunny.Input({
    formats: mediabunny.ALL_FORMATS,
    source: new mediabunny.UrlSource(src),
  });

  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) return null;

  if (typeof videoTrack.canDecode === 'function') {
    if (!(await videoTrack.canDecode())) return null;
  }

  const sink = await videoTrack.createVideoSampleSink();
  const canvas = new OffscreenCanvas(1, 1);
  const ctx = canvas.getContext('2d')!;

  const state = { sink, canvas, ctx };
  extractors.set(src, state);
  return state;
}

async function preseek(src: string, timestamp: number): Promise<ImageBitmap | null> {
  const ext = await getExtractor(src);
  if (!ext) return null;

  const streamStart = Math.max(0, timestamp - 1.0);
  const iterator = ext.sink.samples(streamStart, Infinity);

  let lastFrame: VideoFrame | null = null;
  for await (const sample of iterator) {
    if (lastFrame) lastFrame.close();
    lastFrame = (sample as { frame?: VideoFrame }).frame ?? null;
    if ((sample as { timestamp: number }).timestamp >= timestamp - 0.001) {
      break;
    }
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

self.postMessage({ type: 'ready' });

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data;
  if (msg.type === 'preseek') {
    try {
      const bitmap = await preseek(msg.src, msg.timestamp);
      const response = {
        type: 'preseek_done',
        id: msg.id,
        success: bitmap !== null,
        timestamp: msg.timestamp,
        bitmap: bitmap ?? undefined,
      };
      if (bitmap) {
        self.postMessage(response, { transfer: [bitmap] });
      } else {
        self.postMessage(response);
      }
    } catch (error) {
      self.postMessage({
        type: 'preseek_done',
        id: msg.id,
        success: false,
        timestamp: msg.timestamp,
        error: String(error),
      });
    }
  }
};
