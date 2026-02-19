import { useState, useEffect, useRef, useCallback, useMemo, useEffectEvent } from 'react';
import { gifFrameCache, type CachedGifFrames } from '../services/gif-frame-cache';

interface UseGifFramesOptions {
  /** Media ID from the timeline item */
  mediaId: string;
  /** Blob URL for the GIF file */
  blobUrl: string | null;
  /** Whether the clip is currently visible in viewport */
  isVisible: boolean;
  /** Whether to enable GIF frames (allows conditional disabling) */
  enabled?: boolean;
  /** Image format — determines extraction method ('gif' = gifuct-js, 'webp' = ImageDecoder) */
  format?: 'gif' | 'webp';
}

interface UseGifFramesResult {
  /** Array of ImageBitmap frames (null if loading or not available) */
  frames: ImageBitmap[] | null;
  /** Frame durations in milliseconds */
  durations: number[] | null;
  /** Total animation duration in milliseconds */
  totalDuration: number | null;
  /** Whether GIF frames are currently loading */
  isLoading: boolean;
  /** Whether all frames have been extracted */
  isComplete: boolean;
  /** Loading progress (0-100) */
  progress: number;
  /** Error message if extraction failed */
  error: string | null;
  /** Get frame at specific time (ms) - O(1) via binary search */
  getFrameAtTime: (timeMs: number) => ImageBitmap | null;
}

/**
 * Hook for managing pre-extracted GIF frames for a clip
 *
 * - Pre-extracts all frames using gifuct-js
 * - O(1) frame lookup via binary search on cumulative delays
 * - Caches results in memory + IndexedDB for reuse
 * - Progressive loading: updates as frames become available
 */
export function useGifFrames({
  mediaId,
  blobUrl,
  isVisible,
  enabled = true,
  format = 'gif',
}: UseGifFramesOptions): UseGifFramesResult {
  // State for GIF frame data
  const [gifData, setGifData] = useState<CachedGifFrames | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Ref to track if extraction is in progress
  const isExtractingRef = useRef(false);

  // Progress callback - using useEffectEvent so it doesn't need to be in effect deps
  const onProgress = useEffectEvent((p: number) => {
    setProgress(p);
  });

  // Subscribe to progressive updates
  useEffect(() => {
    if (!enabled || !blobUrl) {
      return;
    }

    // Subscribe to GIF frame updates for progressive loading
    const unsubscribe = gifFrameCache.subscribe(mediaId, (updated) => {
      setGifData(updated);
      if (updated.isComplete) {
        setIsLoading(false);
        setProgress(100);
      }
    });

    return unsubscribe;
  }, [mediaId, enabled, blobUrl]);

  // Load GIF frames when visible and conditions are met
  useEffect(() => {
    // Skip if not enabled or missing required data
    if (!enabled || !blobUrl) {
      return;
    }

    // Skip if not visible and not already extracting
    if (!isVisible && !isExtractingRef.current) {
      return;
    }

    // Skip if already have complete data
    if (gifData?.isComplete) {
      return;
    }

    // Mark as extracting
    isExtractingRef.current = true;
    setIsLoading(true);
    setProgress(0);
    setError(null);

    // Request frames from cache (which will extract if needed)
    const framePromise = format === 'webp'
      ? gifFrameCache.getWebpFrames(mediaId, blobUrl, onProgress)
      : gifFrameCache.getGifFrames(mediaId, blobUrl, onProgress);

    framePromise
      .then((result) => {
        setGifData(result);
        setIsLoading(false);
        setProgress(100);
      })
      .catch((err) => {
        // Don't set error for aborted requests
        if (err.message !== 'Aborted') {
          setError(err.message || 'Failed to extract GIF frames');
        }
        setIsLoading(false);
      })
      .finally(() => {
        isExtractingRef.current = false;
      });

    // Don't abort on effect re-runs - let extraction continue in background
    // Note: onProgress uses useEffectEvent so doesn't need to be in deps
  }, [mediaId, blobUrl, isVisible, enabled, format, gifData?.isComplete]);

  // Memoized getFrameAtTime function
  const getFrameAtTime = useCallback(
    (timeMs: number): ImageBitmap | null => {
      if (!gifData || !gifData.frames || gifData.frames.length === 0) {
        return null;
      }
      try {
        return gifFrameCache.getFrameAtTime(gifData, timeMs).frame;
      } catch {
        return null;
      }
    },
    [gifData]
  );

  return useMemo(
    () => ({
      frames: gifData?.frames ?? null,
      durations: gifData?.durations ?? null,
      totalDuration: gifData?.totalDuration ?? null,
      isLoading,
      isComplete: gifData?.isComplete ?? false,
      progress,
      error,
      getFrameAtTime,
    }),
    [gifData, isLoading, progress, error, getFrameAtTime]
  );
}
