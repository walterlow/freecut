import { createLogger } from '@/shared/logging/logger'
import {
  LOCAL_INFERENCE_UNLOADED_MESSAGE,
  localInferenceRuntimeRegistry,
  useLocalInferenceStore,
} from '@/shared/state/local-inference'

const logger = createLogger('MossTtsService')

const HOST_SOURCE = 'freecut-moss-tts-worker'
const CLIENT_SOURCE = 'freecut-moss-tts-client'
const WORKER_PATH = '/moss-tts/moss_tts.worker.js'
const MODEL_KEY = 'nano-zh'
const MODEL_LABEL = 'Multilingual Nano'
const ESTIMATED_BYTES = 785_000_000
const THREAD_COUNT = 4

interface SerializedAudioChunk {
  sampleRate: number
  channels: number
  isPause?: boolean
  buffers: ArrayBuffer[]
}

interface ProgressInfo {
  type: 'progress'
  requestId: string
  stage?: string
}

interface ResponseInfo {
  type: 'response'
  requestId: string
  ok: boolean
  error?: string
  data?: {
    status?: string
    audioChunks?: SerializedAudioChunk[]
    textChunkCount?: number
  }
}

interface ReadyInfo {
  type: 'ready'
}

interface GenerateSpeechOptions {
  text: string
  voice: MossTtsVoice
  speed: number
  onProgress?: (stage: string) => void
}

interface PendingRequest<T> {
  onProgress?: (stage: string) => void
  reject: (reason?: unknown) => void
  resolve: (value: T) => void
}

export const MOSS_TTS_VOICE_OPTIONS = [
  { value: 'Junhao', label: 'Junhao (ZH, M)' },
  { value: 'Zhiming', label: 'Zhiming (ZH, M)' },
  { value: 'Weiguo', label: 'Weiguo (ZH, M)' },
  { value: 'Xiaoyu', label: 'Xiaoyu (ZH, F)' },
  { value: 'Yuewen', label: 'Yuewen (ZH, F)' },
  { value: 'Lingyu', label: 'Lingyu (ZH, F)' },
  { value: 'Trump', label: 'Trump (EN, M)' },
  { value: 'Ava', label: 'Ava (EN, F)' },
  { value: 'Bella', label: 'Bella (EN, F)' },
  { value: 'Adam', label: 'Adam (EN, M)' },
  { value: 'Nathan', label: 'Nathan (EN, M)' },
  { value: 'Soyo', label: 'Soyo (JA, F)' },
  { value: 'Saki', label: 'Saki (JA, F)' },
  { value: 'Mortis', label: 'Mortis (JA, F)' },
  { value: 'Umiri', label: 'Umiri (JA, F)' },
  { value: 'Mei', label: 'Mei (JA, F)' },
  { value: 'Anon', label: 'Anon (JA, F)' },
  { value: 'Arisa', label: 'Arisa (JA, F)' },
] as const

export type MossTtsVoice = (typeof MOSS_TTS_VOICE_OPTIONS)[number]['value']

export const MOSS_TTS_SUPPORTED_LANGUAGES = [
  'Chinese',
  'English',
  'Japanese',
  'Korean',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Hungarian',
  'Russian',
  'Persian',
  'Arabic',
  'Polish',
  'Portuguese',
  'Czech',
  'Danish',
  'Swedish',
  'Greek',
  'Turkish',
] as const

function makeSafeFileNameSegment(text: string): string {
  const collapsed = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return collapsed.slice(0, 32) || 'speech'
}

function createOutputFileName(text: string, voice: MossTtsVoice): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `ai-tts-${makeSafeFileNameSegment(text)}-${makeSafeFileNameSegment(voice)}-moss-${timestamp}.wav`
}

function concatFloat32Arrays(chunks: Float32Array[]): Float32Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const merged = new Float32Array(totalLength)
  let offset = 0

  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }

  return merged
}

function mergeChunkChannels(audioChunks: SerializedAudioChunk[]): {
  channels: Float32Array[]
  sampleRate: number
} {
  let sampleRate = 0
  let channelCount = 0
  const mergedChunks: Float32Array[][] = []

  for (const chunk of audioChunks) {
    const chunkChannels = chunk.buffers.map((buffer) => new Float32Array(buffer))
    if (chunkChannels.length === 0) {
      continue
    }

    if (sampleRate === 0) {
      sampleRate = chunk.sampleRate
    }

    if (channelCount === 0) {
      channelCount = chunk.channels || chunkChannels.length
      for (let index = 0; index < channelCount; index += 1) {
        mergedChunks.push([])
      }
    }

    const fallbackLength = chunkChannels[0]?.length ?? 0
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      mergedChunks[channelIndex]?.push(
        chunkChannels[channelIndex] ?? new Float32Array(fallbackLength),
      )
    }
  }

  return {
    channels: mergedChunks.map((channelChunks) => concatFloat32Arrays(channelChunks)),
    sampleRate,
  }
}

function createFloat32WavBlob(channels: Float32Array[], sampleRate: number): Blob {
  const channelCount = channels.length
  const frameCount = channels[0]?.length ?? 0
  const bytesPerSample = 4
  const blockAlign = channelCount * bytesPerSample
  const dataSize = frameCount * blockAlign
  const header = new ArrayBuffer(44)
  const view = new DataView(header)

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 3, true)
  view.setUint16(22, channelCount, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 32, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  const interleaved = new Float32Array(frameCount * channelCount)
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      interleaved[frameIndex * channelCount + channelIndex] =
        channels[channelIndex]?.[frameIndex] ?? 0
    }
  }

  return new Blob([header, interleaved.buffer], { type: 'audio/wav' })
}

function getAudioDurationSeconds(channels: Float32Array[], sampleRate: number): number {
  const frameCount = channels[0]?.length ?? 0
  return sampleRate > 0 ? frameCount / sampleRate : 0
}

function applyPlaybackSpeed(channels: Float32Array[], speed: number): Float32Array[] {
  const normalizedSpeed = Number.isFinite(speed) ? Math.min(2, Math.max(0.5, speed)) : 1
  if (Math.abs(normalizedSpeed - 1) < 0.001) {
    return channels
  }

  return channels.map((channel) => {
    if (channel.length <= 1) {
      return channel
    }

    const outputLength = Math.max(1, Math.floor((channel.length - 1) / normalizedSpeed) + 1)
    const output = new Float32Array(outputLength)

    for (let index = 0; index < outputLength; index += 1) {
      const sourcePosition = index * normalizedSpeed
      const baseIndex = Math.floor(sourcePosition)
      const nextIndex = Math.min(channel.length - 1, baseIndex + 1)
      const fraction = sourcePosition - baseIndex
      const start = channel[baseIndex] ?? 0
      const end = channel[nextIndex] ?? start
      output[index] = start + (end - start) * fraction
    }

    return output
  })
}

export function getMossTtsVoiceOption(voice: MossTtsVoice): { value: MossTtsVoice; label: string } {
  return (
    MOSS_TTS_VOICE_OPTIONS.find((option) => option.value === voice) ?? {
      value: voice,
      label: voice,
    }
  )
}

class MossTtsService {
  private readonly runtimeFeature = 'tts'
  private readonly runtimeFeatureLabel = 'MOSS TTS'
  private activeJobs = 0
  private generationChain: Promise<void> | null = null
  private pendingRequests = new Map<string, PendingRequest<ResponseInfo['data']>>()
  private worker: Worker | null = null
  private workerReadyPromise: Promise<void> | null = null
  private preparedPromise: Promise<void> | null = null
  private messageListenerAttached = false

  isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof document !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      typeof navigator.storage?.getDirectory === 'function'
    )
  }

  private getRuntimeId(): string {
    return 'moss-tts:nano'
  }

  private upsertRuntime(
    state: 'loading' | 'running' | 'ready' | 'error',
    errorMessage?: string,
  ): void {
    const runtimeId = this.getRuntimeId()
    const existing = useLocalInferenceStore.getState().runtimesById[runtimeId]
    const now = Date.now()

    if (existing) {
      localInferenceRuntimeRegistry.updateRuntime(runtimeId, {
        feature: this.runtimeFeature,
        featureLabel: this.runtimeFeatureLabel,
        modelKey: MODEL_KEY,
        modelLabel: MODEL_LABEL,
        backend: 'wasm',
        state,
        estimatedBytes: ESTIMATED_BYTES,
        activeJobs: this.activeJobs,
        unloadable: true,
        errorMessage,
        lastUsedAt: now,
      })
      return
    }

    localInferenceRuntimeRegistry.registerRuntime(
      {
        id: runtimeId,
        feature: this.runtimeFeature,
        featureLabel: this.runtimeFeatureLabel,
        modelKey: MODEL_KEY,
        modelLabel: MODEL_LABEL,
        backend: 'wasm',
        state,
        estimatedBytes: ESTIMATED_BYTES,
        activeJobs: this.activeJobs,
        loadedAt: now,
        lastUsedAt: now,
        unloadable: true,
        errorMessage,
      },
      {
        unload: () => this.unload(),
      },
    )
  }

  private incrementJobs(): void {
    this.activeJobs += 1
    this.upsertRuntime('running')
  }

  private decrementJobs(): void {
    this.activeJobs = Math.max(0, this.activeJobs - 1)
    this.upsertRuntime('ready')
  }

  private attachMessageListener(): void {
    if (this.messageListenerAttached || typeof window === 'undefined') {
      return
    }
    this.messageListenerAttached = true
  }

  private readonly handleWorkerMessage = (
    event: MessageEvent<ReadyInfo | ProgressInfo | ResponseInfo>,
  ) => {
    const payload = event.data
    if (!payload || (payload as { source?: string }).source !== HOST_SOURCE) {
      return
    }

    if (payload.type === 'ready') {
      this.workerReadyResolver?.()
      return
    }

    if ('requestId' in payload) {
      const request = this.pendingRequests.get(payload.requestId)
      if (!request) {
        return
      }

      if (payload.type === 'progress') {
        request.onProgress?.(payload.stage || 'Preparing MOSS Nano...')
        return
      }

      this.pendingRequests.delete(payload.requestId)

      if (payload.ok) {
        request.resolve(payload.data)
      } else {
        request.reject(new Error(payload.error || 'MOSS TTS request failed.'))
      }
    }
  }

  private workerReadyResolver: (() => void) | null = null

  private async ensureWorkerLoaded(onProgress?: (stage: string) => void): Promise<void> {
    if (this.workerReadyPromise) {
      return this.workerReadyPromise
    }

    if (!this.isSupported()) {
      throw new Error('Browser-managed storage is not available in this browser.')
    }

    this.attachMessageListener()
    onProgress?.('Starting MOSS worker...')

    this.workerReadyPromise = new Promise<void>((resolve, reject) => {
      const worker = new Worker(WORKER_PATH)
      this.worker = worker
      worker.addEventListener('message', this.handleWorkerMessage)
      worker.addEventListener('error', this.handleWorkerError)

      const timeoutId = window.setTimeout(() => {
        this.workerReadyResolver = null
        this.workerReadyPromise = null
        worker.terminate()
        this.worker = null
        reject(new Error('Timed out while starting the MOSS worker.'))
      }, 30_000)

      this.workerReadyResolver = () => {
        window.clearTimeout(timeoutId)
        this.workerReadyResolver = null
        resolve()
      }
    })

    return this.workerReadyPromise
  }

  private readonly handleWorkerError = () => {
    this.workerReadyPromise = null
  }

  private async requestWorker(
    action: 'warmup' | 'synthesize' | 'dispose',
    payload: Record<string, unknown>,
    onProgress?: (stage: string) => void,
  ): Promise<ResponseInfo['data']> {
    await this.ensureWorkerLoaded(onProgress)

    const requestId = crypto.randomUUID()
    if (!this.worker) {
      throw new Error('MOSS worker is not available.')
    }

    return new Promise<ResponseInfo['data']>((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject, onProgress })

      this.worker?.postMessage({
        source: CLIENT_SOURCE,
        action,
        requestId,
        threadCount: THREAD_COUNT,
        ...payload,
      })
    })
  }

  private async ensurePrepared(onProgress?: (stage: string) => void): Promise<void> {
    if (this.preparedPromise) {
      return this.preparedPromise
    }

    this.upsertRuntime('loading')
    this.preparedPromise = this.requestWorker('warmup', {}, onProgress)
      .then(() => {
        this.upsertRuntime('ready')
      })
      .catch((error) => {
        this.preparedPromise = null
        const message = error instanceof Error ? error.message : String(error)
        this.upsertRuntime('error', message)
        throw error
      })

    return this.preparedPromise
  }

  private async withGenerationLock<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.generationChain ?? Promise.resolve()
    let releaseCurrent = () => {}
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve
    })
    const queued = previous.then(() => current)
    this.generationChain = queued

    await previous

    try {
      return await task()
    } finally {
      releaseCurrent()
      if (this.generationChain === queued) {
        this.generationChain = null
      }
    }
  }

  async unload(): Promise<void> {
    this.preparedPromise = null
    this.workerReadyPromise = null
    this.activeJobs = 0
    for (const request of this.pendingRequests.values()) {
      request.reject(new Error(LOCAL_INFERENCE_UNLOADED_MESSAGE))
    }
    this.pendingRequests.clear()

    if (this.worker) {
      this.worker.postMessage({
        source: CLIENT_SOURCE,
        action: 'dispose',
        requestId: crypto.randomUUID(),
      })
      this.worker.removeEventListener('message', this.handleWorkerMessage)
      this.worker.removeEventListener('error', this.handleWorkerError)
      this.worker.terminate()
      this.worker = null
    }

    localInferenceRuntimeRegistry.unregisterRuntime(this.getRuntimeId())
  }

  async generateSpeechFile({
    text,
    voice,
    speed,
    onProgress,
  }: GenerateSpeechOptions): Promise<{ blob: Blob; file: File; duration: number }> {
    const trimmedText = text.trim()
    if (!trimmedText) {
      throw new Error('Enter some text to synthesize.')
    }

    if (!this.isSupported()) {
      throw new Error('This browser cannot run the local MOSS multilingual TTS runtime.')
    }

    return this.withGenerationLock(async () => {
      await this.ensurePrepared(onProgress)
      this.incrementJobs()

      try {
        onProgress?.('Generating multilingual speech in worker...')
        const response = await this.requestWorker(
          'synthesize',
          {
            text: trimmedText,
            voiceName: voice,
          },
          onProgress,
        )

        const audioChunks = response?.audioChunks ?? []
        if (audioChunks.length === 0) {
          throw new Error('MOSS TTS did not return any audio.')
        }

        const mergedAudio = mergeChunkChannels(audioChunks)
        if (mergedAudio.channels.length === 0 || mergedAudio.sampleRate <= 0) {
          throw new Error('MOSS TTS returned invalid audio data.')
        }

        const spedUpChannels = applyPlaybackSpeed(mergedAudio.channels, speed)
        const blob = createFloat32WavBlob(spedUpChannels, mergedAudio.sampleRate)
        const file = new File([blob], createOutputFileName(trimmedText, voice), {
          type: 'audio/wav',
          lastModified: Date.now(),
        })

        return {
          blob,
          file,
          duration: getAudioDurationSeconds(spedUpChannels, mergedAudio.sampleRate),
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Failed to generate speech with MOSS TTS runtime', error)
        this.upsertRuntime('error', message)
        throw error
      } finally {
        this.decrementJobs()
      }
    })
  }
}

export const mossTtsService = new MossTtsService()
