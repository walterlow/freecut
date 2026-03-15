import type {
  MainThreadMessage,
  PCMChunk,
  QuantizationType,
  WhisperWorkerMessage,
} from '../types';

const TRANSFORMERS_CDN_URL = 'https://esm.sh/@huggingface/transformers@3.8.1?bundle';
const WASM_CDN_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/';

type ASRPipeline = (input: Float32Array, options: Record<string, unknown>) => Promise<unknown>;

interface ProgressInfo {
  status?: string;
  file?: string;
  loaded?: number;
  total?: number;
}

interface TransformersModule {
  env: {
    useBrowserCache: boolean;
    allowLocalModels: boolean;
    backends: {
      onnx: {
        wasm: {
          wasmPaths?: string;
        };
      };
    };
  };
  pipeline: (
    task: string,
    modelId: string,
    options: {
      device: 'webgpu' | 'wasm';
      dtype: Record<string, string> | string;
      progress_callback?: (progress: ProgressInfo) => void;
    }
  ) => Promise<ASRPipeline>;
}

let asrPipeline: ASRPipeline | null = null;
let currentModelId: string | null = null;
let port: MessagePort | null = null;
let language: string | undefined;
let pipelineReady = false;
const queue: PCMChunk[] = [];
let processing = false;
let reportedEstimatedBytes = 0;

self.onmessage = async (event: MessageEvent) => {
  const message = event.data as WhisperWorkerMessage;

  if (message.type === 'port') {
    port = message.port;
    port.onmessage = (portEvent: MessageEvent<PCMChunk>) => {
      enqueue(portEvent.data);
    };
    return;
  }

  if (message.type === 'init') {
    language = message.language;
    await initPipeline(message.modelId, message.quantization ?? 'hybrid');
  }
};

function enqueue(chunk: PCMChunk): void {
  queue.push(chunk);
  port?.postMessage(queue.length);
  if (pipelineReady && !processing) {
    void processNext();
  }
}

async function initPipeline(modelId: string, quantization: QuantizationType): Promise<void> {
  postMain({ type: 'progress', event: { stage: 'loading', progress: 0 } });
  reportedEstimatedBytes = 0;

  try {
    const { pipeline, env } = await import(
      /* @vite-ignore */ TRANSFORMERS_CDN_URL
    ) as TransformersModule;

    env.useBrowserCache = true;
    env.allowLocalModels = false;
    env.backends.onnx.wasm.wasmPaths = WASM_CDN_URL;

    if (asrPipeline && currentModelId !== modelId) {
      const disposable = asrPipeline as ASRPipeline & { dispose?: () => Promise<void> | void };
      await disposable.dispose?.();
      asrPipeline = null;
    }

    if (!asrPipeline || currentModelId !== modelId) {
      currentModelId = modelId;
      const downloadCache = new Map<string, { loaded: number; total: number }>();
      const dtype =
        quantization === 'hybrid'
          ? { encoder_model: 'fp32', decoder_model_merged: 'q4' }
          : quantization;

      const progressCallback = (progress: ProgressInfo) => {
        if (progress.status !== 'download' || !progress.file || !progress.total) {
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
          if (totalExpected > reportedEstimatedBytes) {
            reportedEstimatedBytes = totalExpected;
            postMain({ type: 'runtime', info: { estimatedBytes: totalExpected } });
          }

          postMain({
            type: 'progress',
            event: {
              stage: 'loading',
              progress: Math.min(totalLoaded / totalExpected, 0.99),
            },
          });
        }
      };

      const loadPipeline = async (device: 'webgpu' | 'wasm') =>
        pipeline('automatic-speech-recognition', modelId, {
          device,
          dtype,
          progress_callback: progressCallback,
        });

      try {
        asrPipeline = await loadPipeline('webgpu');
        postMain({ type: 'runtime', info: { backend: 'webgpu' } });
      } catch (error) {
        console.warn(
          `[FreeCut transcription] WebGPU initialization failed: ${
            error instanceof Error ? error.message : String(error)
          }. Falling back to WASM.`
        );
        asrPipeline = await loadPipeline('wasm');
        postMain({ type: 'runtime', info: { backend: 'wasm' } });
      }

      postMain({ type: 'progress', event: { stage: 'loading', progress: 0.99 } });
      try {
        await asrPipeline(new Float32Array(1_600), {
          sampling_rate: 16_000,
          language: 'en',
        });
      } catch {
        // Ignore pre-warm failures. Real inference may still succeed.
      }
    }

    pipelineReady = true;
    postMain({ type: 'progress', event: { stage: 'loading', progress: 1 } });
    postMain({ type: 'ready' });

    if (queue.length > 0 && !processing) {
      void processNext();
    }
  } catch (error) {
    currentModelId = null;
    asrPipeline = null;
    pipelineReady = false;
    postMain({
      type: 'error',
      message: `Failed to initialize Whisper model: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
}

async function processNext(): Promise<void> {
  if (!pipelineReady || !asrPipeline) {
    processing = false;
    return;
  }

  const chunk = queue.shift();
  if (!chunk) {
    processing = false;
    return;
  }

  processing = true;
  port?.postMessage(queue.length);

  try {
    await transcribeChunk(chunk);
  } catch (error) {
    postMain({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
    processing = false;
    return;
  }

  processing = false;
  if (queue.length > 0) {
    void processNext();
  }
}

async function transcribeChunk(chunk: PCMChunk): Promise<void> {
  if (!asrPipeline) {
    return;
  }

  if (chunk.samples.length === 0) {
    if (chunk.final) {
      postMain({ type: 'done' });
    }
    return;
  }

  postMain({ type: 'progress', event: { stage: 'transcribing', progress: 0 } });

  const result = await asrPipeline(chunk.samples, {
    sampling_rate: 16_000,
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5,
    ...(language ? { language } : {}),
  });

  const output = result as {
    chunks?: Array<{ text: string; timestamp: [number | null, number | null] }>;
  };

  for (const segment of output.chunks ?? []) {
    postMain({
      type: 'segment',
      segment: {
        text: segment.text,
        start: (segment.timestamp[0] ?? 0) + chunk.timestamp,
        end: (segment.timestamp[1] ?? 0) + chunk.timestamp,
      },
    });
  }

  postMain({ type: 'progress', event: { stage: 'transcribing', progress: 1 } });

  if (chunk.final) {
    postMain({ type: 'done' });
  }
}

function postMain(message: MainThreadMessage): void {
  (self as unknown as Worker).postMessage(message);
}
