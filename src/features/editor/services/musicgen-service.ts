import {
  DEFAULT_MUSICGEN_MODEL,
  getMusicgenMaxNewTokens,
  getMusicgenModelDefinition,
  MUSICGEN_MODEL_OPTIONS,
  type MusicgenModelId,
} from '@/shared/utils/musicgen-models'
import {
  localInferenceRuntimeRegistry,
  useLocalInferenceStore,
} from '@/shared/state/local-inference'
import { TRANSFORMERS_CACHE_NAME } from '@/shared/utils/local-model-cache'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('MusicgenService')

type TransformersModule = typeof import('@huggingface/transformers')
type MusicgenTokenizer = Awaited<ReturnType<TransformersModule['AutoTokenizer']['from_pretrained']>>
type MusicgenModelInstance = Awaited<
  ReturnType<TransformersModule['MusicgenForConditionalGeneration']['from_pretrained']>
>

interface ProgressInfo {
  status?: string
  file?: string
  loaded?: number
  total?: number
}

interface GenerateMusicOptions {
  prompt: string
  model?: MusicgenModelId
  durationSeconds: number
  guidanceScale?: number
  onProgress?: (stage: string, fraction?: number) => void
  signal?: AbortSignal
}

interface MusicgenRuntime {
  tokenizer: MusicgenTokenizer
  model: MusicgenModelInstance
  modelKey: MusicgenModelId
}

const MUSICGEN_DTYPE_CONFIG = {
  text_encoder: 'q8',
  decoder_model_merged: 'q8',
  decoder_with_past_model: 'q8',
  encodec_decode: 'fp32',
  build_delay_pattern_mask: 'fp32',
} as const

function makeSafeFileNameSegment(text: string): string {
  const collapsed = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return collapsed.slice(0, 32) || 'music'
}

function createOutputFileName(prompt: string, model: MusicgenModelId): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `ai-music-${makeSafeFileNameSegment(prompt)}-${model}-${timestamp}.wav`
}

class MusicgenService {
  private readonly runtimeFeature = 'music'
  private readonly runtimeFeatureLabel = 'MusicGen'
  private modulePromise: Promise<TransformersModule> | null = null
  private runtimePromises = new Map<MusicgenModelId, Promise<MusicgenRuntime>>()
  private activeJobs = new Map<MusicgenModelId, number>()
  private generationChains = new Map<MusicgenModelId, Promise<void>>()

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator
  }

  private async isModelCached(model: MusicgenModelId): Promise<boolean> {
    try {
      const cacheStorage = globalThis.caches
      if (!cacheStorage) return false
      if (!(await cacheStorage.has(TRANSFORMERS_CACHE_NAME))) return false

      const cache = await cacheStorage.open(TRANSFORMERS_CACHE_NAME)
      const keys = await cache.keys()
      const { cacheMatchFragments } = getMusicgenModelDefinition(model)
      return cacheMatchFragments.some((fragment) =>
        keys.some((req) => req.url.toLowerCase().includes(fragment)),
      )
    } catch {
      return false
    }
  }

  private getRuntimeId(model: MusicgenModelId): string {
    return `musicgen:${model}`
  }

  private getModule(): Promise<TransformersModule> {
    if (!this.modulePromise) {
      this.modulePromise = import('@huggingface/transformers').then((module) => {
        module.env.useBrowserCache = true
        module.env.allowLocalModels = false
        return module
      })
    }

    return this.modulePromise
  }

  private upsertRuntime(
    model: MusicgenModelId,
    state: 'loading' | 'running' | 'ready' | 'error',
    errorMessage?: string,
  ): void {
    const runtimeId = this.getRuntimeId(model)
    const existing = useLocalInferenceStore.getState().runtimesById[runtimeId]
    const config = getMusicgenModelDefinition(model)
    const now = Date.now()
    const activeJobs = this.activeJobs.get(model) ?? 0

    if (existing) {
      localInferenceRuntimeRegistry.updateRuntime(runtimeId, {
        feature: this.runtimeFeature,
        featureLabel: this.runtimeFeatureLabel,
        modelKey: model,
        modelLabel: config.label,
        backend: 'webgpu',
        state,
        estimatedBytes: config.estimatedBytes,
        activeJobs,
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
        modelKey: model,
        modelLabel: config.label,
        backend: 'webgpu',
        state,
        estimatedBytes: config.estimatedBytes,
        activeJobs,
        loadedAt: now,
        lastUsedAt: now,
        unloadable: true,
        errorMessage,
      },
      {
        unload: () => this.unloadModel(model),
      },
    )
  }

  private incrementJobs(model: MusicgenModelId): void {
    const nextJobs = (this.activeJobs.get(model) ?? 0) + 1
    this.activeJobs.set(model, nextJobs)
    this.upsertRuntime(model, 'running')
  }

  private decrementJobs(model: MusicgenModelId): void {
    const nextJobs = Math.max(0, (this.activeJobs.get(model) ?? 0) - 1)
    this.activeJobs.set(model, nextJobs)
    this.upsertRuntime(model, 'ready')
  }

  private async ensureRuntime(
    model: MusicgenModelId,
    onProgress?: (stage: string, fraction?: number) => void,
  ): Promise<MusicgenRuntime> {
    const existingPromise = this.runtimePromises.get(model)
    if (existingPromise) {
      return existingPromise
    }

    this.upsertRuntime(model, 'loading')

    const runtimePromise = (async () => {
      const module = await this.getModule()
      const config = getMusicgenModelDefinition(model)
      const cached = await this.isModelCached(model)
      const loadVerb = cached ? 'Loading' : 'Downloading'
      const downloadCache = new Map<string, { loaded: number; total: number }>()

      onProgress?.('Loading MusicGen tokenizer...')
      const tokenizer = await module.AutoTokenizer.from_pretrained(config.modelId)

      onProgress?.(
        cached
          ? `Loading ${config.label} from cache...`
          : `Downloading ${config.label} (${config.downloadLabel})...`,
      )
      const runtimeModel = await module.MusicgenForConditionalGeneration.from_pretrained(
        config.modelId,
        {
          device: 'webgpu',
          dtype: MUSICGEN_DTYPE_CONFIG,
          progress_callback: (progress: ProgressInfo) => {
            if (progress.status !== 'progress' && progress.status !== 'download') {
              return
            }
            if (!progress.file || !progress.total) {
              return
            }

            downloadCache.set(progress.file, {
              loaded: progress.loaded ?? 0,
              total: progress.total,
            })

            let totalLoaded = 0
            let totalExpected = 0
            for (const entry of downloadCache.values()) {
              totalLoaded += entry.loaded
              totalExpected += entry.total
            }

            if (totalExpected > 0) {
              const fraction = Math.min(0.99, totalLoaded / totalExpected)
              onProgress?.(
                `${loadVerb} ${config.label} (${Math.round(fraction * 100)}%)...`,
                fraction,
              )
            }
          },
        },
      )

      this.upsertRuntime(model, 'ready')
      return {
        tokenizer,
        model: runtimeModel,
        modelKey: model,
      }
    })()

    this.runtimePromises.set(model, runtimePromise)

    try {
      return await runtimePromise
    } catch (error) {
      this.runtimePromises.delete(model)
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`Failed to initialize ${model} MusicGen runtime`, error)
      this.upsertRuntime(model, 'error', message)
      throw error
    }
  }

  private async withGenerationLock<T>(model: MusicgenModelId, task: () => Promise<T>): Promise<T> {
    const previous = this.generationChains.get(model) ?? Promise.resolve()
    let releaseCurrent = () => {}
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve
    })
    const queued = previous.then(() => current)
    this.generationChains.set(model, queued)

    await previous

    try {
      return await task()
    } finally {
      releaseCurrent()
      if (this.generationChains.get(model) === queued) {
        this.generationChains.delete(model)
      }
    }
  }

  async unloadModel(model: MusicgenModelId): Promise<void> {
    const runtimeId = this.getRuntimeId(model)
    const runtimePromise = this.runtimePromises.get(model)

    if (!runtimePromise) {
      localInferenceRuntimeRegistry.unregisterRuntime(runtimeId)
      this.activeJobs.delete(model)
      return
    }

    try {
      const pendingGeneration = this.generationChains.get(model)
      if (pendingGeneration) {
        await pendingGeneration
      }

      const runtime = await runtimePromise
      await runtime.model.dispose?.()
    } catch (error) {
      logger.warn(`Failed to unload ${model} MusicGen runtime cleanly`, error)
    } finally {
      this.runtimePromises.delete(model)
      this.generationChains.delete(model)
      this.activeJobs.delete(model)
      localInferenceRuntimeRegistry.unregisterRuntime(runtimeId)
    }
  }

  async generateMusicFile({
    prompt,
    model = DEFAULT_MUSICGEN_MODEL,
    durationSeconds,
    guidanceScale = 3,
    onProgress,
    signal,
  }: GenerateMusicOptions): Promise<{ blob: Blob; file: File; duration: number }> {
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) {
      throw new Error('Describe the music you want to generate.')
    }

    if (!this.isSupported()) {
      throw new Error('WebGPU is not available in this browser.')
    }

    if (signal?.aborted) {
      throw new DOMException('Music generation cancelled.', 'AbortError')
    }

    const config = getMusicgenModelDefinition(model)
    const clampedDuration = Math.min(
      config.maxDurationSeconds,
      Math.max(config.minDurationSeconds, durationSeconds),
    )

    return this.withGenerationLock(model, async () => {
      const runtime = await this.ensureRuntime(model, onProgress)
      const module = await this.getModule()
      this.incrementJobs(model)

      try {
        if (signal?.aborted) {
          throw new DOMException('Music generation cancelled.', 'AbortError')
        }

        onProgress?.('Preparing prompt...')
        const inputs = runtime.tokenizer(trimmedPrompt)

        const maxNewTokens = getMusicgenMaxNewTokens(model, clampedDuration)
        let tokenCount = 0

        onProgress?.('Generating music...', 0)
        const streamer = {
          put: () => {
            if (signal?.aborted) {
              throw new DOMException('Music generation cancelled.', 'AbortError')
            }
            tokenCount++
            const fraction = Math.min(tokenCount / maxNewTokens, 1)
            onProgress?.(`Generating music... ${Math.round(fraction * 100)}%`, fraction)
          },
          end: () => {
            /* done */
          },
        }
        const audioValues = await runtime.model.generate({
          ...inputs,
          max_new_tokens: maxNewTokens,
          do_sample: true,
          guidance_scale: guidanceScale,
          streamer: streamer as never,
        })

        onProgress?.('Encoding WAV...')
        const sampleRate =
          (runtime.model.config as { audio_encoder?: { sampling_rate?: number } }).audio_encoder
            ?.sampling_rate ?? 32000
        const audioData = (audioValues as { data: Float32Array | Float32Array[] }).data
        const audio = new module.RawAudio(audioData, sampleRate)
        const blob = audio.toBlob()
        const file = new File([blob], createOutputFileName(trimmedPrompt, model), {
          type: 'audio/wav',
          lastModified: Date.now(),
        })

        return { blob, file, duration: audio.data.length / sampleRate }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw error
        }
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Failed to generate music with ${model} MusicGen runtime`, error)
        this.upsertRuntime(model, 'error', message)
        throw error
      } finally {
        this.decrementJobs(model)
      }
    })
  }
}

export { DEFAULT_MUSICGEN_MODEL, MUSICGEN_MODEL_OPTIONS }
export type { GenerateMusicOptions, MusicgenModelId }

export const musicgenService = new MusicgenService()
