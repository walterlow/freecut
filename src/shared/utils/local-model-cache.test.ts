import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  LOCAL_MODEL_CACHE_DEFINITIONS,
  clearLocalModelCache,
  inspectAllLocalModelCaches,
  TRANSFORMERS_CACHE_NAME,
} from './local-model-cache'
import {
  SCENE_VERIFICATION_MODEL_IDS,
  SCENE_VERIFICATION_MODEL_LABELS,
} from './scene-verification-models'
import { MUSICGEN_MODEL_IDS, MUSICGEN_MODEL_OPTIONS } from './musicgen-models'

type CacheEntries = Record<string, Response>
type CacheMap = Record<string, CacheEntries>

function createMockCacheStorage(initialCaches: CacheMap): CacheStorage {
  const cacheMap = new Map(
    Object.entries(initialCaches).map(([cacheName, entries]) => [
      cacheName,
      new Map(Object.entries(entries)),
    ]),
  )

  return {
    async delete(cacheName: string) {
      return cacheMap.delete(cacheName)
    },
    async has(cacheName: string) {
      return cacheMap.has(cacheName)
    },
    async keys() {
      return [...cacheMap.keys()]
    },
    async match(request: RequestInfo | URL) {
      const requestUrl =
        typeof request === 'string'
          ? request
          : request instanceof URL
            ? request.toString()
            : request.url

      for (const entries of cacheMap.values()) {
        const response = entries.get(requestUrl)
        if (response) {
          return response.clone()
        }
      }

      return undefined
    },
    async open(cacheName: string) {
      let entries = cacheMap.get(cacheName)
      if (!entries) {
        entries = new Map()
        cacheMap.set(cacheName, entries)
      }

      return {
        async add() {
          throw new Error('Not implemented in test')
        },
        async addAll() {
          throw new Error('Not implemented in test')
        },
        async delete(request: RequestInfo | URL) {
          const requestUrl =
            typeof request === 'string'
              ? request
              : request instanceof URL
                ? request.toString()
                : request.url
          return entries.delete(requestUrl)
        },
        async keys() {
          return [...entries.keys()].map((url) => new Request(url))
        },
        async match(request: RequestInfo | URL) {
          const requestUrl =
            typeof request === 'string'
              ? request
              : request instanceof URL
                ? request.toString()
                : request.url
          return entries.get(requestUrl)?.clone()
        },
        async matchAll() {
          return [...entries.values()].map((response) => response.clone())
        },
        async put(request: RequestInfo | URL, response: Response) {
          const requestUrl =
            typeof request === 'string'
              ? request
              : request instanceof URL
                ? request.toString()
                : request.url
          entries.set(requestUrl, response.clone())
        },
      } as Cache
    },
  } as CacheStorage
}

describe('local-model-cache', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'caches',
      createMockCacheStorage({
        [TRANSFORMERS_CACHE_NAME]: {
          'https://huggingface.co/onnx-community/whisper-small/resolve/main/model.onnx':
            new Response(new Uint8Array(12), {
              headers: { 'content-length': '12' },
            }),
          'https://huggingface.co/onnx-community/whisper-small/resolve/main/tokenizer.json':
            new Response(new Uint8Array(5)),
          'https://huggingface.co/onnx-community/gemma-4-E4B-it-ONNX/resolve/main/model.onnx':
            new Response(new Uint8Array(9), {
              headers: { 'content-length': '9' },
            }),
          'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model.onnx':
            new Response(new Uint8Array(21), {
              headers: { 'content-length': '21' },
            }),
          'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/ort-wasm-simd-threaded.wasm':
            new Response(new Uint8Array(7), {
              headers: { 'content-length': '7' },
            }),
        },
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('inspects configured local model caches without creating missing caches', async () => {
    const summaries = await inspectAllLocalModelCaches()

    expect(summaries).toHaveLength(5)
    expect(summaries.map((summary) => summary.id)).toEqual([
      'whisper',
      ...SCENE_VERIFICATION_MODEL_IDS,
      ...MUSICGEN_MODEL_IDS,
      'kokoro-tts',
    ])

    expect(summaries).toContainEqual(
      expect.objectContaining({
        id: 'whisper',
        cacheName: TRANSFORMERS_CACHE_NAME,
        exists: true,
        downloaded: true,
        entryCount: 2,
        totalBytes: 12,
        sizeStatus: 'partial',
        inspectionState: 'ready',
      }),
    )
    expect(summaries).toContainEqual(
      expect.objectContaining({
        id: 'gemma',
        label: SCENE_VERIFICATION_MODEL_LABELS.gemma,
        cacheName: TRANSFORMERS_CACHE_NAME,
        exists: true,
        downloaded: true,
        entryCount: 1,
        totalBytes: 9,
        sizeStatus: 'exact',
        inspectionState: 'ready',
      }),
    )
    expect(summaries).toContainEqual(
      expect.objectContaining({
        id: 'lfm',
        label: SCENE_VERIFICATION_MODEL_LABELS.lfm,
        cacheName: TRANSFORMERS_CACHE_NAME,
        exists: false,
        downloaded: false,
        entryCount: 0,
        totalBytes: 0,
        sizeStatus: 'unavailable',
        inspectionState: 'ready',
      }),
    )
    expect(summaries).toContainEqual(
      expect.objectContaining({
        id: 'musicgen-small',
        label: MUSICGEN_MODEL_OPTIONS[0]!.label,
        cacheName: TRANSFORMERS_CACHE_NAME,
        exists: false,
        downloaded: false,
        entryCount: 0,
        totalBytes: 0,
        sizeStatus: 'unavailable',
        inspectionState: 'ready',
      }),
    )
    expect(summaries).toContainEqual(
      expect.objectContaining({
        id: 'kokoro-tts',
        cacheName: TRANSFORMERS_CACHE_NAME,
        exists: true,
        downloaded: true,
        entryCount: 1,
        totalBytes: 21,
        sizeStatus: 'exact',
        inspectionState: 'ready',
      }),
    )
  })

  it('clears only the matching model entries inside a shared cache bucket', async () => {
    const whisperDefinition = LOCAL_MODEL_CACHE_DEFINITIONS.find(
      (definition) => definition.id === 'whisper',
    )
    expect(whisperDefinition).toBeTruthy()

    await expect(clearLocalModelCache(whisperDefinition!)).resolves.toBe(true)

    const summaries = await inspectAllLocalModelCaches()
    const whisperSummary = summaries.find((summary) => summary.id === 'whisper')
    const gemmaSummary = summaries.find((summary) => summary.id === 'gemma')
    const lfmSummary = summaries.find((summary) => summary.id === 'lfm')
    const musicgenSummary = summaries.find((summary) => summary.id === 'musicgen-small')

    expect(whisperSummary).toEqual(
      expect.objectContaining({
        id: 'whisper',
        cacheName: TRANSFORMERS_CACHE_NAME,
        exists: false,
        downloaded: false,
        entryCount: 0,
        totalBytes: 0,
        sizeStatus: 'unavailable',
        inspectionState: 'ready',
      }),
    )
    expect(gemmaSummary).toEqual(
      expect.objectContaining({
        id: 'gemma',
        downloaded: true,
        entryCount: 1,
        totalBytes: 9,
      }),
    )
    expect(lfmSummary).toEqual(
      expect.objectContaining({
        id: 'lfm',
        downloaded: false,
        entryCount: 0,
        totalBytes: 0,
      }),
    )
    expect(musicgenSummary).toEqual(
      expect.objectContaining({
        id: 'musicgen-small',
        downloaded: false,
        entryCount: 0,
        totalBytes: 0,
      }),
    )
  })
})
