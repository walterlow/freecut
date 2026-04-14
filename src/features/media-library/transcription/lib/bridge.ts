import type {
  MainThreadMessage,
  PCMChunk,
  QuantizationType,
  TranscriptSegment,
  TranscribeProgress,
  TranscribeRuntimeInfo,
  WhisperModel,
} from '../types';
import { MODEL_IDS } from '../types';
import { createManagedWorkerSession } from '@/shared/utils/managed-worker-session';
import { Chunker } from './chunker';
import { downmixToMono, resampleTo16kHz } from './resampler';

export interface BridgeCallbacks {
  onSegment: (segment: TranscriptSegment) => void;
  onProgress: (event: TranscribeProgress) => void;
  onRuntimeInfo: (info: TranscribeRuntimeInfo) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export class Bridge {
  private readonly callbacks: BridgeCallbacks;
  private readonly session = createManagedWorkerSession({
    decoder: {
      createWorker: () => new Worker(
        new URL('../workers/decoder.worker.ts', import.meta.url),
        { type: 'module' }
      ),
      setupWorker: (worker) => {
        worker.onmessage = (event: MessageEvent<MainThreadMessage>) => {
          this.handleDecoderMessage(event.data);
        };

        worker.onerror = (event) => {
          this.callbacks.onError(`Decoder worker: ${event.message ?? 'unknown error'}`);
          this.terminate();
        };

        return () => {
          worker.onmessage = null;
          worker.onerror = null;
        };
      },
    },
    whisper: {
      createWorker: () => new Worker(
        new URL('../workers/whisper.worker.ts', import.meta.url),
        { type: 'module' }
      ),
      setupWorker: (worker) => {
        worker.onmessage = (event: MessageEvent<MainThreadMessage>) => {
          this.handleWhisperMessage(event.data);
        };

        worker.onerror = (event) => {
          this.callbacks.onError(`Whisper worker: ${event.message ?? 'unknown error'}`);
          this.terminate();
        };

        return () => {
          worker.onmessage = null;
          worker.onerror = null;
        };
      },
    },
  });

  constructor(callbacks: BridgeCallbacks) {
    this.callbacks = callbacks;
  }

  async start(
    file: File,
    model: WhisperModel = 'whisper-tiny',
    language?: string,
    quantization?: QuantizationType,
  ): Promise<void> {
    const { port1, port2 } = new MessageChannel();
    const modelId = MODEL_IDS[model];
    const hasWebCodecs = typeof window !== 'undefined' && 'AudioDecoder' in window;
    const whisperWorker = this.session.getWorker('whisper');

    if (hasWebCodecs) {
      this.session.getWorker('decoder').postMessage({ type: 'port', port: port1 }, [port1]);
    }

    this.session.registerCleanup(() => {
      port1.onmessage = null;
      port2.onmessage = null;
      port1.close();
      port2.close();
    });

    whisperWorker.postMessage({ type: 'port', port: port2 }, [port2]);
    whisperWorker.postMessage({ type: 'init', modelId, language, quantization });

    if (hasWebCodecs) {
      this.session.getWorker('decoder').postMessage({ type: 'init', file });
      return;
    }

    void this.decodeWithAudioContext(file, port1);
  }

  terminate(): void {
    if (this.session.isTerminated()) {
      return;
    }

    this.session.terminate();
  }

  private async decodeWithAudioContext(file: File, port: MessagePort): Promise<void> {
    try {
      this.callbacks.onProgress({ stage: 'decoding', progress: 0 });

      const arrayBuffer = await file.arrayBuffer();
      const AudioContextClass = window.AudioContext ?? (
        window as Window & { webkitAudioContext?: typeof AudioContext }
      ).webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error('AudioContext is not available in this browser');
      }

      const audioContext = new AudioContextClass();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      this.callbacks.onProgress({ stage: 'decoding', progress: 0.5 });

      const channels: Float32Array[] = [];
      for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
        channels.push(audioBuffer.getChannelData(i));
      }

      const mono = downmixToMono(channels);
      const resampled = resampleTo16kHz(mono, audioBuffer.sampleRate);

      let whisperQueueSize = 0;
      let whisperQueueWaiter: (() => void) | null = null;

      port.onmessage = (event: MessageEvent<number>) => {
        whisperQueueSize = event.data;
        if (whisperQueueSize < 3 && whisperQueueWaiter) {
          whisperQueueWaiter();
          whisperQueueWaiter = null;
        }
      };

      const chunker = new Chunker((chunk: PCMChunk) => {
        if (this.session.isTerminated()) {
          return;
        }
        port.postMessage(chunk, [chunk.samples.buffer]);
      });

      const samplesPerChunk = 16_000 * 30;
      for (let i = 0; i < resampled.length; i += samplesPerChunk) {
        if (this.session.isTerminated()) {
          break;
        }

        while (whisperQueueSize >= 3) {
          await new Promise<void>((resolve) => {
            whisperQueueWaiter = resolve;
          });
        }

        if (this.session.isTerminated()) {
          break;
        }

        const chunk = resampled.subarray(i, i + samplesPerChunk);
        chunker.push(chunk);
      }

      if (!this.session.isTerminated()) {
        chunker.flush();
        this.callbacks.onProgress({ stage: 'decoding', progress: 1 });
      }

      await audioContext.close();
    } catch (error) {
      this.callbacks.onError(
        `Decoder fallback error: ${error instanceof Error ? error.message : String(error)}`
      );
      this.terminate();
    }
  }

  private handleWhisperMessage(message: MainThreadMessage): void {
    if (this.session.isTerminated()) {
      return;
    }

    switch (message.type) {
      case 'segment':
        this.callbacks.onSegment(message.segment);
        break;
      case 'progress':
        this.callbacks.onProgress(message.event);
        break;
      case 'runtime':
        this.callbacks.onRuntimeInfo(message.info);
        break;
      case 'done':
        this.callbacks.onDone();
        this.terminate();
        break;
      case 'error':
        this.callbacks.onError(message.message);
        this.terminate();
        break;
      default:
        break;
    }
  }

  private handleDecoderMessage(message: MainThreadMessage): void {
    if (this.session.isTerminated()) {
      return;
    }

    switch (message.type) {
      case 'progress':
        this.callbacks.onProgress(message.event);
        break;
      case 'error':
        this.callbacks.onError(`Decoder: ${message.message}`);
        this.terminate();
        break;
      default:
        break;
    }
  }
}
