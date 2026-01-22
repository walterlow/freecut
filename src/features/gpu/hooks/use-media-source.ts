/**
 * useMediaSource Hook
 *
 * React hook for managing media sources through the GPU media module.
 * Bridges the media source manager to React component lifecycle.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  createMediaSourceManager,
  type MediaSourceManager,
  type ManagedMediaSource,
  type DecodedVideoFrame,
} from '../media';

interface UseMediaSourceOptions {
  /** Source ID for tracking */
  id?: string;
  /** Whether to skip decoder initialization (for testing) */
  skipDecoder?: boolean;
  /** Cache size in MB */
  cacheSizeMB?: number;
}

interface UseMediaSourceResult {
  /** The media source (null if not loaded) */
  source: ManagedMediaSource | null;
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;
  /** Probe result with video/audio info */
  probeResult: ManagedMediaSource['probeResult'] | null;
  /** Get a video frame at a specific time (ms) */
  getVideoFrame: (timeMs: number) => Promise<DecodedVideoFrame | null>;
  /** Get a video frame by frame number */
  getVideoFrameByNumber: (frameNumber: number) => Promise<DecodedVideoFrame | null>;
  /** Reload the source */
  reload: () => void;
}

// Singleton manager instance
let globalManager: MediaSourceManager | null = null;

function getManager(options: { skipDecoder?: boolean; cacheSizeMB?: number } = {}): MediaSourceManager {
  if (!globalManager) {
    globalManager = createMediaSourceManager({
      skipDecoder: options.skipDecoder,
      defaultCacheSizeMB: options.cacheSizeMB ?? 500,
    });
  }
  return globalManager;
}

/**
 * Hook to manage a media source
 *
 * @param sourceUrl - URL or blob URL of the media file
 * @param options - Configuration options
 */
export function useMediaSource(
  sourceUrl: string | null,
  options: UseMediaSourceOptions = {}
): UseMediaSourceResult {
  const [source, setSource] = useState<ManagedMediaSource | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const currentUrlRef = useRef<string | null>(null);

  const loadSource = useCallback(async () => {
    if (!sourceUrl) {
      setSource(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    // Skip if same URL already loaded
    if (currentUrlRef.current === sourceUrl && source) {
      return;
    }

    currentUrlRef.current = sourceUrl;
    setIsLoading(true);
    setError(null);

    try {
      const manager = getManager({
        skipDecoder: options.skipDecoder,
        cacheSizeMB: options.cacheSizeMB,
      });

      const newSource = await manager.createSource(sourceUrl, {
        id: options.id,
      });

      if (mountedRef.current && currentUrlRef.current === sourceUrl) {
        setSource(newSource);
        setIsLoading(false);
      }
    } catch (err) {
      if (mountedRef.current && currentUrlRef.current === sourceUrl) {
        const message = err instanceof Error ? err.message : 'Failed to load media';
        setError(message);
        setIsLoading(false);
      }
    }
  }, [sourceUrl, options.id, options.skipDecoder, options.cacheSizeMB, source]);

  // Load source when URL changes
  useEffect(() => {
    mountedRef.current = true;
    loadSource();

    return () => {
      mountedRef.current = false;
    };
  }, [loadSource]);

  // Get video frame at time
  const getVideoFrame = useCallback(
    async (timeMs: number): Promise<DecodedVideoFrame | null> => {
      if (!source) return null;
      return source.getVideoFrame(timeMs);
    },
    [source]
  );

  // Get video frame by number
  const getVideoFrameByNumber = useCallback(
    async (frameNumber: number): Promise<DecodedVideoFrame | null> => {
      if (!source) return null;
      return source.getVideoFrameByNumber(frameNumber);
    },
    [source]
  );

  // Reload function
  const reload = useCallback(() => {
    currentUrlRef.current = null;
    loadSource();
  }, [loadSource]);

  return {
    source,
    isLoading,
    error,
    probeResult: source?.probeResult ?? null,
    getVideoFrame,
    getVideoFrameByNumber,
    reload,
  };
}

/**
 * Hook to get the global media source manager
 */
export function useMediaSourceManager(): MediaSourceManager {
  return getManager();
}

/**
 * Dispose the global manager (call on app unmount)
 */
export function disposeGlobalMediaManager(): void {
  if (globalManager) {
    globalManager.dispose();
    globalManager = null;
  }
}
