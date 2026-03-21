/**
 * Web Worker for background mediabunny decoder pre-seeking.
 *
 * Runs mediabunny WASM decode off the main thread so pre-seeking occluded
 * variable-speed clips doesn't block the render loop's rAF callbacks.
 *
 * Protocol:
 * - Main → Worker: { type: 'preseek', id, src, timestamp }
 * - Worker → Main: { type: 'preseek_done', id, success, timestamp }
 */

interface PreseekRequest {
  type: 'preseek';
  id: string;
  src: string;
  timestamp: number;
}

interface PreseekResponse {
  type: 'preseek_done';
  id: string;
  success: boolean;
  timestamp: number;
  bitmap?: ImageBitmap;
}

type WorkerMessage = PreseekRequest;
type WorkerResponse = PreseekResponse;

// Lazy-loaded mediabunny types
type MbModule = {
  Input: new (opts: unknown) => unknown;
  ALL_FORMATS: unknown;
  UrlSource: new (src: string) => unknown;
};

interface ExtractorState {
  src: string;
  ready: boolean;
  initPromise: Promise<boolean> | null;
  // mediabunny objects
  input: unknown;
  videoTrack: unknown;
  sink: unknown;
  sampleIterator: AsyncIterableIterator<unknown> | null;
  lastTimestamp: number;
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
}

const extractors = new Map<string, ExtractorState>();
let mb: MbModule | null = null;

async function ensureMediabunny(): Promise<MbModule> {
  if (mb) return mb;
  mb = await import('mediabunny') as unknown as MbModule;
  return mb;
}

async function getOrCreateExtractor(src: string): Promise<ExtractorState | null> {
  const existing = extractors.get(src);
  if (existing?.ready) return existing;
  if (existing?.initPromise) {
    await existing.initPromise;
    return existing.ready ? existing : null;
  }

  const canvas = new OffscreenCanvas(1, 1);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const state: ExtractorState = {
    src,
    ready: false,
    initPromise: null,
    input: null,
    videoTrack: null,
    sink: null,
    sampleIterator: null,
    lastTimestamp: -1,
    canvas,
    ctx,
  };
  extractors.set(src, state);

  state.initPromise = (async () => {
    try {
      const mbModule = await ensureMediabunny();
      state.input = new mbModule.Input({
        formats: mbModule.ALL_FORMATS,
        source: new mbModule.UrlSource(src),
      });

      state.videoTrack = await (state.input as { getPrimaryVideoTrack(): Promise<unknown> }).getPrimaryVideoTrack();
      if (!state.videoTrack) return false;

      const canDecode = (state.videoTrack as { canDecode?: () => Promise<boolean> }).canDecode;
      if (canDecode) {
        const ok = await canDecode.call(state.videoTrack);
        if (!ok) return false;
      }

      state.sink = await (state.videoTrack as { createVideoSampleSink(): Promise<unknown> }).createVideoSampleSink();
      state.ready = true;
      return true;
    } catch {
      return false;
    }
  })();

  await state.initPromise;
  state.initPromise = null;
  return state.ready ? state : null;
}

async function preseek(src: string, timestamp: number): Promise<ImageBitmap | null> {
  const state = await getOrCreateExtractor(src);
  if (!state) return null;

  try {
    const sink = state.sink as {
      samples(start: number, end: number): AsyncIterableIterator<{
        timestamp: number;
        frame?: { close(): void };
      }>;
    };

    // Start a new iterator at the target timestamp (with 1s backtrack)
    const streamStart = Math.max(0, timestamp - 1.0);
    state.sampleIterator = sink.samples(streamStart, Infinity);

    // Iterate until we reach or pass the target timestamp, keeping the last frame
    let lastFrame: { close(): void } | null = null;
    let found = false;
    for await (const rawSample of state.sampleIterator) {
      const sample = rawSample as { timestamp: number; frame?: { close(): void } };
      if (lastFrame) lastFrame.close();
      lastFrame = sample.frame ?? null;
      if (sample.timestamp >= timestamp - 0.001) {
        found = true;
        state.lastTimestamp = sample.timestamp;
        break;
      }
    }
    // Draw the decoded frame to the canvas and create an ImageBitmap
    if (found && lastFrame) {
      const videoFrame = lastFrame as unknown as VideoFrame;
      const w = videoFrame.displayWidth;
      const h = videoFrame.displayHeight;
      state.canvas.width = w;
      state.canvas.height = h;
      state.ctx.drawImage(videoFrame, 0, 0, w, h);
      videoFrame.close();
      return state.canvas.transferToImageBitmap();
    }
    if (lastFrame) lastFrame.close();
    return null;
  } catch {
    return null;
  }
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;
  if (msg.type === 'preseek') {
    const bitmap = await preseek(msg.src, msg.timestamp);
    const response: PreseekResponse = {
      type: 'preseek_done',
      id: msg.id,
      success: bitmap !== null,
      timestamp: msg.timestamp,
      bitmap: bitmap ?? undefined,
    };
    // Transfer the bitmap to avoid copying
    if (bitmap) {
      self.postMessage(response, { transfer: [bitmap] });
    } else {
      self.postMessage(response);
    }
  }
};
