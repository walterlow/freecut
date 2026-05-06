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

export function canUseSoundTouchPreviewWorklet(context: AudioContext): boolean {
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
