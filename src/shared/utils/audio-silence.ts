export interface AudioSilenceRange {
  start: number
  end: number
}

export interface AudioSilenceDetectionOptions {
  thresholdDb?: number
  minSilenceMs?: number
  paddingMs?: number
  windowMs?: number
}

interface AudioBufferLike {
  duration: number
  length: number
  numberOfChannels: number
  sampleRate: number
  getChannelData(channel: number): Float32Array
}

const DEFAULT_THRESHOLD_DB = -45
const DEFAULT_MIN_SILENCE_MS = 500
const DEFAULT_PADDING_MS = 100
const DEFAULT_WINDOW_MS = 20

function dbToAmplitude(db: number): number {
  return 10 ** (db / 20)
}

function clampNumber(value: number | undefined, fallback: number, min: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(min, value)
}

function getWindowMaxRms(channels: Float32Array[], startSample: number, endSample: number): number {
  let maxRms = 0
  const sampleCount = Math.max(1, endSample - startSample)

  for (const channel of channels) {
    let sumSquares = 0
    for (let sample = startSample; sample < endSample; sample += 1) {
      const value = channel[sample] ?? 0
      sumSquares += value * value
    }
    maxRms = Math.max(maxRms, Math.sqrt(sumSquares / sampleCount))
  }

  return maxRms
}

export function detectSilentRanges(
  audioBuffer: AudioBufferLike,
  options: AudioSilenceDetectionOptions = {},
): AudioSilenceRange[] {
  if (
    audioBuffer.length <= 0 ||
    audioBuffer.sampleRate <= 0 ||
    audioBuffer.numberOfChannels <= 0 ||
    audioBuffer.duration <= 0
  ) {
    return []
  }

  const threshold = dbToAmplitude(options.thresholdDb ?? DEFAULT_THRESHOLD_DB)
  const minSilenceSamples = Math.round(
    (clampNumber(options.minSilenceMs, DEFAULT_MIN_SILENCE_MS, 1) / 1000) * audioBuffer.sampleRate,
  )
  const paddingSamples = Math.round(
    (clampNumber(options.paddingMs, DEFAULT_PADDING_MS, 0) / 1000) * audioBuffer.sampleRate,
  )
  const windowSamples = Math.max(
    1,
    Math.round(
      (clampNumber(options.windowMs, DEFAULT_WINDOW_MS, 1) / 1000) * audioBuffer.sampleRate,
    ),
  )

  const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, channel) =>
    audioBuffer.getChannelData(channel),
  )
  const ranges: AudioSilenceRange[] = []
  let silenceStartSample: number | null = null

  for (let startSample = 0; startSample < audioBuffer.length; startSample += windowSamples) {
    const endSample = Math.min(audioBuffer.length, startSample + windowSamples)
    const isSilent = getWindowMaxRms(channels, startSample, endSample) <= threshold

    if (isSilent) {
      silenceStartSample ??= startSample
      continue
    }

    if (silenceStartSample !== null && startSample - silenceStartSample >= minSilenceSamples) {
      const paddedStart = Math.min(startSample, silenceStartSample + paddingSamples)
      const paddedEnd = Math.max(paddedStart, startSample - paddingSamples)
      if (paddedEnd > paddedStart) {
        ranges.push({
          start: paddedStart / audioBuffer.sampleRate,
          end: paddedEnd / audioBuffer.sampleRate,
        })
      }
    }
    silenceStartSample = null
  }

  if (silenceStartSample !== null && audioBuffer.length - silenceStartSample >= minSilenceSamples) {
    const paddedStart = Math.min(audioBuffer.length, silenceStartSample + paddingSamples)
    const paddedEnd = Math.max(paddedStart, audioBuffer.length - paddingSamples)
    if (paddedEnd > paddedStart) {
      ranges.push({
        start: paddedStart / audioBuffer.sampleRate,
        end: paddedEnd / audioBuffer.sampleRate,
      })
    }
  }

  return ranges
}
