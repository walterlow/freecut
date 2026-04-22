import {
  SCENE_VERIFICATION_MODEL_CACHE_DESCRIPTIONS,
  SCENE_VERIFICATION_MODEL_CACHE_MATCH_FRAGMENTS,
  SCENE_VERIFICATION_MODEL_IDS,
  SCENE_VERIFICATION_MODEL_LABELS,
  type SceneVerificationModelId,
} from './scene-verification-models';
import {
  MUSICGEN_MODEL_IDS,
  getMusicgenModelDefinition,
  type MusicgenModelId,
} from './musicgen-models';

export const TRANSFORMERS_CACHE_NAME = 'transformers-cache';
export const LOCAL_MODEL_CACHE_STORAGE_LABEL = 'Browser cache storage';
const WHISPER_CACHE_MATCH_FRAGMENTS = ['/onnx-community/whisper-'];
const KOKORO_TTS_CACHE_MATCH_FRAGMENTS = ['/onnx-community/kokoro-82m-v1.0-onnx/'];

export type LocalModelCacheId = 'whisper' | SceneVerificationModelId | MusicgenModelId | 'kokoro-tts';

export interface LocalModelCacheDefinition {
  id: LocalModelCacheId;
  label: string;
  description: string;
  cacheName: string;
  matchPathFragments?: string[];
}

export interface LocalModelCacheSummary extends LocalModelCacheDefinition {
  supported: boolean;
  exists: boolean;
  downloaded: boolean;
  entryCount: number;
  totalBytes: number;
  sizeStatus: 'exact' | 'partial' | 'unavailable';
  inspectionState: 'ready' | 'timed-out' | 'error';
}

const SCENE_VERIFICATION_MODEL_CACHE_DEFINITIONS: LocalModelCacheDefinition[] = SCENE_VERIFICATION_MODEL_IDS.map((id) => ({
  id,
  label: SCENE_VERIFICATION_MODEL_LABELS[id],
  description: SCENE_VERIFICATION_MODEL_CACHE_DESCRIPTIONS[id],
  cacheName: TRANSFORMERS_CACHE_NAME,
  matchPathFragments: [...SCENE_VERIFICATION_MODEL_CACHE_MATCH_FRAGMENTS[id]],
}));

const MUSICGEN_MODEL_CACHE_DEFINITIONS: LocalModelCacheDefinition[] = MUSICGEN_MODEL_IDS.map((id) => {
  const definition = getMusicgenModelDefinition(id);

  return {
    id,
    label: definition.label,
    description: `${definition.label} model files and tokenizers.`,
    cacheName: TRANSFORMERS_CACHE_NAME,
    matchPathFragments: [...definition.cacheMatchFragments],
  };
});

export const LOCAL_MODEL_CACHE_DEFINITIONS: LocalModelCacheDefinition[] = [
  {
    id: 'whisper',
    label: 'Whisper',
    description: 'Whisper ONNX model files and tokenizers.',
    cacheName: TRANSFORMERS_CACHE_NAME,
    matchPathFragments: WHISPER_CACHE_MATCH_FRAGMENTS,
  },
  ...SCENE_VERIFICATION_MODEL_CACHE_DEFINITIONS,
  ...MUSICGEN_MODEL_CACHE_DEFINITIONS,
  {
    id: 'kokoro-tts',
    label: 'Kokoro TTS',
    description: 'Kokoro ONNX model weights and tokenizer files.',
    cacheName: TRANSFORMERS_CACHE_NAME,
    matchPathFragments: KOKORO_TTS_CACHE_MATCH_FRAGMENTS,
  },
];

function getCacheStorage(): CacheStorage | null {
  if (typeof globalThis === 'undefined' || !('caches' in globalThis)) {
    return null;
  }

  return globalThis.caches;
}

const CACHE_OPERATION_TIMEOUT_MS = 1500;
const CACHE_MATCH_TIMEOUT_MS = 150;

function getCachedResponseSizeFromHeaders(response: Response): number | null {
  const headerValue = response.headers.get('content-length');
  if (!headerValue) {
    return null;
  }

  const parsedValue = Number(headerValue);
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : null;
}

function createUnavailableSummary(
  definition: LocalModelCacheDefinition,
  inspectionState: LocalModelCacheSummary['inspectionState']
): LocalModelCacheSummary {
  return {
    ...definition,
    supported: true,
    exists: false,
    downloaded: false,
    entryCount: 0,
    totalBytes: 0,
    sizeStatus: 'unavailable',
    inspectionState,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = CACHE_OPERATION_TIMEOUT_MS
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

export function supportsLocalModelCacheInspection(): boolean {
  return getCacheStorage() !== null;
}

function matchesDefinitionRequest(
  definition: LocalModelCacheDefinition,
  request: Request
): boolean {
  if (!definition.matchPathFragments || definition.matchPathFragments.length === 0) {
    return true;
  }

  const requestUrl = request.url.toLowerCase();
  return definition.matchPathFragments.some((fragment) => requestUrl.includes(fragment));
}

export async function inspectLocalModelCache(
  definition: LocalModelCacheDefinition
): Promise<LocalModelCacheSummary> {
  const cacheStorage = getCacheStorage();
  if (!cacheStorage) {
    return {
      ...definition,
      supported: false,
      exists: false,
      downloaded: false,
      entryCount: 0,
      totalBytes: 0,
      sizeStatus: 'unavailable',
      inspectionState: 'error',
    };
  }

  try {
    const hasMethod = 'has' in cacheStorage && typeof cacheStorage.has === 'function';
    const cacheExists = hasMethod
      ? await withTimeout(cacheStorage.has(definition.cacheName), `Checking ${definition.cacheName}`)
      : (await withTimeout(cacheStorage.keys(), 'Listing cache buckets')).includes(definition.cacheName);

    if (!cacheExists) {
      return {
        ...definition,
        supported: true,
        exists: false,
        downloaded: false,
        entryCount: 0,
        totalBytes: 0,
        sizeStatus: 'unavailable',
        inspectionState: 'ready',
      };
    }

    const cache = await withTimeout(cacheStorage.open(definition.cacheName), `Opening ${definition.cacheName}`);
    const requests = await withTimeout(cache.keys(), `Reading ${definition.cacheName}`);
    const matchingRequests = requests.filter((request) => matchesDefinitionRequest(definition, request));

    if (matchingRequests.length === 0) {
      return {
        ...definition,
        supported: true,
        exists: false,
        downloaded: false,
        entryCount: 0,
        totalBytes: 0,
        sizeStatus: 'unavailable',
        inspectionState: 'ready',
      };
    }

    const sizeResults = await Promise.allSettled(
      matchingRequests.map(async (request) => {
        const response = await withTimeout(
          cache.match(request),
          `Matching ${definition.cacheName}`,
          CACHE_MATCH_TIMEOUT_MS
        );

        if (!response) {
          return null;
        }

        return getCachedResponseSizeFromHeaders(response);
      })
    );

    let totalBytes = 0;
    let resolvedCount = 0;
    let sizedCount = 0;

    for (const result of sizeResults) {
      if (result.status !== 'fulfilled') {
        continue;
      }

      resolvedCount += 1;
      if (result.value === null) {
        continue;
      }

      totalBytes += result.value;
      sizedCount += 1;
    }

    const sizeStatus: LocalModelCacheSummary['sizeStatus'] =
      sizedCount === 0
        ? 'unavailable'
        : sizedCount === matchingRequests.length && resolvedCount === matchingRequests.length
          ? 'exact'
          : 'partial';

    return {
      ...definition,
      supported: true,
      exists: true,
      downloaded: true,
      entryCount: matchingRequests.length,
      totalBytes,
      sizeStatus,
      inspectionState: 'ready',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('timed out')) {
      return createUnavailableSummary(definition, 'timed-out');
    }

    return createUnavailableSummary(definition, 'error');
  }
}

export async function inspectAllLocalModelCaches(): Promise<LocalModelCacheSummary[]> {
  return Promise.all(LOCAL_MODEL_CACHE_DEFINITIONS.map((definition) => inspectLocalModelCache(definition)));
}

export async function clearLocalModelCache(definition: LocalModelCacheDefinition): Promise<boolean> {
  const cacheStorage = getCacheStorage();
  if (!cacheStorage) {
    return false;
  }

  if (!definition.matchPathFragments || definition.matchPathFragments.length === 0) {
    return cacheStorage.delete(definition.cacheName);
  }

  const hasMethod = 'has' in cacheStorage && typeof cacheStorage.has === 'function';
  const cacheExists = hasMethod
    ? await withTimeout(cacheStorage.has(definition.cacheName), `Checking ${definition.cacheName}`)
    : (await withTimeout(cacheStorage.keys(), 'Listing cache buckets')).includes(definition.cacheName);

  if (!cacheExists) {
    return false;
  }

  const cache = await withTimeout(cacheStorage.open(definition.cacheName), `Opening ${definition.cacheName}`);
  const requests = await withTimeout(cache.keys(), `Reading ${definition.cacheName}`);
  const matchingRequests = requests.filter((request) => matchesDefinitionRequest(definition, request));

  if (matchingRequests.length === 0) {
    return false;
  }

  const deleteResults = await Promise.all(
    matchingRequests.map((request) =>
      withTimeout(cache.delete(request), `Clearing ${definition.label}`, CACHE_MATCH_TIMEOUT_MS)
    )
  );

  return deleteResults.some(Boolean);
}
