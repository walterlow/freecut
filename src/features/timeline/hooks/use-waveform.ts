import { useState, useEffect, useRef, useEffectEvent } from 'react';
import { waveformCache, type CachedWaveform } from '../services/waveform-cache';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('useWaveform');

interface UseWaveformOptions {
  /** Media ID from the timeline item */
  mediaId: string;
  /** Blob URL for the audio file */
  blobUrl: string | null;
  /** Whether the clip is currently visible in viewport */
  isVisible: boolean;
  /** Whether to enable waveform (allows conditional disabling) */
  enabled?: boolean;
}

interface UseWaveformResult {
  /** Peak amplitude data (null if loading or not available) */
  peaks: Float32Array | null;
  /** Audio duration in seconds */
  duration: number;
  /** Samples per second in peaks data */
  sampleRate: number;
  /** Number of audio channels */
  channels: number;
  /** Whether waveform is currently loading */
  isLoading: boolean;
  /** Loading progress (0-100) */
  progress: number;
  /** Error message if generation failed */
  error: string | null;
}

/**
 * Hook for managing waveform data for an audio clip
 *
 * - Only generates when visible and has valid blobUrl
 * - Subscribes to progressive updates for streaming loading
 * - Caches results in memory and OPFS
 * - Sync cache check on mount to avoid skeleton flash when moving clips
 */
export function useWaveform({
  mediaId,
  blobUrl,
  isVisible,
  enabled = true,
}: UseWaveformOptions): UseWaveformResult {
  // State for waveform data - initialize from memory cache to avoid skeleton flash
  // This is important when clips move across tracks (component remounts but cache persists)
  const [waveform, setWaveform] = useState<CachedWaveform | null>(() => {
    return waveformCache.getFromMemoryCacheSync(mediaId);
  });
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(() => {
    // If we have cached data, start at 100%
    const cached = waveformCache.getFromMemoryCacheSync(mediaId);
    return cached?.isComplete ? 100 : 0;
  });
  const [error, setError] = useState<string | null>(null);

  // Ref to track if generation is in progress
  const isGeneratingRef = useRef(false);
  const lastMediaIdRef = useRef<string>(mediaId);

  // Reset state when mediaId changes (e.g., after relinking orphaned clip)
  useEffect(() => {
    if (lastMediaIdRef.current !== mediaId) {
      // Media ID changed - reset to load new waveform
      lastMediaIdRef.current = mediaId;
      isGeneratingRef.current = false;
      setWaveform(waveformCache.getFromMemoryCacheSync(mediaId));
      setIsLoading(false);
      setProgress(waveformCache.getFromMemoryCacheSync(mediaId)?.isComplete ? 100 : 0);
      setError(null);
    }
  }, [mediaId]);

  // Progress callback - using useEffectEvent so it doesn't need to be in effect deps
  const onProgress = useEffectEvent((p: number) => {
    setProgress(p);
  });

  // Subscribe to progressive updates
  useEffect(() => {
    if (!enabled || !blobUrl) {
      return;
    }

    // Subscribe to waveform updates for progressive loading
    const unsubscribe = waveformCache.subscribe(mediaId, (updated) => {
      setWaveform(updated);
      if (updated.isComplete) {
        setIsLoading(false);
        setProgress(100);
      }
    });

    return unsubscribe;
  }, [mediaId, enabled, blobUrl]);

  // Load waveform when visible and conditions are met
  useEffect(() => {
    // Skip if not enabled or missing required data
    if (!enabled || !blobUrl) {
      return;
    }

    // Skip if not visible and not already loading
    if (!isVisible && !isGeneratingRef.current) {
      return;
    }

    // Skip if already have complete waveform
    if (waveform?.isComplete) {
      return;
    }

    // Mark as generating
    isGeneratingRef.current = true;
    setIsLoading(true);
    setProgress(0);
    setError(null);

    // Request waveform from cache (which will generate if needed)
    waveformCache
      .getWaveform(mediaId, blobUrl, onProgress)
      .then((result) => {
        setWaveform(result);
        setIsLoading(false);
        setProgress(100);
      })
      .catch((err) => {
        // Don't set error for aborted requests
        if (err.message !== 'Aborted') {
          logger.warn(`Waveform generation failed for ${mediaId}`, err);
          setError(err.message || 'Failed to generate waveform');
        }
        setIsLoading(false);
      })
      .finally(() => {
        isGeneratingRef.current = false;
      });

    // Don't abort on effect re-runs - let generation continue in background
    // The cache will hold the result for when we need it
    // Note: onProgress uses useEffectEvent so doesn't need to be in deps
  }, [mediaId, blobUrl, isVisible, enabled, waveform?.isComplete]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      waveformCache.abort(mediaId);
    };
  }, [mediaId]);

  return {
    peaks: waveform?.peaks || null,
    duration: waveform?.duration || 0,
    sampleRate: waveform?.sampleRate || 100,
    channels: waveform?.channels || 1,
    isLoading,
    progress,
    error,
  };
}

