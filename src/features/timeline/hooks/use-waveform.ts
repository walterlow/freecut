import { useState, useEffect, useRef, useCallback } from 'react';
import { waveformCache, type CachedWaveform } from '../services/waveform-cache';

export interface UseWaveformOptions {
  /** Media ID from the timeline item */
  mediaId: string;
  /** Blob URL for the audio file */
  blobUrl: string | null;
  /** Whether the clip is currently visible in viewport */
  isVisible: boolean;
  /** Whether to enable waveform (allows conditional disabling) */
  enabled?: boolean;
}

export interface UseWaveformResult {
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
 * - Caches results in memory and IndexedDB
 */
export function useWaveform({
  mediaId,
  blobUrl,
  isVisible,
  enabled = true,
}: UseWaveformOptions): UseWaveformResult {
  // State for waveform data
  const [waveform, setWaveform] = useState<CachedWaveform | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Ref to track if generation is in progress
  const isGeneratingRef = useRef(false);

  // Progress callback
  const handleProgress = useCallback((p: number) => {
    setProgress(p);
  }, []);

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

    // Skip if already have waveform
    if (waveform) {
      return;
    }

    // Mark as generating
    isGeneratingRef.current = true;
    setIsLoading(true);
    setProgress(0);
    setError(null);

    // Request waveform from cache (which will generate if needed)
    waveformCache
      .getWaveform(mediaId, blobUrl, handleProgress)
      .then((result) => {
        setWaveform(result);
        setIsLoading(false);
        setProgress(100);
      })
      .catch((err) => {
        // Don't set error for aborted requests
        if (err.message !== 'Aborted') {
          setError(err.message || 'Failed to generate waveform');
        }
        setIsLoading(false);
      })
      .finally(() => {
        isGeneratingRef.current = false;
      });

    return () => {
      // Abort pending generation on cleanup
      waveformCache.abort(mediaId);
    };
  }, [mediaId, blobUrl, isVisible, enabled, waveform, handleProgress]);

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
