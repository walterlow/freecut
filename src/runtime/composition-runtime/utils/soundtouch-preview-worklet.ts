import { createLogger } from '@/shared/logging/logger'
import { SOUND_TOUCH_PREVIEW_PROCESSOR_NAME } from './soundtouch-preview-shared'
import workletModuleUrl from '../worklets/soundtouch-preview-processor.worklet.ts?worker&url'

const log = createLogger('SoundTouchPreviewWorklet')
const pendingWorkletLoads = new WeakMap<AudioContext, Promise<boolean>>()

export interface SerializedSoundTouchPreviewSource {
  leftChannel: Float32Array
  rightChannel: Float32Array
  frameCount: number
  sampleRate: number
}

interface PreparedSoundTouchPreviewSource {
  leftChannel: Float32Array
  rightChannel: Float32Array
  frameCount: number
  sampleRate: number
}

const preparedSourceCache = new WeakMap<
  AudioBuffer,
  Map<number, Promise<PreparedSoundTouchPreviewSource>>
>()

function resampleChannelLinear(
  input: Float32Array,
  targetFrames: number,
  ratio: number,
): Float32Array {
  const output = new Float32Array(targetFrames)
  for (let i = 0; i < targetFrames; i++) {
    const srcPos = i / ratio
    const idx = Math.floor(srcPos)
    const frac = srcPos - idx
    const s0 = input[idx] ?? 0
    const s1 = input[idx + 1] ?? s0
    output[i] = s0 + (s1 - s0) * frac
  }
  return output
}

export function serializeAudioBufferForSoundTouchPreview(
  buffer: AudioBuffer,
  targetSampleRate: number,
): SerializedSoundTouchPreviewSource {
  const safeTargetRate = Math.max(1, Math.floor(targetSampleRate))
  const leftSource = buffer.getChannelData(0)
  const rightSource = buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0)

  if (buffer.sampleRate === safeTargetRate) {
    return {
      leftChannel: new Float32Array(leftSource),
      rightChannel: new Float32Array(rightSource),
      frameCount: buffer.length,
      sampleRate: buffer.sampleRate,
    }
  }

  const ratio = safeTargetRate / buffer.sampleRate
  const targetFrames = Math.max(1, Math.ceil(buffer.length * ratio))
  return {
    leftChannel: resampleChannelLinear(leftSource, targetFrames, ratio),
    rightChannel: resampleChannelLinear(rightSource, targetFrames, ratio),
    frameCount: targetFrames,
    sampleRate: safeTargetRate,
  }
}

async function prepareSoundTouchPreviewSource(
  buffer: AudioBuffer,
  targetSampleRate: number,
): Promise<PreparedSoundTouchPreviewSource> {
  const safeTargetRate = Math.max(1, Math.floor(targetSampleRate))
  const cachedByRate = preparedSourceCache.get(buffer) ?? new Map()
  preparedSourceCache.set(buffer, cachedByRate)

  const cached = cachedByRate.get(safeTargetRate)
  if (cached) return cached

  const task = (async () => {
    if (buffer.sampleRate === safeTargetRate) {
      return {
        leftChannel: buffer.getChannelData(0),
        rightChannel: buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0),
        frameCount: buffer.length,
        sampleRate: buffer.sampleRate,
      }
    }

    if (typeof OfflineAudioContext !== 'undefined') {
      const targetFrames = Math.max(
        1,
        Math.ceil(buffer.length * (safeTargetRate / buffer.sampleRate)),
      )
      const context = new OfflineAudioContext(
        Math.max(1, Math.min(2, buffer.numberOfChannels)),
        targetFrames,
        safeTargetRate,
      )
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      source.start()
      const rendered = await context.startRendering()
      return {
        leftChannel: rendered.getChannelData(0),
        rightChannel: rendered.getChannelData(rendered.numberOfChannels > 1 ? 1 : 0),
        frameCount: rendered.length,
        sampleRate: rendered.sampleRate,
      }
    }

    return serializeAudioBufferForSoundTouchPreview(buffer, safeTargetRate)
  })().catch((error) => {
    cachedByRate.delete(safeTargetRate)
    throw error
  })

  cachedByRate.set(safeTargetRate, task)
  return task
}

/**
 * Prepares worklet source data without running a multi-million-sample resample
 * loop on the UI thread. The cached prepared channels stay owned by this module;
 * each caller receives transferable copies so posting them to the worklet does
 * not clone the full clip again.
 */
export async function prepareAudioBufferForSoundTouchPreview(
  buffer: AudioBuffer,
  targetSampleRate: number,
): Promise<SerializedSoundTouchPreviewSource> {
  const prepared = await prepareSoundTouchPreviewSource(buffer, targetSampleRate)
  return {
    leftChannel: new Float32Array(prepared.leftChannel),
    rightChannel: new Float32Array(prepared.rightChannel),
    frameCount: prepared.frameCount,
    sampleRate: prepared.sampleRate,
  }
}

function canUseSoundTouchPreviewWorklet(context: AudioContext): boolean {
  return typeof AudioWorkletNode !== 'undefined' && typeof context.audioWorklet !== 'undefined'
}

export async function ensureSoundTouchPreviewWorkletLoaded(
  context: AudioContext,
): Promise<boolean> {
  if (!canUseSoundTouchPreviewWorklet(context)) {
    return false
  }

  const pending = pendingWorkletLoads.get(context)
  if (pending) {
    return pending
  }

  const loadPromise = context.audioWorklet
    .addModule(workletModuleUrl)
    .then(() => true)
    .catch((error) => {
      log.warn('Failed to load SoundTouch preview worklet module', { error })
      pendingWorkletLoads.delete(context)
      return false
    })

  pendingWorkletLoads.set(context, loadPromise)
  return loadPromise
}

export { SOUND_TOUCH_PREVIEW_PROCESSOR_NAME }
