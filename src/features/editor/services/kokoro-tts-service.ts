import { createLogger } from '@/shared/logging/logger';
import {
  localInferenceRuntimeRegistry,
  useLocalInferenceStore,
} from '@/shared/state/local-inference';
import { TRANSFORMERS_CACHE_NAME } from '@/shared/utils/local-model-cache';

const logger = createLogger('KokoroTtsService');

type KokoroTtsModule = typeof import('kokoro-js');
type KokoroTtsRuntimeInstance = Awaited<ReturnType<KokoroTtsModule['KokoroTTS']['from_pretrained']>>;

interface ProgressInfo {
  status?: string;
  file?: string;
  loaded?: number;
  total?: number;
}

interface GenerateSpeechOptions {
  text: string;
  voice: KokoroTtsVoice;
  speed: number;
  model: KokoroTtsModel;
  onProgress?: (stage: string) => void;
}

interface KokoroRuntime {
  tts: KokoroTtsRuntimeInstance;
  model: KokoroTtsModel;
}

interface KokoroTtsModelOption {
  value: string;
  label: string;
  downloadLabel: string;
  qualityLabel: string;
  estimatedBytes: number;
  dtype: 'q8' | 'fp16' | 'fp32';
  cacheMatchFragments: string[];
}

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

const MODEL_CONFIGS = {
  q8: {
    value: 'q8',
    label: 'Fast',
    downloadLabel: '88 MB',
    qualityLabel: 'Fastest',
    estimatedBytes: 92_361_116,
    dtype: 'q8',
    cacheMatchFragments: [
      '/onnx-community/kokoro-82m-v1.0-onnx/',
      '/onnx/model_quantized.onnx',
    ],
  },
  fp16: {
    value: 'fp16',
    label: 'Balanced',
    downloadLabel: '156 MB',
    qualityLabel: 'Higher quality',
    estimatedBytes: 163_234_740,
    dtype: 'fp16',
    cacheMatchFragments: [
      '/onnx-community/kokoro-82m-v1.0-onnx/',
      '/onnx/model_fp16.onnx',
    ],
  },
  fp32: {
    value: 'fp32',
    label: 'Best',
    downloadLabel: '310 MB',
    qualityLabel: 'Best quality',
    estimatedBytes: 325_532_232,
    dtype: 'fp32',
    cacheMatchFragments: [
      '/onnx-community/kokoro-82m-v1.0-onnx/',
      '/onnx/model.onnx',
    ],
  },
} as const satisfies Record<string, KokoroTtsModelOption>;

export type KokoroTtsModel = keyof typeof MODEL_CONFIGS;
type KokoroTtsModelConfig = (typeof MODEL_CONFIGS)[KokoroTtsModel];

export const KOKORO_TTS_MODEL_OPTIONS: KokoroTtsModelOption[] = [
  MODEL_CONFIGS.q8,
  MODEL_CONFIGS.fp16,
  MODEL_CONFIGS.fp32,
];

export const KOKORO_TTS_VOICE_OPTIONS = [
  { value: 'af_heart', label: 'Heart (US, F)' },
  { value: 'af_bella', label: 'Bella (US, F)' },
  { value: 'af_nicole', label: 'Nicole (US, F)' },
  { value: 'af_sky', label: 'Sky (US, F)' },
  { value: 'af_sarah', label: 'Sarah (US, F)' },
  { value: 'af_alloy', label: 'Alloy (US, F)' },
  { value: 'af_aoede', label: 'Aoede (US, F)' },
  { value: 'af_jessica', label: 'Jessica (US, F)' },
  { value: 'af_kore', label: 'Kore (US, F)' },
  { value: 'af_nova', label: 'Nova (US, F)' },
  { value: 'af_river', label: 'River (US, F)' },
  { value: 'am_michael', label: 'Michael (US, M)' },
  { value: 'am_fenrir', label: 'Fenrir (US, M)' },
  { value: 'am_puck', label: 'Puck (US, M)' },
  { value: 'am_adam', label: 'Adam (US, M)' },
  { value: 'am_echo', label: 'Echo (US, M)' },
  { value: 'am_eric', label: 'Eric (US, M)' },
  { value: 'am_liam', label: 'Liam (US, M)' },
  { value: 'am_onyx', label: 'Onyx (US, M)' },
  { value: 'am_santa', label: 'Santa (US, M)' },
  { value: 'bf_emma', label: 'Emma (UK, F)' },
  { value: 'bf_isabella', label: 'Isabella (UK, F)' },
  { value: 'bf_alice', label: 'Alice (UK, F)' },
  { value: 'bf_lily', label: 'Lily (UK, F)' },
  { value: 'bm_george', label: 'George (UK, M)' },
  { value: 'bm_fable', label: 'Fable (UK, M)' },
  { value: 'bm_lewis', label: 'Lewis (UK, M)' },
  { value: 'bm_daniel', label: 'Daniel (UK, M)' },
] as const;

export type KokoroTtsVoice = typeof KOKORO_TTS_VOICE_OPTIONS[number]['value'];

function makeSafeFileNameSegment(text: string): string {
  const collapsed = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return collapsed.slice(0, 32) || 'speech';
}

function createOutputFileName(text: string, voice: KokoroTtsVoice, model: KokoroTtsModel): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `ai-tts-${makeSafeFileNameSegment(text)}-${voice}-${model}-${timestamp}.wav`;
}

export function getKokoroTtsModelOption(model: KokoroTtsModel): KokoroTtsModelConfig {
  return MODEL_CONFIGS[model];
}

export function getKokoroTtsVoiceOption(voice: KokoroTtsVoice): { value: KokoroTtsVoice; label: string } {
  return KOKORO_TTS_VOICE_OPTIONS.find((option) => option.value === voice) ?? {
    value: voice,
    label: voice,
  };
}

const KOKORO_TTS_MAX_CHARS_PER_SEGMENT = 220;

function normalizeKokoroText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitSentenceLikeUnits(text: string): string[] {
  const paragraphs = normalizeKokoroText(text)
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  const units: string[] = [];

  for (const paragraph of paragraphs) {
    const sentences = paragraph.match(/[^.!?;:,\n]+(?:[.!?;:,]+|$)/g) ?? [paragraph];
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (trimmed) {
        units.push(trimmed);
      }
    }
  }

  return units;
}

function splitLongUnit(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    const candidate = `${current} ${word}`;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    chunks.push(current);
    current = word;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function chunkTextForKokoro(text: string, maxChars = KOKORO_TTS_MAX_CHARS_PER_SEGMENT): string[] {
  const units = splitSentenceLikeUnits(text);
  const segments: string[] = [];
  let current = '';

  const flushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) {
      segments.push(trimmed);
    }
    current = '';
  };

  for (const unit of units) {
    const normalizedUnit = unit.trim();
    if (!normalizedUnit) {
      continue;
    }

    if (normalizedUnit.length > maxChars) {
      flushCurrent();
      for (const longChunk of splitLongUnit(normalizedUnit, maxChars)) {
        if (longChunk.trim()) {
          segments.push(longChunk.trim());
        }
      }
      continue;
    }

    const candidate = current ? `${current} ${normalizedUnit}` : normalizedUnit;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      flushCurrent();
      current = normalizedUnit;
    }
  }

  flushCurrent();

  return segments.length > 0 ? segments : [normalizeKokoroText(text)];
}

function getRawAudioChunks(audio: { audio?: unknown }): Float32Array[] | null {
  const rawAudio = audio.audio;

  if (rawAudio instanceof Float32Array) {
    return [rawAudio];
  }

  if (Array.isArray(rawAudio)) {
    for (const chunk of rawAudio) {
      if (!(chunk instanceof Float32Array)) {
        return null;
      }
    }

    return rawAudio;
  }

  return null;
}

function getTotalSampleLength(chunks: Float32Array[]): number {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.length;
  }
  return total;
}

function createWavBlob(chunks: Float32Array[], sampleRate: number): Blob {
  const totalLength = getTotalSampleLength(chunks);
  const headerBuffer = new ArrayBuffer(44);
  const view = new DataView(headerBuffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + totalLength * 4, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 32, true);
  writeString(36, 'data');
  view.setUint32(40, totalLength * 4, true);

  const audioBuffers = chunks.map((chunk) => {
    const buffer = new ArrayBuffer(chunk.byteLength);
    new Uint8Array(buffer).set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    return buffer;
  });

  return new Blob([headerBuffer, ...audioBuffers], { type: 'audio/wav' });
}

function getAudioDurationSeconds(chunks: Float32Array[], sampleRate: number): number {
  return sampleRate > 0 ? getTotalSampleLength(chunks) / sampleRate : 0;
}

class KokoroTtsService {
  private readonly runtimeFeature = 'tts';
  private readonly runtimeFeatureLabel = 'Kokoro TTS';
  private modulePromise: Promise<KokoroTtsModule> | null = null;
  private runtimePromises = new Map<KokoroTtsModel, Promise<KokoroRuntime>>();
  private activeJobs = new Map<KokoroTtsModel, number>();
  private generationChains = new Map<KokoroTtsModel, Promise<void>>();

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
  }

  private async isModelCached(model: KokoroTtsModel): Promise<boolean> {
    try {
      const cacheStorage = globalThis.caches;
      if (!cacheStorage) return false;
      if (!(await cacheStorage.has(TRANSFORMERS_CACHE_NAME))) return false;

      const cache = await cacheStorage.open(TRANSFORMERS_CACHE_NAME);
      const keys = await cache.keys();
      const { cacheMatchFragments } = MODEL_CONFIGS[model];

      return cacheMatchFragments.some((fragment) =>
        keys.some((request) => request.url.toLowerCase().includes(fragment))
      );
    } catch {
      return false;
    }
  }

  private getRuntimeId(model: KokoroTtsModel): string {
    return `kokoro-tts:${model}`;
  }

  private getModule(): Promise<KokoroTtsModule> {
    if (!this.modulePromise) {
      this.modulePromise = import('kokoro-js');
    }

    return this.modulePromise;
  }

  private upsertRuntime(
    model: KokoroTtsModel,
    state: 'loading' | 'running' | 'ready' | 'error',
    errorMessage?: string,
  ): void {
    const runtimeId = this.getRuntimeId(model);
    const existing = useLocalInferenceStore.getState().runtimesById[runtimeId];
    const config = MODEL_CONFIGS[model];
    const now = Date.now();
    const activeJobs = this.activeJobs.get(model) ?? 0;

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
      });
      return;
    }

    localInferenceRuntimeRegistry.registerRuntime({
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
    }, {
      unload: () => this.unloadModel(model),
    });
  }

  private incrementJobs(model: KokoroTtsModel): void {
    const nextJobs = (this.activeJobs.get(model) ?? 0) + 1;
    this.activeJobs.set(model, nextJobs);
    this.upsertRuntime(model, 'running');
  }

  private decrementJobs(model: KokoroTtsModel): void {
    const nextJobs = Math.max(0, (this.activeJobs.get(model) ?? 0) - 1);
    this.activeJobs.set(model, nextJobs);
    this.upsertRuntime(model, 'ready');
  }

  private async ensureRuntime(
    model: KokoroTtsModel,
    onProgress?: (stage: string) => void,
  ): Promise<KokoroRuntime> {
    const existingPromise = this.runtimePromises.get(model);
    if (existingPromise) {
      return existingPromise;
    }

    this.upsertRuntime(model, 'loading');

    const runtimePromise = (async () => {
      const module = await this.getModule();
      const config = MODEL_CONFIGS[model];
      const cached = await this.isModelCached(model);
      const loadVerb = cached ? 'Loading' : 'Downloading';
      const downloadCache = new Map<string, { loaded: number; total: number }>();

      onProgress?.(
        cached
          ? `Loading Kokoro ${config.label.toLowerCase()} from cache...`
          : `Downloading Kokoro ${config.label.toLowerCase()} (${config.downloadLabel})...`,
      );

      const tts = await module.KokoroTTS.from_pretrained(MODEL_ID, {
        device: 'webgpu',
        dtype: config.dtype,
        progress_callback: (progress: ProgressInfo) => {
          if (progress.status !== 'progress' && progress.status !== 'download') {
            return;
          }
          if (!progress.file || !progress.total) {
            return;
          }

          downloadCache.set(progress.file, {
            loaded: progress.loaded ?? 0,
            total: progress.total,
          });

          let totalLoaded = 0;
          let totalExpected = 0;
          for (const entry of downloadCache.values()) {
            totalLoaded += entry.loaded;
            totalExpected += entry.total;
          }

          if (totalExpected > 0) {
            const fraction = Math.min(0.99, totalLoaded / totalExpected);
            onProgress?.(
              `${loadVerb} Kokoro ${config.label.toLowerCase()} (${Math.round(fraction * 100)}%)...`,
            );
          }
        },
      });

      this.upsertRuntime(model, 'ready');
      return { tts, model };
    })();

    this.runtimePromises.set(model, runtimePromise);

    try {
      return await runtimePromise;
    } catch (error) {
      this.runtimePromises.delete(model);
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to initialize ${model} Kokoro TTS runtime`, error);
      this.upsertRuntime(model, 'error', message);
      throw error;
    }
  }

  private async withGenerationLock<T>(model: KokoroTtsModel, task: () => Promise<T>): Promise<T> {
    const previous = this.generationChains.get(model) ?? Promise.resolve();
    let releaseCurrent = () => {};
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const queued = previous.then(() => current);
    this.generationChains.set(model, queued);

    await previous;

    try {
      return await task();
    } finally {
      releaseCurrent();
      if (this.generationChains.get(model) === queued) {
        this.generationChains.delete(model);
      }
    }
  }

  async unloadModel(model: KokoroTtsModel): Promise<void> {
    const runtimeId = this.getRuntimeId(model);
    const runtimePromise = this.runtimePromises.get(model);

    if (!runtimePromise) {
      localInferenceRuntimeRegistry.unregisterRuntime(runtimeId);
      this.activeJobs.delete(model);
      return;
    }

    try {
      const pendingGeneration = this.generationChains.get(model);
      if (pendingGeneration) {
        await pendingGeneration;
      }

      const runtime = await runtimePromise;
      await runtime.tts.model.dispose();
    } catch (error) {
      logger.warn(`Failed to unload ${model} Kokoro TTS runtime cleanly`, error);
    } finally {
      this.runtimePromises.delete(model);
      this.generationChains.delete(model);
      this.activeJobs.delete(model);
      localInferenceRuntimeRegistry.unregisterRuntime(runtimeId);
    }
  }

  async generateSpeechFile({
    text,
    voice,
    speed,
    model,
    onProgress,
  }: GenerateSpeechOptions): Promise<{ blob: Blob; file: File; duration: number }> {
    const trimmedText = text.trim();
    if (!trimmedText) {
      throw new Error('Enter some text to synthesize.');
    }

    if (!this.isSupported()) {
      throw new Error('WebGPU is not available in this browser.');
    }

    return this.withGenerationLock(model, async () => {
      const runtime = await this.ensureRuntime(model, onProgress);

      this.incrementJobs(model);

      try {
        onProgress?.('Preparing text...');
        onProgress?.('Generating speech...');
        const segments = chunkTextForKokoro(trimmedText);
        const collectedChunks: Float32Array[] = [];
        let sampleRate = 0;
        
        for (const [index, segment] of segments.entries()) {
          onProgress?.(`Generating speech segment ${index + 1}/${segments.length}...`);
          const audio = await runtime.tts.generate(segment, { voice, speed });
          const chunks = getRawAudioChunks(audio);
          if (!chunks || chunks.length === 0) {
            throw new Error('Kokoro returned an empty audio segment.');
          }

          if (sampleRate === 0) {
            sampleRate = audio.sampling_rate;
          }

          collectedChunks.push(...chunks);
        }

        if (collectedChunks.length === 0) {
          throw new Error('Kokoro did not return any audio.');
        }

        const blob = createWavBlob(collectedChunks, sampleRate);
        const file = new File([blob], createOutputFileName(trimmedText, voice, model), {
          type: 'audio/wav',
          lastModified: Date.now(),
        });

        return {
          blob,
          file,
          duration: getAudioDurationSeconds(collectedChunks, sampleRate),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to generate speech with ${model} Kokoro TTS runtime`, error);
        this.upsertRuntime(model, 'error', message);
        throw error;
      } finally {
        this.decrementJobs(model);
      }
    });
  }
}

export const kokoroTtsService = new KokoroTtsService();
