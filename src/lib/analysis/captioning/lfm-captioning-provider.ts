import { createLogger } from '@/shared/logging/logger';
import { createLfmSceneWorker } from '../create-lfm-worker';
import { seekVideo } from '../scene-detection-utils';
import type {
  CaptioningOptions,
  MediaCaption,
  MediaCaptioningProvider,
} from './types';

const log = createLogger('LfmCaptioningProvider');

const MAX_DIM = 512;
const DEFAULT_SAMPLE_INTERVAL_SEC = 3;
const INIT_TIMEOUT_MS = 30_000;

async function captureFrame(video: HTMLVideoElement, timeSec: number): Promise<Blob> {
  await seekVideo(video, timeSec);

  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 360;
  const scale = Math.min(MAX_DIM / Math.max(vw, vh), 1);
  const width = Math.round(vw * scale);
  const height = Math.round(vh * scale);

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not acquire captioning canvas context');
  }

  context.drawImage(video, 0, 0, width, height);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
}

function waitForReady(
  worker: Worker,
  onProgress?: CaptioningOptions['onProgress'],
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let timeout = setTimeout(
      () => {
        worker.removeEventListener('message', onMessage);
        reject(new Error('LFM worker init timed out'));
      },
      INIT_TIMEOUT_MS,
    );

    const cleanup = () => {
      clearTimeout(timeout);
      worker.removeEventListener('message', onMessage);
    };

    const onMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'ready') {
        cleanup();
        resolve();
        return;
      }

      if (message.type === 'error') {
        cleanup();
        reject(new Error(message.message));
        return;
      }

      if (message.type === 'progress') {
        clearTimeout(timeout);
        timeout = setTimeout(
          () => {
            worker.removeEventListener('message', onMessage);
            reject(new Error('LFM worker init timed out'));
          },
          INIT_TIMEOUT_MS,
        );
        onProgress?.({
          stage: 'loading-model',
          percent: message.percent ?? 0,
          framesAnalyzed: 0,
          totalFrames: 0,
        });
      }
    };

    if (signal?.aborted) {
      cleanup();
      reject(signal.reason);
      return;
    }

    signal?.addEventListener('abort', () => {
      cleanup();
      reject(signal.reason);
    }, { once: true });

    worker.addEventListener('message', onMessage);
    worker.postMessage({ type: 'init' });
  });
}

function captionSingle(worker: Worker, id: number, imageBlob: Blob, signal?: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(signal!.reason);
    };

    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.data.type === 'caption' && event.data.id === id) {
        cleanup();
        resolve(event.data.caption ?? '');
      }
    };

    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(event.message || 'Caption worker error'));
    };

    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ type: 'describe', id, image: imageBlob });
  });
}

export const lfmCaptioningProvider: MediaCaptioningProvider = {
  id: 'lfm-captioning',
  label: 'LFM 2.5 VL',
  async captionVideo(video, options = {}) {
    const {
      onProgress,
      signal,
      sampleIntervalSec: rawSampleInterval = DEFAULT_SAMPLE_INTERVAL_SEC,
    } = options;
    const sampleIntervalSec = Number.isFinite(rawSampleInterval) && rawSampleInterval > 0
      ? rawSampleInterval
      : DEFAULT_SAMPLE_INTERVAL_SEC;

    const worker = createLfmSceneWorker();
    try {
      await waitForReady(worker, onProgress, signal);
      if (signal?.aborted) {
        return [];
      }

      const duration = video.duration || 0;
      if (duration <= 0) {
        return [];
      }

      const timestamps: number[] = [];
      for (let time = 0; time < duration; time += sampleIntervalSec) {
        timestamps.push(time);
      }

      if (
        timestamps.length > 0
        && timestamps[timestamps.length - 1]! + sampleIntervalSec * 0.5 < duration
      ) {
        timestamps.push(Math.max(0, duration - 0.1));
      }

      const captions: MediaCaption[] = [];

      for (let index = 0; index < timestamps.length; index += 1) {
        if (signal?.aborted) {
          break;
        }

        const timeSec = timestamps[index]!;
        const blob = await captureFrame(video, timeSec);

        onProgress?.({
          stage: 'captioning',
          percent: ((index + 1) / timestamps.length) * 100,
          framesAnalyzed: index,
          totalFrames: timestamps.length,
        });

        const text = await captionSingle(worker, index, blob, signal);
        if (text) {
          captions.push({
            timeSec: Math.round(timeSec * 10) / 10,
            text,
          });
        }

        log.info('Frame caption', { frame: index, time: timeSec.toFixed(1), length: text.length });
      }

      return captions;
    } finally {
      worker.postMessage({ type: 'dispose' });
      setTimeout(() => worker.terminate(), 500);
    }
  },
  async captionImage(imageBlob, options = {}) {
    const { onProgress, signal } = options;

    const worker = createLfmSceneWorker();
    try {
      await waitForReady(worker, onProgress, signal);
      if (signal?.aborted) {
        return [];
      }

      onProgress?.({
        stage: 'captioning',
        percent: 50,
        framesAnalyzed: 0,
        totalFrames: 1,
      });

      const text = await captionSingle(worker, 0, imageBlob, signal);

      onProgress?.({
        stage: 'captioning',
        percent: 100,
        framesAnalyzed: 1,
        totalFrames: 1,
      });

      log.info('Image caption', { length: text.length });
      return text ? [{ timeSec: 0, text }] : [];
    } finally {
      worker.postMessage({ type: 'dispose' });
      setTimeout(() => worker.terminate(), 500);
    }
  },
};
