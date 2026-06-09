import { createLogger } from '@/shared/logging/logger'
import { sanitizeAiOutputFileNameSegment } from '@/shared/utils/ai-output-filename'
import {
  localInferenceRuntimeRegistry,
  useLocalInferenceStore,
} from '@/shared/state/local-inference'
import { validateTtsGenerateRequest } from './tts-generate-validation'

const logger = createLogger('SupertonicTtsService')

type OrtModule = typeof import('onnxruntime-web')
type OrtTensor = InstanceType<OrtModule['Tensor']>
type OrtSession = Awaited<ReturnType<OrtModule['InferenceSession']['create']>>

interface SupertonicTtsModels {
  durationPredictor: OrtSession
  textEncoder: OrtSession
  vectorEstimator: OrtSession
  vocoder: OrtSession
}

interface SupertonicTtsConfig {
  ae: {
    sample_rate: number
    base_chunk_size: number
  }
  ttl: {
    chunk_compress_factor: number
    latent_dim: number
  }
}

interface SupertonicRuntime {
  backend: 'webgpu' | 'wasm'
  config: SupertonicTtsConfig
  models: SupertonicTtsModels
  processors: {
    textProcessor: UnicodeProcessor
  }
}

interface GenerateSpeechOptions {
  text: string
  voice: SupertonicTtsVoice
  language: SupertonicTtsLanguageSelection
  speed: number
  onProgress?: (stage: string) => void
}

interface VoiceStyleData {
  style_ttl: {
    data: unknown[]
    dims: number[]
    type?: string
  }
  style_dp: {
    data: unknown[]
    dims: number[]
    type?: string
  }
}

interface VoiceStyleTensors {
  styleTtl: OrtTensor
  styleDp: OrtTensor
}

const MODEL_LABEL = 'Supertonic 3'
const MODEL_KEY = 'supertonic-3'
const ESTIMATED_BYTES = 398_000_000
const MODEL_BASE_URL = 'https://huggingface.co/spaces/Supertone/supertonic-3/resolve/main/assets'
const ONNX_BASE_URL = `${MODEL_BASE_URL}/onnx`
const VOICE_STYLE_BASE_URL = `${MODEL_BASE_URL}/voice_styles`
const ORT_WASM_PATH =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260410-5e55544225/dist/'
const DEFAULT_TOTAL_STEPS = 8
const MAX_CHARS_PER_SEGMENT = 300
const MAX_CJK_CHARS_PER_SEGMENT = 120
const SILENCE_BETWEEN_SEGMENTS_SECONDS = 0.3

export const SUPERTONIC_TTS_VOICE_OPTIONS = [
  { value: 'F1', label: 'Sarah (F)' },
  { value: 'F2', label: 'Lily (F)' },
  { value: 'F3', label: 'Jessica (F)' },
  { value: 'F4', label: 'Olivia (F)' },
  { value: 'F5', label: 'Emily (F)' },
  { value: 'M1', label: 'Alex (M)' },
  { value: 'M2', label: 'James (M)' },
  { value: 'M3', label: 'Robert (M)' },
  { value: 'M4', label: 'Sam (M)' },
  { value: 'M5', label: 'Daniel (M)' },
] as const

export type SupertonicTtsVoice = (typeof SUPERTONIC_TTS_VOICE_OPTIONS)[number]['value']

const SUPERTONIC_TTS_SUPPORTED_LANGUAGE_CODES = [
  'en',
  'ko',
  'ja',
  'ar',
  'bg',
  'cs',
  'da',
  'de',
  'el',
  'es',
  'et',
  'fi',
  'fr',
  'hi',
  'hr',
  'hu',
  'id',
  'it',
  'lt',
  'lv',
  'nl',
  'pl',
  'pt',
  'ro',
  'ru',
  'sk',
  'sl',
  'sv',
  'tr',
  'uk',
  'vi',
] as const

type SupertonicLanguageCode = (typeof SUPERTONIC_TTS_SUPPORTED_LANGUAGE_CODES)[number]
export type SupertonicTtsLanguageSelection = 'auto' | SupertonicLanguageCode

export const SUPERTONIC_TTS_SUPPORTED_LANGUAGES = [
  'English',
  'Korean',
  'Japanese',
  'Arabic',
  'Bulgarian',
  'Czech',
  'Danish',
  'German',
  'Greek',
  'Spanish',
  'Estonian',
  'Finnish',
  'French',
  'Hindi',
  'Croatian',
  'Hungarian',
  'Indonesian',
  'Italian',
  'Lithuanian',
  'Latvian',
  'Dutch',
  'Polish',
  'Portuguese',
  'Romanian',
  'Russian',
  'Slovak',
  'Slovenian',
  'Swedish',
  'Turkish',
  'Ukrainian',
  'Vietnamese',
] as const

export const SUPERTONIC_TTS_LANGUAGE_OPTIONS: Array<{
  value: SupertonicTtsLanguageSelection
  label: string
}> = [
  { value: 'auto', label: 'Auto detect' },
  { value: 'en', label: 'English' },
  { value: 'ko', label: 'Korean' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ar', label: 'Arabic' },
  { value: 'bg', label: 'Bulgarian' },
  { value: 'cs', label: 'Czech' },
  { value: 'da', label: 'Danish' },
  { value: 'de', label: 'German' },
  { value: 'el', label: 'Greek' },
  { value: 'es', label: 'Spanish' },
  { value: 'et', label: 'Estonian' },
  { value: 'fi', label: 'Finnish' },
  { value: 'fr', label: 'French' },
  { value: 'hi', label: 'Hindi' },
  { value: 'hr', label: 'Croatian' },
  { value: 'hu', label: 'Hungarian' },
  { value: 'id', label: 'Indonesian' },
  { value: 'it', label: 'Italian' },
  { value: 'lt', label: 'Lithuanian' },
  { value: 'lv', label: 'Latvian' },
  { value: 'nl', label: 'Dutch' },
  { value: 'pl', label: 'Polish' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ro', label: 'Romanian' },
  { value: 'ru', label: 'Russian' },
  { value: 'sk', label: 'Slovak' },
  { value: 'sl', label: 'Slovenian' },
  { value: 'sv', label: 'Swedish' },
  { value: 'tr', label: 'Turkish' },
  { value: 'uk', label: 'Ukrainian' },
  { value: 'vi', label: 'Vietnamese' },
]

export const SUPERTONIC_TTS_EXPRESSIVE_TAG_OPTIONS = [
  { value: '<laugh>', label: 'Laugh' },
  { value: '<breath>', label: 'Breath' },
  { value: '<sigh>', label: 'Sigh' },
] as const

function createOutputFileName(text: string, voice: SupertonicTtsVoice): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `ai-tts-${sanitizeAiOutputFileNameSegment(text, 'speech')}-${voice.toLowerCase()}-supertonic-${timestamp}.wav`
}

function getSupertonicVoiceOption(voice: SupertonicTtsVoice): {
  value: SupertonicTtsVoice
  label: string
} {
  return (
    SUPERTONIC_TTS_VOICE_OPTIONS.find((option) => option.value === voice) ?? {
      value: voice,
      label: voice,
    }
  )
}

function isSupportedLanguageCode(value: string): value is SupertonicLanguageCode {
  return SUPERTONIC_TTS_SUPPORTED_LANGUAGE_CODES.includes(value as SupertonicLanguageCode)
}

function detectBrowserLanguage(): SupertonicLanguageCode {
  if (typeof navigator === 'undefined') return 'en'
  const langCode = (navigator.language || 'en').split('-')[0]?.toLowerCase() ?? 'en'
  return isSupportedLanguageCode(langCode) ? langCode : 'en'
}

function detectTextLanguage(text: string): SupertonicLanguageCode | null {
  const normalizedText = text.normalize('NFC').toLowerCase()
  if (/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(normalizedText)) return 'ko'
  if (/[\u3040-\u30ff]/.test(normalizedText)) return 'ja'
  if (/[\u0600-\u06ff\ufb50-\ufdff\ufe70-\ufeff]/.test(normalizedText)) return 'ar'
  if (/[\u0900-\u097f]/.test(normalizedText)) return 'hi'
  if (/[\u0370-\u03ff]/.test(normalizedText)) return 'el'
  if (/[\u0400-\u04ff]/.test(normalizedText)) {
    if (/[\u0456\u0457\u0454\u0491]/.test(normalizedText)) return 'uk'
    if (/\u044a/.test(normalizedText)) return 'bg'
    return 'ru'
  }

  if (/[ñ¿¡]/.test(normalizedText)) return 'es'
  if (/[ãõ]/.test(normalizedText)) return 'pt'
  if (/[œùûèêëàâîïô]/.test(normalizedText)) return 'fr'
  if (/[ßäöü]/.test(normalizedText)) return 'de'
  if (/[ąćęłńśźż]/.test(normalizedText)) return 'pl'
  if (/[ğşıİ]/.test(normalizedText)) return 'tr'
  if (/[ơưăđạảãàáấầẩẫậắằẳẵặẹẻẽèéếềểễệịỉĩìíọỏõòóốồổỗộợởỡờớụủũùúứừửữựỳỵỷỹý]/.test(normalizedText)) {
    return 'vi'
  }

  return null
}

function preprocessText(text: string, lang: SupertonicLanguageCode): string {
  let normalized = text
    .normalize('NFKD')
    .replace(/[\u{1f600}-\u{1f64f}\u{1f300}-\u{1f5ff}\u{1f680}-\u{1f6ff}\u{2600}-\u{27bf}]+/gu, '')
    .replace(/[–‑—]/g, '-')
    .replace(/[_[\]|/#→←]/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’´`]/g, "'")
    .replace(/[♥☆♡©\\]/g, '')
    .replaceAll('@', ' at ')
    .replaceAll('e.g.,', 'for example,')
    .replaceAll('i.e.,', 'that is,')
    .replace(/\s+/g, ' ')
    .trim()

  normalized = normalized
    .replace(/ ,/g, ',')
    .replace(/ \./g, '.')
    .replace(/ !/g, '!')
    .replace(/ \?/g, '?')
    .replace(/ ;/g, ';')
    .replace(/ :/g, ':')

  if (!/[.!?;:,'"')\]}…。」』】〉》›»]$/.test(normalized)) {
    normalized += '.'
  }

  return `<${lang}>${normalized}</${lang}>`
}

class UnicodeProcessor {
  constructor(private readonly indexer: Record<string, number>) {}

  call(
    textList: string[],
    lang: SupertonicLanguageCode,
  ): {
    textIds: number[][]
    textMask: number[][]
    unsupportedChars: string[]
  } {
    const processedTexts = textList.map((text) => preprocessText(text, lang))
    const textIdsLengths = processedTexts.map((text) => Array.from(text).length)
    const maxLen = Math.max(...textIdsLengths, 1)
    const unsupportedChars = new Set<string>()
    const textIds = processedTexts.map((text) => {
      const row = new Array<number>(maxLen).fill(0)
      Array.from(text).forEach((char, index) => {
        const indexValue = this.indexer[String(char.charCodeAt(0))]
        if (indexValue === undefined || indexValue === null || indexValue === -1) {
          unsupportedChars.add(char)
          return
        }
        row[index] = indexValue
      })
      return row
    })

    const textMask = textIdsLengths.map((length) =>
      Array.from({ length: maxLen }, (_, index) => (index < length ? 1 : 0)),
    )

    return { textIds, textMask, unsupportedChars: [...unsupportedChars] }
  }
}

function flattenUnknownNumbers(value: unknown): number[] {
  if (typeof value === 'number') return [value]
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => flattenUnknownNumbers(entry))
}

function floatTensor(ort: OrtModule, values: Float32Array | number[], dims: number[]): OrtTensor {
  return new ort.Tensor(
    'float32',
    values instanceof Float32Array ? values : Float32Array.from(values),
    dims,
  )
}

function int64Tensor(ort: OrtModule, values: number[], dims: number[]): OrtTensor {
  return new ort.Tensor('int64', BigInt64Array.from(values.map((value) => BigInt(value))), dims)
}

function createWavBlob(audioData: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2
  const dataSize = audioData.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

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
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  for (let index = 0; index < audioData.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, audioData[index] ?? 0))
    view.setInt16(44 + index * bytesPerSample, Math.round(sample * 32767), true)
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

function concatAudioSegments(segments: Float32Array[], sampleRate: number): Float32Array {
  const silenceLength = Math.floor(SILENCE_BETWEEN_SEGMENTS_SECONDS * sampleRate)
  const totalLength = segments.reduce(
    (sum, segment, index) =>
      sum + segment.length + (index < segments.length - 1 ? silenceLength : 0),
    0,
  )
  const merged = new Float32Array(totalLength)
  let offset = 0

  for (const [index, segment] of segments.entries()) {
    merged.set(segment, offset)
    offset += segment.length
    if (index < segments.length - 1) {
      offset += silenceLength
    }
  }

  return merged
}

function createNoisyLatent(
  config: SupertonicTtsConfig,
  durationSeconds: number,
): {
  latentBuffer: Float32Array
  latentMask: Float32Array
  latentShape: [number, number, number]
  latentMaskShape: [number, number, number]
} {
  const sampleRate = config.ae.sample_rate
  const chunkSize = config.ae.base_chunk_size * config.ttl.chunk_compress_factor
  const latentLen = Math.max(1, Math.ceil((durationSeconds * sampleRate) / chunkSize))
  const latentDim = config.ttl.latent_dim * config.ttl.chunk_compress_factor
  const latentMask = new Float32Array(latentLen).fill(1)
  const latentBuffer = new Float32Array(latentDim * latentLen)

  for (let index = 0; index < latentBuffer.length; index += 2) {
    const u1 = Math.max(Number.MIN_VALUE, Math.random())
    const u2 = Math.random()
    const radius = Math.sqrt(-2 * Math.log(u1))
    latentBuffer[index] = radius * Math.cos(2 * Math.PI * u2)
    if (index + 1 < latentBuffer.length) {
      latentBuffer[index + 1] = radius * Math.sin(2 * Math.PI * u2)
    }
  }

  return {
    latentBuffer,
    latentMask,
    latentShape: [1, latentDim, latentLen],
    latentMaskShape: [1, 1, latentLen],
  }
}

function getMaxSegmentLength(lang: SupertonicLanguageCode): number {
  return lang === 'ko' || lang === 'ja' ? MAX_CJK_CHARS_PER_SEGMENT : MAX_CHARS_PER_SEGMENT
}

function splitLongText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text]

  const words = text.split(/\s+/).filter(Boolean)
  if (words.length <= 1) {
    const chunks: string[] = []
    for (let index = 0; index < text.length; index += maxLength) {
      chunks.push(text.slice(index, index + maxLength))
    }
    return chunks
  }

  const chunks: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxLength) {
      current = candidate
      continue
    }
    if (current) chunks.push(current)
    current = word
  }
  if (current) chunks.push(current)
  return chunks
}

function chunkText(text: string, lang: SupertonicLanguageCode): string[] {
  const maxLength = getMaxSegmentLength(lang)
  const chunks: string[] = []
  const paragraphs = text
    .trim()
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  for (const paragraph of paragraphs) {
    const sentences = paragraph.split(
      /(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/,
    )
    let current = ''

    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim()
      if (!trimmedSentence) continue

      if (trimmedSentence.length > maxLength) {
        if (current) {
          chunks.push(current)
          current = ''
        }
        chunks.push(...splitLongText(trimmedSentence, maxLength))
        continue
      }

      const candidate = current ? `${current} ${trimmedSentence}` : trimmedSentence
      if (candidate.length <= maxLength) {
        current = candidate
      } else {
        if (current) chunks.push(current)
        current = trimmedSentence
      }
    }

    if (current) chunks.push(current)
  }

  return chunks.length > 0 ? chunks : [text.trim()]
}

function speedToDurationFactor(speed: number): number {
  const normalizedSpeed = Number.isFinite(speed) ? Math.min(1.3, Math.max(0.8, speed)) : 1
  return 1 / (normalizedSpeed + 0.05)
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as T
}

class SupertonicTtsService {
  private readonly runtimeFeature = 'tts'
  private readonly runtimeFeatureLabel = 'Supertonic TTS'
  private activeJobs = 0
  private generationChain: Promise<void> | null = null
  private ortPromise: Promise<OrtModule> | null = null
  private runtimePromise: Promise<SupertonicRuntime> | null = null
  private voiceStylePromises = new Map<SupertonicTtsVoice, Promise<VoiceStyleTensors>>()

  isSupported(): boolean {
    return typeof window !== 'undefined' && typeof WebAssembly !== 'undefined'
  }

  private getRuntimeId(): string {
    return `supertonic-tts:${MODEL_KEY}`
  }

  private getOrt(): Promise<OrtModule> {
    if (!this.ortPromise) {
      this.ortPromise = import('onnxruntime-web').then((module) => {
        module.env.wasm.wasmPaths = ORT_WASM_PATH
        module.env.wasm.numThreads = 1
        return module
      })
    }
    return this.ortPromise
  }

  private upsertRuntime(
    state: 'loading' | 'running' | 'ready' | 'error',
    backend: 'webgpu' | 'wasm' | 'unknown' = 'unknown',
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
        backend,
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
        backend,
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

  private incrementJobs(backend: 'webgpu' | 'wasm'): void {
    this.activeJobs += 1
    this.upsertRuntime('running', backend)
  }

  private decrementJobs(backend: 'webgpu' | 'wasm'): void {
    this.activeJobs = Math.max(0, this.activeJobs - 1)
    this.upsertRuntime('ready', backend)
  }

  private async loadModels(
    ort: OrtModule,
    backend: 'webgpu' | 'wasm',
    onProgress?: (stage: string) => void,
  ): Promise<SupertonicTtsModels> {
    const sessionOptions = {
      executionProviders: [backend],
      graphOptimizationLevel: 'all',
    } satisfies Parameters<OrtModule['InferenceSession']['create']>[1]
    const modelFiles = [
      ['durationPredictor', 'Duration predictor', 'duration_predictor.onnx'],
      ['textEncoder', 'Text encoder', 'text_encoder.onnx'],
      ['vectorEstimator', 'Vector estimator', 'vector_estimator.onnx'],
      ['vocoder', 'Vocoder', 'vocoder.onnx'],
    ] as const
    const loaded = {} as Partial<SupertonicTtsModels>
    let completed = 0

    await Promise.all(
      modelFiles.map(async ([key, label, fileName]) => {
        const session = await ort.InferenceSession.create(
          `${ONNX_BASE_URL}/${fileName}`,
          sessionOptions,
        )
        completed += 1
        onProgress?.(`Loading Supertonic ${backend.toUpperCase()} (${completed}/4): ${label}...`)
        loaded[key] = session
      }),
    )

    return {
      durationPredictor: loaded.durationPredictor,
      textEncoder: loaded.textEncoder,
      vectorEstimator: loaded.vectorEstimator,
      vocoder: loaded.vocoder,
    } as SupertonicTtsModels
  }

  private async ensureRuntime(onProgress?: (stage: string) => void): Promise<SupertonicRuntime> {
    if (this.runtimePromise) {
      return this.runtimePromise
    }

    this.upsertRuntime('loading')
    this.runtimePromise = (async () => {
      const ort = await this.getOrt()
      onProgress?.('Loading Supertonic configuration...')
      const [config, indexer] = await Promise.all([
        fetchJson<SupertonicTtsConfig>(`${ONNX_BASE_URL}/tts.json`),
        fetchJson<Record<string, number>>(`${ONNX_BASE_URL}/unicode_indexer.json`),
      ])

      const canUseWebGpu =
        typeof navigator !== 'undefined' && 'gpu' in navigator && window.isSecureContext
      let backend: 'webgpu' | 'wasm' = canUseWebGpu ? 'webgpu' : 'wasm'
      let models: SupertonicTtsModels

      try {
        onProgress?.(`Loading Supertonic models with ${backend.toUpperCase()}...`)
        models = await this.loadModels(ort, backend, onProgress)
      } catch (error) {
        if (backend !== 'webgpu') {
          throw error
        }
        logger.warn('Supertonic WebGPU load failed; falling back to WASM', error)
        backend = 'wasm'
        onProgress?.('WebGPU model load failed. Falling back to WASM...')
        models = await this.loadModels(ort, backend, onProgress)
      }

      const runtime = {
        backend,
        config,
        models,
        processors: {
          textProcessor: new UnicodeProcessor(indexer),
        },
      }

      this.upsertRuntime('ready', backend)
      return runtime
    })()

    try {
      return await this.runtimePromise
    } catch (error) {
      this.runtimePromise = null
      const message = error instanceof Error ? error.message : String(error)
      this.upsertRuntime('error', 'unknown', message)
      throw error
    }
  }

  private async loadVoiceStyle(
    ort: OrtModule,
    voice: SupertonicTtsVoice,
  ): Promise<VoiceStyleTensors> {
    const existing = this.voiceStylePromises.get(voice)
    if (existing) {
      return existing
    }

    const promise = fetchJson<VoiceStyleData>(`${VOICE_STYLE_BASE_URL}/${voice}.json`).then(
      (styleData) => ({
        styleTtl: new ort.Tensor(
          'float32',
          Float32Array.from(flattenUnknownNumbers(styleData.style_ttl.data)),
          styleData.style_ttl.dims,
        ),
        styleDp: new ort.Tensor(
          'float32',
          Float32Array.from(flattenUnknownNumbers(styleData.style_dp.data)),
          styleData.style_dp.dims,
        ),
      }),
    )

    this.voiceStylePromises.set(voice, promise)
    return promise
  }

  private async synthesizeSegment({
    lang,
    ort,
    runtime,
    text,
    totalSteps,
    durationFactor,
    style,
  }: {
    lang: SupertonicLanguageCode
    ort: OrtModule
    runtime: SupertonicRuntime
    text: string
    totalSteps: number
    durationFactor: number
    style: VoiceStyleTensors
  }): Promise<Float32Array> {
    const { textIds, textMask, unsupportedChars } = runtime.processors.textProcessor.call(
      [text],
      lang,
    )
    if (unsupportedChars.length > 0) {
      throw new Error(
        `Unsupported characters: ${unsupportedChars.map((char) => `"${char}"`).join(', ')}`,
      )
    }

    const textLength = textIds[0]?.length ?? 0
    const textIdsFlat = textIds[0] ?? []
    const textMaskFlat = textMask[0] ?? []
    const textMaskTensor = floatTensor(ort, textMaskFlat, [1, 1, textMaskFlat.length])
    const textIdsTensor = int64Tensor(ort, textIdsFlat, [1, textLength])

    const durationResult = await runtime.models.durationPredictor.run({
      text_ids: textIdsTensor,
      style_dp: style.styleDp,
      text_mask: textMaskTensor,
    })
    const durationTensor = durationResult.duration
    if (!durationTensor) {
      throw new Error('Supertonic duration predictor returned no duration.')
    }
    const rawDuration = Number(durationTensor.data[0] ?? 0)
    const durationSeconds = Math.max(0.1, rawDuration * durationFactor)

    const textEncodeResult = await runtime.models.textEncoder.run({
      text_ids: textIdsTensor,
      style_ttl: style.styleTtl,
      text_mask: textMaskTensor,
    })
    const textEmbeddingTensor = textEncodeResult.text_emb
    if (!textEmbeddingTensor) {
      throw new Error('Supertonic text encoder returned no embedding.')
    }

    const { latentBuffer, latentMask, latentShape, latentMaskShape } = createNoisyLatent(
      runtime.config,
      durationSeconds,
    )
    const totalStepTensor = floatTensor(ort, [totalSteps], [1])
    const stepTensors = Array.from({ length: totalSteps }, (_, step) =>
      floatTensor(ort, [step], [1]),
    )
    const latentMaskTensor = floatTensor(ort, latentMask, latentMaskShape)

    for (let step = 0; step < totalSteps; step += 1) {
      const currentStepTensor = stepTensors[step]
      if (!currentStepTensor) {
        throw new Error(`Missing Supertonic denoising step ${step}.`)
      }
      const vectorResult = await runtime.models.vectorEstimator.run({
        noisy_latent: floatTensor(ort, latentBuffer, latentShape),
        text_emb: textEmbeddingTensor,
        style_ttl: style.styleTtl,
        text_mask: textMaskTensor,
        latent_mask: latentMaskTensor,
        total_step: totalStepTensor,
        current_step: currentStepTensor,
      })
      const denoisedLatent = vectorResult.denoised_latent
      if (!denoisedLatent) {
        throw new Error('Supertonic vector estimator returned no denoised latent.')
      }
      latentBuffer.set(denoisedLatent.data as Float32Array)
    }

    const vocoderResult = await runtime.models.vocoder.run({
      latent: floatTensor(ort, latentBuffer, latentShape),
    })
    const wavTensor = vocoderResult.wav_tts
    if (!wavTensor) {
      throw new Error('Supertonic vocoder returned no audio.')
    }
    const wavBatch = wavTensor.data as Float32Array
    const wavLength = Math.max(1, Math.floor(runtime.config.ae.sample_rate * durationSeconds))
    return wavBatch.slice(0, Math.min(wavLength, wavBatch.length))
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
    try {
      const runtime = this.runtimePromise ? await this.runtimePromise : null
      if (runtime) {
        await Promise.allSettled(
          Object.values(runtime.models).map((session) => session.release?.()),
        )
      }
    } catch (error) {
      logger.warn('Failed to unload Supertonic runtime cleanly', error)
    } finally {
      this.runtimePromise = null
      this.voiceStylePromises.clear()
      this.activeJobs = 0
      localInferenceRuntimeRegistry.unregisterRuntime(this.getRuntimeId())
    }
  }

  async generateSpeechFile({
    text,
    voice,
    language,
    speed,
    onProgress,
  }: GenerateSpeechOptions): Promise<{ blob: Blob; file: File; duration: number }> {
    const trimmedText = validateTtsGenerateRequest({
      text,
      isSupported: this.isSupported(),
      unsupportedMessage: 'This browser cannot run the local Supertonic TTS runtime.',
    })

    return this.withGenerationLock(async () => {
      const runtime = await this.ensureRuntime(onProgress)
      const ort = await this.getOrt()
      this.incrementJobs(runtime.backend)

      try {
        onProgress?.(`Loading ${getSupertonicVoiceOption(voice).label} voice style...`)
        const style = await this.loadVoiceStyle(ort, voice)
        const lang =
          language === 'auto'
            ? (detectTextLanguage(trimmedText) ?? detectBrowserLanguage())
            : language
        const segments = chunkText(trimmedText, lang)
        const durationFactor = speedToDurationFactor(speed)
        const audioSegments: Float32Array[] = []

        for (const [index, segment] of segments.entries()) {
          onProgress?.(`Generating Supertonic segment ${index + 1}/${segments.length}...`)
          audioSegments.push(
            await this.synthesizeSegment({
              lang,
              ort,
              runtime,
              text: segment,
              totalSteps: DEFAULT_TOTAL_STEPS,
              durationFactor,
              style,
            }),
          )
        }

        const mergedAudio = concatAudioSegments(audioSegments, runtime.config.ae.sample_rate)
        const blob = createWavBlob(mergedAudio, runtime.config.ae.sample_rate)
        const file = new File([blob], createOutputFileName(trimmedText, voice), {
          type: 'audio/wav',
          lastModified: Date.now(),
        })

        return {
          blob,
          file,
          duration: mergedAudio.length / runtime.config.ae.sample_rate,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Failed to generate speech with Supertonic TTS runtime', error)
        this.upsertRuntime('error', runtime.backend, message)
        throw error
      } finally {
        this.decrementJobs(runtime.backend)
      }
    })
  }
}

export const supertonicTtsService = new SupertonicTtsService()
