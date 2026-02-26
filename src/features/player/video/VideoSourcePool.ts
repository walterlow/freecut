/**
 * VideoSourcePool.ts - Manages video elements by source URL
 *
 * Core concept: Instead of one <video> per clip, we share elements by source.
 * Multiple clips from the same source file share the same video element(s).
 *
 * This dramatically reduces memory usage and improves performance when
 * users split clips or have multiple clips from the same source.
 */

interface SourceMetadata {
  duration: number;
  width: number;
  height: number;
}

const VIDEO_POOL_ABORT_PREFIX = 'VIDEO_POOL_ABORT:';

function createVideoPoolAbortError(reason: string): Error {
  const error = new Error(`${VIDEO_POOL_ABORT_PREFIX}${reason}`);
  error.name = 'AbortError';
  return error;
}

export function isVideoPoolAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'AbortError' || error.message.startsWith(VIDEO_POOL_ABORT_PREFIX);
}

/**
 * SourceController - Manages video elements for a single source URL
 *
 * Handles:
 * - Primary element (always loaded, handles most cases)
 * - Overflow elements (for simultaneous clips: transitions, PIP)
 * - Assignment tracking (which clip is using which element)
 */
class SourceController {
  readonly sourceUrl: string;
  private primary: HTMLVideoElement | null = null;
  private overflow: HTMLVideoElement[] = [];
  private assignments: Map<string, HTMLVideoElement> = new Map();
  private metadata: SourceMetadata | null = null;
  private loadPromise: Promise<void> | null = null;
  // Element being loaded by ensureLoaded() but not yet promoted to primary.
  // Allows acquire() to reuse it instead of creating a redundant overflow element.
  private _pendingPrimary: HTMLVideoElement | null = null;

  // Callbacks
  private onElementReady?: (element: HTMLVideoElement) => void;
  private onElementError?: (element: HTMLVideoElement, error: Error) => void;

  // Configuration
  // Need enough concurrent elements for same-source split transitions:
  // left main clip + right main clip + transition left + transition right = 4 total.
  private static readonly MAX_OVERFLOW_ELEMENTS = 3;
  private static readonly LOAD_TIMEOUT_MS = 15_000;

  // Stored so dispose() can cancel a pending load timeout
  private _loadTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(
    sourceUrl: string,
    options?: {
      onElementReady?: (element: HTMLVideoElement) => void;
      onElementError?: (element: HTMLVideoElement, error: Error) => void;
    }
  ) {
    this.sourceUrl = sourceUrl;
    this.onElementReady = options?.onElementReady;
    this.onElementError = options?.onElementError;
  }

  /**
   * Ensure the primary element is loaded and ready.
   *
   * The element is created synchronously and stored as `_pendingPrimary` so
   * that a concurrent `acquire()` call can reuse it instead of creating a
   * redundant overflow element (the common race on first mount).
   */
  async ensureLoaded(): Promise<HTMLVideoElement> {
    if (this.primary) {
      return this.primary;
    }

    if (this.loadPromise) {
      await this.loadPromise;
      return this.primary!;
    }

    // Create element synchronously so acquire() can grab it immediately.
    const element = this.createElementSync();
    this._pendingPrimary = element;

    this.loadPromise = new Promise<void>((resolve, reject) => {
      const onCanPlay = () => {
        cleanup();
        resolve();
      };

      const onError = () => {
        const srcAttr = element.getAttribute('src') ?? '';
        const mediaMessage = element.error?.message || 'Unknown error';
        if (!srcAttr && /empty\s+src\s+attribute/i.test(mediaMessage)) {
          cleanup();
          reject(createVideoPoolAbortError('source-cleared-during-load'));
          return;
        }

        cleanup();
        reject(
          new Error(
            `Failed to load video: ${mediaMessage}`
          )
        );
      };

      const cleanup = () => {
        if (this._loadTimeoutId !== null) {
          clearTimeout(this._loadTimeoutId);
          this._loadTimeoutId = null;
        }
        element.removeEventListener('canplay', onCanPlay);
        element.removeEventListener('error', onError);
      };

      element.addEventListener('canplay', onCanPlay);
      element.addEventListener('error', onError);

      // Reject if the element never fires canplay or error (stale blob URL,
      // broken file, browser bug). Without this, the promise hangs forever
      // and blocks subsequent preloadSource() calls for the same URL.
      this._loadTimeoutId = setTimeout(() => {
        if (!(element.getAttribute('src') ?? '')) {
          cleanup();
          reject(createVideoPoolAbortError('source-cleared-before-ready'));
          return;
        }

        cleanup();
        reject(
          new Error(
            `Video load timed out after ${SourceController.LOAD_TIMEOUT_MS}ms for: ${this.sourceUrl.slice(0, 80)}`
          )
        );
      }, SourceController.LOAD_TIMEOUT_MS);

      // Trigger load
      element.load();
    }).then(() => {
      // acquire() may have already promoted _pendingPrimary to primary;
      // this is a harmless no-op in that case.
      this.primary = element;
      this._pendingPrimary = null;
    }).catch((err) => {
      // Tear down the failed element so it doesn't linger in memory
      if (this._pendingPrimary === element) {
        this._pendingPrimary = null;
      }
      element.pause();
      element.src = '';
      element.load();
      // Allow retries by clearing the rejected promise
      this.loadPromise = null;
      throw err;
    });

    await this.loadPromise;
    return this.primary!;
  }

  /**
   * Acquire a video element for a clip
   * Returns an element seeked to the correct source time
   */
  acquire(clipId: string): HTMLVideoElement | null {
    // Check if clip already has an assignment
    const existing = this.assignments.get(clipId);
    if (existing) {
      return existing;
    }

    // Try to use primary if available
    if (this.primary && !this.isElementInUse(this.primary)) {
      this.assignments.set(clipId, this.primary);
      return this.primary;
    }

    // Use the pending primary if preloadSource() started loading but hasn't
    // resolved yet. This avoids creating a redundant overflow element when
    // preload and acquire race (the common case on first mount).
    if (this._pendingPrimary && !this.isElementInUse(this._pendingPrimary)) {
      this.primary = this._pendingPrimary;
      this._pendingPrimary = null;
      this.assignments.set(clipId, this.primary);
      return this.primary;
    }

    // Try to find an available overflow element
    for (const element of this.overflow) {
      if (!this.isElementInUse(element)) {
        this.assignments.set(clipId, element);
        return element;
      }
    }

    // Need to create overflow element if under limit
    if (this.overflow.length < SourceController.MAX_OVERFLOW_ELEMENTS) {
      const element = this.createElementSync();
      this.overflow.push(element);
      this.assignments.set(clipId, element);
      return element;
    }

    // All pooled elements are currently in use.
    // Do NOT reuse an in-use element: this can cause cross-clip state conflicts
    // (mute/seek/playback race) and audible dropouts during transitions.
    // Instead, create an extra overflow element for this rare overlap.
    console.warn(
      `[SourceController] All pooled elements in use for ${this.sourceUrl}, creating extra overflow element`
    );
    const extraElement = this.createElementSync();
    this.overflow.push(extraElement);
    this.assignments.set(clipId, extraElement);
    return extraElement;
  }

  /**
   * Release a clip's element back to the pool
   */
  release(clipId: string): void {
    this.assignments.delete(clipId);
  }

  /**
   * Seek an element to a specific source time
   */
  seekElement(
    element: HTMLVideoElement,
    sourceTimeSeconds: number,
    options?: { fast?: boolean }
  ): void {
    // Clamp to valid range
    const duration = element.duration || Infinity;
    const clampedTime = Math.max(0, Math.min(sourceTimeSeconds, duration - 0.001));

    // Skip if already at target (within tolerance)
    const tolerance = options?.fast ? 0.1 : 0.016; // ~1 frame at 60fps
    if (Math.abs(element.currentTime - clampedTime) < tolerance) {
      return;
    }

    // Use fastSeek for scrubbing if available, currentTime for accuracy
    if (options?.fast && 'fastSeek' in element) {
      (element as HTMLVideoElement & { fastSeek: (time: number) => void }).fastSeek(clampedTime);
    } else {
      element.currentTime = clampedTime;
    }
  }

  /**
   * Get the element assigned to a clip
   */
  getAssignedElement(clipId: string): HTMLVideoElement | null {
    return this.assignments.get(clipId) || null;
  }

  /**
   * Get source metadata (duration, dimensions)
   */
  getMetadata(): SourceMetadata | null {
    return this.metadata;
  }

  /**
   * Get count of active assignments
   */
  getActiveCount(): number {
    return this.assignments.size;
  }

  /**
   * Get total number of video elements managed by this controller
   */
  getElementCount(): number {
    return (this.primary ? 1 : 0) + (this._pendingPrimary ? 1 : 0) + this.overflow.length;
  }

  /**
   * Check if any clips are using this source
   */
  isInUse(): boolean {
    return this.assignments.size > 0;
  }

  /**
   * Dispose all elements
   */
  dispose(): void {
    // Cancel any in-flight load timeout so it can't reject after disposal
    if (this._loadTimeoutId !== null) {
      clearTimeout(this._loadTimeoutId);
      this._loadTimeoutId = null;
    }

    // Pause and clear all elements
    if (this.primary) {
      this.primary.pause();
      this.primary.src = '';
      this.primary.load();
    }

    if (this._pendingPrimary) {
      this._pendingPrimary.pause();
      this._pendingPrimary.src = '';
      this._pendingPrimary.load();
      this._pendingPrimary = null;
    }

    for (const element of this.overflow) {
      element.pause();
      element.src = '';
      element.load();
    }

    this.primary = null;
    this.overflow = [];
    this.assignments.clear();
    this.metadata = null;
    this.loadPromise = null;
  }

  // --- Private methods ---

  private isElementInUse(element: HTMLVideoElement): boolean {
    for (const assigned of this.assignments.values()) {
      if (assigned === element) {
        return true;
      }
    }
    return false;
  }

  private createElementSync(): HTMLVideoElement {
    const element = document.createElement('video');
    element.src = this.sourceUrl;
    element.preload = 'auto';
    element.playsInline = true;
    element.muted = true; // Start muted, unmute when needed

    element.addEventListener('loadedmetadata', () => {
      if (!this.metadata) {
        this.metadata = {
          duration: element.duration,
          width: element.videoWidth,
          height: element.videoHeight,
        };
      }
      this.onElementReady?.(element);
    });

    element.addEventListener('error', () => {
      const error = new Error(
        `Failed to load video: ${element.error?.message || 'Unknown error'}`
      );
      this.onElementError?.(element, error);
    });

    return element;
  }

}

/**
 * VideoSourcePool - Global pool managing all source controllers
 *
 * Usage:
 *   const pool = new VideoSourcePool();
 *   const element = await pool.acquireForClip('clip-1', 'video.mp4');
 *   pool.seekClip('clip-1', 5.5); // Seek to 5.5 seconds in source
 *   pool.releaseClip('clip-1');
 */
export class VideoSourcePool {
  private sources: Map<string, SourceController> = new Map();
  private clipToSource: Map<string, string> = new Map();

  // Callbacks
  private onElementReady?: (sourceUrl: string, element: HTMLVideoElement) => void;
  private onElementError?: (sourceUrl: string, error: Error) => void;

  constructor(options?: {
    onElementReady?: (sourceUrl: string, element: HTMLVideoElement) => void;
    onElementError?: (sourceUrl: string, error: Error) => void;
  }) {
    this.onElementReady = options?.onElementReady;
    this.onElementError = options?.onElementError;
  }

  /**
   * Get or create a source controller
   */
  getSource(sourceUrl: string): SourceController {
    let controller = this.sources.get(sourceUrl);

    if (!controller) {
      controller = new SourceController(sourceUrl, {
        onElementReady: (element) => {
          this.onElementReady?.(sourceUrl, element);
        },
        onElementError: (_element, error) => {
          this.onElementError?.(sourceUrl, error);
        },
      });
      this.sources.set(sourceUrl, controller);
    }

    return controller;
  }

  /**
   * Ensure a source is preloaded
   */
  async preloadSource(sourceUrl: string): Promise<void> {
    const controller = this.getSource(sourceUrl);
    await controller.ensureLoaded();
  }

  /**
   * Acquire a video element for a clip
   */
  acquireForClip(clipId: string, sourceUrl: string): HTMLVideoElement | null {
    // Release any previous assignment for this clip
    this.releaseClip(clipId);

    const controller = this.getSource(sourceUrl);
    const element = controller.acquire(clipId);

    if (element) {
      this.clipToSource.set(clipId, sourceUrl);
    }

    return element;
  }

  /**
   * Release a clip's element
   */
  releaseClip(clipId: string): void {
    const sourceUrl = this.clipToSource.get(clipId);
    if (sourceUrl) {
      const controller = this.sources.get(sourceUrl);
      controller?.release(clipId);
      this.clipToSource.delete(clipId);
    }
  }

  /**
   * Seek a clip's element to a source time
   */
  seekClip(
    clipId: string,
    sourceTimeSeconds: number,
    options?: { fast?: boolean }
  ): void {
    const sourceUrl = this.clipToSource.get(clipId);
    if (!sourceUrl) return;

    const controller = this.sources.get(sourceUrl);
    if (!controller) return;

    const element = controller.getAssignedElement(clipId);
    if (!element) return;

    controller.seekElement(element, sourceTimeSeconds, options);
  }

  /**
   * Get the element for a clip
   */
  getClipElement(clipId: string): HTMLVideoElement | null {
    const sourceUrl = this.clipToSource.get(clipId);
    if (!sourceUrl) return null;

    const controller = this.sources.get(sourceUrl);
    return controller?.getAssignedElement(clipId) || null;
  }

  /**
   * Get metadata for a source
   */
  getSourceMetadata(sourceUrl: string): SourceMetadata | null {
    const controller = this.sources.get(sourceUrl);
    return controller?.getMetadata() || null;
  }

  /**
   * Prune sources that are no longer in use
   */
  pruneUnused(activeSourceUrls: Set<string>): void {
    for (const [url, controller] of this.sources.entries()) {
      if (!activeSourceUrls.has(url) && !controller.isInUse()) {
        controller.dispose();
        this.sources.delete(url);
      }
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    sourceCount: number;
    totalElements: number;
    activeClips: number;
  } {
    let totalElements = 0;
    let activeClips = 0;

    for (const controller of this.sources.values()) {
      totalElements += controller.getElementCount();
      activeClips += controller.getActiveCount();
    }

    return {
      sourceCount: this.sources.size,
      totalElements,
      activeClips,
    };
  }

  /**
   * Dispose entire pool
   */
  dispose(): void {
    for (const controller of this.sources.values()) {
      controller.dispose();
    }
    this.sources.clear();
    this.clipToSource.clear();
  }
}

// Singleton instance for app-wide use
let globalPool: VideoSourcePool | null = null;

export function getGlobalVideoSourcePool(): VideoSourcePool {
  if (!globalPool) {
    globalPool = new VideoSourcePool();
  }
  return globalPool;
}
