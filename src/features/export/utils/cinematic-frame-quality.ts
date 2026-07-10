import { clamp } from '@/shared/utils/math'

export type CinematicFrameQualityGrade = 'excellent' | 'strong' | 'fair' | 'weak'

export type CinematicFrameQualitySeverity = 'critical' | 'warning' | 'info'

export interface CinematicFrameSample {
  frame: number
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface CinematicFrameQualityIssue {
  id: string
  severity: CinematicFrameQualitySeverity
  message: string
}

export interface CinematicFrameQualityMetrics {
  sampleCount: number
  averageLuma: number
  lumaStdDev: number
  crushedBlackRatio: number
  darkRatio: number
  highlightRatio: number
  averageSharpness: number
  averageFrameDelta: number
  frameDeltaStdDev: number
  averageMotionMagnitude: number
  motionAxisBalance: number
  motionDirectionChangeRatio: number
  referenceMotionScore: number
}

export interface CinematicFrameQualityScore {
  score: number
  grade: CinematicFrameQualityGrade
  summary: string
  issues: CinematicFrameQualityIssue[]
  metrics: CinematicFrameQualityMetrics
}

export interface CinematicReferenceMotionProfile {
  id: string
  label: string
  source: string
  measured: {
    frameDeltaMean: number
    frameDeltaP90: number
    topWindowFrameDeltaRange: [number, number]
    motionMean: number
    motionP90: number
    topWindowMotionRange: [number, number]
    topWindowAxisBalanceRange: [number, number]
  }
  passScore: number
}

export interface SampleRenderedVideoQualityOptions {
  sampleCount?: number
  targetWidth?: number
  timeoutMs?: number
}

interface LumaStats {
  averageLuma: number
  lumaStdDev: number
  crushedBlackRatio: number
  darkRatio: number
  highlightRatio: number
}

interface QualityRule {
  applies: (metrics: CinematicFrameQualityMetrics) => boolean
  issue: CinematicFrameQualityIssue
  penalty: number
}

interface MotionVector {
  x: number
  y: number
  magnitude: number
}

const BLACK_CRUSH_LUMA = 16
const DARK_LUMA = 36
const HIGHLIGHT_LUMA = 235
const REFERENCE_SHADOW_CRUSH_LIMIT = 0.14
const REFERENCE_DARK_FRAME_LIMIT = 0.5
const DEFAULT_SAMPLE_COUNT = 6
const DEFAULT_TARGET_WIDTH = 160
const DEFAULT_TIMEOUT_MS = 12000
export const CAPCUT_PARALLAX_REFERENCE_PROFILE: CinematicReferenceMotionProfile = {
  id: 'capcut-3d-parallax-reference',
  label: 'CapCut 3D parallax reference',
  source: 'Create Amazing 3D PARALLAX Effect in CapCut-854x480-mp4a.mp4',
  measured: {
    frameDeltaMean: 11.12,
    frameDeltaP90: 39.38,
    topWindowFrameDeltaRange: [45, 56],
    motionMean: 1.213,
    motionP90: 4.431,
    topWindowMotionRange: [4.5, 6],
    topWindowAxisBalanceRange: [0.65, 0.86],
  },
  passScore: 6.6,
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10
}

function scoreRange(params: {
  value: number
  min: number
  idealMin: number
  idealMax: number
  max: number
}): number {
  const { value, min, idealMin, idealMax, max } = params
  if (!Number.isFinite(value) || value <= min || value >= max) return 0
  if (value >= idealMin && value <= idealMax) return 1
  if (value < idealMin) return clamp((value - min) / Math.max(1e-6, idealMin - min), 0, 1)
  return clamp((max - value) / Math.max(1e-6, max - idealMax), 0, 1)
}

function gradeForScore(score: number): CinematicFrameQualityGrade {
  if (score >= 8.5) return 'excellent'
  if (score >= 7) return 'strong'
  if (score >= 5) return 'fair'
  return 'weak'
}

function summaryForGrade(grade: CinematicFrameQualityGrade): string {
  switch (grade) {
    case 'excellent':
      return 'Rendered frames look sharp, balanced, and cinematic.'
    case 'strong':
      return 'Rendered frames are solid with only minor finishing concerns.'
    case 'fair':
      return 'Rendered frames need a finishing pass before they feel premium.'
    case 'weak':
      return 'Rendered frames risk looking soft, flat, or under-directed.'
  }
}

function issue(
  id: string,
  severity: CinematicFrameQualitySeverity,
  message: string,
): CinematicFrameQualityIssue {
  return { id, severity, message }
}

const QUALITY_RULES: QualityRule[] = [
  {
    applies: (metrics) => metrics.averageSharpness < 4,
    issue: issue('soft-render', 'critical', 'The sampled frames look soft or blurry.'),
    penalty: 3,
  },
  {
    applies: (metrics) => metrics.averageSharpness >= 4 && metrics.averageSharpness < 8,
    issue: issue('low-sharpness', 'warning', 'The export could use a sharper finishing pass.'),
    penalty: 1.4,
  },
  {
    applies: (metrics) => metrics.crushedBlackRatio > 0.35,
    issue: issue('crushed-blacks', 'critical', 'Blacks are heavily crushed in the render.'),
    penalty: 2.2,
  },
  {
    applies: (metrics) => metrics.crushedBlackRatio > 0.22 && metrics.crushedBlackRatio <= 0.35,
    issue: issue('deep-blacks', 'warning', 'The render has very deep blacks.'),
    penalty: 1,
  },
  {
    applies: (metrics) =>
      metrics.crushedBlackRatio > REFERENCE_SHADOW_CRUSH_LIMIT && metrics.crushedBlackRatio <= 0.22,
    issue: issue(
      'reference-shadow-crush',
      'warning',
      'Blacks are deeper than the measured parallax references and may look muddy.',
    ),
    penalty: 0.7,
  },
  {
    applies: (metrics) => metrics.darkRatio > 0.62,
    issue: issue('too-dark', 'warning', 'A large portion of the frame is very dark.'),
    penalty: 1.1,
  },
  {
    applies: (metrics) =>
      metrics.darkRatio > REFERENCE_DARK_FRAME_LIMIT && metrics.darkRatio <= 0.62,
    issue: issue(
      'reference-shadows-too-heavy',
      'warning',
      'The frame is darker than the uploaded parallax references.',
    ),
    penalty: 0.6,
  },
  {
    applies: (metrics) => metrics.lumaStdDev < 18,
    issue: issue('flat-contrast', 'warning', 'The render has low contrast and may feel flat.'),
    penalty: 1.2,
  },
  {
    applies: (metrics) => metrics.highlightRatio > 0.18,
    issue: issue('hot-highlights', 'info', 'Highlights are close to clipping in the render.'),
    penalty: 0.5,
  },
  {
    applies: (metrics) => metrics.sampleCount > 1 && metrics.averageFrameDelta < 1.8,
    issue: issue('weak-motion', 'warning', 'Frame-to-frame motion reads too subtle.'),
    penalty: 1.5,
  },
  {
    applies: (metrics) => metrics.averageFrameDelta > 55,
    issue: issue('jumpy-motion', 'info', 'Frame-to-frame motion may feel abrupt or overcut.'),
    penalty: 0.7,
  },
  {
    applies: (metrics) =>
      metrics.sampleCount > 2 &&
      metrics.averageMotionMagnitude > 0.4 &&
      metrics.motionAxisBalance < 0.12 &&
      metrics.motionDirectionChangeRatio < 0.25 &&
      metrics.frameDeltaStdDev < 8,
    issue: issue(
      'single-axis-motion',
      'warning',
      'Motion reads like a single pan instead of a staged cinematic camera move.',
    ),
    penalty: 1,
  },
  {
    applies: (metrics) =>
      metrics.sampleCount > 2 &&
      metrics.referenceMotionScore < CAPCUT_PARALLAX_REFERENCE_PROFILE.passScore,
    issue: issue(
      'reference-motion-too-soft',
      'warning',
      'Motion lacks the dramatic push-plus-pan/tilt energy of the reference style.',
    ),
    penalty: 1.2,
  },
]

function getLuma(data: Uint8ClampedArray, offset: number): number {
  return (
    (data[offset] ?? 0) * 0.2126 +
    (data[offset + 1] ?? 0) * 0.7152 +
    (data[offset + 2] ?? 0) * 0.0722
  )
}

function getStride(width: number, height: number): number {
  return Math.max(1, Math.floor(Math.sqrt((width * height) / 12000)))
}

function collectLumas(sample: CinematicFrameSample): number[] {
  const lumas: number[] = []
  const stride = getStride(sample.width, sample.height)

  for (let y = 0; y < sample.height; y += stride) {
    for (let x = 0; x < sample.width; x += stride) {
      lumas.push(getLuma(sample.data, (y * sample.width + x) * 4))
    }
  }

  return lumas
}

function analyzeLuma(samples: CinematicFrameSample[]): LumaStats {
  const lumas = samples.flatMap(collectLumas)
  if (lumas.length === 0) {
    return {
      averageLuma: 0,
      lumaStdDev: 0,
      crushedBlackRatio: 0,
      darkRatio: 0,
      highlightRatio: 0,
    }
  }

  const sum = lumas.reduce((total, luma) => total + luma, 0)
  const averageLuma = sum / lumas.length
  const variance =
    lumas.reduce((total, luma) => total + (luma - averageLuma) ** 2, 0) / lumas.length

  return {
    averageLuma,
    lumaStdDev: Math.sqrt(variance),
    crushedBlackRatio: lumas.filter((luma) => luma <= BLACK_CRUSH_LUMA).length / lumas.length,
    darkRatio: lumas.filter((luma) => luma <= DARK_LUMA).length / lumas.length,
    highlightRatio: lumas.filter((luma) => luma >= HIGHLIGHT_LUMA).length / lumas.length,
  }
}

function measureSharpness(sample: CinematicFrameSample): number {
  if (sample.width < 2 || sample.height < 2) return 0

  const stride = getStride(sample.width, sample.height)
  let total = 0
  let count = 0

  for (let y = 0; y < sample.height - stride; y += stride) {
    for (let x = 0; x < sample.width - stride; x += stride) {
      const offset = (y * sample.width + x) * 4
      const rightOffset = (y * sample.width + x + stride) * 4
      const downOffset = ((y + stride) * sample.width + x) * 4
      const luma = getLuma(sample.data, offset)
      total += Math.abs(luma - getLuma(sample.data, rightOffset))
      total += Math.abs(luma - getLuma(sample.data, downOffset))
      count += 2
    }
  }

  return count > 0 ? total / count : 0
}

function measureFrameDelta(left: CinematicFrameSample, right: CinematicFrameSample): number {
  const width = Math.min(left.width, right.width)
  const height = Math.min(left.height, right.height)
  if (width < 1 || height < 1) return 0

  const stride = getStride(width, height)
  let total = 0
  let count = 0

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const leftOffset = (y * left.width + x) * 4
      const rightOffset = (y * right.width + x) * 4
      total += Math.abs(getLuma(left.data, leftOffset) - getLuma(right.data, rightOffset))
      count += 1
    }
  }

  return count > 0 ? total / count : 0
}

function shiftedLumaError(
  left: CinematicFrameSample,
  right: CinematicFrameSample,
  dx: number,
  dy: number,
): number {
  const width = Math.min(left.width, right.width)
  const height = Math.min(left.height, right.height)
  const stride = getStride(width, height)
  let total = 0
  let count = 0

  for (let y = Math.max(0, -dy); y < height - Math.max(0, dy); y += stride) {
    for (let x = Math.max(0, -dx); x < width - Math.max(0, dx); x += stride) {
      const leftOffset = (y * left.width + x) * 4
      const rightOffset = ((y + dy) * right.width + x + dx) * 4
      total += Math.abs(getLuma(left.data, leftOffset) - getLuma(right.data, rightOffset))
      count += 1
    }
  }

  return count > 0 ? total / count : Number.POSITIVE_INFINITY
}

function estimateMotionVector(
  left: CinematicFrameSample,
  right: CinematicFrameSample,
): MotionVector {
  let bestX = 0
  let bestY = 0
  let bestError = Number.POSITIVE_INFINITY

  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const error = shiftedLumaError(left, right, dx, dy)
      if (error < bestError) {
        bestError = error
        bestX = dx
        bestY = dy
      }
    }
  }

  return { x: bestX, y: bestY, magnitude: Math.hypot(bestX, bestY) }
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0
  const mean = average(values)
  return Math.sqrt(values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length)
}

function motionAxisBalance(vectors: MotionVector[]): number {
  const averageX = average(vectors.map((vector) => Math.abs(vector.x)))
  const averageY = average(vectors.map((vector) => Math.abs(vector.y)))
  const dominant = Math.max(averageX, averageY)
  if (dominant <= 0) return 1
  return Math.min(averageX, averageY) / dominant
}

function motionDirectionChangeRatio(vectors: MotionVector[]): number {
  if (vectors.length < 2) return 0
  let changes = 0
  let comparisons = 0

  for (let index = 1; index < vectors.length; index += 1) {
    const previous = vectors[index - 1]!
    const current = vectors[index]!
    if (previous.magnitude < 0.25 || current.magnitude < 0.25) continue
    comparisons += 1

    const dot = previous.x * current.x + previous.y * current.y
    const cosine = clamp(dot / (previous.magnitude * current.magnitude), -1, 1)
    const angleDegrees = (Math.acos(cosine) * 180) / Math.PI
    if (angleDegrees >= 20) changes += 1
  }

  return comparisons > 0 ? changes / comparisons : 0
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((total, value) => total + value, 0) / values.length
}

export function calculateReferenceMotionScore(
  metrics: Pick<
    CinematicFrameQualityMetrics,
    | 'sampleCount'
    | 'averageFrameDelta'
    | 'frameDeltaStdDev'
    | 'averageMotionMagnitude'
    | 'motionAxisBalance'
    | 'motionDirectionChangeRatio'
  >,
): number {
  if (metrics.sampleCount < 3) return 0

  const visibleMotion = scoreRange({
    value: metrics.averageFrameDelta,
    min: 2.4,
    idealMin: CAPCUT_PARALLAX_REFERENCE_PROFILE.measured.frameDeltaMean,
    idealMax: CAPCUT_PARALLAX_REFERENCE_PROFILE.measured.topWindowFrameDeltaRange[1],
    max: 72,
  })
  const motionEnergy = scoreRange({
    value: metrics.averageMotionMagnitude,
    min: 0.45,
    idealMin: CAPCUT_PARALLAX_REFERENCE_PROFILE.measured.motionMean,
    idealMax: CAPCUT_PARALLAX_REFERENCE_PROFILE.measured.topWindowMotionRange[1],
    max: 7.4,
  })
  const multiAxis = clamp(
    metrics.motionAxisBalance /
      CAPCUT_PARALLAX_REFERENCE_PROFILE.measured.topWindowAxisBalanceRange[0],
    0,
    1,
  )
  const stagedTiming = Math.max(
    clamp(metrics.motionDirectionChangeRatio / 0.4, 0, 1),
    clamp(metrics.frameDeltaStdDev / 9.5, 0, 1),
  )

  return roundMetric(
    (visibleMotion * 0.32 + motionEnergy * 0.24 + multiAxis * 0.22 + stagedTiming * 0.22) * 10,
  )
}

function calculateMetrics(samples: CinematicFrameSample[]): CinematicFrameQualityMetrics {
  const lumaStats = analyzeLuma(samples)
  const sharpnessValues = samples.map(measureSharpness)
  const deltaValues = samples
    .slice(1)
    .map((sample, index) => measureFrameDelta(samples[index]!, sample))
  const motionVectors = samples
    .slice(1)
    .map((sample, index) => estimateMotionVector(samples[index]!, sample))

  const baseMetrics = {
    ...lumaStats,
    sampleCount: samples.length,
    averageSharpness: average(sharpnessValues),
    averageFrameDelta: average(deltaValues),
    frameDeltaStdDev: standardDeviation(deltaValues),
    averageMotionMagnitude: average(motionVectors.map((vector) => vector.magnitude)),
    motionAxisBalance: motionAxisBalance(motionVectors),
    motionDirectionChangeRatio: motionDirectionChangeRatio(motionVectors),
  }

  return {
    ...baseMetrics,
    referenceMotionScore: calculateReferenceMotionScore(baseMetrics),
  }
}

function buildIssues(metrics: CinematicFrameQualityMetrics): CinematicFrameQualityIssue[] {
  if (metrics.sampleCount === 0) {
    return [issue('no-samples', 'critical', 'No rendered frames could be sampled from the export.')]
  }

  return QUALITY_RULES.filter((rule) => rule.applies(metrics)).map((rule) => rule.issue)
}

function penaltyForMetrics(metrics: CinematicFrameQualityMetrics): number {
  if (metrics.sampleCount === 0) return 10
  return QUALITY_RULES.reduce(
    (total, rule) => total + (rule.applies(metrics) ? rule.penalty : 0),
    0,
  )
}

export function scoreCinematicFrameQuality(
  samples: CinematicFrameSample[],
): CinematicFrameQualityScore {
  const metrics = calculateMetrics(samples)
  const score = roundMetric(clamp(10 - penaltyForMetrics(metrics), 0, 10))
  const grade = gradeForScore(score)

  return {
    score,
    grade,
    summary: summaryForGrade(grade),
    issues: buildIssues(metrics),
    metrics: {
      sampleCount: metrics.sampleCount,
      averageLuma: roundMetric(metrics.averageLuma),
      lumaStdDev: roundMetric(metrics.lumaStdDev),
      crushedBlackRatio: roundMetric(metrics.crushedBlackRatio * 100) / 100,
      darkRatio: roundMetric(metrics.darkRatio * 100) / 100,
      highlightRatio: roundMetric(metrics.highlightRatio * 100) / 100,
      averageSharpness: roundMetric(metrics.averageSharpness),
      averageFrameDelta: roundMetric(metrics.averageFrameDelta),
      frameDeltaStdDev: roundMetric(metrics.frameDeltaStdDev),
      averageMotionMagnitude: roundMetric(metrics.averageMotionMagnitude),
      motionAxisBalance: roundMetric(metrics.motionAxisBalance * 100) / 100,
      motionDirectionChangeRatio: roundMetric(metrics.motionDirectionChangeRatio * 100) / 100,
      referenceMotionScore: roundMetric(metrics.referenceMotionScore),
    },
  }
}

function once(target: EventTarget, eventName: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for ${eventName}`))
    }, timeoutMs)
    const onEvent = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error(`Failed while waiting for ${eventName}`))
    }
    const cleanup = () => {
      window.clearTimeout(timeout)
      target.removeEventListener(eventName, onEvent)
      target.removeEventListener('error', onError)
    }

    target.addEventListener(eventName, onEvent, { once: true })
    target.addEventListener('error', onError, { once: true })
  })
}

function getSampleTimes(duration: number, sampleCount: number): number[] {
  const count = clamp(Math.round(sampleCount), 2, 10)
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 1
  return Array.from({ length: count }, (_, index) => {
    const progress = count === 1 ? 0.5 : (index + 0.5) / count
    return clamp(progress * safeDuration, 0, Math.max(0, safeDuration - 0.04))
  })
}

async function seekVideo(video: HTMLVideoElement, timeSeconds: number, timeoutMs: number) {
  if (Math.abs(video.currentTime - timeSeconds) < 0.01) return
  const seeked = once(video, 'seeked', timeoutMs)
  video.currentTime = timeSeconds
  await seeked
}

export async function sampleRenderedVideoQuality(
  src: string,
  options: SampleRenderedVideoQualityOptions = {},
): Promise<CinematicFrameQualityScore> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.muted = true
  video.playsInline = true
  video.src = src

  await once(video, 'loadedmetadata', timeoutMs)

  const sourceWidth = video.videoWidth || DEFAULT_TARGET_WIDTH
  const sourceHeight = video.videoHeight || DEFAULT_TARGET_WIDTH
  const targetWidth = clamp(Math.round(options.targetWidth ?? DEFAULT_TARGET_WIDTH), 64, 320)
  const targetHeight = Math.max(
    1,
    Math.round((sourceHeight / Math.max(1, sourceWidth)) * targetWidth),
  )
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Could not sample rendered video frames.')

  const samples: CinematicFrameSample[] = []
  const sampleTimes = getSampleTimes(video.duration, options.sampleCount ?? DEFAULT_SAMPLE_COUNT)

  for (const [index, timeSeconds] of sampleTimes.entries()) {
    await seekVideo(video, timeSeconds, timeoutMs)
    context.drawImage(video, 0, 0, targetWidth, targetHeight)
    const image = context.getImageData(0, 0, targetWidth, targetHeight)
    samples.push({
      frame: index,
      width: targetWidth,
      height: targetHeight,
      data: image.data,
    })
  }

  video.removeAttribute('src')
  video.load()
  return scoreCinematicFrameQuality(samples)
}
