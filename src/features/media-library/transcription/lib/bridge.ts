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
  private readonly decoderWorker = new Worker(
    new URL('../workers/decoder.worker.ts', import.meta.url),
    { type: 'module' }
  );
  private readonly whisperWorker = new Worker(
    new URL('../workers/whisper.worker.ts', import.meta.url),
    { type: 'module' }
  );
  private readonly callbacks: BridgeCallbacks;
  private terminated = false;

  constructor(callbacks: BridgeCallbacks) {
    this.callbacks = callbacks;

    this.whisperWorker.onmessage = (event: MessageEvent<MainThreadMessage>) => {
      this.handleWhisperMessage(event.data);
    };

    this.decoderWorker.onmessage = (event: MessageEvent<MainThreadMessage>) => {
      this.handleDecoderMessage(event.data);
    };

    this.whisperWorker.onerror = (event) => {
      callbacks.onError(`Whisper worker: ${event.message ?? 'unknown error'}`);
      this.terminate();
    };

    this.decoderWorker.onerror = (event) => {
      callbacks.onError(`Decoder worker: ${event.message ?? 'unknown error'}`);
      this.terminate();
    };
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

    if (hasWebCodecs) {
      this.decoderWorker.postMessage({ type: 'port', port: port1 }, [port1]);
    }

    this.whisperWorker.postMessage({ type: 'port', port: port2 }, [port2]);
    this.whisperWorker.postMessage({ type: 'init', modelId, language, quantization });

    if (hasWebCodecs) {
      this.decoderWorker.postMessage({ type: 'init', file });
      return;
    }

    void this.decodeWithAudioContext(file, port1);
  }

  terminate(): void {
    if (this.terminated) {
      return;
    }

    this.terminated = true;
    this.decoderWorker.terminate();
    this.whisperWorker.terminate();
  }

  private async decodeWithAudioContext(file: File, port: MessagePort): Promise<void> {
    try {
      this.callbacks.onProgress({ stage: 'decoding', progress: 0 });

      const arrayBuffer = await file.arrayBuffer();
      const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
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
        if (this.terminated) {
          return;
        }
        port.postMessage(chunk, [chunk.samples.buffer]);
      });

      const samplesPerChunk = 16_000 * 30;
      for (let i = 0; i < resampled.length; i += samplesPerChunk) {
        if (this.terminated) {
          break;
        }

        while (whisperQueueSize >= 3) {
          await new Promise<void>((resolve) => {
            whisperQueueWaiter = resolve;
          });
        }

        if (this.terminated) {
          break;
        }

        const chunk = resampled.subarray(i, i + samplesPerChunk);
        chunker.push(chunk);
      }

      if (!this.terminated) {
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
    if (this.terminated) {
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
    if (this.terminated) {
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
