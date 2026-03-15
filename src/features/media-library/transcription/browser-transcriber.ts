import { Bridge } from './lib/bridge';
import type {
  TranscriptSegment,
  TranscribeOptions,
  TranscribeProgress,
  TranscribeRuntimeInfo,
  WhisperModel,
} from './types';
import type { MediaTranscriptQuantization } from '@/types/storage';
import { localInferenceRuntimeRegistry } from '@/shared/state/local-inference';
import { LOCAL_INFERENCE_UNLOADED_MESSAGE } from '@/shared/state/local-inference';
import { formatWhisperRuntimeModelLabel, estimateWhisperRuntimeBytes } from './runtime-estimates';

export class BrowserTranscriber {
  private readonly defaultOptions: TranscribeOptions;

  constructor(options: TranscribeOptions = {}) {
    this.defaultOptions = options;
  }

  transcribe(file: File, runtimeOptions: TranscribeOptions = {}): TranscribeStream {
    return new TranscribeStream(file, {
      ...this.defaultOptions,
      ...runtimeOptions,
    });
  }
}

export class TranscribeStream implements AsyncIterable<TranscriptSegment> {
  private readonly file: File;
  private readonly options: TranscribeOptions;
  private readonly runtimeId = `whisper-${crypto.randomUUID()}`;
  private readonly queue: TranscriptSegment[] = [];
  private doneFlag = false;
  private error: Error | undefined;
  private notify: (() => void) | null = null;
  private bridge: Bridge | null = null;
  private started = false;
  private runtimeRegistered = false;

  constructor(file: File, options: TranscribeOptions = {}) {
    this.file = file;
    this.options = options;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<TranscriptSegment> {
    await this.startBridge();

    while (true) {
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        if (next) {
          yield next;
        }
      } else if (this.error) {
        throw this.error;
      } else if (this.doneFlag) {
        return;
      } else {
        await new Promise<void>((resolve) => {
          this.notify = resolve;
        });
      }
    }
  }

  async collect(): Promise<TranscriptSegment[]> {
    const segments: TranscriptSegment[] = [];
    for await (const segment of this) {
      segments.push(segment);
    }
    return segments;
  }

  cancel(message = LOCAL_INFERENCE_UNLOADED_MESSAGE): void {
    this.bridge?.terminate();
    this.queue.length = 0;
    this.error = new Error(message);
    this.unregisterRuntime();
    this.wakeUp();
  }

  private async startBridge(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;
    this.registerRuntime();
    this.bridge = new Bridge({
      onSegment: (segment: TranscriptSegment) => {
        this.queue.push(segment);
        this.options.onSegment?.(segment);
        this.wakeUp();
      },
      onProgress: (event: TranscribeProgress) => {
        this.updateRuntimeFromProgress(event);
        this.options.onProgress?.(event);
      },
      onRuntimeInfo: (info: TranscribeRuntimeInfo) => {
        this.updateRuntime(info);
        this.options.onRuntimeInfo?.(info);
      },
      onDone: () => {
        this.doneFlag = true;
        this.unregisterRuntime();
        this.wakeUp();
      },
      onError: (message: string) => {
        this.error = new Error(message);
        this.unregisterRuntime();
        this.wakeUp();
      },
    });

    try {
      await this.bridge.start(
        this.file,
        (this.options.model as WhisperModel | undefined) ?? 'whisper-tiny',
        this.options.language,
        this.options.quantization,
      );
    } catch (error) {
      this.error = error instanceof Error ? error : new Error(String(error));
      this.unregisterRuntime();
      this.wakeUp();
    }
  }

  private registerRuntime(): void {
    if (this.runtimeRegistered) {
      return;
    }

    this.runtimeRegistered = true;
    const model = (this.options.model as WhisperModel | undefined) ?? 'whisper-tiny';
    const quantization = (this.options.quantization as MediaTranscriptQuantization | undefined) ?? 'hybrid';
    const now = Date.now();

    localInferenceRuntimeRegistry.registerRuntime({
      id: this.runtimeId,
      feature: 'whisper',
      featureLabel: 'Whisper',
      modelKey: model,
      modelLabel: formatWhisperRuntimeModelLabel(model, quantization),
      backend: 'unknown',
      state: 'loading',
      estimatedBytes: estimateWhisperRuntimeBytes(model, quantization),
      activeJobs: 1,
      loadedAt: now,
      lastUsedAt: now,
      unloadable: true,
    }, {
      unload: () => {
        this.cancel();
      },
    });
  }

  private unregisterRuntime(): void {
    if (!this.runtimeRegistered) {
      return;
    }

    this.runtimeRegistered = false;
    localInferenceRuntimeRegistry.unregisterRuntime(this.runtimeId);
  }

  private updateRuntime(info: TranscribeRuntimeInfo): void {
    if (!this.runtimeRegistered) {
      return;
    }

    localInferenceRuntimeRegistry.updateRuntime(this.runtimeId, {
      ...(info.backend ? { backend: info.backend } : {}),
      ...(info.estimatedBytes ? { estimatedBytes: info.estimatedBytes } : {}),
      lastUsedAt: Date.now(),
    });
  }

  private updateRuntimeFromProgress(event: TranscribeProgress): void {
    if (!this.runtimeRegistered) {
      return;
    }

    localInferenceRuntimeRegistry.updateRuntime(this.runtimeId, {
      state: event.stage === 'loading' ? 'loading' : 'running',
      lastUsedAt: Date.now(),
    });
  }

  private wakeUp(): void {
    const resolver = this.notify;
    this.notify = null;
    resolver?.();
  }
}
