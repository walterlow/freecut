import type {
  FillerAudioConfidence,
  FillerRange,
  FillerRangesByMediaId,
} from './filler-word-removal-preview'
import { getOrDecodeAudio } from '@/features/timeline/deps/composition-runtime'
import { resolveMediaUrl } from '@/features/timeline/deps/media-library-resolver'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('FillerAudioConfidence')

const CLAP_MODEL_ID = 'Xenova/clap-htsat-unfused'
const CLAP_SAMPLE_RATE = 48_000
const MIN_AUDIO_WINDOW_SEC = 0.35
const WINDOW_CONTEXT_SEC = 0.08
const MAX_CONCURRENT_SCORES = 2

const FILLER_LABELS = [
  'filler word',
  'hesitation sound',
  'person saying um',
  'person saying uh',
  'person hesitating while speaking',
] as const

const NON_FILLER_LABELS = ['normal speech', 'silence', 'music', 'background noise'] as const
const CANDIDATE_LABELS = [...FILLER_LABELS, ...NON_FILLER_LABELS]

type ZeroShotAudioClassifier = (
  audio: Float32Array,
  labels: readonly string[],
  options?: { hypothesis_template?: string },
) => Promise<Array<{ label: string; score: number }>>

type TransformersModule = {
  env: {
    useBrowserCache: boolean
    allowLocalModels: boolean
  }
  pipeline: (
    task: 'zero-shot-audio-classification',
    model: string,
    options?: {
      device?: 'webgpu' | 'wasm'
      dtype?: string
    },
  ) => Promise<ZeroShotAudioClassifier>
}

let classifierPromise: Promise<ZeroShotAudioClassifier> | null = null
const SCORE_CACHE_MAX_ENTRIES = 500
const scoreCache = new Map<string, FillerAudioConfidence>()

function getRangeCacheKey(mediaId: string, range: FillerRange): string {
  return `${mediaId}:${range.start.toFixed(3)}:${range.end.toFixed(3)}:${range.text}`
}

function getCachedScore(cacheKey: string): FillerAudioConfidence | undefined {
  const cached = scoreCache.get(cacheKey)
  if (cached === undefined) return undefined
  scoreCache.delete(cacheKey)
  scoreCache.set(cacheKey, cached)
  return cached
}

function setCachedScore(cacheKey: string, confidence: FillerAudioConfidence): void {
  if (scoreCache.size >= SCORE_CACHE_MAX_ENTRIES) {
    const oldestKey = scoreCache.keys().next().value
    if (oldestKey !== undefined) scoreCache.delete(oldestKey)
  }
  scoreCache.set(cacheKey, confidence)
}

async function getClassifier(): Promise<ZeroShotAudioClassifier> {
  if (classifierPromise) {
    return classifierPromise
  }

  classifierPromise = (async () => {
    const { env, pipeline } = (await import('@huggingface/transformers')) as TransformersModule
    env.useBrowserCache = true
    env.allowLocalModels = false

    try {
      return await pipeline('zero-shot-audio-classification', CLAP_MODEL_ID, {
        device: 'webgpu',
        dtype: 'q8',
      })
    } catch (error) {
      logger.warn('CLAP WebGPU initialization failed, falling back to WASM', {
        error,
      })
      return pipeline('zero-shot-audio-classification', CLAP_MODEL_ID, {
        device: 'wasm',
        dtype: 'q8',
      })
    }
  })()

  try {
    return await classifierPromise
  } catch (error) {
    classifierPromise = null
    throw error
  }
}

function mixDownToMono(buffer: AudioBuffer, startSec: number, endSec: number): Float32Array {
  const sampleRate = buffer.sampleRate
  const startSample = Math.max(0, Math.floor(startSec * sampleRate))
  const endSample = Math.min(buffer.length, Math.ceil(endSec * sampleRate))
  const length = Math.max(1, endSample - startSample)
  const output = new Float32Array(length)

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i += 1) {
      output[i] = (output[i] ?? 0) + (data[startSample + i] ?? 0)
    }
  }

  const gain = 1 / Math.max(1, buffer.numberOfChannels)
  for (let i = 0; i < output.length; i += 1) {
    output[i] = (output[i] ?? 0) * gain
  }

  return output
}

function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) {
    return input
  }

  const outputLength = Math.max(1, Math.round((input.length * toRate) / fromRate))
  const output = new Float32Array(outputLength)
  const ratio = fromRate / toRate

  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * ratio
    const leftIndex = Math.floor(sourceIndex)
    const rightIndex = Math.min(input.length - 1, leftIndex + 1)
    const mix = sourceIndex - leftIndex
    const left = input[leftIndex] ?? 0
    const right = input[rightIndex] ?? left
    output[i] = left + (right - left) * mix
  }

  return output
}

function getRangeAudio(buffer: AudioBuffer, range: FillerRange): Float32Array {
  const midpoint = (range.start + range.end) / 2
  const halfWindow = Math.max(MIN_AUDIO_WINDOW_SEC, range.end - range.start) / 2
  const start = Math.max(0, midpoint - halfWindow - WINDOW_CONTEXT_SEC)
  const end = Math.min(buffer.duration, midpoint + halfWindow + WINDOW_CONTEXT_SEC)
  const mono = mixDownToMono(buffer, start, end)
  return resampleLinear(mono, buffer.sampleRate, CLAP_SAMPLE_RATE)
}

function classifyConfidence(
  scores: Array<{ label: string; score: number }>,
): FillerAudioConfidence {
  const fillerScores = scores.filter((score) => FILLER_LABELS.includes(score.label as never))
  const nonFillerScores = scores.filter((score) => NON_FILLER_LABELS.includes(score.label as never))
  const bestFiller = fillerScores.toSorted((left, right) => right.score - left.score)[0]
  const bestNonFiller = nonFillerScores.toSorted((left, right) => right.score - left.score)[0]
  const fillerScore = bestFiller?.score ?? 0
  const nonFillerScore = bestNonFiller?.score ?? 0
  const margin = fillerScore - nonFillerScore

  const level =
    fillerScore >= 0.42 && margin >= 0.12
      ? 'high'
      : fillerScore >= 0.28 && margin >= 0.02
        ? 'medium'
        : 'low'

  return {
    level,
    score: fillerScore,
    fillerScore,
    nonFillerScore,
    label: bestFiller?.label ?? 'filler word',
  }
}

async function scoreOneRange(
  classifier: ZeroShotAudioClassifier,
  audioBuffer: AudioBuffer,
  mediaId: string,
  range: FillerRange,
): Promise<FillerRange> {
  const cacheKey = getRangeCacheKey(mediaId, range)
  const cached = getCachedScore(cacheKey)
  if (cached) {
    return { ...range, audioConfidence: cached }
  }

  const audio = getRangeAudio(audioBuffer, range)
  const scores = await classifier(audio, CANDIDATE_LABELS, {
    hypothesis_template: 'This audio contains {}.',
  })
  const confidence = classifyConfidence(scores)
  setCachedScore(cacheKey, confidence)
  return { ...range, audioConfidence: confidence }
}

async function runLimited<T, R>(
  inputs: readonly T[],
  worker: (input: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = []
  let nextIndex = 0

  async function runNext(): Promise<void> {
    const index = nextIndex
    nextIndex += 1
    if (index >= inputs.length) return
    results[index] = await worker(inputs[index]!)
    await runNext()
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, runNext))
  return results
}

export async function scoreFillerRangesWithClap(
  rangesByMediaId: FillerRangesByMediaId,
): Promise<FillerRangesByMediaId> {
  const classifier = await getClassifier()
  const scored: FillerRangesByMediaId = {}

  for (const [mediaId, ranges] of Object.entries(rangesByMediaId)) {
    try {
      const url = await resolveMediaUrl(mediaId)
      if (!url) {
        scored[mediaId] = ranges.map((range) => ({
          ...range,
          audioConfidence: {
            level: 'unknown',
            score: 0,
            fillerScore: 0,
            nonFillerScore: 0,
            label: 'unavailable media',
          },
        }))
        continue
      }

      const audioBuffer = await getOrDecodeAudio(mediaId, url)
      scored[mediaId] = await runLimited(
        ranges,
        (range) => scoreOneRange(classifier, audioBuffer, mediaId, range),
        MAX_CONCURRENT_SCORES,
      )
    } catch (error) {
      logger.warn('Audio confidence scoring failed for media', { mediaId, error })
      scored[mediaId] = ranges.map((range) => ({
        ...range,
        audioConfidence: {
          level: 'unknown',
          score: 0,
          fillerScore: 0,
          nonFillerScore: 0,
          label: 'processing error',
        },
      }))
    }
  }

  return scored
}
