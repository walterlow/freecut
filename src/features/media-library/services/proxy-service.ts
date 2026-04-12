/**
 * Proxy Video Service
 *
 * Manages 720p proxy video generation lifecycle:
 * - Start/cancel proxy generation for a media item
 * - Track generation status per mediaId
 * - Load existing proxies from OPFS on startup
 * - Provide proxy blob URLs for preview playback
 * - Clean up proxies when media is deleted
 *
 * Storage structure (OPFS):
 *   proxies/{proxyKey}/
 *     proxy.mp4
 *     meta.json - { width, height, status, createdAt, version, sourceWidth, sourceHeight }
 */

import { createLogger } from '@/shared/logging/logger';
import { createManagedWorker } from '@/shared/utils/managed-worker';
import { registerObjectUrl, unregisterObjectUrl } from '@/infrastructure/browser/object-url-registry';
import { useSettingsStore } from '@/features/media-library/deps/settings-contract';
import { filmstripCache } from '@/features/media-library/deps/timeline-services';
import { needsCustomAudioDecoder } from '@/features/media-library/deps/composition-runtime';
import {
  DEFAULT_PROXY_GENERATION_MODE,
  DEFAULT_PROXY_GENERATION_RESOLUTION,
  getProxyGenerationThreshold,
  isVideoProxyCandidate,
} from '@/config/proxy-generation';
import { PROXY_DIR, PROXY_SCHEMA_VERSION } from '../proxy-constants';
import type {
  ProxyWorkerRequest,
  ProxyWorkerResponse,
} from '../workers/proxy-generation-worker';
import { useMediaLibraryStore } from '../stores/media-library-store';
import { enqueueBackgroundMediaWork } from './background-media-work';

const logger = createLogger('ProxyService');

function revokeRegisteredObjectUrl(url: string): void {
  unregisterObjectUrl(url);
  URL.revokeObjectURL(url);
}

function getProxyOpfsPath(proxyKey: string): string {
  return `${PROXY_DIR}/${proxyKey}/proxy.mp4`;
}

const PROXY_PRIORITY_AUDIO_CODECS = new Set([
  'ac-3',
  'ac3',
  'ec-3',
  'eac3',
  'e-ac-3',
  'dts',
  'pcm-s16be',
  'pcm-s16le',
  'pcm-s24be',
  'pcm-s24le',
  'pcm-s32be',
  'pcm-s32le',
  's16be',
  's16le',
  's24be',
  's24le',
  's32be',
  's32le',
  's16',
  's24',
  's32',
  'twos',
  'sowt',
  'lpcm',
]);

interface ProxyMetadata {
  version?: number;
  width: number;
  height: number;
  sourceWidth?: number;
  sourceHeight?: number;
  status: string;
  createdAt: number;
}

type ProxyStatusListener = (
  mediaId: string,
  status: 'generating' | 'ready' | 'error' | 'idle',
  progress?: number
) => void;

type ProxySourceLoader = () => Promise<Blob | null>;
type ProxySourceInput = Blob | ProxySourceLoader;
type ProxyJobPriority = 'user' | 'background';
type ProxyPlaybackIssue =
  | 'slow-seek'
  | 'slow-decode'
  | 'playback-resync'
  | 'waiting'
  | 'stalled'
  | 'dropped-frames';

interface ProxyGenerationOptions {
  priority?: ProxyJobPriority;
}

interface ProxyPlaybackIssueOptions {
  proxyKey?: string;
  source?: ProxySourceInput;
  sourceWidth?: number;
  sourceHeight?: number;
  priority?: ProxyJobPriority;
}

interface QueuedProxyJob {
  mediaId: string;
  proxyKey: string;
  sourceWidth: number;
  sourceHeight: number;
  loadSource: ProxySourceLoader;
  priority: ProxyJobPriority;
}

interface ProgressEmissionState {
  lastEmitAt: number;
  lastProgress: number;
  pendingProgress: number | null;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

const PROXY_PROGRESS_EMIT_INTERVAL_MS = 150;
const PROXY_PROGRESS_EMIT_MIN_DELTA = 0.01;
const PROXY_FILMSTRIP_PREWARM_SECONDS = 12;
const PROXY_FILMSTRIP_PREWARM_DELAY_MS = 900;
const PROXY_PLAYBACK_ISSUE_SCORE_THRESHOLD = 5;
const PROXY_PLAYBACK_ISSUE_WEIGHTS: Record<ProxyPlaybackIssue, number> = {
  'slow-seek': 2,
  'slow-decode': 2,
  'playback-resync': 2,
  waiting: 3,
  stalled: 3,
  'dropped-frames': 3,
};
const PROXY_PLAYBACK_ISSUE_COOLDOWN_MS: Record<ProxyPlaybackIssue, number> = {
  'slow-seek': 1200,
  'slow-decode': 1200,
  'playback-resync': 1500,
  waiting: 2500,
  stalled: 2500,
  'dropped-frames': 3000,
};

class ProxyService {
  private proxyBlobUrlByKey = new Map<string, string>();
  private proxyKeyByMediaId = new Map<string, string>();
  private mediaIdsByProxyKey = new Map<string, Set<string>>();
  private progressByProxyKey = new Map<string, number>();
  private playbackIssueScoreByMediaId = new Map<string, number>();
  private playbackIssueLastAtByMediaId = new Map<string, Map<ProxyPlaybackIssue, number>>();
  private pendingJobsByKey = new Map<string, QueuedProxyJob>();
  private pendingJobOrder: string[] = [];
  private activeJobPhaseByKey = new Map<string, 'loading' | 'processing'>();
  private progressEmissionByProxyKey = new Map<string, ProgressEmissionState>();
  private statusListener: ProxyStatusListener | null = null;
  private generatingProxyKeys = new Set<string>();
  private isRefreshing = false;
  private readonly maxConcurrentJobs = 1;
  private readonly workerManager = createManagedWorker({
    createWorker: () => new Worker(
      new URL('../workers/proxy-generation-worker.ts', import.meta.url),
      { type: 'module' }
    ),
    setupWorker: (worker) => {
      worker.onmessage = (event: MessageEvent<ProxyWorkerResponse>) => {
        this.handleWorkerMessage(event.data);
      };

      worker.onerror = (error) => {
        logger.error('Proxy worker error:', error);
      };

      return () => {
        worker.onmessage = null;
        worker.onerror = null;
      };
    },
  });

  /**
   * Register a listener for proxy status changes (used by the store)
   */
  onStatusChange(listener: ProxyStatusListener): void {
    this.statusListener = listener;
  }

  /**
   * Register media -> proxy identity mapping so multiple media items can
   * share one physical proxy file.
   */
  setProxyKey(mediaId: string, proxyKey: string): void {
    const existingKey = this.proxyKeyByMediaId.get(mediaId);
    if (existingKey === proxyKey) {
      return;
    }

    if (existingKey) {
      const existingSet = this.mediaIdsByProxyKey.get(existingKey);
      existingSet?.delete(mediaId);
      if (existingSet && existingSet.size === 0) {
        this.mediaIdsByProxyKey.delete(existingKey);
      }
    }

    this.proxyKeyByMediaId.set(mediaId, proxyKey);

    let mediaIds = this.mediaIdsByProxyKey.get(proxyKey);
    if (!mediaIds) {
      mediaIds = new Set<string>();
      this.mediaIdsByProxyKey.set(proxyKey, mediaIds);
    }
    mediaIds.add(mediaId);

    // Immediately synchronize status for newly mapped aliases.
    if (this.proxyBlobUrlByKey.has(proxyKey)) {
      this.statusListener?.(mediaId, 'ready');
    } else if (this.generatingProxyKeys.has(proxyKey)) {
      this.statusListener?.(mediaId, 'generating', this.progressByProxyKey.get(proxyKey) ?? 0);
    }
  }

  /**
   * Remove media -> proxy identity mapping.
   */
  clearProxyKey(mediaId: string): void {
    const proxyKey = this.proxyKeyByMediaId.get(mediaId);
    if (!proxyKey) {
      return;
    }

    this.proxyKeyByMediaId.delete(mediaId);
    const mediaIds = this.mediaIdsByProxyKey.get(proxyKey);
    mediaIds?.delete(mediaId);
    if (mediaIds && mediaIds.size === 0) {
      this.mediaIdsByProxyKey.delete(proxyKey);
    }
  }

  getProxyKey(mediaId: string): string | undefined {
    return this.proxyKeyByMediaId.get(mediaId);
  }

  prioritizeProxy(mediaId: string, proxyKey?: string): void {
    const resolvedProxyKey = this.resolveProxyKey(mediaId, proxyKey);
    const pendingJob = this.pendingJobsByKey.get(resolvedProxyKey);
    if (!pendingJob || pendingJob.priority === 'user') {
      return;
    }

    this.removePendingJob(resolvedProxyKey);
    pendingJob.priority = 'user';
    this.insertPendingJob(pendingJob);
  }

  /**
   * Check if media supports manual proxy generation.
   */
  canGenerateProxy(mimeType: string): boolean {
    return isVideoProxyCandidate(mimeType);
  }

  isProxyRecommended(mediaId: string): boolean {
    return useSettingsStore.getState().proxyRecommendedMediaIds.includes(mediaId);
  }

  reportPlaybackIssue(
    mediaId: string,
    issue: ProxyPlaybackIssue,
    options: ProxyPlaybackIssueOptions = {},
  ): boolean {
    const normalizedMediaId = mediaId.trim();
    if (!normalizedMediaId) {
      return false;
    }

    if (this.isProxyRecommended(normalizedMediaId)) {
      return false;
    }

    const now = Date.now();
    const issueTimestamps = this.playbackIssueLastAtByMediaId.get(normalizedMediaId) ?? new Map();
    const lastIssueAt = issueTimestamps.get(issue) ?? 0;
    if ((now - lastIssueAt) < PROXY_PLAYBACK_ISSUE_COOLDOWN_MS[issue]) {
      return false;
    }

    issueTimestamps.set(issue, now);
    this.playbackIssueLastAtByMediaId.set(normalizedMediaId, issueTimestamps);

    const nextScore = (
      this.playbackIssueScoreByMediaId.get(normalizedMediaId) ?? 0
    ) + PROXY_PLAYBACK_ISSUE_WEIGHTS[issue];
    this.playbackIssueScoreByMediaId.set(normalizedMediaId, nextScore);

    if (nextScore < PROXY_PLAYBACK_ISSUE_SCORE_THRESHOLD) {
      return false;
    }

    useSettingsStore.getState().markProxyRecommended(normalizedMediaId);
    this.playbackIssueScoreByMediaId.delete(normalizedMediaId);
    this.playbackIssueLastAtByMediaId.delete(normalizedMediaId);

    logger.info(`Runtime proxy recommendation triggered for ${normalizedMediaId}`, {
      issue,
      score: nextScore,
    });

    const shouldAutoQueue = (
      (useSettingsStore.getState().proxyGenerationMode ?? DEFAULT_PROXY_GENERATION_MODE) === 'smart'
      && options.source
      && typeof options.sourceWidth === 'number'
      && typeof options.sourceHeight === 'number'
    );

    if (shouldAutoQueue) {
      this.generateProxy(
        normalizedMediaId,
        options.source!,
        options.sourceWidth!,
        options.sourceHeight!,
        options.proxyKey,
        { priority: options.priority ?? 'background' }
      );
    }

    return true;
  }

  /**
   * Check if a video qualifies for automatic proxy generation.
   * - Honors user settings for smart/manual/all modes
   * - Always true in smart mode for heavy/problematic audio codecs
   * - Otherwise true for sources at or above the configured resolution threshold
   */
  needsProxy(width: number, height: number, mimeType: string, audioCodec?: string, mediaId?: string): boolean {
    if (!this.canGenerateProxy(mimeType)) return false;

    const settings = useSettingsStore.getState();
    const proxyGenerationMode = settings.proxyGenerationMode ?? DEFAULT_PROXY_GENERATION_MODE;
    if (proxyGenerationMode === 'manual') {
      return false;
    }
    if (proxyGenerationMode === 'all') {
      return true;
    }

    if (mediaId && this.isProxyRecommended(mediaId)) {
      return true;
    }

    const normalizedAudioCodec = (audioCodec ?? '').toLowerCase();
    if (PROXY_PRIORITY_AUDIO_CODECS.has(normalizedAudioCodec)) {
      return true;
    }
    if (needsCustomAudioDecoder(audioCodec)) {
      return true;
    }

    const threshold = getProxyGenerationThreshold(
      settings.proxyGenerationResolution ?? DEFAULT_PROXY_GENERATION_RESOLUTION
    );
    return width >= threshold.width || height >= threshold.height;
  }

  /**
   * Start proxy generation for a media item
   */
  generateProxy(
    mediaId: string,
    source: ProxySourceInput,
    sourceWidth: number,
    sourceHeight: number,
    proxyKey?: string,
    options?: ProxyGenerationOptions
  ): void {
    if (proxyKey) {
      this.setProxyKey(mediaId, proxyKey);
    }
    const resolvedProxyKey = this.resolveProxyKey(mediaId, proxyKey);

    if (this.proxyBlobUrlByKey.has(resolvedProxyKey)) {
      this.emitStatusForProxyKey(resolvedProxyKey, 'ready');
      return;
    }

    if (this.generatingProxyKeys.has(resolvedProxyKey)) {
      const existingJob = this.pendingJobsByKey.get(resolvedProxyKey);
      if (existingJob && (options?.priority ?? 'user') === 'user' && existingJob.priority !== 'user') {
        this.removePendingJob(resolvedProxyKey);
        existingJob.priority = 'user';
        this.insertPendingJob(existingJob);
      }
      this.emitStatusForProxyKey(
        resolvedProxyKey,
        'generating',
        this.progressByProxyKey.get(resolvedProxyKey) ?? 0
      );
      return;
    }

    this.generatingProxyKeys.add(resolvedProxyKey);
    this.progressByProxyKey.set(resolvedProxyKey, 0);
    this.emitStatusForProxyKey(resolvedProxyKey, 'generating', 0);

    this.insertPendingJob({
      mediaId,
      proxyKey: resolvedProxyKey,
      sourceWidth,
      sourceHeight,
      loadSource: this.normalizeSourceLoader(source),
      priority: options?.priority ?? 'user',
    });
    this.drainQueue();
  }

  /**
   * Cancel proxy generation for a media item
   */
  cancelProxy(mediaId: string, proxyKey?: string): void {
    const resolvedProxyKey = this.resolveProxyKey(mediaId, proxyKey);
    if (!this.generatingProxyKeys.has(resolvedProxyKey)) return;

    this.generatingProxyKeys.delete(resolvedProxyKey);
    this.progressByProxyKey.delete(resolvedProxyKey);
    this.clearProgressEmissionState(resolvedProxyKey);
    this.emitStatusForProxyKey(resolvedProxyKey, 'idle');

    if (this.pendingJobsByKey.has(resolvedProxyKey)) {
      this.removePendingJob(resolvedProxyKey);
      return;
    }

    const activePhase = this.activeJobPhaseByKey.get(resolvedProxyKey);
    if (!activePhase) {
      return;
    }

    if (activePhase === 'loading') {
      this.activeJobPhaseByKey.delete(resolvedProxyKey);
      this.drainQueue();
      return;
    }

    const worker = this.getWorker();
    worker.postMessage({
      type: 'cancel',
      mediaId: resolvedProxyKey,
    } as ProxyWorkerRequest);
  }

  /**
   * Get proxy blob URL if available
   */
  getProxyBlobUrl(mediaId: string, proxyKey?: string): string | null {
    const resolvedProxyKey = this.resolveProxyKey(mediaId, proxyKey);
    return this.proxyBlobUrlByKey.get(resolvedProxyKey) ?? null;
  }

  /**
   * Check if proxy exists and is ready
   */
  hasProxy(mediaId: string, proxyKey?: string): boolean {
    const resolvedProxyKey = this.resolveProxyKey(mediaId, proxyKey);
    return this.proxyBlobUrlByKey.has(resolvedProxyKey);
  }

  /**
   * Delete proxy for a media item (OPFS + cache)
   */
  async deleteProxy(mediaId: string, proxyKey?: string): Promise<void> {
    const resolvedProxyKey = this.resolveProxyKey(mediaId, proxyKey);

    // Cancel if generating
    this.cancelProxy(mediaId, resolvedProxyKey);

    // Revoke blob URL
    const url = this.proxyBlobUrlByKey.get(resolvedProxyKey);
    if (url) {
      revokeRegisteredObjectUrl(url);
      this.proxyBlobUrlByKey.delete(resolvedProxyKey);
    }

    this.clearPlaybackRecommendationForProxyKey(resolvedProxyKey);

    // Remove from OPFS
    try {
      const root = await navigator.storage.getDirectory();
      const proxyRoot = await root.getDirectoryHandle(PROXY_DIR);
      await proxyRoot.removeEntry(resolvedProxyKey, { recursive: true });
      logger.debug(`Deleted proxy for ${resolvedProxyKey}`);
    } catch {
      // Directory may not exist
    }
  }

  /**
   * Load existing proxies from OPFS at startup.
   * Only loads proxies for the given mediaIds (project-scoped).
   */
  async loadExistingProxies(mediaIds: string[]): Promise<string[]> {
    const staleProxyIds: string[] = [];
    try {
      const root = await navigator.storage.getDirectory();
      let proxyRoot: FileSystemDirectoryHandle;
      try {
        proxyRoot = await root.getDirectoryHandle(PROXY_DIR);
      } catch {
        return staleProxyIds; // No proxies directory yet
      }

      const requestedProxyKeys = new Set<string>();
      for (const mediaId of mediaIds) {
        requestedProxyKeys.add(this.resolveProxyKey(mediaId));
      }

      const collectMappedMediaIds = (proxyKey: string): string[] => {
        const mappedMediaIds = this.mediaIdsByProxyKey.get(proxyKey);
        if (!mappedMediaIds || mappedMediaIds.size === 0) {
          return [];
        }

        return [...mappedMediaIds];
      };

      const removeProxyEntry = async (proxyKey: string, reason: string): Promise<void> => {
        try {
          await proxyRoot.removeEntry(proxyKey, { recursive: true });
          logger.debug(`Removed ${reason} proxy for ${proxyKey}`);
        } catch (error) {
          logger.error(`Failed to remove ${reason} proxy for ${proxyKey}:`, error);
        }
      };

      for await (const entry of proxyRoot.values()) {
        if (entry.kind !== 'directory') continue;
        if (!requestedProxyKeys.has(entry.name)) continue;

        const proxyKey = entry.name;

        try {
          const mediaDir = await proxyRoot.getDirectoryHandle(proxyKey);

          // Check metadata
          const metaHandle = await mediaDir.getFileHandle('meta.json');
          const metaFile = await metaHandle.getFile();
          const metadata: ProxyMetadata = JSON.parse(await metaFile.text());

          if (metadata.status === 'generating') {
            staleProxyIds.push(...collectMappedMediaIds(proxyKey));
            await removeProxyEntry(proxyKey, 'interrupted');
            continue;
          }

          if (metadata.status === 'error') {
            // Failed proxies are removed, but we do not automatically requeue
            // them on startup. Repeated deterministic failures should not keep
            // restarting in the background every session.
            await removeProxyEntry(proxyKey, 'failed');
            continue;
          }

          if (metadata.status !== 'ready') {
            staleProxyIds.push(...collectMappedMediaIds(proxyKey));
            await removeProxyEntry(proxyKey, 'invalid-status');
            continue;
          }

          // Invalidate stale proxy formats to avoid aspect distortion from
          // legacy fixed-1280x720 transcodes.
          if (metadata.version !== PROXY_SCHEMA_VERSION) {
            const mappedMediaIds = collectMappedMediaIds(proxyKey);
            if (mappedMediaIds.length > 0) {
              staleProxyIds.push(...mappedMediaIds);
            } else {
              logger.debug(`Stale proxy ${proxyKey} has no mapped media ids; deleting stale file only`);
            }

            await removeProxyEntry(proxyKey, 'stale');
            continue;
          }

          // Load proxy file and create blob URL
          const proxyHandle = await mediaDir.getFileHandle('proxy.mp4');
          const proxyFile = await proxyHandle.getFile();

          if (proxyFile.size === 0) {
            staleProxyIds.push(...collectMappedMediaIds(proxyKey));
            await removeProxyEntry(proxyKey, 'empty');
            continue;
          }

          const blobUrl = URL.createObjectURL(proxyFile);
          registerObjectUrl(blobUrl, proxyFile, {
            storageType: 'opfs',
            opfsPath: getProxyOpfsPath(proxyKey),
            fileSize: proxyFile.size,
          });
          this.proxyBlobUrlByKey.set(proxyKey, blobUrl);
          this.emitStatusForProxyKey(proxyKey, 'ready');

          logger.debug(`Loaded existing proxy for ${proxyKey}`);
        } catch {
          staleProxyIds.push(...collectMappedMediaIds(proxyKey));
          await removeProxyEntry(proxyKey, 'invalid');
        }
      }
    } catch (error) {
      logger.warn('Failed to load existing proxies:', error);
    }

    return staleProxyIds;
  }

  /**
   * Get or create the shared worker instance
   */
  private getWorker(): Worker {
    return this.workerManager.getWorker();
  }

  /**
   * Handle messages from the worker
   */
  private handleWorkerMessage(message: ProxyWorkerResponse): void {
    // Worker uses `mediaId` field as proxyKey for storage identity.
    const proxyKey = message.mediaId;

    switch (message.type) {
      case 'progress': {
        if (!this.generatingProxyKeys.has(proxyKey)) {
          break;
        }
        this.progressByProxyKey.set(proxyKey, message.progress);
        this.emitProgressThrottled(proxyKey, message.progress);
        break;
      }

      case 'complete': {
        const wasCancelled = !this.generatingProxyKeys.has(proxyKey);
        this.activeJobPhaseByKey.delete(proxyKey);
        this.generatingProxyKeys.delete(proxyKey);
        this.progressByProxyKey.delete(proxyKey);
        this.clearProgressEmissionState(proxyKey);
        this.drainQueue();
        if (wasCancelled) {
          break;
        }
        // Load the completed proxy from OPFS
        void this.loadCompletedProxy(proxyKey);
        break;
      }

      case 'cancelled': {
        this.activeJobPhaseByKey.delete(proxyKey);
        this.generatingProxyKeys.delete(proxyKey);
        this.progressByProxyKey.delete(proxyKey);
        this.clearProgressEmissionState(proxyKey);
        this.drainQueue();
        break;
      }

      case 'error': {
        const wasCancelled = !this.generatingProxyKeys.has(proxyKey);
        this.activeJobPhaseByKey.delete(proxyKey);
        this.generatingProxyKeys.delete(proxyKey);
        this.progressByProxyKey.delete(proxyKey);
        this.clearProgressEmissionState(proxyKey);
        this.drainQueue();
        if (wasCancelled) {
          break;
        }
        logger.error(`Proxy generation failed for ${proxyKey}:`, message.error);
        this.emitStatusForProxyKey(proxyKey, 'error');
        break;
      }
    }
  }

  /**
   * Load a freshly completed proxy from OPFS and cache its blob URL
   */
  private async loadCompletedProxy(proxyKey: string): Promise<void> {
    try {
      const root = await navigator.storage.getDirectory();
      const proxyRoot = await root.getDirectoryHandle(PROXY_DIR);
      const mediaDir = await proxyRoot.getDirectoryHandle(proxyKey);
      const proxyHandle = await mediaDir.getFileHandle('proxy.mp4');
      const proxyFile = await proxyHandle.getFile();

      if (proxyFile.size === 0) {
        this.emitStatusForProxyKey(proxyKey, 'error');
        return;
      }

      const previousBlobUrl = this.proxyBlobUrlByKey.get(proxyKey);
      if (previousBlobUrl) {
        revokeRegisteredObjectUrl(previousBlobUrl);
      }

      const blobUrl = URL.createObjectURL(proxyFile);
      registerObjectUrl(blobUrl, proxyFile, {
        storageType: 'opfs',
        opfsPath: getProxyOpfsPath(proxyKey),
        fileSize: proxyFile.size,
      });
      this.proxyBlobUrlByKey.set(proxyKey, blobUrl);
      this.emitStatusForProxyKey(proxyKey, 'ready');
      this.prewarmFilmstripFromProxy(proxyKey, proxyFile);

      logger.debug(`Proxy ready for ${proxyKey}`);
    } catch (error) {
      logger.error(`Failed to load completed proxy for ${proxyKey}:`, error);
      this.emitStatusForProxyKey(proxyKey, 'error');
    }
  }

  private prewarmFilmstripFromProxy(proxyKey: string, proxyFile: Blob): void {
    const mediaIds = [...(this.mediaIdsByProxyKey.get(proxyKey) ?? [])];
    if (mediaIds.length === 0) {
      return;
    }

    const mediaById = useMediaLibraryStore.getState().mediaById;
    for (const mediaId of mediaIds) {
      const media = mediaById[mediaId];
      if (!media || !media.mimeType.startsWith('video/') || media.duration <= 0) {
        continue;
      }

      const warmEndTime = Math.min(media.duration, PROXY_FILMSTRIP_PREWARM_SECONDS);
      enqueueBackgroundMediaWork(() => (
        filmstripCache.prewarmPriorityWindow(mediaId, proxyFile, media.duration, {
          startTime: 0,
          endTime: warmEndTime,
        })
      ), {
        priority: 'warm',
        delayMs: PROXY_FILMSTRIP_PREWARM_DELAY_MS,
      });
    }
  }

  /**
   * Re-read all cached proxy files from OPFS and create fresh blob URLs.
   * Call this after tab wake-up to recover from stale blob URLs caused by
   * browser memory pressure or tab throttling during inactivity.
   *
   * @returns Number of proxy blob URLs that were refreshed
   */
  async refreshAllBlobUrls(): Promise<number> {
    if (this.isRefreshing) return 0;

    const proxyKeys = [...this.proxyBlobUrlByKey.keys()];
    if (proxyKeys.length === 0) return 0;

    this.isRefreshing = true;
    let refreshed = 0;

    try {
      const root = await navigator.storage.getDirectory();
      let proxyRoot: FileSystemDirectoryHandle;
      try {
        proxyRoot = await root.getDirectoryHandle(PROXY_DIR);
      } catch {
        return 0;
      }

      for (const proxyKey of proxyKeys) {
        try {
          const mediaDir = await proxyRoot.getDirectoryHandle(proxyKey);
          const proxyHandle = await mediaDir.getFileHandle('proxy.mp4');
          const proxyFile = await proxyHandle.getFile();

          if (proxyFile.size === 0) {
            // Revoke stale cache entry for empty proxy file
            const oldUrl = this.proxyBlobUrlByKey.get(proxyKey);
            if (oldUrl) {
              revokeRegisteredObjectUrl(oldUrl);
            }
            this.proxyBlobUrlByKey.delete(proxyKey);
            continue;
          }

          // Revoke old blob URL
          const oldUrl = this.proxyBlobUrlByKey.get(proxyKey);
          if (oldUrl) {
            revokeRegisteredObjectUrl(oldUrl);
          }

          // Create fresh blob URL from OPFS
          const freshUrl = URL.createObjectURL(proxyFile);
          registerObjectUrl(freshUrl, proxyFile, {
            storageType: 'opfs',
            opfsPath: getProxyOpfsPath(proxyKey),
            fileSize: proxyFile.size,
          });
          this.proxyBlobUrlByKey.set(proxyKey, freshUrl);
          refreshed++;
        } catch {
          // Proxy file may have been deleted - remove stale cache entry
          const oldUrl = this.proxyBlobUrlByKey.get(proxyKey);
          if (oldUrl) {
            revokeRegisteredObjectUrl(oldUrl);
          }
          this.proxyBlobUrlByKey.delete(proxyKey);
        }
      }
    } catch (error) {
      logger.warn('Failed to refresh proxy blob URLs:', error);
    } finally {
      this.isRefreshing = false;
    }

    if (refreshed > 0) {
      logger.debug(`Refreshed ${refreshed} proxy blob URLs from OPFS`);
    }

    return refreshed;
  }

  private resolveProxyKey(mediaId: string, explicitProxyKey?: string): string {
    if (explicitProxyKey) {
      return explicitProxyKey;
    }
    return this.proxyKeyByMediaId.get(mediaId) ?? mediaId;
  }

  private normalizeSourceLoader(source: ProxySourceInput): ProxySourceLoader {
    if (typeof source === 'function') {
      return source;
    }
    return async () => source;
  }

  private insertPendingJob(job: QueuedProxyJob): void {
    this.pendingJobsByKey.set(job.proxyKey, job);

    const existingIndex = this.pendingJobOrder.indexOf(job.proxyKey);
    if (existingIndex >= 0) {
      this.pendingJobOrder.splice(existingIndex, 1);
    }

    if (job.priority === 'background') {
      this.pendingJobOrder.push(job.proxyKey);
      return;
    }

    const firstBackgroundIndex = this.pendingJobOrder.findIndex((proxyKey) => (
      this.pendingJobsByKey.get(proxyKey)?.priority === 'background'
    ));

    if (firstBackgroundIndex === -1) {
      this.pendingJobOrder.push(job.proxyKey);
      return;
    }

    this.pendingJobOrder.splice(firstBackgroundIndex, 0, job.proxyKey);
  }

  private removePendingJob(proxyKey: string): void {
    this.pendingJobsByKey.delete(proxyKey);
    const pendingIndex = this.pendingJobOrder.indexOf(proxyKey);
    if (pendingIndex >= 0) {
      this.pendingJobOrder.splice(pendingIndex, 1);
    }
  }

  private drainQueue(): void {
    while (this.activeJobPhaseByKey.size < this.maxConcurrentJobs && this.pendingJobOrder.length > 0) {
      const nextProxyKey = this.pendingJobOrder.shift();
      if (!nextProxyKey) {
        break;
      }

      const job = this.pendingJobsByKey.get(nextProxyKey);
      if (!job) {
        continue;
      }

      this.pendingJobsByKey.delete(nextProxyKey);
      void this.runQueuedJob(job);
    }
  }

  private async runQueuedJob(job: QueuedProxyJob): Promise<void> {
    const { proxyKey } = job;
    this.activeJobPhaseByKey.set(proxyKey, 'loading');

    let source: Blob | null = null;
    try {
      source = await job.loadSource();
    } catch (error) {
      if (!this.generatingProxyKeys.has(proxyKey)) {
        this.activeJobPhaseByKey.delete(proxyKey);
        this.drainQueue();
        return;
      }

      this.failQueuedJob(proxyKey, `Failed to load source for ${proxyKey}`, error);
      return;
    }

    if (!this.generatingProxyKeys.has(proxyKey)) {
      this.activeJobPhaseByKey.delete(proxyKey);
      this.drainQueue();
      return;
    }

    if (!source) {
      this.failQueuedJob(proxyKey, `Source media unavailable for ${proxyKey}`);
      return;
    }

    try {
      const worker = this.getWorker();
      this.activeJobPhaseByKey.set(proxyKey, 'processing');
      worker.postMessage({
        type: 'generate',
        mediaId: proxyKey,
        source,
        sourceWidth: job.sourceWidth,
        sourceHeight: job.sourceHeight,
      } as ProxyWorkerRequest);
    } catch (error) {
      this.failQueuedJob(proxyKey, `Failed to start proxy generation for ${proxyKey}`, error);
    }
  }

  private failQueuedJob(proxyKey: string, message: string, error?: unknown): void {
    this.activeJobPhaseByKey.delete(proxyKey);
    this.generatingProxyKeys.delete(proxyKey);
    this.progressByProxyKey.delete(proxyKey);
    this.clearProgressEmissionState(proxyKey);
    if (error) {
      logger.error(message, error);
    } else {
      logger.error(message);
    }
    this.emitStatusForProxyKey(proxyKey, 'error');
    this.drainQueue();
  }

  private emitProgressThrottled(proxyKey: string, progress: number): void {
    const now = Date.now();
    const state = this.progressEmissionByProxyKey.get(proxyKey) ?? {
      lastEmitAt: 0,
      lastProgress: 0,
      pendingProgress: null,
      timeoutId: null,
    };

    const shouldEmitImmediately = (
      progress >= 1
      || progress <= 0
      || progress - state.lastProgress >= PROXY_PROGRESS_EMIT_MIN_DELTA
      || now - state.lastEmitAt >= PROXY_PROGRESS_EMIT_INTERVAL_MS
    );

    if (shouldEmitImmediately) {
      if (state.timeoutId !== null) {
        clearTimeout(state.timeoutId);
        state.timeoutId = null;
      }
      state.pendingProgress = null;
      state.lastEmitAt = now;
      state.lastProgress = progress;
      this.progressEmissionByProxyKey.set(proxyKey, state);
      this.emitStatusForProxyKey(proxyKey, 'generating', progress);
      return;
    }

    state.pendingProgress = progress;
    if (state.timeoutId === null) {
      state.timeoutId = setTimeout(() => {
        const pendingState = this.progressEmissionByProxyKey.get(proxyKey);
        if (!pendingState) {
          return;
        }

        pendingState.timeoutId = null;
        if (pendingState.pendingProgress == null) {
          return;
        }

        const nextProgress = pendingState.pendingProgress;
        pendingState.pendingProgress = null;
        pendingState.lastEmitAt = Date.now();
        pendingState.lastProgress = nextProgress;
        this.progressEmissionByProxyKey.set(proxyKey, pendingState);
        this.emitStatusForProxyKey(proxyKey, 'generating', nextProgress);
      }, PROXY_PROGRESS_EMIT_INTERVAL_MS);
    }

    this.progressEmissionByProxyKey.set(proxyKey, state);
  }

  private clearProgressEmissionState(proxyKey: string): void {
    const state = this.progressEmissionByProxyKey.get(proxyKey);
    if (state?.timeoutId !== null) {
      clearTimeout(state.timeoutId);
    }
    this.progressEmissionByProxyKey.delete(proxyKey);
  }

  private clearPlaybackRecommendationForProxyKey(proxyKey: string): void {
    const settings = useSettingsStore.getState();
    const mappedMediaIds = this.mediaIdsByProxyKey.get(proxyKey);
    if (mappedMediaIds && mappedMediaIds.size > 0) {
      for (const mediaId of mappedMediaIds) {
        settings.clearProxyRecommended(mediaId);
        this.playbackIssueScoreByMediaId.delete(mediaId);
        this.playbackIssueLastAtByMediaId.delete(mediaId);
      }
      return;
    }

    settings.clearProxyRecommended(proxyKey);
    this.playbackIssueScoreByMediaId.delete(proxyKey);
    this.playbackIssueLastAtByMediaId.delete(proxyKey);
  }

  private emitStatusForProxyKey(
    proxyKey: string,
    status: 'generating' | 'ready' | 'error' | 'idle',
    progress?: number
  ): void {
    const mediaIds = this.mediaIdsByProxyKey.get(proxyKey);
    if (mediaIds && mediaIds.size > 0) {
      for (const mediaId of mediaIds) {
        this.statusListener?.(mediaId, status, progress);
      }
      return;
    }

    // Fallback for legacy/unmapped calls where proxyKey == mediaId.
    this.statusListener?.(proxyKey, status, progress);
  }
}

// Singleton
export const proxyService = new ProxyService();
