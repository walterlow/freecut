/**
 * Scene Detection Service — Two-pass pipeline.
 *
 * Pass 1 (fast): GPU optical flow detects candidate scene cuts (~seconds).
 * Pass 2 (smart): Gemma-4 VLM verifies each candidate by comparing frame
 *                 pairs, filtering out camera pans, dissolves, and false
 *                 positives (~seconds per candidate).
 */

import { OpticalFlowAnalyzer } from './optical-flow-analyzer';
import type { MotionResult } from './optical-flow-analyzer';
import { ANALYSIS_WIDTH, ANALYSIS_HEIGHT } from './optical-flow-shaders';
import { createGemmaSceneWorker } from './create-gemma-worker';
import { createLogger } from '@/shared/logging/logger';

const log = createLogger('SceneDetection');

/** Default sampling interval in milliseconds (matches masterselects) */
const SAMPLE_INTERVAL_MS = 500;

/** Minimum gap in seconds between scene cuts — prevents micro-segments from dissolves/pans */
const MIN_CUT_GAP_SEC = 2.0;

/** Resolution for frames sent to Gemma (larger = better accuracy, slower) */
const VERIFY_FRAME_WIDTH = 320;
const VERIFY_FRAME_HEIGHT = 180;

export interface SceneCut {
  /** Frame number where the scene cut occurs */
  frame: number;
  /** Time in seconds */
  time: number;
  /** Motion result at the cut point */
  motion: MotionResult;
  /** Whether Gemma verified this as a real scene cut (undefined = not verified) */
  verified?: boolean;
}

export interface SceneDetectionProgress {
  percent: number;
  currentSample: number;
  totalSamples: number;
  sceneCuts: number;
  /** Current stage of the pipeline */
  stage?: 'optical-flow' | 'loading-model' | 'verifying';
}

/**
 * Seek video and wait for the seeked event with a timeout fallback.
 */
async function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    }, 1000);
    video.addEventListener('seeked', onSeeked);
    video.currentTime = timeSec;
  });
}

export interface DetectScenesOptions {
  /** Time between optical flow samples in ms (default: 500) */
  sampleIntervalMs?: number;
  /** Use Gemma-4 VLM to verify candidate cuts (default: true) */
  useGemmaVerification?: boolean;
  /** Progress callback */
  onProgress?: (progress: SceneDetectionProgress) => void;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

/**
 * Detect scene cuts in a video element.
 *
 * Pass 1: Samples at fixed intervals and compares consecutive frames via GPU
 * optical flow. A scene cut candidate is flagged when mean motion exceeds the
 * threshold AND coverage ratio is high AND flow direction is incoherent.
 *
 * Pass 2 (if enabled): Captures frame pairs around each candidate and sends
 * them to Gemma-4 VLM to verify whether it's a real hard cut or just camera
 * movement / dissolve.
 */
export async function detectScenes(
  video: HTMLVideoElement,
  fps: number,
  options: DetectScenesOptions = {},
): Promise<SceneCut[]> {
  const {
    sampleIntervalMs = SAMPLE_INTERVAL_MS,
    useGemmaVerification = true,
    onProgress,
    signal,
  } = options;
  if (!navigator.gpu) {
    throw new Error('WebGPU not supported — scene detection requires GPU');
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No GPU adapter available');
  const device = await adapter.requestDevice();

  const analyzer = new OpticalFlowAnalyzer(device);

  // Verify shader compiles cleanly
  const shaderOk = await analyzer.checkShaderCompilation();
  if (!shaderOk) {
    analyzer.destroy();
    device.destroy();
    throw new Error('Optical flow shader compilation failed — check console for details');
  }

  const sceneCuts: SceneCut[] = [];

  const duration = video.duration;
  const sampleIntervalSec = sampleIntervalMs / 1000;
  const totalSamples = Math.ceil(duration / sampleIntervalSec);
  const canvas = new OffscreenCanvas(ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
  const ctx = canvas.getContext('2d')!;

  try {
    let maxMotionSeen = 0;
    for (let i = 0; i < totalSamples; i++) {
      if (signal?.aborted) break;

      const time = i * sampleIntervalSec;

      await seekVideo(video, time);

      // Capture frame at analysis resolution
      ctx.drawImage(video, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
      const bitmap = await createImageBitmap(canvas);

      const result = await analyzer.analyzeFrame(bitmap);
      bitmap.close();

      if (result.totalMotion > maxMotionSeen) {
        maxMotionSeen = result.totalMotion;
      }

      if (result.isSceneCut) {
        const frame = Math.round(time * fps);
        sceneCuts.push({ frame, time, motion: result });
      }

      onProgress?.({
        percent: (i / totalSamples) * 100,
        currentSample: i,
        totalSamples,
        sceneCuts: sceneCuts.length,
        stage: 'optical-flow',
      });
    }
    log.info('Optical flow pass complete', { totalSamples, maxMotion: maxMotionSeen.toFixed(4), rawCuts: sceneCuts.length });
  } finally {
    analyzer.destroy();
    device.destroy();
  }

  // Deduplicate: when multiple cuts cluster together (dissolves, pans), keep
  // only the strongest cut within each MIN_CUT_GAP_SEC window.
  const deduped = deduplicateCuts(sceneCuts, MIN_CUT_GAP_SEC);

  log.info('Deduplication complete', { cuts: deduped.length, minGapSec: MIN_CUT_GAP_SEC });

  if (!useGemmaVerification || deduped.length === 0 || signal?.aborted) {
    return deduped;
  }

  // Pass 2: Gemma verification — gracefully fall back to optical-flow results on failure
  try {
    const verified = await verifyWithGemma(video, deduped, onProgress, signal);
    log.info('Gemma verification complete', { confirmed: verified.length, candidates: deduped.length });
    return verified;
  } catch (err) {
    resetGemmaWorker();
    log.warn('Gemma verification failed, using optical flow results', { error: (err as Error).message });
    return deduped;
  }
}

/**
 * Capture a video frame as a PNG Blob for Gemma input.
 */
async function captureFrameBlob(
  video: HTMLVideoElement,
  timeSec: number,
): Promise<Blob> {
  await seekVideo(video, timeSec);
  const canvas = new OffscreenCanvas(VERIFY_FRAME_WIDTH, VERIFY_FRAME_HEIGHT);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0, VERIFY_FRAME_WIDTH, VERIFY_FRAME_HEIGHT);
  return canvas.convertToBlob({ type: 'image/png' });
}

/**
 * Singleton Gemma worker — created via a Vite module-worker factory so the
 * worker entry resolves correctly in dev and production.
 */
let gemmaWorker: Worker | null = null;

function getGemmaWorker(): Worker {
  if (!gemmaWorker) {
    gemmaWorker = createGemmaSceneWorker();
  }
  return gemmaWorker;
}

function resetGemmaWorker(): void {
  if (gemmaWorker) {
    gemmaWorker.terminate();
    gemmaWorker = null;
  }
}

/**
 * Pass 2: Verify candidate cuts with Gemma-4 in a Web Worker so model loading
 * and inference do not block the main thread.
 */
async function verifyWithGemma(
  video: HTMLVideoElement,
  candidates: SceneCut[],
  onProgress?: (progress: SceneDetectionProgress) => void,
  signal?: AbortSignal,
): Promise<SceneCut[]> {
  const worker = getGemmaWorker();
  const sampleInterval = SAMPLE_INTERVAL_MS / 1000;

  // Wait for model to load (30s timeout for bootstrap + initial load handshake)
  await new Promise<void>((resolve, reject) => {
    const INACTIVITY_MS = 30_000;
    let timeout = setTimeout(onTimeout, INACTIVITY_MS);
    function onTimeout() {
      worker.removeEventListener('message', onMsg);
      reject(new Error('Gemma worker init timed out after 30s of inactivity'));
    }
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
        // Model is downloading — reset inactivity timeout
        clearTimeout(timeout);
        timeout = setTimeout(onTimeout, INACTIVITY_MS);
        onProgress?.({
          percent: msg.percent,
          currentSample: 0,
          totalSamples: candidates.length,
          sceneCuts: 0,
          stage: 'loading-model',
        });
      }
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage({ type: 'init' });
  });

  if (signal?.aborted) return candidates;

  const verified: SceneCut[] = [];

  for (let i = 0; i < candidates.length; i++) {
    if (signal?.aborted) break;

    const cut = candidates[i]!;
    const beforeTime = Math.max(0, cut.time - sampleInterval);

    onProgress?.({
      percent: (i / candidates.length) * 100,
      currentSample: i,
      totalSamples: candidates.length,
      sceneCuts: verified.length,
      stage: 'verifying',
    });

    const [beforeBlob, afterBlob] = await Promise.all([
      captureFrameBlob(video, beforeTime),
      captureFrameBlob(video, cut.time),
    ]);

    const result = await new Promise<{ isSceneCut: boolean; reason: string }>((resolve) => {
      const onMsg = (e: MessageEvent) => {
        if (e.data.type === 'result' && e.data.id === i) {
          worker.removeEventListener('message', onMsg);
          resolve({ isSceneCut: e.data.isSceneCut, reason: e.data.reason });
        }
      };
      worker.addEventListener('message', onMsg);
      worker.postMessage({ type: 'verify', id: i, before: beforeBlob, after: afterBlob });
    });

    log.info('Gemma candidate result', { index: i, time: cut.time.toFixed(1), reason: result.reason });

    if (result.isSceneCut) {
      verified.push({ ...cut, verified: true });
    }
  }

  return verified;
}

/**
 * Cluster scene cuts that are closer than `minGapSec` and keep only
 * the one with the highest total motion in each cluster.
 */
function deduplicateCuts(cuts: SceneCut[], minGapSec: number): SceneCut[] {
  if (cuts.length <= 1) return cuts;

  const result: SceneCut[] = [];
  let clusterBest = cuts[0]!;

  for (let i = 1; i < cuts.length; i++) {
    const cut = cuts[i]!;
    if (cut.time - clusterBest.time < minGapSec) {
      // Same cluster — keep the stronger cut
      if (cut.motion.totalMotion > clusterBest.motion.totalMotion) {
        clusterBest = cut;
      }
    } else {
      // New cluster — emit previous best and start new cluster
      result.push(clusterBest);
      clusterBest = cut;
    }
  }
  result.push(clusterBest);

  return result;
}
