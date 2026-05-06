/**
 * Scene Detection Service
 *
 * Two detection methods:
 * - `histogram` (default): Fast CPU-only color histogram comparison.
 * - `optical-flow`: GPU optical flow via WebGPU compute shaders.
 *
 * Optional VLM verification pass filters false positives.
 */

import { OpticalFlowAnalyzer } from './optical-flow-analyzer'
import type { MotionResult } from './optical-flow-analyzer'
import { ANALYSIS_WIDTH, ANALYSIS_HEIGHT } from './optical-flow-shaders'
import { detectScenesHistogram } from './histogram-scene-detection'
import { seekVideo, deduplicateCuts } from './scene-detection-utils'
import { getSceneVerificationProvider, type VerificationModel } from './verification/registry'
import type { SceneVerificationProvider } from './verification/types'
import { createLogger } from '@/shared/logging/logger'

const log = createLogger('SceneDetection')

export type { VerificationModel } from './verification/registry'

/**
 * In-memory cache of scene detection results keyed by
 * `${mediaId}:${method}:${sampleIntervalMs}:${verificationModel}`.
 * Survives across multiple detection runs within the same session.
 */
const resultsCache = new Map<string, SceneCut[]>()

/** Clear cached results for a specific media, or all if no id given. */
export function clearSceneCache(mediaId?: string): void {
  if (mediaId) {
    for (const key of resultsCache.keys()) {
      if (key.startsWith(`${mediaId}:`)) resultsCache.delete(key)
    }
  } else {
    resultsCache.clear()
  }
}

/** Default sampling interval in milliseconds (matches masterselects) */
const SAMPLE_INTERVAL_MS = 500

/** Minimum gap in seconds between scene cuts - prevents micro-segments from dissolves/pans */
const MIN_CUT_GAP_SEC = 2.0

/** Max dimension (longest side) for frames sent to the verification worker - preserves aspect ratio */
const VERIFY_MAX_DIM = 480

/** How far before the detected cut to sample the "before" frame (seconds) */
const VERIFY_BEFORE_OFFSET_SEC = 1.0

export interface SceneCut {
  /** Frame number where the scene cut occurs */
  frame: number
  /** Time in seconds */
  time: number
  /** Motion result at the cut point */
  motion: MotionResult
  /** Whether a verification model confirmed this as a real scene cut (undefined = not verified) */
  verified?: boolean
}

export interface SceneDetectionProgress {
  percent: number
  currentSample: number
  totalSamples: number
  sceneCuts: number
  /** Current stage of the pipeline */
  stage?: 'optical-flow' | 'loading-model' | 'verifying'
  /** Which verification model is being loaded/used */
  verificationModel?: VerificationModel
}

export interface DetectScenesOptions {
  /**
   * Detection method:
   * - `'histogram'` - fast CPU-only color histogram comparison (default).
   *    Best for hard cuts. No WebGPU required.
   * - `'optical-flow'` - GPU optical flow via WebGPU compute shaders.
   *    Detects more subtle transitions but requires WebGPU.
   */
  method?: 'histogram' | 'optical-flow'
  /** Time between samples in ms (default: 250 for histogram, 500 for optical-flow) */
  sampleIntervalMs?: number
  /** VLM to verify candidate cuts (default: undefined for histogram, 'gemma' for optical-flow) */
  verificationModel?: VerificationModel
  /** Progress callback */
  onProgress?: (progress: SceneDetectionProgress) => void
  /** AbortSignal for cancellation */
  signal?: AbortSignal
  /** Media ID for result caching - skip re-analysis when the same media is detected again */
  mediaId?: string
}

/**
 * Detect scene cuts in a video element.
 *
 * Uses `method` to select the detection strategy:
 * - `'histogram'` (default): fast CPU-only color histogram comparison
 * - `'optical-flow'`: GPU optical flow via WebGPU compute shaders
 *
 * Optional VLM verification pass (enabled by default for optical-flow)
 * filters false positives from camera pans, dissolves, etc.
 */
export async function detectScenes(
  video: HTMLVideoElement,
  fps: number,
  options: DetectScenesOptions = {},
): Promise<SceneCut[]> {
  const { method = 'histogram', onProgress, signal, mediaId } = options

  const sampleIntervalMs =
    options.sampleIntervalMs ?? (method === 'histogram' ? 250 : SAMPLE_INTERVAL_MS)
  const verificationModel =
    options.verificationModel ?? (method === 'optical-flow' ? 'gemma' : undefined)

  // Return cached results when available
  if (mediaId) {
    const cacheKey = `${mediaId}:${method}:${sampleIntervalMs}:${verificationModel ?? 'none'}`
    const cached = resultsCache.get(cacheKey)
    if (cached) {
      log.info('Returning cached scene detection results', { mediaId, cuts: cached.length })
      return cached
    }
  }

  let deduped: SceneCut[]

  if (method === 'histogram') {
    deduped = await detectScenesHistogram(video, fps, {
      sampleIntervalMs,
      onProgress,
      signal,
    })
  } else {
    deduped = await detectScenesOpticalFlow(video, fps, sampleIntervalMs, onProgress, signal)
  }

  const cacheKey = mediaId
    ? `${mediaId}:${method}:${sampleIntervalMs}:${verificationModel ?? 'none'}`
    : null
  const cacheAndReturn = (results: SceneCut[]): SceneCut[] => {
    if (cacheKey) resultsCache.set(cacheKey, results)
    return results
  }

  if (signal?.aborted) {
    return deduped
  }

  if (!verificationModel || deduped.length === 0) {
    return cacheAndReturn(deduped)
  }

  // Pass 2: VLM verification - gracefully fall back to optical-flow results on failure
  const verificationProvider = getSceneVerificationProvider(verificationModel)

  try {
    const verified = await verifyWithVlm(
      verificationProvider,
      video,
      deduped,
      verificationModel,
      onProgress,
      signal,
    )
    log.info('VLM verification complete', {
      model: verificationModel,
      confirmed: verified.length,
      candidates: deduped.length,
    })
    verificationProvider.disposeWorker()
    return cacheAndReturn(verified)
  } catch (err) {
    verificationProvider.resetWorker()
    if (signal?.aborted) {
      log.info('VLM verification aborted', { model: verificationModel })
      return deduped
    }
    log.warn('VLM verification failed, using optical flow results', {
      model: verificationModel,
      error: (err as Error).message,
    })
    return cacheAndReturn(deduped)
  }
}

/**
 * Pass 1 alternative: GPU optical flow detection.
 * Requires WebGPU - throws if unavailable.
 */
async function detectScenesOpticalFlow(
  video: HTMLVideoElement,
  fps: number,
  sampleIntervalMs: number,
  onProgress?: (progress: SceneDetectionProgress) => void,
  signal?: AbortSignal,
): Promise<SceneCut[]> {
  if (!navigator.gpu) {
    throw new Error('WebGPU not supported - optical-flow scene detection requires GPU')
  }

  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) throw new Error('No GPU adapter available')
  const device = await adapter.requestDevice()

  const analyzer = new OpticalFlowAnalyzer(device)

  const shaderOk = await analyzer.checkShaderCompilation()
  if (!shaderOk) {
    analyzer.destroy()
    device.destroy()
    throw new Error('Optical flow shader compilation failed - check console for details')
  }

  const sceneCuts: SceneCut[] = []
  const duration = video.duration
  const sampleIntervalSec = sampleIntervalMs / 1000
  const totalSamples = Math.ceil(duration / sampleIntervalSec)
  const canvas = new OffscreenCanvas(ANALYSIS_WIDTH, ANALYSIS_HEIGHT)
  const ctx = canvas.getContext('2d')!

  try {
    let maxMotionSeen = 0
    for (let i = 0; i < totalSamples; i++) {
      if (signal?.aborted) break

      const time = i * sampleIntervalSec
      await seekVideo(video, time)

      ctx.drawImage(video, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT)
      const bitmap = await createImageBitmap(canvas)

      const result = await analyzer.analyzeFrame(bitmap)
      bitmap.close()

      if (result.totalMotion > maxMotionSeen) {
        maxMotionSeen = result.totalMotion
      }

      if (result.isSceneCut) {
        const frame = Math.round(time * fps)
        sceneCuts.push({ frame, time, motion: result })
      }

      onProgress?.({
        percent: (i / totalSamples) * 100,
        currentSample: i,
        totalSamples,
        sceneCuts: sceneCuts.length,
        stage: 'optical-flow',
      })
    }
    log.info('Optical flow pass complete', {
      totalSamples,
      maxMotion: maxMotionSeen.toFixed(4),
      rawCuts: sceneCuts.length,
    })
  } finally {
    analyzer.destroy()
    device.destroy()
  }

  // Deduplicate: keep strongest cut within each MIN_CUT_GAP_SEC window
  const deduped = deduplicateCuts(sceneCuts, MIN_CUT_GAP_SEC)
  log.info('Deduplication complete', { cuts: deduped.length, minGapSec: MIN_CUT_GAP_SEC })
  return deduped
}

/**
 * Capture a video frame as a JPEG Blob for scene verification input.
 * Preserves the video's native aspect ratio, scaling so the longest
 * side fits within VERIFY_MAX_DIM.
 */
async function captureFrameBlob(video: HTMLVideoElement, timeSec: number): Promise<Blob> {
  await seekVideo(video, timeSec)

  const vw = video.videoWidth || 640
  const vh = video.videoHeight || 360
  const scale = Math.min(VERIFY_MAX_DIM / Math.max(vw, vh), 1)
  const w = Math.round(vw * scale)
  const h = Math.round(vh * scale)

  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(video, 0, 0, w, h)
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
}

/**
 * Pass 2: Verify candidate cuts with a VLM (Gemma or LFM) in a Web Worker
 * so model loading and inference do not block the main thread.
 */
async function verifyWithVlm(
  provider: SceneVerificationProvider,
  video: HTMLVideoElement,
  candidates: SceneCut[],
  verificationModel: VerificationModel,
  onProgress?: (progress: SceneDetectionProgress) => void,
  signal?: AbortSignal,
): Promise<SceneCut[]> {
  const worker = provider.getWorker()
  const modelLabel = provider.label

  // Wait for model to load (30s timeout for bootstrap + initial load handshake)
  await new Promise<void>((resolve, reject) => {
    const INACTIVITY_MS = 30_000
    let timeout = setTimeout(onTimeout, INACTIVITY_MS)

    function onTimeout() {
      worker.removeEventListener('message', onMsg)
      reject(new Error(`${modelLabel} worker init timed out after 30s of inactivity`))
    }

    const onMsg = (e: MessageEvent) => {
      const msg = e.data
      if (msg.type === 'ready') {
        clearTimeout(timeout)
        worker.removeEventListener('message', onMsg)
        resolve()
      } else if (msg.type === 'error') {
        clearTimeout(timeout)
        worker.removeEventListener('message', onMsg)
        reject(new Error(msg.message))
      } else if (msg.type === 'progress') {
        // Model is downloading - reset inactivity timeout
        clearTimeout(timeout)
        timeout = setTimeout(onTimeout, INACTIVITY_MS)
        onProgress?.({
          percent: msg.percent,
          currentSample: 0,
          totalSamples: candidates.length,
          sceneCuts: 0,
          stage: 'loading-model',
          verificationModel,
        })
      }
    }

    worker.addEventListener('message', onMsg)
    worker.postMessage({ type: 'init' })
  })

  if (signal?.aborted) return candidates

  const verified: SceneCut[] = []

  for (let i = 0; i < candidates.length; i++) {
    if (signal?.aborted) break

    const cut = candidates[i]!
    const beforeTime = Math.max(0, cut.time - VERIFY_BEFORE_OFFSET_SEC)

    onProgress?.({
      percent: (i / candidates.length) * 100,
      currentSample: i,
      totalSamples: candidates.length,
      sceneCuts: verified.length,
      stage: 'verifying',
      verificationModel,
    })

    // Serialize seeks - both mutate video.currentTime
    const beforeBlob = await captureFrameBlob(video, beforeTime)
    const afterBlob = await captureFrameBlob(video, cut.time)

    const result = await new Promise<{ isSceneCut: boolean; reason: string }>((resolve) => {
      const onMsg = (e: MessageEvent) => {
        if (e.data.type === 'debug') {
          log.info(`${modelLabel} worker debug`, e.data)
        } else if (e.data.type === 'result' && e.data.id === i) {
          worker.removeEventListener('message', onMsg)
          resolve({ isSceneCut: e.data.isSceneCut, reason: e.data.reason })
        } else if (e.data.type === 'error') {
          worker.removeEventListener('message', onMsg)
          resolve({ isSceneCut: false, reason: `worker error: ${e.data.message}` })
        }
      }

      worker.addEventListener('message', onMsg)
      worker.postMessage({ type: 'verify', id: i, before: beforeBlob, after: afterBlob })
    })

    log.info(`${modelLabel} candidate result`, {
      index: i,
      time: cut.time.toFixed(1),
      reason: result.reason,
    })

    if (result.isSceneCut) {
      verified.push({ ...cut, verified: true })
    }
  }

  return verified
}
