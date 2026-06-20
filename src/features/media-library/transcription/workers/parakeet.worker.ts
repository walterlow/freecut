import type { MainThreadMessage, PCMChunk, TranscriptWord, WhisperWorkerMessage } from '../types'
import { createLogger } from '@/shared/logging/logger'

// Parakeet TDT 0.6B v3 (NVIDIA, CC-BY-4.0) on-device ASR. Clean-room ORT-web pipeline
// (nemo128 log-mel preprocessor -> FastConformer encoder -> token-and-duration greedy
// decode -> BPE detokenize), authored from the published onnx-asr algorithm. The encoder
// runs on WebGPU (fp16) while the tiny autoregressive joint runs on WASM/CPU — the joint
// has hundreds of sequential steps per span and per-step GPU dispatch sync dominates, so
// keeping it on CPU is ~7x faster overall (measured). Implements the same worker message
// protocol as whisper.worker.ts so the Bridge can drive either engine.

const logger = createLogger('ParakeetWorker')

const ORT_WASM_PATH =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260410-5e55544225/dist/'
const HF_BASE = 'https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx/resolve/main'

const ENCODER_FP16 = 'encoder-model.fp16.onnx'
const ENCODER_INT8 = 'encoder-model.int8.onnx'
const DECODER_INT8 = 'decoder_joint-model.int8.onnx'
const PREPROCESSOR = 'nemo128.onnx'
const VOCAB_FILE = 'vocab.txt'

const SUBSAMPLING = 8
const SEC_PER_FRAME = 0.01 * SUBSAMPLING // 80ms per encoder frame
const MAX_TOKENS_PER_STEP = 10
const STATE_SHAPE = [2, 1, 640] as const // [pred_rnn_layers, batch, pred_hidden]

const RECENT_WORD_RETENTION_SECONDS = 8
const DUPLICATE_WORD_START_TOLERANCE_SECONDS = 0.5

const ESTIMATED_BYTES: Record<'webgpu' | 'wasm', number> = {
  webgpu: Math.round(1_270 * 1024 * 1024),
  wasm: Math.round(820 * 1024 * 1024),
}

type OrtModule = typeof import('onnxruntime-web')
type OrtTensor = InstanceType<OrtModule['Tensor']>
type OrtSession = Awaited<ReturnType<OrtModule['InferenceSession']['create']>>

let ortPromise: Promise<OrtModule> | null = null
let preproc: OrtSession | null = null
let encoder: OrtSession | null = null
let decoder: OrtSession | null = null
let vocab: { idToToken: Map<number, string>; vocabSize: number; blankIdx: number } | null = null
let activeBackend: 'webgpu' | 'wasm' = 'wasm'

let port: MessagePort | null = null
let pipelineReady = false
let paused = false
let processing = false
// Serializes init so a pre-warm init and the real job's init can't compile concurrently.
let initChain: Promise<void> = Promise.resolve()
const queue: PCMChunk[] = []
const recentWords: TranscriptWord[] = []

self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  const reason = event.reason
  const message =
    reason instanceof Error
      ? `${reason.name}: ${reason.message}`
      : typeof reason === 'string'
        ? reason
        : 'Unknown worker error'
  postMain({ type: 'error', message })
  event.preventDefault()
})

self.addEventListener('error', (event: ErrorEvent) => {
  postMain({
    type: 'error',
    message: event.message || (event.error instanceof Error ? event.error.message : 'Worker error'),
  })
})

self.onmessage = async (event: MessageEvent) => {
  const message = event.data as WhisperWorkerMessage

  if (message.type === 'port') {
    port = message.port
    port.onmessage = (portEvent: MessageEvent<PCMChunk>) => {
      enqueue(portEvent.data)
    }
    return
  }

  if (message.type === 'init') {
    // Reset per-job state — the worker (and its compiled sessions) is reused across jobs.
    recentWords.length = 0
    queue.length = 0
    processing = false
    paused = false
    initChain = initChain.then(() => initPipeline()).catch(() => {})
    await initChain
    return
  }

  if (message.type === 'pause') {
    paused = true
    return
  }

  if (message.type === 'resume') {
    if (!paused) return
    paused = false
    if (pipelineReady && !processing && queue.length > 0) {
      void processNext()
    }
  }
}

function getOrt(): Promise<OrtModule> {
  if (!ortPromise) {
    ortPromise = import('onnxruntime-web').then((module) => {
      module.env.wasm.wasmPaths = ORT_WASM_PATH
      module.env.wasm.numThreads = 1
      return module
    })
  }
  return ortPromise
}

async function fetchModel(
  url: string,
  onBytes?: (received: number, total: number) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok || !res.body) {
    throw new Error(`Failed to fetch ${url} (${res.status})`)
  }
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    onBytes?.(received, total)
  }
  const buf = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    buf.set(chunk, offset)
    offset += chunk.byteLength
  }
  return buf.buffer
}

async function loadVocab(): Promise<NonNullable<typeof vocab>> {
  const text = await (await fetch(`${HF_BASE}/${VOCAB_FILE}`)).text()
  const idToToken = new Map<number, string>()
  let blankIdx = -1
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line) continue
    const sep = line.lastIndexOf(' ')
    if (sep < 0) continue
    const token = line.slice(0, sep)
    const id = Number(line.slice(sep + 1))
    if (!Number.isFinite(id)) continue
    idToToken.set(id, token.replace(/▁/g, ' ')) // ▁ -> space
    if (token === '<blk>') blankIdx = id
  }
  if (blankIdx < 0) {
    throw new Error('Parakeet vocab is missing the <blk> token')
  }
  return { idToToken, vocabSize: idToToken.size, blankIdx }
}

async function createSession(
  ort: OrtModule,
  url: string,
  backend: 'webgpu' | 'wasm',
  onBytes?: (received: number, total: number) => void,
): Promise<OrtSession> {
  const bytes = await fetchModel(url, onBytes)
  return ort.InferenceSession.create(bytes, {
    executionProviders: [backend],
    graphOptimizationLevel: 'all',
  })
}

async function initPipeline(): Promise<void> {
  if (pipelineReady) {
    // Warm reuse: sessions already compiled — skip download/compile entirely.
    postMain({
      type: 'runtime',
      info: { backend: activeBackend, estimatedBytes: ESTIMATED_BYTES[activeBackend] },
    })
    postMain({ type: 'progress', event: { stage: 'loading', progress: 1 } })
    postMain({ type: 'ready' })
    if (queue.length > 0 && !processing && !paused) {
      void processNext()
    }
    return
  }

  postMain({ type: 'progress', event: { stage: 'loading', progress: 0 } })

  try {
    const ort = await getOrt()
    vocab = await loadVocab()

    // Preprocessor + autoregressive joint always run on WASM (tiny graphs, no per-step
    // GPU sync). The heavy encoder prefers WebGPU and falls back to the int8 WASM encoder.
    preproc = await createSession(ort, `${HF_BASE}/${PREPROCESSOR}`, 'wasm')

    let encoderBackend: 'webgpu' | 'wasm' = 'wasm'
    const webgpuAvailable =
      typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu != null
    if (webgpuAvailable) {
      try {
        encoder = await createSession(
          ort,
          `${HF_BASE}/${ENCODER_FP16}`,
          'webgpu',
          (received, total) => {
            // Encoder download dominates total bytes — drive the loading bar from it.
            postMain({
              type: 'progress',
              event: { stage: 'loading', progress: total ? Math.min(received / total, 0.98) : 0 },
            })
          },
        )
        encoderBackend = 'webgpu'
      } catch (error) {
        logger.warn(
          `WebGPU encoder init failed, falling back to WASM int8: ${error instanceof Error ? error.message : String(error)}`,
        )
        encoder = null
      }
    }
    if (!encoder) {
      encoder = await createSession(
        ort,
        `${HF_BASE}/${ENCODER_INT8}`,
        'wasm',
        (received, total) => {
          postMain({
            type: 'progress',
            event: { stage: 'loading', progress: total ? Math.min(received / total, 0.98) : 0 },
          })
        },
      )
      encoderBackend = 'wasm'
    }

    decoder = await createSession(ort, `${HF_BASE}/${DECODER_INT8}`, 'wasm')

    activeBackend = encoderBackend
    postMain({
      type: 'runtime',
      info: { backend: activeBackend, estimatedBytes: ESTIMATED_BYTES[activeBackend] },
    })

    pipelineReady = true
    postMain({ type: 'progress', event: { stage: 'loading', progress: 1 } })
    postMain({ type: 'ready' })

    if (queue.length > 0 && !processing && !paused) {
      void processNext()
    }
  } catch (error) {
    pipelineReady = false
    postMain({
      type: 'error',
      message: `Failed to initialize Parakeet model: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
}

function enqueue(chunk: PCMChunk): void {
  queue.push(chunk)
  port?.postMessage(queue.length)
  if (pipelineReady && !processing && !paused) {
    void processNext()
  }
}

async function processNext(): Promise<void> {
  if (!pipelineReady || paused) {
    processing = false
    return
  }

  const chunk = queue.shift()
  if (!chunk) {
    processing = false
    return
  }

  processing = true
  port?.postMessage(queue.length)

  try {
    await transcribeChunk(chunk)
  } catch (error) {
    postMain({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    processing = false
    return
  }

  processing = false
  if (queue.length > 0 && !paused) {
    void processNext()
  }
}

// --- Tensor helpers -------------------------------------------------------

function f32(ort: OrtModule, data: Float32Array, dims: number[]): OrtTensor {
  return new ort.Tensor('float32', data, dims)
}
function i32(ort: OrtModule, values: number[], dims: number[]): OrtTensor {
  return new ort.Tensor('int32', Int32Array.from(values), dims)
}
function i64(ort: OrtModule, values: number[], dims: number[]): OrtTensor {
  return new ort.Tensor('int64', BigInt64Array.from(values.map((v) => BigInt(v))), dims)
}
function zeroState(ort: OrtModule): [OrtTensor, OrtTensor] {
  const size = STATE_SHAPE[0] * STATE_SHAPE[1] * STATE_SHAPE[2]
  return [
    new ort.Tensor('float32', new Float32Array(size), STATE_SHAPE as unknown as number[]),
    new ort.Tensor('float32', new Float32Array(size), STATE_SHAPE as unknown as number[]),
  ]
}

function argmax(arr: ArrayLike<number>, start: number, end: number): number {
  let best = start
  let bestVal = arr[start] ?? Number.NEGATIVE_INFINITY
  for (let i = start + 1; i < end; i++) {
    const v = arr[i] ?? Number.NEGATIVE_INFINITY
    if (v > bestVal) {
      bestVal = v
      best = i
    }
  }
  return best
}

// --- Pipeline -------------------------------------------------------------

async function transcribeChunk(chunk: PCMChunk): Promise<void> {
  if (!preproc || !encoder || !decoder || !vocab) return

  if (chunk.samples.length === 0) {
    if (chunk.final) postMain({ type: 'done' })
    return
  }

  postMain({ type: 'progress', event: { stage: 'transcribing', progress: 0 } })

  const ort = await getOrt()

  // 1. Log-mel features: waveforms [1,N] + waveforms_lens [1] -> features [1,128,T].
  const preOut = (await preproc.run({
    waveforms: f32(ort, chunk.samples, [1, chunk.samples.length]),
    waveforms_lens: i64(ort, [chunk.samples.length], [1]),
  })) as Record<string, OrtTensor>

  // 2. Encoder: audio_signal [1,128,T] + length [1] -> outputs [1,D,T'] + encoded_lengths.
  const encOut = (await encoder.run({
    audio_signal: preOut.features!,
    length: preOut.features_lens!,
  })) as Record<string, OrtTensor>
  const encoded = encOut.outputs!
  const encDims = encoded.dims as number[]
  const D = encDims[1] ?? 0
  const T = encDims[2] ?? 0
  const encData = encoded.data as Float32Array
  const lenData = encOut.encoded_lengths!.data as BigInt64Array
  const frames = Math.min(Number(lenData[0] ?? T), T)

  // 3. Greedy token-and-duration decode over encoder frames.
  const { idToToken, vocabSize, blankIdx } = vocab
  const tokens: number[] = []
  const timestamps: number[] = []
  let state = zeroState(ort)
  const frameBuf = new Float32Array(D)

  let t = 0
  let emitted = 0
  while (t < frames) {
    for (let d = 0; d < D; d++) frameBuf[d] = encData[d * T + t] ?? 0
    const lastToken = tokens.length ? tokens[tokens.length - 1]! : blankIdx

    const out = (await decoder.run({
      encoder_outputs: f32(ort, frameBuf.slice(), [1, D, 1]),
      targets: i32(ort, [lastToken], [1, 1]),
      target_length: i32(ort, [1], [1]),
      input_states_1: state[0],
      input_states_2: state[1],
    })) as Record<string, OrtTensor>

    const logits = out.outputs!.data as Float32Array
    const token = argmax(logits, 0, vocabSize)
    const step = argmax(logits, vocabSize, logits.length) - vocabSize

    if (token !== blankIdx) {
      state = [out.output_states_1!, out.output_states_2!]
      tokens.push(token)
      timestamps.push(t)
      emitted++
    }

    if (step > 0) {
      t += step
      emitted = 0
    } else if (token === blankIdx || emitted === MAX_TOKENS_PER_STEP) {
      t += 1
      emitted = 0
    }
  }

  // 4. Group BPE tokens into words; timestamps are chunk-relative -> offset to absolute.
  const words: TranscriptWord[] = []
  let current: TranscriptWord | null = null
  for (let i = 0; i < tokens.length; i++) {
    const piece = idToToken.get(tokens[i]!) ?? ''
    const start = chunk.timestamp + timestamps[i]! * SEC_PER_FRAME
    const end = chunk.timestamp + (timestamps[i]! + 1) * SEC_PER_FRAME
    if (piece.startsWith(' ') || current === null) {
      if (current) words.push(current)
      current = { text: piece.trim(), start, end }
    } else {
      current.text += piece.trim()
      current.end = end
    }
  }
  if (current) words.push(current)

  const deduped = dedupeOverlappingWords(words.filter((w) => w.text.length > 0))

  if (deduped.length > 0) {
    const newestEnd = deduped.at(-1)?.end ?? chunk.timestamp
    recentWords.push(...deduped)
    while (
      recentWords.length > 0 &&
      (recentWords[0]?.end ?? 0) < newestEnd - RECENT_WORD_RETENTION_SECONDS
    ) {
      recentWords.shift()
    }

    postMain({
      type: 'segment',
      segment: {
        text: deduped
          .map((w) => w.text)
          .join(' ')
          .trim(),
        start: deduped[0]?.start ?? chunk.timestamp,
        end: deduped.at(-1)?.end ?? chunk.timestamp,
        words: deduped,
      },
    })
  }

  postMain({ type: 'progress', event: { stage: 'transcribing', progress: 1 } })

  if (chunk.final) postMain({ type: 'done' })
}

function dedupeOverlappingWords(words: TranscriptWord[]): TranscriptWord[] {
  return words.filter((word) => {
    const normalized = normalizeWordText(word.text)
    if (!normalized) return true
    return !recentWords.some((recent) => {
      if (normalizeWordText(recent.text) !== normalized) return false
      const startsClose =
        Math.abs(recent.start - word.start) <= DUPLICATE_WORD_START_TOLERANCE_SECONDS
      const overlaps = recent.start < word.end && word.start < recent.end
      return startsClose || overlaps
    })
  })
}

function normalizeWordText(text: string): string {
  return text.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

function postMain(message: MainThreadMessage): void {
  ;(self as unknown as Worker).postMessage(message)
}
