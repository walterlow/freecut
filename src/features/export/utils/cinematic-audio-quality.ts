import { clamp } from '@/shared/utils/math'

export type CinematicAudioQualityGrade = 'excellent' | 'strong' | 'fair' | 'weak'

export type CinematicAudioQualitySeverity = 'critical' | 'warning' | 'info'

export interface CinematicAudioBufferInput {
  sampleRate: number
  channels: readonly Float32Array[]
  durationSeconds?: number
}

export interface CinematicAudioQualityIssue {
  id: string
  severity: CinematicAudioQualitySeverity
  message: string
}

export interface CinematicAudioQualityMetrics {
  durationSeconds: number
  channelCount: number
  peakDb: number
  rmsDb: number
  dynamicRangeDb: number
  silenceRatio: number
  clippedRatio: number
  stereoSpread: number
}

export interface CinematicAudioQualityScore {
  score: number
  grade: CinematicAudioQualityGrade
  summary: string
  issues: CinematicAudioQualityIssue[]
  metrics: CinematicAudioQualityMetrics
}

export interface SampleRenderedAudioQualityOptions {
  maxDecodeBytes?: number
}

interface AudioQualityRule {
  applies: (metrics: CinematicAudioQualityMetrics) => boolean
  issue: CinematicAudioQualityIssue
  penalty: number
}

const DEFAULT_MAX_DECODE_BYTES = 220 * 1024 * 1024
const MAX_ANALYSIS_SAMPLES = 900_000
const SILENCE_RMS_THRESHOLD = 0.006
const CLIP_THRESHOLD = 0.995
const BLOCK_SECONDS = 0.4
const MIN_DB = -120

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10
}

function amplitudeToDb(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return MIN_DB
  return Math.max(MIN_DB, 20 * Math.log10(value))
}

function gradeForScore(score: number): CinematicAudioQualityGrade {
  if (score >= 8.5) return 'excellent'
  if (score >= 7) return 'strong'
  if (score >= 5) return 'fair'
  return 'weak'
}

function summaryForGrade(grade: CinematicAudioQualityGrade): string {
  switch (grade) {
    case 'excellent':
      return 'Exported audio is loud, controlled, and cinematic.'
    case 'strong':
      return 'Exported audio is solid with only minor mix concerns.'
    case 'fair':
      return 'Exported audio needs a mix pass before it feels premium.'
    case 'weak':
      return 'Exported audio risks sounding quiet, clipped, flat, or unfinished.'
  }
}

function issue(
  id: string,
  severity: CinematicAudioQualitySeverity,
  message: string,
): CinematicAudioQualityIssue {
  return { id, severity, message }
}

const AUDIO_RULES: AudioQualityRule[] = [
  {
    applies: (metrics) => metrics.clippedRatio > 0.001 || metrics.peakDb > -0.1,
    issue: issue('clipping-risk', 'critical', 'The final mix is clipping or hitting the ceiling.'),
    penalty: 3,
  },
  {
    applies: (metrics) => metrics.rmsDb < -26,
    issue: issue('too-quiet', 'critical', 'The final mix is too quiet for a cinematic export.'),
    penalty: 3.2,
  },
  {
    applies: (metrics) => metrics.rmsDb >= -26 && metrics.rmsDb < -22,
    issue: issue('quiet-mix', 'warning', 'The final mix may feel underpowered.'),
    penalty: 1.2,
  },
  {
    applies: (metrics) => metrics.rmsDb > -11,
    issue: issue('too-loud', 'warning', 'The final mix may feel over-limited or fatiguing.'),
    penalty: 1.2,
  },
  {
    applies: (metrics) => metrics.dynamicRangeDb < 6,
    issue: issue('flat-dynamics', 'warning', 'The final mix has very little dynamic movement.'),
    penalty: 1.4,
  },
  {
    applies: (metrics) => metrics.dynamicRangeDb > 30,
    issue: issue('uneven-dynamics', 'info', 'The final mix has very large loudness swings.'),
    penalty: 0.6,
  },
  {
    applies: (metrics) => metrics.silenceRatio > 0.18,
    issue: issue('dead-air', 'warning', 'The export contains too many near-silent sections.'),
    penalty: 1.1,
  },
  {
    applies: (metrics) => metrics.channelCount < 2 || metrics.stereoSpread < 0.015,
    issue: issue('narrow-mix', 'info', 'The final mix is very narrow or mono.'),
    penalty: 0.8,
  },
]

function analysisStride(length: number): number {
  return Math.max(1, Math.ceil(length / MAX_ANALYSIS_SAMPLES))
}

function getSampleAt(
  channels: readonly Float32Array[],
  channelIndex: number,
  index: number,
): number {
  return channels[channelIndex]?.[index] ?? 0
}

function measurePeakAndRms(input: CinematicAudioBufferInput) {
  const length = input.channels[0]?.length ?? 0
  const stride = analysisStride(length)
  let peak = 0
  let sumSquares = 0
  let clipped = 0
  let count = 0

  for (let index = 0; index < length; index += stride) {
    for (let channel = 0; channel < input.channels.length; channel += 1) {
      const sample = Math.abs(getSampleAt(input.channels, channel, index))
      peak = Math.max(peak, sample)
      sumSquares += sample * sample
      clipped += sample >= CLIP_THRESHOLD ? 1 : 0
      count += 1
    }
  }

  return {
    peak,
    rms: count > 0 ? Math.sqrt(sumSquares / count) : 0,
    clippedRatio: count > 0 ? clipped / count : 0,
  }
}

function blockRms(input: CinematicAudioBufferInput, start: number, end: number): number {
  let sumSquares = 0
  let count = 0

  for (let index = start; index < end; index += 1) {
    for (let channel = 0; channel < input.channels.length; channel += 1) {
      const sample = getSampleAt(input.channels, channel, index)
      sumSquares += sample * sample
      count += 1
    }
  }

  return count > 0 ? Math.sqrt(sumSquares / count) : 0
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[clamp(Math.round((sorted.length - 1) * ratio), 0, sorted.length - 1)] ?? 0
}

function measureDynamicRange(input: CinematicAudioBufferInput) {
  const length = input.channels[0]?.length ?? 0
  const blockSize = Math.max(1, Math.round(input.sampleRate * BLOCK_SECONDS))
  const blockValues: number[] = []
  let silentBlocks = 0

  for (let start = 0; start < length; start += blockSize) {
    const rms = blockRms(input, start, Math.min(length, start + blockSize))
    blockValues.push(amplitudeToDb(rms))
    silentBlocks += rms < SILENCE_RMS_THRESHOLD ? 1 : 0
  }

  return {
    dynamicRangeDb: percentile(blockValues, 0.95) - percentile(blockValues, 0.1),
    silenceRatio: blockValues.length > 0 ? silentBlocks / blockValues.length : 0,
  }
}

function measureStereoSpread(input: CinematicAudioBufferInput): number {
  const length = input.channels[0]?.length ?? 0
  if (input.channels.length < 2 || length === 0) return 0

  const stride = analysisStride(length)
  let sideSum = 0
  let midSum = 0

  for (let index = 0; index < length; index += stride) {
    const left = getSampleAt(input.channels, 0, index)
    const right = getSampleAt(input.channels, 1, index)
    sideSum += Math.abs(left - right)
    midSum += Math.abs(left + right)
  }

  return midSum > 0 ? sideSum / midSum : 0
}

function getDurationSeconds(input: CinematicAudioBufferInput): number {
  const fallback = (input.channels[0]?.length ?? 0) / Math.max(1, input.sampleRate)
  return Math.max(0, input.durationSeconds ?? fallback)
}

function calculateMetrics(input: CinematicAudioBufferInput): CinematicAudioQualityMetrics {
  const peakAndRms = measurePeakAndRms(input)
  const dynamic = measureDynamicRange(input)

  return {
    durationSeconds: getDurationSeconds(input),
    channelCount: input.channels.length,
    peakDb: amplitudeToDb(peakAndRms.peak),
    rmsDb: amplitudeToDb(peakAndRms.rms),
    dynamicRangeDb: dynamic.dynamicRangeDb,
    silenceRatio: dynamic.silenceRatio,
    clippedRatio: peakAndRms.clippedRatio,
    stereoSpread: measureStereoSpread(input),
  }
}

function buildIssues(metrics: CinematicAudioQualityMetrics): CinematicAudioQualityIssue[] {
  return AUDIO_RULES.filter((rule) => rule.applies(metrics)).map((rule) => rule.issue)
}

function penaltyForMetrics(metrics: CinematicAudioQualityMetrics): number {
  return AUDIO_RULES.reduce((total, rule) => total + (rule.applies(metrics) ? rule.penalty : 0), 0)
}

function roundMetrics(metrics: CinematicAudioQualityMetrics): CinematicAudioQualityMetrics {
  return {
    durationSeconds: roundMetric(metrics.durationSeconds),
    channelCount: metrics.channelCount,
    peakDb: roundMetric(metrics.peakDb),
    rmsDb: roundMetric(metrics.rmsDb),
    dynamicRangeDb: roundMetric(metrics.dynamicRangeDb),
    silenceRatio: roundMetric(metrics.silenceRatio * 100) / 100,
    clippedRatio: roundMetric(metrics.clippedRatio * 10000) / 10000,
    stereoSpread: roundMetric(metrics.stereoSpread * 100) / 100,
  }
}

export function scoreCinematicAudioQuality(
  input: CinematicAudioBufferInput,
): CinematicAudioQualityScore {
  const metrics = calculateMetrics(input)
  const score = roundMetric(clamp(10 - penaltyForMetrics(metrics), 0, 10))
  const grade = gradeForScore(score)

  return {
    score,
    grade,
    summary: summaryForGrade(grade),
    issues: buildIssues(metrics),
    metrics: roundMetrics(metrics),
  }
}

function getAudioContextCtor(): typeof AudioContext | null {
  return globalThis.AudioContext ?? null
}

function audioBufferToInput(buffer: AudioBuffer): CinematicAudioBufferInput {
  return {
    sampleRate: buffer.sampleRate,
    durationSeconds: buffer.duration,
    channels: Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
      buffer.getChannelData(channel),
    ),
  }
}

export async function sampleRenderedAudioQuality(
  blob: Blob,
  options: SampleRenderedAudioQualityOptions = {},
): Promise<CinematicAudioQualityScore> {
  if (blob.size > (options.maxDecodeBytes ?? DEFAULT_MAX_DECODE_BYTES)) {
    throw new Error('Rendered audio is too large to analyze in-browser.')
  }

  const AudioContextCtor = getAudioContextCtor()
  if (!AudioContextCtor) throw new Error('AudioContext is unavailable.')

  const context = new AudioContextCtor()
  try {
    const source = await blob.arrayBuffer()
    const decoded = await context.decodeAudioData(source.slice(0))
    return scoreCinematicAudioQuality(audioBufferToInput(decoded))
  } finally {
    await context.close().catch(() => undefined)
  }
}
