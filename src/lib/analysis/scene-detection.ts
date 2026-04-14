/**
 * Scene Detection Service
 *
 * Uses the optical flow analyzer to detect scene cuts in a video.
 * Seeks through the video at analysis intervals and classifies motion.
 */

import { OpticalFlowAnalyzer } from './optical-flow-analyzer';
import type { MotionResult } from './optical-flow-analyzer';
import { ANALYSIS_WIDTH, ANALYSIS_HEIGHT } from './optical-flow-shaders';

export interface SceneCut {
  /** Frame number where the scene cut occurs */
  frame: number;
  /** Time in seconds */
  time: number;
  /** Motion result at the cut point */
  motion: MotionResult;
}

export interface SceneDetectionProgress {
  percent: number;
  currentFrame: number;
  totalFrames: number;
  sceneCuts: number;
}

/**
 * Detect scene cuts in a video element.
 *
 * @param video - HTMLVideoElement (must have loaded metadata)
 * @param fps - Project frame rate
 * @param analyzeEveryNthFrame - Skip frames for speed (default: 5)
 * @param onProgress - Progress callback
 * @param signal - AbortSignal for cancellation
 * @returns Array of detected scene cuts
 */
export async function detectScenes(
  video: HTMLVideoElement,
  fps: number,
  analyzeEveryNthFrame = 5,
  onProgress?: (progress: SceneDetectionProgress) => void,
  signal?: AbortSignal,
): Promise<SceneCut[]> {
  if (!navigator.gpu) {
    throw new Error('WebGPU not supported — scene detection requires GPU');
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No GPU adapter available');
  const device = await adapter.requestDevice();

  const analyzer = new OpticalFlowAnalyzer(device);
  const sceneCuts: SceneCut[] = [];

  const duration = video.duration;
  const totalFrames = Math.floor(duration * fps);
  const canvas = new OffscreenCanvas(ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
  const ctx = canvas.getContext('2d')!;

  try {
    for (let frame = 0; frame < totalFrames; frame += analyzeEveryNthFrame) {
      if (signal?.aborted) break;

      const time = frame / fps;
      video.currentTime = time;

      // Wait for seek to complete
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
        // If already at the right time, resolve immediately
        if (Math.abs(video.currentTime - time) < 0.01) {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        }
      });

      // Capture frame at analysis resolution
      ctx.drawImage(video, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
      const bitmap = await createImageBitmap(canvas);

      const result = await analyzer.analyzeFrame(bitmap);
      bitmap.close();

      if (result.isSceneCut) {
        sceneCuts.push({ frame, time, motion: result });
      }

      onProgress?.({
        percent: (frame / totalFrames) * 100,
        currentFrame: frame,
        totalFrames,
        sceneCuts: sceneCuts.length,
      });
    }
  } finally {
    analyzer.destroy();
    device.destroy();
  }

  return sceneCuts;
}
