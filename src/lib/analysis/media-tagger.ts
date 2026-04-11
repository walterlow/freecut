/**
 * Media Captioner — uses LFM 2.5 VL to generate timestamped captions for media.
 *
 * For video: samples frames at regular intervals and captions each.
 * For images: captions the single image (timestamp 0).
 */

import { createLfmSceneWorker } from './create-lfm-worker';
import { seekVideo } from './scene-detection-utils';
import { createLogger } from '@/shared/logging/logger';

const log = createLogger('MediaCaptioner');

const MAX_DIM = 512;
/** Default interval between sampled frames (seconds). */
const DEFAULT_SAMPLE_INTERVAL_SEC = 3;
const INIT_TIMEOUT_MS = 30_000;

export interface MediaCaption {
  timeSec: number;
  text: string;
}

export interface CaptioningProgress {
  stage: 'loading-model' | 'captioning';
  percent: number;
  framesAnalyzed: number;
  totalFrames: number;
}

export interface CaptioningOptions {
  onProgress?: (progress: CaptioningProgress) => void;
  signal?: AbortSignal;
  /** Interval between sampled frames in seconds (default: 3) */
  sampleIntervalSec?: number;
}

/**
 * Capture a video frame as a JPEG Blob, scaled to fit within MAX_DIM.
 */
async function captureFrame(video: HTMLVideoElement, timeSec: number): Promise<Blob> {
  await seekVideo(video, timeSec);

  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 360;
  const scale = Math.min(MAX_DIM / Math.max(vw, vh), 1);
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0, w, h);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
}

/**
 * Wait for the LFM worker to finish loading the model.
 */
function waitForReady(
  worker: Worker,
  onProgress?: CaptioningOptions['onProgress'],
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let timeout = setTimeout(
      () => { worker.removeEventListener('message', onMsg); reject(new Error('LFM worker init timed out')); },
      INIT_TIMEOUT_MS,
    );

    const onMsg = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'ready') {
        clearTimeout(timeout);
        worker.removeEventListener('message', onMsg);
        resolve();
      } else if (msg.type === 'error') {
        clearTimeout(timeout);
        worker.removeEventListener('message', onMsg);
        reject(new Error(msg.message));
      } else if (msg.type === 'progress') {
        clearTimeout(timeout);
        timeout = setTimeout(
          () => { worker.removeEventListener('message', onMsg); reject(new Error('LFM worker init timed out')); },
          INIT_TIMEOUT_MS,
        );
        onProgress?.({ stage: 'loading-model', percent: msg.percent ?? 0, framesAnalyzed: 0, totalFrames: 0 });
      }
    };

    if (signal?.aborted) { clearTimeout(timeout); reject(signal.reason); return; }
    signal?.addEventListener('abort', () => { clearTimeout(timeout); worker.removeEventListener('message', onMsg); reject(signal.reason); }, { once: true });

    worker.addEventListener('message', onMsg);
    worker.postMessage({ type: 'init' });
  });
}

/**
 * Send an image to the worker and get back a caption string.
 */
function captionSingle(worker: Worker, id: number, imageBlob: Blob): Promise<string> {
  return new Promise<string>((resolve) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data.type === 'caption' && e.data.id === id) {
        worker.removeEventListener('message', onMsg);
        resolve(e.data.caption ?? '');
      }
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage({ type: 'describe', id, image: imageBlob });
  });
}

/**
 * Generate timestamped captions for a video by sampling frames at regular intervals.
 */
export async function captionVideo(
  video: HTMLVideoElement,
  options?: CaptioningOptions,
): Promise<MediaCaption[]> {
  const { onProgress, signal, sampleIntervalSec = DEFAULT_SAMPLE_INTERVAL_SEC } = options ?? {};

  const worker = createLfmSceneWorker();
  try {
    await waitForReady(worker, onProgress, signal);
    if (signal?.aborted) return [];

    const duration = video.duration || 0;
    if (duration <= 0) return [];

    // Build sample timestamps
    const timestamps: number[] = [];
    for (let t = 0; t < duration; t += sampleIntervalSec) {
      timestamps.push(t);
    }
    // Always include the last moment if it wasn't covered
    if (timestamps.length > 0 && timestamps[timestamps.length - 1]! + sampleIntervalSec * 0.5 < duration) {
      timestamps.push(Math.max(0, duration - 0.1));
    }

    const captions: MediaCaption[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      if (signal?.aborted) break;

      const timeSec = timestamps[i]!;
      const blob = await captureFrame(video, timeSec);

      onProgress?.({
        stage: 'captioning',
        percent: ((i + 1) / timestamps.length) * 100,
        framesAnalyzed: i,
        totalFrames: timestamps.length,
      });

      const text = await captionSingle(worker, i, blob);
      if (text) {
        captions.push({ timeSec: Math.round(timeSec * 10) / 10, text });
      }

      log.info('Frame caption', { frame: i, time: timeSec.toFixed(1), text });
    }

    return captions;
  } finally {
    worker.postMessage({ type: 'dispose' });
    setTimeout(() => worker.terminate(), 500);
  }
}

/**
 * Generate a caption for a single image.
 */
export async function captionImage(
  imageBlob: Blob,
  options?: CaptioningOptions,
): Promise<MediaCaption[]> {
  const { onProgress, signal } = options ?? {};

  const worker = createLfmSceneWorker();
  try {
    await waitForReady(worker, onProgress, signal);
    if (signal?.aborted) return [];

    onProgress?.({ stage: 'captioning', percent: 50, framesAnalyzed: 0, totalFrames: 1 });

    const text = await captionSingle(worker, 0, imageBlob);

    log.info('Image caption', { text });

    onProgress?.({ stage: 'captioning', percent: 100, framesAnalyzed: 1, totalFrames: 1 });

    return text ? [{ timeSec: 0, text }] : [];
  } finally {
    worker.postMessage({ type: 'dispose' });
    setTimeout(() => worker.terminate(), 500);
  }
}
