import { useState, useEffect, useRef, useEffectEvent } from 'react';
import { filmstripCache, type Filmstrip, type FilmstripFrame } from '../services/filmstrip-cache';

export type { FilmstripFrame };

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
  /** Array of frames with URLs for img src */
  frames: FilmstripFrame[] | null;
  /** Whether filmstrip is currently loading/extracting */
  isLoading: boolean;
  /** Whether extraction is complete */
  isComplete: boolean;
  /** Loading progress (0-100) */
  progress: number;
  /** Error message if generation failed */
  error: string | null;
}

/**
 * Hook for managing filmstrip thumbnails for a video clip
 *
 * Returns object URLs for use in <img src> tags.
 * Progressive loading: updates as frames are extracted.
 */
export function useFilmstrip({
  mediaId,
  blobUrl,
  duration,
  isVisible,
  enabled = true,
}: UseFilmstripOptions): UseFilmstripResult {
  // Initialize from cache to avoid flash on remount
  const [filmstrip, setFilmstrip] = useState<Filmstrip | null>(() => {
    return filmstripCache.getFromCacheSync(mediaId);
  });
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(() => {
    const cached = filmstripCache.getFromCacheSync(mediaId);
    return cached?.isComplete ? 100 : (cached?.progress ?? 0);
  });
  const [error, setError] = useState<string | null>(null);

  const isGeneratingRef = useRef(false);

  // Progress callback
  const onProgress = useEffectEvent((p: number) => {
    setProgress(p);
  });

  // Subscribe to progressive updates
  useEffect(() => {
    if (!enabled || !blobUrl || !duration || duration <= 0) {
      return;
    }

    const unsubscribe = filmstripCache.subscribe(mediaId, (updated) => {
      setFilmstrip(updated);
      setProgress(updated.progress);
      if (updated.isComplete) {
        setIsLoading(false);
      }
    });

    return unsubscribe;
  }, [mediaId, enabled, blobUrl, duration]);

  // Load filmstrip when visible
  useEffect(() => {
    if (!enabled || !blobUrl || !duration || duration <= 0) {
      return;
    }

    if (!isVisible && !isGeneratingRef.current) {
      return;
    }

    if (filmstrip?.isComplete) {
      return;
    }

    isGeneratingRef.current = true;
    setIsLoading(true);
    setError(null);

    filmstripCache
      .getFilmstrip(mediaId, blobUrl, duration, onProgress)
      .then((result) => {
        setFilmstrip(result);
        setProgress(result.progress);
        if (result.isComplete) {
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (err.message !== 'Aborted') {
          setError(err.message || 'Failed to generate filmstrip');
        }
        setIsLoading(false);
      })
      .finally(() => {
        isGeneratingRef.current = false;
      });
  }, [mediaId, blobUrl, duration, isVisible, enabled, filmstrip?.isComplete]);

  return {
    frames: filmstrip?.frames || null,
    isLoading: isLoading || (filmstrip?.isExtracting ?? false),
    isComplete: filmstrip?.isComplete ?? false,
    progress,
    error,
  };
}
