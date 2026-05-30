/**
 * Tunable configuration for {@link FilmstripCacheService}.
 *
 * Keeps the cold-start path intentionally conservative so dropping several
 * clips into a fresh timeline does not fan out into a large parallel decode
 * burst. Threshold knobs (priority/background stride, memory budgets) shape
 * which frames get extracted first and how aggressively the cache evicts.
 */

/** Frame rate of the extraction worker — must match the worker constant. */
export const FRAME_RATE = 1
/** Don't fan out to multiple workers unless a clip has at least this many frames. */
export const MIN_FRAMES_PER_WORKER = 120
/** Hard cap on workers per extraction on high-core devices. */
export const MAX_WORKERS = 2
/** Below this core count, never run extractions in parallel. */
export const MIN_CORES_FOR_PARALLEL_WORKERS = 8
/** Devices with at least this many cores get an extra concurrent extraction slot. */
export const HIGH_CORE_THRESHOLD = 12
export const MAX_CONCURRENT_EXTRACTIONS_BASE = 1
export const MAX_CONCURRENT_EXTRACTIONS_HIGH_CORE = 2
export const MIN_FILMSTRIP_TARGET_FRAMES = 40
export const MAX_FILMSTRIP_TARGET_FRAMES = 72
export const IMPORT_FILMSTRIP_TINY_TARGET_FRAMES = 8
export const IMPORT_FILMSTRIP_LARGE_TARGET_FRAMES = 16
export const IMPORT_FILMSTRIP_MEDIUM_TARGET_FRAMES = 32
export const IMPORT_FILMSTRIP_NORMAL_TARGET_FRAMES = 48
export const IMPORT_FILMSTRIP_HUGE_FILE_BYTES = 1_000 * 1024 * 1024
export const IMPORT_FILMSTRIP_LARGE_FILE_BYTES = 500 * 1024 * 1024
export const IMPORT_FILMSTRIP_LONG_DURATION_SEC = 900
export const IMPORT_FILMSTRIP_VERY_LONG_DURATION_SEC = 1_800
export const IMPORT_FILMSTRIP_SLOW_CONTAINER_MIME_TYPES = new Set([
  'video/webm',
  'video/x-matroska',
  'video/matroska',
])
export const IMPORT_FILMSTRIP_PREP_TIMEOUT_MS = 8_000
export const IMPORT_FILMSTRIP_SLOW_PREP_TIMEOUT_MS = 6_000
export const TARGET_FRAME_BUDGET_SCALE = 4
export const MAX_PRIORITY_DENSE_FRAMES = 180
/** Background stride (in frames) for clips longer than {@link MEDIUM_CLIP_FRAME_THRESHOLD}. */
export const BACKGROUND_STRIDE_MEDIUM = 2
export const BACKGROUND_STRIDE_LONG = 3
export const BACKGROUND_STRIDE_VERY_LONG = 4
export const MEDIUM_CLIP_FRAME_THRESHOLD = 300
export const LONG_CLIP_FRAME_THRESHOLD = 1200
export const VERY_LONG_CLIP_FRAME_THRESHOLD = 2400
/** Idle time before a cache entry with no subscribers is evicted. */
export const CACHE_EVICT_IDLE_MS = 15_000
export const MEMORY_TARGET_BYTES = 500 * 1024 * 1024
export const MEMORY_SOFT_LIMIT_BYTES = 420 * 1024 * 1024
export const METRICS_HISTORY_LIMIT = 120
export const PROGRESS_NOTIFY_INTERVAL_MS = 200
export const PROGRESS_NOTIFY_FRAME_DELTA = 4
export const IMAGE_FORMAT = 'image/jpeg'
export const IMAGE_QUALITY = 0.7
export const MAX_IDLE_WORKERS_BASE = 2
export const WORKER_PARALLEL_SAVES_BASE = 2
export const WORKER_PARALLEL_SAVES_MEMORY_PRESSURE = 2
export const MEMORY_CHECK_INTERVAL_MS = 500
