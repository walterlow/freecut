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
 *   proxies/{mediaId}/
 *     proxy.mp4
 *     meta.json - { width, height, status, createdAt }
 */

import { createLogger } from '@/lib/logger';
import type {
  ProxyWorkerRequest,
  ProxyWorkerResponse,
} from '../workers/proxy-generation-worker';

const logger = createLogger('ProxyService');

const PROXY_DIR = 'proxies';
const MIN_WIDTH_THRESHOLD = 1920;
const MIN_HEIGHT_THRESHOLD = 1080;

interface ProxyMetadata {
  width: number;
  height: number;
  status: string;
  createdAt: number;
}

type ProxyStatusListener = (mediaId: string, status: 'generating' | 'ready' | 'error', progress?: number) => void;

class ProxyService {
  private worker: Worker | null = null;
  private blobUrlCache = new Map<string, string>();
  private statusListener: ProxyStatusListener | null = null;
  private generatingSet = new Set<string>();

  /**
   * Register a listener for proxy status changes (used by the store)
   */
  onStatusChange(listener: ProxyStatusListener): void {
    this.statusListener = listener;
  }

  /**
   * Check if a video qualifies for proxy generation (above 1080p)
   */
  needsProxy(width: number, height: number, mimeType: string): boolean {
    if (!mimeType.startsWith('video/')) return false;
    return width > MIN_WIDTH_THRESHOLD || height > MIN_HEIGHT_THRESHOLD;
  }

  /**
   * Start proxy generation for a media item
   */
  generateProxy(mediaId: string, blobUrl: string, sourceWidth: number, sourceHeight: number): void {
    if (this.generatingSet.has(mediaId)) return;

    this.generatingSet.add(mediaId);
    this.statusListener?.(mediaId, 'generating', 0);

    const worker = this.getWorker();
    worker.postMessage({
      type: 'generate',
      mediaId,
      blobUrl,
      sourceWidth,
      sourceHeight,
    } as ProxyWorkerRequest);
  }

  /**
   * Cancel proxy generation for a media item
   */
  cancelProxy(mediaId: string): void {
    if (!this.generatingSet.has(mediaId)) return;

    this.generatingSet.delete(mediaId);
    const worker = this.getWorker();
    worker.postMessage({
      type: 'cancel',
      mediaId,
    } as ProxyWorkerRequest);
  }

  /**
   * Get proxy blob URL if available
   */
  getProxyBlobUrl(mediaId: string): string | null {
    return this.blobUrlCache.get(mediaId) ?? null;
  }

  /**
   * Check if proxy exists and is ready
   */
  hasProxy(mediaId: string): boolean {
    return this.blobUrlCache.has(mediaId);
  }

  /**
   * Delete proxy for a media item (OPFS + cache)
   */
  async deleteProxy(mediaId: string): Promise<void> {
    // Cancel if generating
    this.cancelProxy(mediaId);

    // Revoke blob URL
    const url = this.blobUrlCache.get(mediaId);
    if (url) {
      URL.revokeObjectURL(url);
      this.blobUrlCache.delete(mediaId);
    }

    // Remove from OPFS
    try {
      const root = await navigator.storage.getDirectory();
      const proxyRoot = await root.getDirectoryHandle(PROXY_DIR);
      await proxyRoot.removeEntry(mediaId, { recursive: true });
      logger.debug(`Deleted proxy for ${mediaId}`);
    } catch {
      // Directory may not exist
    }
  }

  /**
   * Load existing proxies from OPFS at startup.
   * Only loads proxies for the given mediaIds (project-scoped).
   */
  async loadExistingProxies(mediaIds: string[]): Promise<void> {
    try {
      const root = await navigator.storage.getDirectory();
      let proxyRoot: FileSystemDirectoryHandle;
      try {
        proxyRoot = await root.getDirectoryHandle(PROXY_DIR);
      } catch {
        return; // No proxies directory yet
      }

      const mediaIdSet = new Set(mediaIds);

      for await (const entry of proxyRoot.values()) {
        if (entry.kind !== 'directory') continue;
        if (!mediaIdSet.has(entry.name)) continue;

        const mediaId = entry.name;

        try {
          const mediaDir = await proxyRoot.getDirectoryHandle(mediaId);

          // Check metadata
          const metaHandle = await mediaDir.getFileHandle('meta.json');
          const metaFile = await metaHandle.getFile();
          const metadata: ProxyMetadata = JSON.parse(await metaFile.text());

          if (metadata.status !== 'ready') continue;

          // Load proxy file and create blob URL
          const proxyHandle = await mediaDir.getFileHandle('proxy.mp4');
          const proxyFile = await proxyHandle.getFile();

          if (proxyFile.size === 0) continue;

          const blobUrl = URL.createObjectURL(proxyFile);
          this.blobUrlCache.set(mediaId, blobUrl);
          this.statusListener?.(mediaId, 'ready');

          logger.debug(`Loaded existing proxy for ${mediaId}`);
        } catch {
          // Skip invalid proxy entries
        }
      }
    } catch (error) {
      logger.warn('Failed to load existing proxies:', error);
    }
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
    switch (message.type) {
      case 'progress': {
        this.statusListener?.(message.mediaId, 'generating', message.progress);
        break;
      }

      case 'complete': {
        this.generatingSet.delete(message.mediaId);
        // Load the completed proxy from OPFS
        void this.loadCompletedProxy(message.mediaId);
        break;
      }

      case 'error': {
        this.generatingSet.delete(message.mediaId);
        logger.error(`Proxy generation failed for ${message.mediaId}:`, message.error);
        this.statusListener?.(message.mediaId, 'error');
        break;
      }
    }
  }

  /**
   * Load a freshly completed proxy from OPFS and cache its blob URL
   */
  private async loadCompletedProxy(mediaId: string): Promise<void> {
    try {
      const root = await navigator.storage.getDirectory();
      const proxyRoot = await root.getDirectoryHandle(PROXY_DIR);
      const mediaDir = await proxyRoot.getDirectoryHandle(mediaId);
      const proxyHandle = await mediaDir.getFileHandle('proxy.mp4');
      const proxyFile = await proxyHandle.getFile();

      if (proxyFile.size === 0) {
        this.statusListener?.(mediaId, 'error');
        return;
      }

      const blobUrl = URL.createObjectURL(proxyFile);
      this.blobUrlCache.set(mediaId, blobUrl);
      this.statusListener?.(mediaId, 'ready');

      logger.debug(`Proxy ready for ${mediaId}`);
    } catch (error) {
      logger.error(`Failed to load completed proxy for ${mediaId}:`, error);
      this.statusListener?.(mediaId, 'error');
    }
  }
}

// Singleton
export const proxyService = new ProxyService();
