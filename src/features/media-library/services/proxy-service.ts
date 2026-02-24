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

import { createLogger } from '@/lib/logger';
import { PROXY_DIR, PROXY_SCHEMA_VERSION } from '../proxy-constants';
import type {
  ProxyWorkerRequest,
  ProxyWorkerResponse,
} from '../workers/proxy-generation-worker';

const logger = createLogger('ProxyService');

const MIN_WIDTH_THRESHOLD = 1920;
const MIN_HEIGHT_THRESHOLD = 1080;
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
  status: 'generating' | 'ready' | 'error',
  progress?: number
) => void;

class ProxyService {
  private worker: Worker | null = null;
  private proxyBlobUrlByKey = new Map<string, string>();
  private sourceBlobUrlByProxyKey = new Map<string, string>();
  private proxyKeyByMediaId = new Map<string, string>();
  private mediaIdsByProxyKey = new Map<string, Set<string>>();
  private progressByProxyKey = new Map<string, number>();
  private statusListener: ProxyStatusListener | null = null;
  private generatingProxyKeys = new Set<string>();
  private isRefreshing = false;

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

  /**
   * Check if a video qualifies for proxy generation.
   * - Always true for heavy/problematic audio codecs (e.g. E-AC3/AC3/DTS)
   * - Otherwise true for sources above 1080p thresholds
   */
  needsProxy(width: number, height: number, mimeType: string, audioCodec?: string): boolean {
    if (!mimeType.startsWith('video/')) return false;
    const normalizedAudioCodec = (audioCodec ?? '').toLowerCase();
    if (PROXY_PRIORITY_AUDIO_CODECS.has(normalizedAudioCodec)) {
      return true;
    }
    return width > MIN_WIDTH_THRESHOLD || height > MIN_HEIGHT_THRESHOLD;
  }

  /**
   * Start proxy generation for a media item
   */
  generateProxy(
    mediaId: string,
    blobUrl: string,
    sourceWidth: number,
    sourceHeight: number,
    proxyKey?: string
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
      this.emitStatusForProxyKey(
        resolvedProxyKey,
        'generating',
        this.progressByProxyKey.get(resolvedProxyKey) ?? 0
      );
      return;
    }

    const previousSourceBlobUrl = this.sourceBlobUrlByProxyKey.get(resolvedProxyKey);
    if (previousSourceBlobUrl && previousSourceBlobUrl !== blobUrl) {
      URL.revokeObjectURL(previousSourceBlobUrl);
    }
    this.sourceBlobUrlByProxyKey.set(resolvedProxyKey, blobUrl);

    this.generatingProxyKeys.add(resolvedProxyKey);
    this.progressByProxyKey.set(resolvedProxyKey, 0);
    this.emitStatusForProxyKey(resolvedProxyKey, 'generating', 0);

    const worker = this.getWorker();
    worker.postMessage({
      type: 'generate',
      mediaId: resolvedProxyKey,
      blobUrl,
      sourceWidth,
      sourceHeight,
    } as ProxyWorkerRequest);
  }

  /**
   * Cancel proxy generation for a media item
   */
  cancelProxy(mediaId: string, proxyKey?: string): void {
    const resolvedProxyKey = this.resolveProxyKey(mediaId, proxyKey);
    if (!this.generatingProxyKeys.has(resolvedProxyKey)) return;

    this.generatingProxyKeys.delete(resolvedProxyKey);
    this.progressByProxyKey.delete(resolvedProxyKey);
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
    this.revokeTrackedSourceBlobUrl(resolvedProxyKey);

    // Revoke blob URL
    const url = this.proxyBlobUrlByKey.get(resolvedProxyKey);
    if (url) {
      URL.revokeObjectURL(url);
      this.proxyBlobUrlByKey.delete(resolvedProxyKey);
    }

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

          if (metadata.status !== 'ready') continue;

          // Invalidate stale proxy formats to avoid aspect distortion from
          // legacy fixed-1280x720 transcodes.
          if (metadata.version !== PROXY_SCHEMA_VERSION) {
            const mappedMediaIds = this.mediaIdsByProxyKey.get(proxyKey);
            if (mappedMediaIds && mappedMediaIds.size > 0) {
              staleProxyIds.push(...mappedMediaIds);
            } else {
              logger.debug(`Stale proxy ${proxyKey} has no mapped media ids; deleting stale file only`);
            }

            try {
              await proxyRoot.removeEntry(proxyKey, { recursive: true });
              logger.debug(`Removed stale proxy (schema mismatch) for ${proxyKey}`);
            } catch (error) {
              logger.error(`Failed to remove stale proxy for ${proxyKey}:`, error);
            }

            continue;
          }

          // Load proxy file and create blob URL
          const proxyHandle = await mediaDir.getFileHandle('proxy.mp4');
          const proxyFile = await proxyHandle.getFile();

          if (proxyFile.size === 0) continue;

          const blobUrl = URL.createObjectURL(proxyFile);
          this.proxyBlobUrlByKey.set(proxyKey, blobUrl);
          this.emitStatusForProxyKey(proxyKey, 'ready');

          logger.debug(`Loaded existing proxy for ${proxyKey}`);
        } catch {
          // Skip invalid proxy entries
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
    if (!this.worker) {
      this.worker = new Worker(
        new URL('../workers/proxy-generation-worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = (event: MessageEvent<ProxyWorkerResponse>) => {
        this.handleWorkerMessage(event.data);
      };

      this.worker.onerror = (error) => {
        logger.error('Proxy worker error:', error);
      };
    }
    return this.worker;
  }

  /**
   * Handle messages from the worker
   */
  private handleWorkerMessage(message: ProxyWorkerResponse): void {
    // Worker uses `mediaId` field as proxyKey for storage identity.
    const proxyKey = message.mediaId;

    switch (message.type) {
      case 'progress': {
        this.progressByProxyKey.set(proxyKey, message.progress);
        this.emitStatusForProxyKey(proxyKey, 'generating', message.progress);
        break;
      }

      case 'complete': {
        this.generatingProxyKeys.delete(proxyKey);
        this.progressByProxyKey.delete(proxyKey);
        this.revokeTrackedSourceBlobUrl(proxyKey);
        // Load the completed proxy from OPFS
        void this.loadCompletedProxy(proxyKey);
        break;
      }

      case 'error': {
        this.generatingProxyKeys.delete(proxyKey);
        this.progressByProxyKey.delete(proxyKey);
        this.revokeTrackedSourceBlobUrl(proxyKey);
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
        URL.revokeObjectURL(previousBlobUrl);
      }

      const blobUrl = URL.createObjectURL(proxyFile);
      this.proxyBlobUrlByKey.set(proxyKey, blobUrl);
      this.emitStatusForProxyKey(proxyKey, 'ready');

      logger.debug(`Proxy ready for ${proxyKey}`);
    } catch (error) {
      logger.error(`Failed to load completed proxy for ${proxyKey}:`, error);
      this.emitStatusForProxyKey(proxyKey, 'error');
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
              URL.revokeObjectURL(oldUrl);
            }
            this.proxyBlobUrlByKey.delete(proxyKey);
            continue;
          }

          // Revoke old blob URL
          const oldUrl = this.proxyBlobUrlByKey.get(proxyKey);
          if (oldUrl) {
            URL.revokeObjectURL(oldUrl);
          }

          // Create fresh blob URL from OPFS
          const freshUrl = URL.createObjectURL(proxyFile);
          this.proxyBlobUrlByKey.set(proxyKey, freshUrl);
          refreshed++;
        } catch {
          // Proxy file may have been deleted - remove stale cache entry
          const oldUrl = this.proxyBlobUrlByKey.get(proxyKey);
          if (oldUrl) {
            URL.revokeObjectURL(oldUrl);
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

  private revokeTrackedSourceBlobUrl(proxyKey: string): void {
    const sourceBlobUrl = this.sourceBlobUrlByProxyKey.get(proxyKey);
    if (!sourceBlobUrl) {
      return;
    }

    URL.revokeObjectURL(sourceBlobUrl);
    this.sourceBlobUrlByProxyKey.delete(proxyKey);
  }

  private resolveProxyKey(mediaId: string, explicitProxyKey?: string): string {
    if (explicitProxyKey) {
      return explicitProxyKey;
    }
    return this.proxyKeyByMediaId.get(mediaId) ?? mediaId;
  }

  private emitStatusForProxyKey(
    proxyKey: string,
    status: 'generating' | 'ready' | 'error',
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
