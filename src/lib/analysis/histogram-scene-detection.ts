/**
 * Fast histogram-based scene detection — CPU-only, no WebGPU required.
 *
 * Compares consecutive frames using RGB color histograms. A scene cut is
 * detected when the chi-squared distance between histograms exceeds a
 * threshold. Much faster than optical flow but only detects hard cuts
 * (not gradual transitions like dissolves or wipes).
 */

import { createLogger } from '@/shared/logging/logger'
import type { MotionResult } from './optical-flow-analyzer'
import type { SceneCut, SceneDetectionProgress } from './scene-detection'
import { seekVideo, deduplicateCuts } from './scene-detection-utils'

const log = createLogger('HistogramSceneDetection')

/** Number of bins per RGB channel */
const BINS_PER_CHANNEL = 32
const TOTAL_BINS = BINS_PER_CHANNEL * 3

/** Analysis resolution — small enough for speed, large enough for accuracy */
const HIST_WIDTH = 160
const HIST_HEIGHT = 90

/**
 * Chi-squared distance threshold for a scene cut.
 * Empirically tuned: hard cuts typically score 0.5–2.0+, same-scene
 * frames score < 0.15. Threshold of 0.3 catches most hard cuts with
 * few false positives.
 */
const CHI_SQUARED_THRESHOLD = 0.3

/** Minimum gap in seconds between cuts to avoid micro-segments */
const MIN_CUT_GAP_SEC = 2.0

/**
 * Compute a normalized RGB histogram from pixel data.
 * Returns an array of TOTAL_BINS floats summing to 3.0 (1.0 per channel).
 */
export function computeHistogram(pixels: Uint8ClampedArray): Float32Array {
  const hist = new Float32Array(TOTAL_BINS)
  const binScale = BINS_PER_CHANNEL / 256
  const pixelCount = pixels.length / 4

  for (let i = 0; i < pixels.length; i += 4) {
    const rBin = Math.min((pixels[i]! * binScale) | 0, BINS_PER_CHANNEL - 1)
    const gBin = Math.min((pixels[i + 1]! * binScale) | 0, BINS_PER_CHANNEL - 1)
    const bBin = Math.min((pixels[i + 2]! * binScale) | 0, BINS_PER_CHANNEL - 1)
    hist[rBin]!++
    hist[BINS_PER_CHANNEL + gBin]!++
    hist[BINS_PER_CHANNEL * 2 + bBin]!++
  }

  // Normalize each channel to sum to 1.0
  for (let c = 0; c < 3; c++) {
    const offset = c * BINS_PER_CHANNEL
    for (let b = 0; b < BINS_PER_CHANNEL; b++) {
      hist[offset + b]! /= pixelCount
    }
  }

  return hist
}

/**
 * Chi-squared distance between two normalized histograms.
 * Returns 0 for identical histograms, higher values for more difference.
 */
export function chiSquaredDistance(a: Float32Array, b: Float32Array): number {
  let distance = 0
  for (let i = 0; i < a.length; i++) {
    const sum = a[i]! + b[i]!
    if (sum > 0) {
      const diff = a[i]! - b[i]!
      distance += (diff * diff) / sum
    }
  }
  return distance
}

export interface HistogramDetectOptions {
  /** Time between samples in ms (default: 250) */
  sampleIntervalMs?: number
  /** Chi-squared threshold for cut detection (default: 0.3) */
  threshold?: number
  /** Progress callback */
  onProgress?: (progress: SceneDetectionProgress) => void
  /** AbortSignal for cancellation */
  signal?: AbortSignal
}

/**
 * Detect scene cuts using color histogram comparison.
 * Returns cuts sorted by time.
 */
export async function detectScenesHistogram(
  video: HTMLVideoElement,
  fps: number,
  options: HistogramDetectOptions = {},
): Promise<SceneCut[]> {
  const { sampleIntervalMs = 250, threshold = CHI_SQUARED_THRESHOLD, onProgress, signal } = options

  const duration = video.duration
  const sampleIntervalSec = sampleIntervalMs / 1000
  const totalSamples = Math.ceil(duration / sampleIntervalSec)

  const canvas = new OffscreenCanvas(HIST_WIDTH, HIST_HEIGHT)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  const rawCuts: SceneCut[] = []
  let prevHist: Float32Array | null = null
  let maxDistance = 0

  for (let i = 0; i < totalSamples; i++) {
    if (signal?.aborted) break

    const time = i * sampleIntervalSec
    await seekVideo(video, time)

    ctx.drawImage(video, 0, 0, HIST_WIDTH, HIST_HEIGHT)
    const imageData = ctx.getImageData(0, 0, HIST_WIDTH, HIST_HEIGHT)
    const hist = computeHistogram(imageData.data)

    if (prevHist) {
      const distance = chiSquaredDistance(prevHist, hist)
      if (distance > maxDistance) maxDistance = distance

      if (distance >= threshold) {
        const frame = Math.round(time * fps)
        const motion: MotionResult = {
          totalMotion: distance,
          globalMotion: distance,
          localMotion: 0,
          isSceneCut: true,
          dominantDirection: 0,
          directionCoherence: 0,
        }
        rawCuts.push({ frame, time, motion })
      }
    }

    prevHist = hist

    onProgress?.({
      percent: ((i + 1) / totalSamples) * 100,
      currentSample: i,
      totalSamples,
      sceneCuts: rawCuts.length,
      stage: 'optical-flow', // reuse stage name for progress UI compatibility
    })
  }

  log.info('Histogram analysis complete', {
    totalSamples,
    maxDistance: maxDistance.toFixed(4),
    rawCuts: rawCuts.length,
    threshold,
  })

  // Deduplicate: keep strongest cut within each MIN_CUT_GAP_SEC window
  const deduped = deduplicateCuts(rawCuts, MIN_CUT_GAP_SEC)
  log.info('Deduplication complete', { cuts: deduped.length })

  return deduped
}
