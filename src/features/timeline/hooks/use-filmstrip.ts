import { useState, useEffect, useRef, useCallback } from 'react';
import { filmstripCache, type CachedFilmstrip } from '../services/filmstrip-cache';

export interface UseFilmstripOptions {
  /** Media ID from the timeline item */
  mediaId: string;
  /** Blob URL for the video file */
  blobUrl: string | null;
  /** Total source duration in seconds */
  duration: number;
  /** Whether the clip is currently visible in viewport */
  isVisible: boolean;
  /** Whether to enable filmstrip (allows conditional disabling) */
  enabled?: boolean;
}

export interface UseFilmstripResult {
  /** Array of ImageBitmap frames (null if loading or not available) */
  frames: ImageBitmap[] | null;
  /** Frame timestamps in seconds */
  timestamps: number[] | null;
  /** Whether filmstrip is currently loading */
  isLoading: boolean;
  /** Loading progress (0-100) */
  progress: number;
  /** Error message if generation failed */
  error: string | null;
}

/**
 * Hook for managing filmstrip thumbnails for a video clip
 *
 * - Extracts frames across the full source duration
 * - Rendering component matches frames to slots by timestamp
 * - Caches results in memory for reuse across zoom/scroll
 * - Progressive loading: updates as frames become available
 */
export function useFilmstrip({
  mediaId,
  blobUrl,
  duration,
  isVisible,
  enabled = true,
}: UseFilmstripOptions): UseFilmstripResult {
  // State for filmstrip data
  const [filmstrip, setFilmstrip] = useState<CachedFilmstrip | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Ref to track if generation is in progress
  const isGeneratingRef = useRef(false);

  // Progress callback
  const handleProgress = useCallback((p: number) => {
    setProgress(p);
  }, []);

  // Subscribe to progressive updates
  useEffect(() => {
    if (!enabled || !blobUrl || !duration || duration <= 0) {
      return;
    }

    // Subscribe to filmstrip updates for progressive loading
    const unsubscribe = filmstripCache.subscribe(mediaId, (updated) => {
      setFilmstrip(updated);
      if (updated.isComplete) {
        setIsLoading(false);
        setProgress(100);
      }
    });

    return unsubscribe;
  }, [mediaId, enabled, blobUrl, duration]);

  // Load filmstrip when visible and conditions are met
  useEffect(() => {
    // Skip if not enabled or missing required data
    if (!enabled || !blobUrl || !duration || duration <= 0) {
      return;
    }

    // Skip if not visible and not already loading
    if (!isVisible && !isGeneratingRef.current) {
      return;
    }

    // Skip if already have complete filmstrip
    if (filmstrip?.isComplete) {
      return;
    }

    // Mark as generating
    isGeneratingRef.current = true;
    setIsLoading(true);
    setProgress(0);
    setError(null);

    // Request filmstrip from cache (which will generate if needed)
    filmstripCache
      .getFilmstrip(mediaId, blobUrl, duration, handleProgress)
      .then((result) => {
        setFilmstrip(result);
        setIsLoading(false);
        setProgress(100);
      })
      .catch((err) => {
        // Don't set error for aborted requests
        if (err.message !== 'Aborted') {
          setError(err.message || 'Failed to generate filmstrip');
        }
        setIsLoading(false);
      })
      .finally(() => {
        isGeneratingRef.current = false;
      });

    // Don't abort on effect re-runs - let generation continue in background
    // The cache will hold the result for when we need it
  }, [mediaId, blobUrl, duration, isVisible, enabled, filmstrip?.isComplete, handleProgress]);

  return {
    frames: filmstrip?.frames || null,
    timestamps: filmstrip?.timestamps || null,
    isLoading,
    progress,
    error,
  };
}
