/**
 * Filmstrip Cache Service
 *
 * Simple service that:
 * 1. Manages extraction worker
 * 2. Provides object URLs from OPFS storage
 * 3. Notifies subscribers when new frames are available
 *
 * No ImageBitmaps in memory - just URLs for <img> tags.
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('FilmstripCache');

import { THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT } from '@/features/timeline/constants';
import { filmstripOPFSStorage, type FilmstripFrame } from './filmstrip-opfs-storage';
import type { ExtractRequest, WorkerResponse } from '../workers/filmstrip-extraction-worker';

export { THUMBNAIL_WIDTH };
export type { FilmstripFrame };

export interface Filmstrip {
  frames: FilmstripFrame[];
  isComplete: boolean;
  isExtracting: boolean;
  progress: number;
}

type FilmstripUpdateCallback = (filmstrip: Filmstrip) => void;

// Configuration for parallel extraction
const FRAME_RATE = 1; // Must match worker - 1fps for filmstrip thumbnails
const MIN_FRAMES_PER_WORKER = 120; // Avoid over-parallelizing small/medium extractions
const MAX_WORKERS = 2; // Max workers per extraction on high-core devices
const MIN_CORES_FOR_PARALLEL_WORKERS = 8; // Enable worker parallelism on mid/high-end CPUs
const HIGH_CORE_THRESHOLD = 12;
const MAX_CONCURRENT_EXTRACTIONS_BASE = 3;
const MAX_CONCURRENT_EXTRACTIONS_HIGH_CORE = 4;
const MIN_FILMSTRIP_TARGET_FRAMES = 90;
const MAX_FILMSTRIP_TARGET_FRAMES = 300;
const TARGET_FRAME_BUDGET_SCALE = 8;
const MAX_PRIORITY_DENSE_FRAMES = 180;
const BACKGROUND_STRIDE_MEDIUM = 2; // 0.5fps equivalent outside priority range
const BACKGROUND_STRIDE_LONG = 3;
const BACKGROUND_STRIDE_VERY_LONG = 4;
const MEDIUM_CLIP_FRAME_THRESHOLD = 300;
const LONG_CLIP_FRAME_THRESHOLD = 1200;
const VERY_LONG_CLIP_FRAME_THRESHOLD = 2400;
const CACHE_EVICT_IDLE_MS = 15_000;
const MEMORY_TARGET_BYTES = 500 * 1024 * 1024;
const MEMORY_SOFT_LIMIT_BYTES = 420 * 1024 * 1024;
const METRICS_HISTORY_LIMIT = 120;
const PROGRESS_NOTIFY_INTERVAL_MS = 200;
const PROGRESS_NOTIFY_FRAME_DELTA = 4;
const IMAGE_FORMAT = 'image/jpeg';
const IMAGE_QUALITY = 0.7;
const FRAME_MEMORY_FALLBACK_BYTES = THUMBNAIL_WIDTH * THUMBNAIL_HEIGHT * 4;
const MAX_IDLE_WORKERS_BASE = 2;
const WORKER_PARALLEL_SAVES_BASE = 4;
const WORKER_PARALLEL_SAVES_MEMORY_PRESSURE = 2;
const MEMORY_CHECK_INTERVAL_MS = 500;

interface WorkerState {
  worker: Worker;
  requestId: string;
  startIndex: number;
  endIndex: number;
  completed: boolean;
  frameCount: number;
  lastLoadedCount: number;
  isLoading: boolean;
  hasPendingLoad: boolean;
}

interface PendingExtraction {
  mediaId: string;
  blobUrl: string;
  duration: number;
  skipIndices: number[];
  priorityRange: PriorityFrameRange | null;
  forceSingleWorker: boolean;
  fallbackAttempted: boolean;
  isVideoFallback: boolean;
  workers: WorkerState[];
  totalFrames: number;
  progressFrames: number;
  targetIndices: number[];
  priorityOnly: boolean;
  completedWorkers: number;
  onProgress?: (progress: number) => void;
  // Track frames incrementally during extraction
  extractedFrames: Map<number, FilmstripFrame>;
  lastNotifyAt: number;
  lastNotifiedFrameCount: number;
  metrics: ExtractionMetrics;
}

interface PriorityFrameRange {
  startIndex: number;
  endIndex: number;
}

type ExtractionOutcome = 'completed' | 'failed' | 'aborted';

interface ExtractionMetrics {
  id: string;
  mediaId: string;
  startedAtMs: number;
  firstFrameAtMs: number | null;
  targetFrames: number;
  existingTargetFrames: number;
  framesToExtract: number;
  priorityFrames: number;
  backgroundStride: number;
  workerCount: number;
  usedVideoFallback: boolean;
}

interface ExtractionMetricSample {
  id: string;
  mediaId: string;
  startedAtMs: number;
  durationMs: number;
  timeToFirstFrameMs: number | null;
  targetFrames: number;
  existingTargetFrames: number;
  framesToExtract: number;
  priorityFrames: number;
  backgroundStride: number;
  workerCount: number;
  usedVideoFallback: boolean;
  extractedFrames: number;
  outcome: ExtractionOutcome;
}

export interface FilmstripMetricsSnapshot {
  totals: {
    started: number;
    completed: number;
    failed: number;
    aborted: number;
  };
  averages: {
    durationMs: number;
    timeToFirstFrameMs: number;
    extractFramesPerSecond: number;
  };
  memory: {
    cacheBytes: number;
    cacheEntries: number;
    activeExtractions: number;
    queuedExtractions: number;
    usedJSHeapBytes: number | null;
    maxConcurrentExtractions: number;
  };
  recent: ExtractionMetricSample[];
}

interface CacheEntryMeta {
  sizeBytes: number;
  lastAccessedAt: number;
}

class FilmstripCacheService {
  private cache = new Map<string, Filmstrip>();
  private cacheMeta = new Map<string, CacheEntryMeta>();
  private cacheBytes = 0;
  private idleEvictionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingExtractions = new Map<string, PendingExtraction>();
  private updateCallbacks = new Map<string, Set<FilmstripUpdateCallback>>();
  private loadingPromises = new Map<string, Promise<Filmstrip>>();
  private activeExtractions = new Set<string>();
  private extractionQueue: string[] = [];
  private workerPool: Worker[] = [];
  private allWorkers = new Set<Worker>();
  private metricsTotals = {
    started: 0,
    completed: 0,
    failed: 0,
    aborted: 0,
  };
  private metricsHistory: ExtractionMetricSample[] = [];
  private lastMemoryCheckAt = 0;

  private createWorker(): Worker {
    const worker = new Worker(
      new URL('../workers/filmstrip-extraction-worker.ts', import.meta.url),
      { type: 'module' }
    );
    this.allWorkers.add(worker);
    return worker;
  }

  private getQueueScore(mediaId: string): number {
    const pending = this.pendingExtractions.get(mediaId);
    if (!pending) return Number.POSITIVE_INFINITY;
    return pending.metrics.framesToExtract;
  }

  private acquireWorker(): Worker {
    return this.workerPool.pop() ?? this.createWorker();
  }

  private getMaxIdleWorkers(): number {
    if (this.isHardMemoryPressure()) return 0;
    if (this.isSoftMemoryPressure()) return 1;
    return MAX_IDLE_WORKERS_BASE;
  }

  private releaseWorker(worker: Worker): void {
    worker.onmessage = null;
    worker.onerror = null;
    if (this.workerPool.length >= this.getMaxIdleWorkers()) {
      this.terminateWorker(worker);
      return;
    }
    this.workerPool.push(worker);
  }

  private terminateWorker(worker: Worker): void {
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    this.allWorkers.delete(worker);
  }

  /**
   * `performance.memory` is Chrome-only.
   * On browsers without it (e.g. Firefox/Safari), `isSoftMemoryPressure`/`isHardMemoryPressure`
   * use cache-bytes-only heuristics, so external tab/browser memory pressure is not observable.
   */
  private getUsedJsHeapBytes(): number | null {
    if (typeof performance === 'undefined') return null;
    const withMemory = performance as Performance & {
      memory?: { usedJSHeapSize?: number };
    };
    const used = withMemory.memory?.usedJSHeapSize;
    if (typeof used !== 'number' || !Number.isFinite(used) || used <= 0) {
      return null;
    }
    return used;
  }

  private isSoftMemoryPressure(): boolean {
    // `usedJSHeapSize` is process-wide JS heap, not filmstrip-only memory. Unrelated
    // allocations can trigger this branch, which intentionally throttles extraction
    // concurrency in `getMaxConcurrentExtractions()` even when `cacheBytes` is low.
    const usedHeap = this.getUsedJsHeapBytes();
    if (usedHeap !== null && usedHeap >= MEMORY_SOFT_LIMIT_BYTES) {
      return true;
    }
    return this.cacheBytes >= MEMORY_SOFT_LIMIT_BYTES;
  }

  private isHardMemoryPressure(): boolean {
    // Same caveat as soft pressure: a large non-filmstrip heap spike can trip this
    // check and defer work in `startPendingExtraction()` until pressure clears.
    const usedHeap = this.getUsedJsHeapBytes();
    if (usedHeap !== null && usedHeap >= MEMORY_TARGET_BYTES) {
      return true;
    }
    return this.cacheBytes >= MEMORY_TARGET_BYTES;
  }

  private estimateFilmstripBytes(frames: FilmstripFrame[]): number {
    let total = 0;
    for (const frame of frames) {
      total += frame.byteSize && frame.byteSize > 0
        ? frame.byteSize
        : FRAME_MEMORY_FALLBACK_BYTES;
    }
    return total;
  }

  private updateCacheMeta(mediaId: string, filmstrip: Filmstrip): void {
    const nextSize = this.estimateFilmstripBytes(filmstrip.frames);
    const previous = this.cacheMeta.get(mediaId);
    if (previous) {
      this.cacheBytes = Math.max(0, this.cacheBytes - previous.sizeBytes);
    }
    this.cacheBytes += nextSize;
    this.cacheMeta.set(mediaId, {
      sizeBytes: nextSize,
      lastAccessedAt: Date.now(),
    });
  }

  private touchCacheEntry(mediaId: string): void {
    const entry = this.cacheMeta.get(mediaId);
    if (entry) {
      entry.lastAccessedAt = Date.now();
      return;
    }
    const cached = this.cache.get(mediaId);
    if (!cached) return;
    this.updateCacheMeta(mediaId, cached);
  }

  private clearCacheMeta(mediaId: string): void {
    const previous = this.cacheMeta.get(mediaId);
    if (!previous) return;
    this.cacheBytes = Math.max(0, this.cacheBytes - previous.sizeBytes);
    this.cacheMeta.delete(mediaId);
  }

  private clearIdleEvictionTimer(mediaId: string): void {
    const timer = this.idleEvictionTimers.get(mediaId);
    if (!timer) return;
    clearTimeout(timer);
    this.idleEvictionTimers.delete(mediaId);
  }

  private scheduleIdleEviction(mediaId: string): void {
    this.clearIdleEvictionTimer(mediaId);
    if (this.pendingExtractions.has(mediaId)) return;
    if (this.hasSubscribers(mediaId)) return;
    if (!this.cache.has(mediaId)) return;

    const timer = setTimeout(() => {
      this.idleEvictionTimers.delete(mediaId);
      this.tryEvictMedia(mediaId, 'idle-timeout');
    }, CACHE_EVICT_IDLE_MS);
    this.idleEvictionTimers.set(mediaId, timer);
  }

  private hasSubscribers(mediaId: string): boolean {
    const callbacks = this.updateCallbacks.get(mediaId);
    return !!callbacks && callbacks.size > 0;
  }

  private tryEvictMedia(mediaId: string, reason: string): boolean {
    if (this.pendingExtractions.has(mediaId)) return false;
    if (this.hasSubscribers(mediaId)) return false;
    if (!this.cache.has(mediaId)) return false;

    this.cache.delete(mediaId);
    this.clearCacheMeta(mediaId);
    filmstripOPFSStorage.revokeUrls(mediaId);
    this.clearIdleEvictionTimer(mediaId);
    logger.debug(`Evicted in-memory filmstrip ${mediaId} (${reason})`);
    return true;
  }

  private enforceMemoryBudget(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastMemoryCheckAt < MEMORY_CHECK_INTERVAL_MS) {
      return;
    }
    this.lastMemoryCheckAt = now;

    const usedHeap = this.getUsedJsHeapBytes();
    const shouldTrim = force
      || this.cacheBytes > MEMORY_SOFT_LIMIT_BYTES
      || (usedHeap !== null && usedHeap > MEMORY_SOFT_LIMIT_BYTES);
    if (!shouldTrim) return;

    const evictable = Array.from(this.cacheMeta.entries())
      .filter(([mediaId]) => !this.pendingExtractions.has(mediaId))
      .sort((a, b) => {
        const aSubscribed = this.hasSubscribers(a[0]) ? 1 : 0;
        const bSubscribed = this.hasSubscribers(b[0]) ? 1 : 0;
        if (aSubscribed !== bSubscribed) return aSubscribed - bSubscribed;
        return a[1].lastAccessedAt - b[1].lastAccessedAt;
      });

    for (const [mediaId] of evictable) {
      if (this.cacheBytes <= MEMORY_SOFT_LIMIT_BYTES) {
        break;
      }

      this.tryEvictMedia(mediaId, 'memory-pressure');
    }
  }

  private getMaxConcurrentExtractions(): number {
    const base = typeof navigator === 'undefined'
      ? MAX_CONCURRENT_EXTRACTIONS_BASE
      : (navigator.hardwareConcurrency || 4) >= HIGH_CORE_THRESHOLD
        ? MAX_CONCURRENT_EXTRACTIONS_HIGH_CORE
        : MAX_CONCURRENT_EXTRACTIONS_BASE;

    if (this.isHardMemoryPressure()) {
      return 1;
    }
    if (this.isSoftMemoryPressure()) {
      return Math.min(base, 2);
    }
    return base;
  }

  private buildPriorityIndices(
    totalFrames: number,
    priorityRange: PriorityFrameRange | null
  ): number[] {
    if (!priorityRange || totalFrames <= 0) return [];

    const rangeStart = Math.max(0, Math.min(totalFrames - 1, priorityRange.startIndex));
    const rangeEnd = Math.max(rangeStart + 1, Math.min(totalFrames, priorityRange.endIndex));
    const rangeLength = Math.max(0, rangeEnd - rangeStart);
    if (rangeLength === 0) return [];

    if (rangeLength <= MAX_PRIORITY_DENSE_FRAMES) {
      const dense: number[] = [];
      for (let i = rangeStart; i < rangeEnd; i++) dense.push(i);
      return dense;
    }

    const sampled = new Set<number>();
    const stride = Math.ceil(rangeLength / MAX_PRIORITY_DENSE_FRAMES);
    for (let i = rangeStart; i < rangeEnd; i += stride) sampled.add(i);
    sampled.add(rangeStart);
    sampled.add(rangeEnd - 1);
    return Array.from(sampled).sort((a, b) => a - b);
  }

  private getTargetFrameBudget(totalFrames: number): number {
    if (totalFrames <= 0) return 0;
    if (totalFrames <= MIN_FILMSTRIP_TARGET_FRAMES) return totalFrames;

    // Keep short clips dense, but scale sub-linearly for long clips to
    // avoid expensive full-duration extraction when many clips are queued.
    const scaledBudget = Math.round(Math.sqrt(totalFrames) * TARGET_FRAME_BUDGET_SCALE);
    return Math.max(
      MIN_FILMSTRIP_TARGET_FRAMES,
      Math.min(
        totalFrames,
        Math.min(MAX_FILMSTRIP_TARGET_FRAMES, scaledBudget)
      )
    );
  }

  private getBackgroundStride(totalFrames: number): number {
    if (totalFrames <= MEDIUM_CLIP_FRAME_THRESHOLD) return 1;
    if (totalFrames <= LONG_CLIP_FRAME_THRESHOLD) return BACKGROUND_STRIDE_MEDIUM;
    if (totalFrames <= VERY_LONG_CLIP_FRAME_THRESHOLD) return BACKGROUND_STRIDE_LONG;
    return BACKGROUND_STRIDE_VERY_LONG;
  }

  private createExtractionMetrics(
    mediaId: string,
    totalFrames: number,
    targetIndices: number[],
    existingTargetCount: number,
    priorityRange: PriorityFrameRange | null,
  ): ExtractionMetrics {
    const startedAtMs = Date.now();
    return {
      id: crypto.randomUUID(),
      mediaId,
      startedAtMs,
      firstFrameAtMs: existingTargetCount > 0 ? startedAtMs : null,
      targetFrames: targetIndices.length,
      existingTargetFrames: existingTargetCount,
      framesToExtract: Math.max(0, targetIndices.length - existingTargetCount),
      priorityFrames: this.buildPriorityIndices(totalFrames, priorityRange).length,
      backgroundStride: this.getBackgroundStride(totalFrames),
      workerCount: 0,
      usedVideoFallback: false,
    };
  }

  private noteFirstFrame(metrics: ExtractionMetrics): void {
    if (metrics.firstFrameAtMs === null) {
      metrics.firstFrameAtMs = Date.now();
    }
  }

  private finalizeExtractionMetrics(
    metrics: ExtractionMetrics,
    outcome: ExtractionOutcome,
    extractedFrames: number
  ): void {
    const now = Date.now();
    const sample: ExtractionMetricSample = {
      id: metrics.id,
      mediaId: metrics.mediaId,
      startedAtMs: metrics.startedAtMs,
      durationMs: Math.max(0, now - metrics.startedAtMs),
      timeToFirstFrameMs: metrics.firstFrameAtMs === null
        ? null
        : Math.max(0, metrics.firstFrameAtMs - metrics.startedAtMs),
      targetFrames: metrics.targetFrames,
      existingTargetFrames: metrics.existingTargetFrames,
      framesToExtract: metrics.framesToExtract,
      priorityFrames: metrics.priorityFrames,
      backgroundStride: metrics.backgroundStride,
      workerCount: metrics.workerCount,
      usedVideoFallback: metrics.usedVideoFallback,
      extractedFrames,
      outcome,
    };

    this.metricsHistory.push(sample);
    if (this.metricsHistory.length > METRICS_HISTORY_LIMIT) {
      this.metricsHistory.shift();
    }

    if (outcome === 'completed') this.metricsTotals.completed++;
    if (outcome === 'failed') this.metricsTotals.failed++;
    if (outcome === 'aborted') this.metricsTotals.aborted++;
  }

  getMetricsSnapshot(): FilmstripMetricsSnapshot {
    const recent = [...this.metricsHistory];
    const completed = recent.filter((sample) => sample.outcome === 'completed');
    const completedForAverages = completed.filter(
      (sample) => sample.framesToExtract > 1 && sample.durationMs >= 250
    );
    const averageSamples = completedForAverages.length > 0 ? completedForAverages : completed;
    const durationAvg = averageSamples.length > 0
      ? averageSamples.reduce((sum, sample) => sum + sample.durationMs, 0) / averageSamples.length
      : 0;
    const ttfpSamples = averageSamples.filter((sample) => sample.timeToFirstFrameMs !== null);
    const ttfpAvg = ttfpSamples.length > 0
      ? ttfpSamples.reduce((sum, sample) => sum + (sample.timeToFirstFrameMs ?? 0), 0) / ttfpSamples.length
      : 0;
    const throughputAvg = averageSamples.length > 0
      ? averageSamples.reduce((sum, sample) => {
        const seconds = Math.max(0.001, sample.durationMs / 1000);
        return sum + (sample.framesToExtract / seconds);
      }, 0) / averageSamples.length
      : 0;

    return {
      totals: { ...this.metricsTotals },
      averages: {
        durationMs: Math.round(durationAvg),
        timeToFirstFrameMs: Math.round(ttfpAvg),
        extractFramesPerSecond: Math.round(throughputAvg * 100) / 100,
      },
      memory: {
        cacheBytes: this.cacheBytes,
        cacheEntries: this.cache.size,
        activeExtractions: this.activeExtractions.size,
        queuedExtractions: this.extractionQueue.length,
        usedJSHeapBytes: this.getUsedJsHeapBytes(),
        maxConcurrentExtractions: this.getMaxConcurrentExtractions(),
      },
      recent,
    };
  }

  clearMetrics(): void {
    this.metricsTotals = { started: 0, completed: 0, failed: 0, aborted: 0 };
    this.metricsHistory = [];
  }

  private buildTargetIndices(
    totalFrames: number,
    priorityRange: PriorityFrameRange | null
  ): number[] {
    if (totalFrames <= 0) return [];

    const target = new Set<number>();
    target.add(0);
    target.add(totalFrames - 1);

    const priorityIndices = this.buildPriorityIndices(totalFrames, priorityRange);
    for (const index of priorityIndices) target.add(index);

    if (totalFrames <= MIN_FILMSTRIP_TARGET_FRAMES) {
      for (let i = 0; i < totalFrames; i++) {
        target.add(i);
      }
      return Array.from(target).sort((a, b) => a - b);
    }

    const budget = this.getTargetFrameBudget(totalFrames);
    if (budget >= totalFrames) {
      for (let i = 0; i < totalFrames; i++) {
        target.add(i);
      }
      return Array.from(target).sort((a, b) => a - b);
    }

    // Adaptive background sampling:
    // - Keep priority range dense.
    // - Sample the non-priority tail with a duration-based stride.
    // - Treat budget as an upper bound, not a fill target.
    const stride = this.getBackgroundStride(totalFrames);
    const backgroundCandidates: number[] = [];
    for (let i = 0; i < totalFrames; i += stride) {
      if (!target.has(i)) {
        backgroundCandidates.push(i);
      }
    }

    const remainingBudget = Math.max(0, budget - target.size);
    if (remainingBudget === 0 || backgroundCandidates.length === 0) {
      return Array.from(target).sort((a, b) => a - b);
    }

    if (backgroundCandidates.length <= remainingBudget) {
      for (const index of backgroundCandidates) target.add(index);
    } else {
      const step = backgroundCandidates.length / remainingBudget;
      for (let i = 0; i < remainingBudget; i++) {
        const outsideIndex = Math.floor(i * step);
        const chosen = backgroundCandidates[Math.min(backgroundCandidates.length - 1, outsideIndex)];
        if (chosen !== undefined) target.add(chosen);
      }
    }

    return Array.from(target).sort((a, b) => a - b);
  }

  private needsRefinementForRange(
    frames: FilmstripFrame[],
    totalFrames: number,
    priorityRange: PriorityFrameRange | null
  ): boolean {
    if (!priorityRange || frames.length === 0) return false;
    const required = this.buildPriorityIndices(totalFrames, priorityRange);
    if (required.length === 0) return false;

    const available = new Set(frames.map((frame) => frame.index));
    return required.some((index) => !available.has(index));
  }

  needsPriorityRefinement(
    mediaId: string,
    duration: number,
    priorityRange?: PriorityFrameRange | null
  ): boolean {
    const cached = this.cache.get(mediaId);
    if (!cached || cached.isExtracting) return false;
    if (!priorityRange || duration <= 0) return false;

    const totalFrames = Math.ceil(duration * FRAME_RATE);
    const normalizedPriorityRange = this.normalizePriorityRange(priorityRange, totalFrames);
    return this.needsRefinementForRange(cached.frames, totalFrames, normalizedPriorityRange);
  }

  /**
   * Subscribe to filmstrip updates
   */
  subscribe(mediaId: string, callback: FilmstripUpdateCallback): () => void {
    this.clearIdleEvictionTimer(mediaId);
    if (!this.updateCallbacks.has(mediaId)) {
      this.updateCallbacks.set(mediaId, new Set());
    }
    this.updateCallbacks.get(mediaId)!.add(callback);

    // Immediately call with current state if available
    const current = this.cache.get(mediaId);
    if (current) {
      this.touchCacheEntry(mediaId);
      callback(current);
    }

    return () => {
      const callbacks = this.updateCallbacks.get(mediaId);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.updateCallbacks.delete(mediaId);
          this.scheduleIdleEviction(mediaId);
        }
      }
    };
  }

  private notifyUpdate(mediaId: string, filmstrip: Filmstrip): void {
    this.clearIdleEvictionTimer(mediaId);
    this.cache.set(mediaId, filmstrip);
    this.updateCacheMeta(mediaId, filmstrip);
    this.enforceMemoryBudget();
    const callbacks = this.updateCallbacks.get(mediaId);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(filmstrip);
      }
    }
    if (!this.hasSubscribers(mediaId) && !filmstrip.isExtracting) {
      this.scheduleIdleEviction(mediaId);
    }
  }

  /**
   * Get filmstrip - loads from storage and starts extraction if needed
   */
  async getFilmstrip(
    mediaId: string,
    blobUrl: string,
    duration: number,
    onProgress?: (progress: number) => void,
    priorityRange?: PriorityFrameRange
  ): Promise<Filmstrip> {
    this.clearIdleEvictionTimer(mediaId);
    const totalFrames = Math.ceil(duration * FRAME_RATE);
    const normalizedPriorityRange = this.normalizePriorityRange(priorityRange, totalFrames);

    // Return cached if complete
    const cached = this.cache.get(mediaId);
    if (cached?.isComplete && !cached.isExtracting) {
      const needsRefinement = this.needsRefinementForRange(
        cached.frames,
        totalFrames,
        normalizedPriorityRange
      );
      if (!needsRefinement) {
        this.touchCacheEntry(mediaId);
        return cached;
      }

      // Kick off a focused refinement pass for the active priority window.
      const existingIndices = cached.frames.map((frame) => frame.index);
      this.startExtraction(
        mediaId,
        blobUrl,
        duration,
        existingIndices,
        cached.frames,
        onProgress,
        false,
        normalizedPriorityRange ?? undefined,
        { priorityOnly: true }
      );

      const refining = { ...cached, isExtracting: true };
      this.notifyUpdate(mediaId, refining);
      return refining;
    }

    const pending = this.pendingExtractions.get(mediaId);
    if (pending) {
      pending.priorityRange = this.normalizePriorityRange(priorityRange, pending.totalFrames);
      const current = this.cache.get(mediaId);
      if (current) {
        this.touchCacheEntry(mediaId);
        return current;
      }
    }

    // Check for pending load
    const loading = this.loadingPromises.get(mediaId);
    if (loading) {
      return loading;
    }

    const promise = this.loadAndExtract(
      mediaId,
      blobUrl,
      duration,
      onProgress,
      normalizedPriorityRange ?? undefined
    );
    this.loadingPromises.set(mediaId, promise);

    try {
      return await promise;
    } finally {
      this.loadingPromises.delete(mediaId);
    }
  }

  private async loadAndExtract(
    mediaId: string,
    blobUrl: string,
    duration: number,
    onProgress?: (progress: number) => void,
    priorityRange?: PriorityFrameRange
  ): Promise<Filmstrip> {
    // Try loading from storage
    const stored = await filmstripOPFSStorage.load(mediaId);

    if (stored?.metadata.isComplete) {
      // Complete - return immediately
      const filmstrip: Filmstrip = {
        frames: stored.frames,
        isComplete: true,
        isExtracting: false,
        progress: 100,
      };
      this.notifyUpdate(mediaId, filmstrip);
      return filmstrip;
    }

    // Notify with existing frames (if any)
    const existingFrames = stored?.frames || [];
    const existingIndices = stored?.existingIndices || [];
    const totalFrames = Math.ceil(duration * FRAME_RATE);
    const targetIndices = this.buildTargetIndices(totalFrames, priorityRange ?? null);
    const targetSet = new Set(targetIndices);
    const existingTargetCount = existingFrames.reduce(
      (count, frame) => (targetSet.has(frame.index) ? count + 1 : count),
      0
    );

    const initialFilmstrip: Filmstrip = {
      frames: existingFrames,
      isComplete: false,
      isExtracting: true,
      progress: targetIndices.length > 0
        ? Math.round((existingTargetCount / targetIndices.length) * 100)
        : 0,
    };
    this.notifyUpdate(mediaId, initialFilmstrip);

    // Start extraction (pass existing frames to avoid reloading)
    this.startExtraction(
      mediaId,
      blobUrl,
      duration,
      existingIndices,
      existingFrames,
      onProgress,
      false,
      priorityRange,
      undefined,
    );

    return initialFilmstrip;
  }

  private startExtraction(
    mediaId: string,
    blobUrl: string,
    duration: number,
    skipIndices: number[],
    existingFrames: FilmstripFrame[],
    onProgress?: (progress: number) => void,
    forceSingleWorker = false,
    priorityRange?: PriorityFrameRange,
    options?: {
      priorityOnly?: boolean;
    }
  ): void {
    // Check if already extracting
    if (this.pendingExtractions.has(mediaId)) {
      return;
    }

    // Calculate total frames and worker count
    const totalFrames = Math.ceil(duration * FRAME_RATE);
    const skipSet = new Set(skipIndices);
    const normalizedPriorityRange = this.normalizePriorityRange(priorityRange, totalFrames);
    const requestedPriorityOnly = options?.priorityOnly ?? false;
    const targetIndices = requestedPriorityOnly
      ? this.buildPriorityIndices(totalFrames, normalizedPriorityRange)
      : this.buildTargetIndices(totalFrames, normalizedPriorityRange);
    const existingTargetCount = targetIndices.reduce(
      (count, index) => (skipSet.has(index) ? count + 1 : count),
      0
    );
    const framesToExtract = Math.max(0, targetIndices.length - existingTargetCount);

    // Initialize with existing frames
    const extractedFrames = new Map<number, FilmstripFrame>();
    for (const frame of existingFrames) {
      extractedFrames.set(frame.index, frame);
    }

    // Create pending extraction state
    const pending: PendingExtraction = {
      mediaId,
      blobUrl,
      duration,
      skipIndices,
      priorityRange: normalizedPriorityRange,
      forceSingleWorker,
      fallbackAttempted: false,
      isVideoFallback: false,
      workers: [],
      totalFrames,
      progressFrames: Math.max(1, targetIndices.length),
      targetIndices,
      priorityOnly: requestedPriorityOnly,
      completedWorkers: 0,
      onProgress,
      extractedFrames,
      lastNotifyAt: 0,
      lastNotifiedFrameCount: existingTargetCount,
      metrics: this.createExtractionMetrics(
        mediaId,
        totalFrames,
        targetIndices,
        existingTargetCount,
        normalizedPriorityRange
      ),
    };
    this.pendingExtractions.set(mediaId, pending);

    if (framesToExtract === 0) {
      this.metricsTotals.started++;
      const targetFrames = [...existingFrames].sort((a, b) => a.index - b.index);
      this.notifyUpdate(mediaId, {
        frames: targetFrames,
        isComplete: true,
        isExtracting: false,
        progress: 100,
      });
      onProgress?.(100);
      this.finalizeExtractionMetrics(pending.metrics, 'completed', targetFrames.length);
      this.cleanupExtraction(mediaId);
      return;
    }

    this.metricsTotals.started++;

    // Persist extraction session metadata once. Workers should focus on frame
    // writes; centralizing meta writes avoids cross-worker file contention.
    void filmstripOPFSStorage.saveMetadata(mediaId, {
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT,
      isComplete: false,
      frameCount: existingFrames.length,
    }).catch((error) => {
      logger.warn(`Failed to persist extraction metadata for ${mediaId}:`, error);
    });

    this.enforceMemoryBudget();
    this.enqueueExtraction(mediaId);
  }

  private enqueueExtraction(mediaId: string): void {
    this.enforceMemoryBudget();
    if (this.activeExtractions.has(mediaId)) {
      return;
    }

    if (this.extractionQueue.includes(mediaId)) {
      return;
    }

    if (this.activeExtractions.size >= this.getMaxConcurrentExtractions()) {
      this.extractionQueue.push(mediaId);
      this.extractionQueue.sort((a, b) => this.getQueueScore(a) - this.getQueueScore(b));
      logger.debug(`Queued filmstrip extraction for ${mediaId}`);
      return;
    }

    this.activeExtractions.add(mediaId);
    this.startPendingExtraction(mediaId);
  }

  private startNextQueuedExtraction(): void {
    if (this.activeExtractions.size >= this.getMaxConcurrentExtractions()) {
      return;
    }

    while (this.extractionQueue.length > 0) {
      const nextMediaId = this.extractionQueue.shift();
      if (!nextMediaId) {
        return;
      }

      if (!this.pendingExtractions.has(nextMediaId)) {
        continue;
      }

      this.activeExtractions.add(nextMediaId);
      this.startPendingExtraction(nextMediaId);
      return;
    }
  }

  private startPendingExtraction(mediaId: string): void {
    const pending = this.pendingExtractions.get(mediaId);
    if (!pending) {
      this.activeExtractions.delete(mediaId);
      this.startNextQueuedExtraction();
      return;
    }

    this.enforceMemoryBudget();
    if (this.isHardMemoryPressure() && !this.hasSubscribers(mediaId)) {
      logger.debug('Deferring filmstrip extraction under hard memory pressure (no subscribers)', {
        mediaId,
        cacheBytes: this.cacheBytes,
        usedHeapBytes: this.getUsedJsHeapBytes(),
      });
      const frames = Array.from(pending.extractedFrames.values())
        .sort((a, b) => a.index - b.index);
      const targetSet = new Set(pending.targetIndices);
      const extractedTargetCount = frames.reduce(
        (count, frame) => (targetSet.has(frame.index) ? count + 1 : count),
        0
      );
      const progress = pending.progressFrames > 0
        ? Math.min(99, Math.round((extractedTargetCount / pending.progressFrames) * 100))
        : 0;
      this.notifyUpdate(mediaId, {
        frames,
        isComplete: false,
        isExtracting: false,
        progress,
      });
      this.finalizeExtractionMetrics(pending.metrics, 'aborted', pending.extractedFrames.size);
      this.cleanupExtraction(mediaId);
      return;
    }

    if (pending.isVideoFallback) {
      void this.extractWithVideoElement(mediaId);
      return;
    }

    this.startWorkerExtraction(pending);
  }

  private normalizePriorityRange(
    priorityRange: PriorityFrameRange | undefined,
    totalFrames: number,
  ): PriorityFrameRange | null {
    if (!priorityRange || totalFrames <= 0) return null;

    const startIndex = Math.max(0, Math.min(totalFrames - 1, priorityRange.startIndex));
    const endIndex = Math.max(startIndex + 1, Math.min(totalFrames, priorityRange.endIndex));

    return { startIndex, endIndex };
  }

  private getPriorityIndicesForRange(
    pending: PendingExtraction,
    rangeStart: number,
    rangeEnd: number,
    rangeSkipIndices: number[],
  ): number[] {
    if (!pending.priorityRange) return [];

    const start = Math.max(rangeStart, pending.priorityRange.startIndex);
    const end = Math.min(rangeEnd, pending.priorityRange.endIndex);
    if (end <= start) return [];

    const skipSet = new Set(rangeSkipIndices);
    const indices: number[] = [];
    for (let i = start; i < end; i++) {
      if (!skipSet.has(i)) {
        indices.push(i);
      }
    }
    return indices;
  }

  private getPriorityIndicesForTargets(
    targetIndices: number[],
    priorityRange: PriorityFrameRange | null,
    skipSet: Set<number>
  ): number[] {
    if (!priorityRange || targetIndices.length === 0) return [];
    const start = priorityRange.startIndex;
    const end = priorityRange.endIndex;
    const indices: number[] = [];
    for (const index of targetIndices) {
      if (index < start || index >= end) continue;
      if (!skipSet.has(index)) {
        indices.push(index);
      }
    }
    return indices;
  }

  private startWorkerExtraction(pending: PendingExtraction): void {
    this.enforceMemoryBudget();
    const {
      mediaId,
      blobUrl,
      duration,
      skipIndices,
      forceSingleWorker,
      progressFrames,
      targetIndices,
    } = pending;
    const skipSet = new Set(skipIndices);
    const framesToExtract = targetIndices.reduce(
      (count, index) => (skipSet.has(index) ? count : count + 1),
      0
    );
    const hardwareConcurrency = typeof navigator !== 'undefined'
      ? (navigator.hardwareConcurrency || 4)
      : 4;
    const memoryConstrained = this.isSoftMemoryPressure();

    // Determine workers per extraction based on hardware and frame count
    const maxWorkers = forceSingleWorker
      || memoryConstrained
      || hardwareConcurrency < MIN_CORES_FOR_PARALLEL_WORKERS
      ? 1
      : MAX_WORKERS;
    const workerCount = Math.min(
      maxWorkers,
      Math.max(1, Math.floor(framesToExtract / MIN_FRAMES_PER_WORKER))
    );

    const sortedTargetIndices = [...targetIndices].sort((a, b) => a - b);
    const effectiveWorkerCount = Math.min(workerCount, Math.max(1, sortedTargetIndices.length));
    const targetsPerWorker = Math.ceil(sortedTargetIndices.length / effectiveWorkerCount);
    pending.metrics.workerCount = effectiveWorkerCount;

    logger.info(`Starting ${effectiveWorkerCount} workers for ${mediaId} (${framesToExtract} frames)`);

    for (let i = 0; i < effectiveWorkerCount; i++) {
      const chunkStart = i * targetsPerWorker;
      const chunkEnd = Math.min(chunkStart + targetsPerWorker, sortedTargetIndices.length);
      const rangeTargetIndices = sortedTargetIndices.slice(chunkStart, chunkEnd);
      if (rangeTargetIndices.length === 0) continue;

      const startIndex = rangeTargetIndices[0]!;
      const endIndex = rangeTargetIndices[rangeTargetIndices.length - 1]! + 1;

      const requestId = crypto.randomUUID();
      const worker = this.acquireWorker();
      const rangeSkipIndices = rangeTargetIndices.filter((idx) => skipSet.has(idx));
      const rangeSkipSet = new Set(rangeSkipIndices);
      const priorityIndices = this.getPriorityIndicesForTargets(
        rangeTargetIndices,
        pending.priorityRange,
        rangeSkipSet,
      );
      const existingTargetCount = rangeSkipIndices.length;

      const workerState: WorkerState = {
        worker,
        requestId,
        startIndex,
        endIndex,
        completed: false,
        frameCount: existingTargetCount,
        lastLoadedCount: existingTargetCount,
        isLoading: false,
        hasPendingLoad: false,
      };
      pending.workers.push(workerState);

      // Handle worker messages
      worker.onmessage = async (e: MessageEvent<WorkerResponse>) => {
        const response = e.data;

        if (response.type === 'progress') {
          workerState.frameCount = response.frameCount;

          // Calculate overall progress from all workers
          const totalExtracted = pending.workers.reduce((sum, w) => sum + w.frameCount, 0);
          const overallProgress = Math.min(100, Math.round((totalExtracted / progressFrames) * 100));
          pending.onProgress?.(overallProgress);

          // Preferred path: use worker-provided blobs directly for progressive
          // updates to avoid OPFS read-after-write latency.
          if (Array.isArray(response.savedFrames) && response.savedFrames.length > 0) {
            this.ingestSavedFrames(
              mediaId,
              response.savedFrames.filter((frame) =>
                frame.index >= workerState.startIndex
                && frame.index < workerState.endIndex
                && !pending.extractedFrames.has(frame.index)
              )
            );
            workerState.lastLoadedCount = Math.max(workerState.lastLoadedCount, response.frameCount);
          } else if (response.savedIndices.length > 0) {
            // Backward-compatible fallback for workers that report only indices.
            const newIndices = response.savedIndices.filter((index) =>
              index >= workerState.startIndex
              && index < workerState.endIndex
              && !pending.extractedFrames.has(index)
            );
            if (newIndices.length > 0) {
              try {
                await this.loadNewFrames(mediaId, newIndices);
              } catch (error) {
                logger.error('Failed to load saved filmstrip frames from OPFS', {
                  mediaId,
                  requestId: workerState.requestId,
                  range: [workerState.startIndex, workerState.endIndex],
                  newIndicesCount: newIndices.length,
                  error,
                });
                this.handleWorkerError(mediaId, 'Failed to load saved frames from OPFS');
                return;
              }
            }
            workerState.lastLoadedCount = Math.max(workerState.lastLoadedCount, response.frameCount);
          } else {
            // Backward-compatible fallback for workers without savedIndices.
            const newFrameCount = Math.max(0, response.frameCount - workerState.lastLoadedCount);
            if (newFrameCount > 0) {
              try {
                await this.flushWorkerRangeLoads(mediaId, workerState);
              } catch (error) {
                logger.error('Failed to flush worker frame range loads from OPFS', {
                  mediaId,
                  requestId: workerState.requestId,
                  range: [workerState.startIndex, workerState.endIndex],
                  newFrameCount,
                  error,
                });
                this.handleWorkerError(mediaId, 'Failed to refresh worker frame range from OPFS');
                return;
              }
            }
          }

          if (this.shouldNotifyProgress(pending, totalExtracted, overallProgress)) {
            // Notify with current state
            const frames = Array.from(pending.extractedFrames.values())
              .sort((a, b) => a.index - b.index);

            this.notifyUpdate(mediaId, {
              frames,
              isComplete: false,
              isExtracting: true,
              progress: overallProgress,
            });
          }

        } else if (response.type === 'complete') {
          workerState.completed = true;
          workerState.frameCount = response.frameCount;
          pending.completedWorkers++;

          logger.debug(`Worker ${i} complete: ${response.frameCount} frames`);

          // Check if all workers are done
          if (pending.completedWorkers === pending.workers.length) {
            // All workers done - finalize directly from in-memory extracted frames
            // to avoid an extra full OPFS directory scan and URL recreation pass.
            const finalFrames = Array.from(pending.extractedFrames.values())
              .sort((a, b) => a.index - b.index);
            try {
              await filmstripOPFSStorage.saveMetadata(mediaId, {
                width: THUMBNAIL_WIDTH,
                height: THUMBNAIL_HEIGHT,
                isComplete: true,
                frameCount: finalFrames.length,
              });
            } catch (metadataError) {
              logger.warn(`Failed to persist completion metadata for ${mediaId}:`, metadataError);
            }
            this.notifyUpdate(mediaId, {
              frames: finalFrames,
              isComplete: true,
              isExtracting: false,
              progress: 100,
            });
            pending.onProgress?.(100);
            this.finalizeExtractionMetrics(pending.metrics, 'completed', finalFrames.length);
            this.cleanupExtraction(mediaId, { reuseCompletedWorkers: true });
            logger.info(`Filmstrip ${mediaId} complete: ${finalFrames.length} frames`);
          }

        } else if (response.type === 'error') {
          if (this.shouldRetryWithSingleWorker(response.error)) {
            logger.warn(`Worker ${i} decode error: ${response.error}`);
          } else {
            logger.error(`Worker ${i} error: ${response.error}`);
          }
          this.handleWorkerError(mediaId, response.error);
        }
      };

      worker.onerror = (e) => {
        if (this.shouldRetryWithSingleWorker(e.message)) {
          logger.warn(`Worker ${i} decode error: ${e.message}`);
        } else {
          logger.error(`Worker ${i} error:`, e.message);
        }
        this.handleWorkerError(mediaId, e.message);
      };

      // Send extraction request with range
      const request: ExtractRequest = {
        type: 'extract',
        requestId,
        mediaId,
        blobUrl,
        duration,
        width: THUMBNAIL_WIDTH,
        height: THUMBNAIL_HEIGHT,
        skipIndices: rangeSkipIndices,
        priorityIndices,
        targetIndices: rangeTargetIndices,
        startIndex,
        endIndex,
        totalFrames: progressFrames,
        workerId: i,
        maxParallelSaves: memoryConstrained
          ? WORKER_PARALLEL_SAVES_MEMORY_PRESSURE
          : WORKER_PARALLEL_SAVES_BASE,
      };
      worker.postMessage(request);
    }
  }

  private shouldNotifyProgress(
    pending: PendingExtraction,
    totalExtracted: number,
    overallProgress: number
  ): boolean {
    const now = Date.now();
    const frameDelta = totalExtracted - pending.lastNotifiedFrameCount;
    const elapsed = now - pending.lastNotifyAt;
    const shouldNotify = overallProgress >= 99
      || frameDelta >= PROGRESS_NOTIFY_FRAME_DELTA
      || elapsed >= PROGRESS_NOTIFY_INTERVAL_MS;

    if (shouldNotify) {
      pending.lastNotifyAt = now;
      pending.lastNotifiedFrameCount = totalExtracted;
      return true;
    }

    return false;
  }

  private async loadNewFramesInRange(
    mediaId: string,
    startIndex: number,
    endIndex: number
  ): Promise<number> {
    const pending = this.pendingExtractions.get(mediaId);
    if (!pending) return 0;

    // Discover what is actually saved on disk for this worker's range.
    const inRangeExistingIndices = await filmstripOPFSStorage.getExistingIndices(
      mediaId,
      startIndex,
      endIndex
    );
    const newIndices = inRangeExistingIndices.filter(index => !pending.extractedFrames.has(index));

    if (newIndices.length > 0) {
      await this.loadNewFrames(mediaId, newIndices);
    }

    // Track discovered file state, not a synthetic contiguous offset.
    return inRangeExistingIndices.length;
  }

  private async loadNewFrames(
    mediaId: string,
    indices: number[]
  ): Promise<void> {
    const pending = this.pendingExtractions.get(mediaId);
    if (!pending) return;

    if (indices.length === 0) return;

    const loadPromises = indices.map(async (index) => {
      const frame = await filmstripOPFSStorage.loadSingleFrame(mediaId, index);
      if (frame) {
        pending.extractedFrames.set(index, frame);
        this.noteFirstFrame(pending.metrics);
      }
    });
    await Promise.all(loadPromises);
  }

  private ingestSavedFrames(
    mediaId: string,
    savedFrames: Array<{ index: number; blob: Blob }>
  ): void {
    const pending = this.pendingExtractions.get(mediaId);
    if (!pending || savedFrames.length === 0) return;

    for (const saved of savedFrames) {
      if (pending.extractedFrames.has(saved.index)) continue;
      const frame = filmstripOPFSStorage.createFrameFromBlob(mediaId, saved.index, saved.blob);
      if (frame) {
        pending.extractedFrames.set(saved.index, frame);
        this.noteFirstFrame(pending.metrics);
      }
    }
  }

  private async flushWorkerRangeLoads(
    mediaId: string,
    workerState: WorkerState
  ): Promise<void> {
    if (workerState.isLoading) {
      workerState.hasPendingLoad = true;
      return;
    }

    workerState.isLoading = true;
    try {
      do {
        workerState.hasPendingLoad = false;
        const discoveredCount = await this.loadNewFramesInRange(
          mediaId,
          workerState.startIndex,
          workerState.endIndex
        );
        workerState.lastLoadedCount = discoveredCount;
      } while (workerState.hasPendingLoad);
    } finally {
      workerState.isLoading = false;
    }
  }

  private shouldRetryWithSingleWorker(error: string): boolean {
    const normalized = error.toLowerCase();
    return normalized.includes('key frame is required after configure() or flush()')
      || normalized.includes('marked as type `key` but wasn\'t a key frame');
  }

  private startVideoElementFallback(
    mediaId: string,
    blobUrl: string,
    duration: number,
    skipIndices: number[],
    existingFrames: FilmstripFrame[],
    onProgress?: (progress: number) => void,
    priorityRange?: PriorityFrameRange,
  ): void {
    if (this.pendingExtractions.has(mediaId)) {
      return;
    }

    const totalFrames = Math.ceil(duration * FRAME_RATE);
    const normalizedPriorityRange = this.normalizePriorityRange(priorityRange, totalFrames);
    const targetIndices = this.buildTargetIndices(totalFrames, normalizedPriorityRange);
    const targetSet = new Set(targetIndices);
    const existingTargetCount = existingFrames.reduce(
      (count, frame) => (targetSet.has(frame.index) ? count + 1 : count),
      0
    );
    const extractedFrames = new Map<number, FilmstripFrame>();
    for (const frame of existingFrames) {
      extractedFrames.set(frame.index, frame);
    }

    const pending: PendingExtraction = {
      mediaId,
      blobUrl,
      duration,
      skipIndices,
      priorityRange: normalizedPriorityRange,
      forceSingleWorker: true,
      fallbackAttempted: true,
      isVideoFallback: true,
      workers: [],
      totalFrames,
      progressFrames: Math.max(1, targetIndices.length),
      targetIndices,
      priorityOnly: false,
      completedWorkers: 0,
      onProgress,
      extractedFrames,
      lastNotifyAt: 0,
      lastNotifiedFrameCount: existingTargetCount,
      metrics: this.createExtractionMetrics(
        mediaId,
        totalFrames,
        targetIndices,
        existingTargetCount,
        normalizedPriorityRange
      ),
    };
    pending.metrics.usedVideoFallback = true;

    this.pendingExtractions.set(mediaId, pending);
    this.metricsTotals.started++;
    logger.warn(`Falling back to HTMLVideoElement extraction for ${mediaId}`);

    this.enqueueExtraction(mediaId);
  }

  private async extractWithVideoElement(mediaId: string): Promise<void> {
    const pending = this.pendingExtractions.get(mediaId);
    if (!pending || !pending.isVideoFallback) return;

    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    try {
      video.src = pending.blobUrl;
      await new Promise<void>((resolve, reject) => {
        const onLoaded = () => {
          video.removeEventListener('loadedmetadata', onLoaded);
          video.removeEventListener('error', onError);
          resolve();
        };
        const onError = () => {
          video.removeEventListener('loadedmetadata', onLoaded);
          video.removeEventListener('error', onError);
          reject(new Error('Failed to load video metadata for filmstrip fallback'));
        };
        video.addEventListener('loadedmetadata', onLoaded, { once: true });
        video.addEventListener('error', onError, { once: true });
      });

      const canvas = document.createElement('canvas');
      canvas.width = THUMBNAIL_WIDTH;
      canvas.height = THUMBNAIL_HEIGHT;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to create canvas context for filmstrip fallback');
      }

      const totalFrames = pending.totalFrames;
      const targetIndices = pending.targetIndices;
      const targetSet = new Set(targetIndices);
      const skipSet = new Set<number>();
      for (const index of pending.skipIndices) {
        if (targetSet.has(index)) skipSet.add(index);
      }
      for (const index of pending.extractedFrames.keys()) {
        if (targetSet.has(index)) skipSet.add(index);
      }
      const totalTargetFrames = Math.max(1, targetIndices.length);
      let extractedTargetCount = skipSet.size;

      await filmstripOPFSStorage.saveMetadata(mediaId, {
        width: THUMBNAIL_WIDTH,
        height: THUMBNAIL_HEIGHT,
        isComplete: false,
        frameCount: skipSet.size,
      });

      const priorityIndices = this.getPriorityIndicesForRange(
        pending,
        0,
        totalFrames,
        Array.from(skipSet)
      ).filter((index) => targetSet.has(index));
      const prioritySet = new Set(priorityIndices);
      const extractionOrder = [
        ...priorityIndices,
        ...targetIndices.filter((index) => !skipSet.has(index) && !prioritySet.has(index)),
      ];

      for (const i of extractionOrder) {
        const currentPending = this.pendingExtractions.get(mediaId);
        if (!currentPending || !currentPending.isVideoFallback) {
          return;
        }

        const maxSeekTime = Math.max(0, video.duration - 0.01);
        const targetTime = Math.min(i / FRAME_RATE, maxSeekTime);

        await this.seekVideo(video, targetTime);
        this.drawCoverFrame(video, ctx, canvas.width, canvas.height);

        const blob = await this.canvasToBlob(canvas);
        await filmstripOPFSStorage.saveFrameBlob(mediaId, i, blob);

        const frame = await filmstripOPFSStorage.loadSingleFrame(mediaId, i);
        if (frame) {
          currentPending.extractedFrames.set(i, frame);
          this.noteFirstFrame(currentPending.metrics);
          extractedTargetCount++;
        }

        const overallProgress = Math.round((extractedTargetCount / totalTargetFrames) * 100);
        currentPending.onProgress?.(overallProgress);

        if (
          extractedTargetCount <= 3
          || extractedTargetCount % 10 === 0
          || extractedTargetCount === totalTargetFrames
        ) {
          const frames = Array.from(currentPending.extractedFrames.values())
            .sort((a, b) => a.index - b.index);
          this.notifyUpdate(mediaId, {
            frames,
            isComplete: false,
            isExtracting: true,
            progress: overallProgress,
          });
        }
      }

      const finishedPending = this.pendingExtractions.get(mediaId);
      if (!finishedPending || !finishedPending.isVideoFallback) {
        return;
      }

      await filmstripOPFSStorage.saveMetadata(mediaId, {
        width: THUMBNAIL_WIDTH,
        height: THUMBNAIL_HEIGHT,
        isComplete: true,
        frameCount: finishedPending.extractedFrames.size,
      });

      const finalFrames = Array.from(finishedPending.extractedFrames.values())
        .sort((a, b) => a.index - b.index);
      this.notifyUpdate(mediaId, {
        frames: finalFrames,
        isComplete: true,
        isExtracting: false,
        progress: 100,
      });
      finishedPending.onProgress?.(100);
      this.finalizeExtractionMetrics(finishedPending.metrics, 'completed', finalFrames.length);
      this.cleanupExtraction(mediaId);
      logger.info(`Filmstrip ${mediaId} complete via video fallback: ${finalFrames.length} frames`);
    } catch (error) {
      logger.error(`Video fallback extraction failed for ${mediaId}:`, error);

      const currentPending = this.pendingExtractions.get(mediaId);
      const frames = currentPending
        ? Array.from(currentPending.extractedFrames.values()).sort((a, b) => a.index - b.index)
        : [];

      this.notifyUpdate(mediaId, {
        frames,
        isComplete: false,
        isExtracting: false,
        progress: 0,
      });
      if (currentPending) {
        this.finalizeExtractionMetrics(currentPending.metrics, 'failed', frames.length);
      }
      this.cleanupExtraction(mediaId);
    } finally {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  }

  private async seekVideo(video: HTMLVideoElement, targetTime: number): Promise<void> {
    const clamped = Math.max(0, targetTime);
    if (Math.abs(video.currentTime - clamped) < 0.001) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
        resolve();
      };
      const onError = () => {
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
        reject(new Error('Video seek failed during filmstrip fallback'));
      };

      video.addEventListener('seeked', onSeeked, { once: true });
      video.addEventListener('error', onError, { once: true });
      video.currentTime = clamped;
    });
  }

  private drawCoverFrame(
    video: HTMLVideoElement,
    ctx: CanvasRenderingContext2D,
    targetWidth: number,
    targetHeight: number
  ): void {
    const sourceWidth = video.videoWidth || targetWidth;
    const sourceHeight = video.videoHeight || targetHeight;

    const sourceAspect = sourceWidth / sourceHeight;
    const targetAspect = targetWidth / targetHeight;

    let drawWidth = targetWidth;
    let drawHeight = targetHeight;
    let offsetX = 0;
    let offsetY = 0;

    if (sourceAspect > targetAspect) {
      drawHeight = targetHeight;
      drawWidth = drawHeight * sourceAspect;
      offsetX = (targetWidth - drawWidth) / 2;
    } else {
      drawWidth = targetWidth;
      drawHeight = drawWidth / sourceAspect;
      offsetY = (targetHeight - drawHeight) / 2;
    }

    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
  }

  private canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
            return;
          }
          reject(new Error('Failed to convert filmstrip fallback canvas to blob'));
        },
        IMAGE_FORMAT,
        IMAGE_QUALITY
      );
    });
  }

  private handleWorkerError(mediaId: string, error = ''): void {
    const pending = this.pendingExtractions.get(mediaId);
    if (!pending) return;

    // Keep any frames we have
    const currentFrames = Array.from(pending.extractedFrames.values())
      .sort((a, b) => a.index - b.index);

    if (
      !pending.forceSingleWorker
      && !pending.fallbackAttempted
      && this.shouldRetryWithSingleWorker(error)
    ) {
      logger.warn(`Retrying filmstrip extraction for ${mediaId} with a single worker`);

      const skipIndices = Array.from(new Set([
        ...pending.skipIndices,
        ...currentFrames.map(frame => frame.index),
      ]));

      pending.fallbackAttempted = true;
      this.finalizeExtractionMetrics(pending.metrics, 'failed', currentFrames.length);
      this.cleanupExtraction(mediaId);
      this.startExtraction(
        mediaId,
        pending.blobUrl,
        pending.duration,
        skipIndices,
        currentFrames,
        pending.onProgress,
        true,
        pending.priorityRange ?? undefined,
        {
          priorityOnly: pending.priorityOnly,
        }
      );
      return;
    }

    if (pending.forceSingleWorker && !pending.isVideoFallback && this.shouldRetryWithSingleWorker(error)) {
      logger.warn(`Single-worker decode failed for ${mediaId}; switching to video element fallback`);

      const skipIndices = Array.from(new Set([
        ...pending.skipIndices,
        ...currentFrames.map(frame => frame.index),
      ]));

      this.finalizeExtractionMetrics(pending.metrics, 'failed', currentFrames.length);
      this.cleanupExtraction(mediaId);
      this.startVideoElementFallback(
        mediaId,
        pending.blobUrl,
        pending.duration,
        skipIndices,
        currentFrames,
        pending.onProgress,
        pending.priorityRange ?? undefined,
      );
      return;
    }

    if (!pending.isVideoFallback && !pending.fallbackAttempted) {
      logger.warn(`Worker extraction failed for ${mediaId}; switching to video fallback`);

      const skipIndices = Array.from(new Set([
        ...pending.skipIndices,
        ...currentFrames.map(frame => frame.index),
      ]));

      this.finalizeExtractionMetrics(pending.metrics, 'failed', currentFrames.length);
      this.cleanupExtraction(mediaId);
      this.startVideoElementFallback(
        mediaId,
        pending.blobUrl,
        pending.duration,
        skipIndices,
        currentFrames,
        pending.onProgress,
        pending.priorityRange ?? undefined,
      );
      return;
    }

    this.notifyUpdate(mediaId, {
      frames: currentFrames,
      isComplete: false,
      isExtracting: false,
      progress: 0,
    });
    this.finalizeExtractionMetrics(pending.metrics, 'failed', currentFrames.length);
    this.cleanupExtraction(mediaId);
  }

  private cleanupExtraction(
    mediaId: string,
    options?: { reuseCompletedWorkers?: boolean }
  ): void {
    const reuseCompletedWorkers = options?.reuseCompletedWorkers ?? false;
    const pending = this.pendingExtractions.get(mediaId);
    const wasActive = this.activeExtractions.delete(mediaId);
    const queueIndex = this.extractionQueue.indexOf(mediaId);
    if (queueIndex !== -1) {
      this.extractionQueue.splice(queueIndex, 1);
    }

    if (pending) {
      // Reuse workers only after clean completion. Any in-flight/error/abort
      // path terminates workers to avoid cross-request message bleed.
      for (const workerState of pending.workers) {
        if (reuseCompletedWorkers && workerState.completed) {
          this.releaseWorker(workerState.worker);
        } else {
          this.terminateWorker(workerState.worker);
        }
      }
      this.pendingExtractions.delete(mediaId);
    }

    if (!this.hasSubscribers(mediaId)) {
      this.scheduleIdleEviction(mediaId);
    }
    this.enforceMemoryBudget();

    if (wasActive) {
      this.startNextQueuedExtraction();
    }
  }

  /**
   * Abort extraction
   */
  abort(mediaId: string): void {
    const pending = this.pendingExtractions.get(mediaId);
    if (pending) {
      // Send abort to all workers
      for (const workerState of pending.workers) {
        workerState.worker.postMessage({ type: 'abort', requestId: workerState.requestId });
      }
      const frames = Array.from(pending.extractedFrames.values())
        .sort((a, b) => a.index - b.index);
      const targetSet = new Set(pending.targetIndices);
      const extractedTargetCount = frames.reduce(
        (count, frame) => (targetSet.has(frame.index) ? count + 1 : count),
        0
      );
      const progress = pending.progressFrames > 0
        ? Math.min(99, Math.round((extractedTargetCount / pending.progressFrames) * 100))
        : 0;
      this.notifyUpdate(mediaId, {
        frames,
        isComplete: false,
        isExtracting: false,
        progress,
      });
      this.finalizeExtractionMetrics(
        pending.metrics,
        'aborted',
        pending.extractedFrames.size
      );
      this.cleanupExtraction(mediaId);
    }
  }

  /**
   * Get synchronously from cache (for avoiding flash on remount)
   */
  getFromCacheSync(mediaId: string): Filmstrip | null {
    const cached = this.cache.get(mediaId) || null;
    if (cached) {
      this.clearIdleEvictionTimer(mediaId);
      this.touchCacheEntry(mediaId);
    }
    return cached;
  }

  /**
   * Clear filmstrip for a media item
   */
  async clearMedia(mediaId: string): Promise<void> {
    this.abort(mediaId);
    this.clearIdleEvictionTimer(mediaId);
    this.cache.delete(mediaId);
    this.clearCacheMeta(mediaId);
    filmstripOPFSStorage.revokeUrls(mediaId);
    await filmstripOPFSStorage.delete(mediaId);
  }

  /**
   * Clear all
   */
  async clearAll(): Promise<void> {
    for (const mediaId of this.pendingExtractions.keys()) {
      this.abort(mediaId);
    }
    for (const timer of this.idleEvictionTimers.values()) {
      clearTimeout(timer);
    }
    this.idleEvictionTimers.clear();
    this.cache.clear();
    this.cacheMeta.clear();
    this.cacheBytes = 0;
    await filmstripOPFSStorage.clearAll();
  }

  /**
   * Dispose
   */
  async dispose(): Promise<void> {
    for (const mediaId of this.pendingExtractions.keys()) {
      this.abort(mediaId);
    }
    for (const worker of [...this.workerPool]) {
      this.terminateWorker(worker);
    }
    this.workerPool = [];
    for (const worker of Array.from(this.allWorkers)) {
      this.terminateWorker(worker);
    }
    for (const timer of this.idleEvictionTimers.values()) {
      clearTimeout(timer);
    }
    await filmstripOPFSStorage.clearAll();
    this.idleEvictionTimers.clear();
    this.cache.clear();
    this.cacheMeta.clear();
    this.cacheBytes = 0;
    this.pendingExtractions.clear();
    this.clearMetrics();
    this.updateCallbacks.clear();
    this.loadingPromises.clear();
    this.activeExtractions.clear();
    this.extractionQueue = [];
  }
}

// Singleton
export const filmstripCache = new FilmstripCacheService();

declare global {
  interface Window {
    __filmstripCache?: FilmstripCacheService;
    __filmstripMetrics?: {
      getSnapshot: () => FilmstripMetricsSnapshot;
      clear: () => void;
    };
  }
}

if (import.meta.env.DEV) {
  window.__filmstripCache = filmstripCache;
  window.__filmstripMetrics = {
    getSnapshot: () => filmstripCache.getMetricsSnapshot(),
    clear: () => filmstripCache.clearMetrics(),
  };
}
