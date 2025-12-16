/**
 * Client-side render hook
 *
 * Provides a React hook for client-side video rendering using mediabunny.
 * This is an alternative to the server-side `useRender` hook that doesn't
 * require a backend server.
 *
 * Key differences from server-side rendering:
 * - No media upload required (uses blob URLs directly)
 * - Limited codec support (WebCodecs-based)
 * - Runs entirely in the browser
 * - Progress reported via callbacks, not Socket.IO
 */

import { useState, useCallback, useRef } from 'react';
import type { ExportSettings } from '@/types/export';
import type { RenderProgress, ClientRenderResult } from '../utils/client-renderer';
import {
  mapToClientSettings,
  validateSettings,
  getSupportedCodecs,
  formatBytes,
  estimateFileSize,
} from '../utils/client-renderer';
import { renderComposition } from '../utils/client-render-engine';
import { convertTimelineToRemotion } from '../utils/timeline-to-remotion';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { resolveMediaUrls } from '@/features/preview/utils/media-resolver';
import { createLogger } from '@/lib/logger';

const log = createLogger('useClientRender');

export type ClientRenderStatus =
  | 'idle'
  | 'preparing'
  | 'rendering'
  | 'encoding'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface UseClientRenderReturn {
  // State
  isExporting: boolean;
  progress: number;
  renderedFrames?: number;
  totalFrames?: number;
  status: ClientRenderStatus;
  error: string | null;
  result: ClientRenderResult | null;

  // Actions
  startExport: (settings: ExportSettings) => Promise<void>;
  cancelExport: () => void;
  downloadVideo: () => void;
  resetState: () => void;

  // Utilities
  getSupportedCodecs: () => Promise<string[]>;
  estimateFileSize: (settings: ExportSettings, durationSeconds: number) => string;
}

export function useClientRender(): UseClientRenderReturn {
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [renderedFrames, setRenderedFrames] = useState<number>();
  const [totalFrames, setTotalFrames] = useState<number>();
  const [status, setStatus] = useState<ClientRenderStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClientRenderResult | null>(null);

  // AbortController for cancellation
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Handle progress updates from the render engine
   */
  const handleProgress = useCallback((progressData: RenderProgress) => {
    setProgress(progressData.progress);
    setRenderedFrames(progressData.currentFrame);
    setTotalFrames(progressData.totalFrames);

    // Map phase to status
    switch (progressData.phase) {
      case 'preparing':
        setStatus('preparing');
        break;
      case 'rendering':
        setStatus('rendering');
        break;
      case 'encoding':
        setStatus('encoding');
        break;
      case 'finalizing':
        setStatus('finalizing');
        break;
    }

    log.debug('Progress:', progressData.message, `${progressData.progress}%`);
  }, []);

  /**
   * Start client-side export
   */
  const startExport = useCallback(
    async (settings: ExportSettings) => {
      try {
        setIsExporting(true);
        setProgress(0);
        setError(null);
        setResult(null);
        setStatus('preparing');

        // Create abort controller for cancellation
        abortControllerRef.current = new AbortController();

        // Read current state from store
        const state = useTimelineStore.getState();
        const { tracks, items, transitions, fps, inPoint, outPoint, keyframes } = state;

        log.debug('Starting client export', {
          fps,
          tracksCount: tracks.length,
          itemsCount: items.length,
          inPoint,
          outPoint,
          keyframeCount: keyframes?.length ?? 0,
        });

        // Map settings to client-compatible settings
        const clientSettings = mapToClientSettings(settings, fps);

        // Validate settings
        const validation = validateSettings(clientSettings);
        if (!validation.valid) {
          throw new Error(validation.error);
        }

        // Check codec support
        const supportedCodecs = await getSupportedCodecs(
          clientSettings.resolution.width,
          clientSettings.resolution.height
        );

        if (!supportedCodecs.includes(clientSettings.codec)) {
          // Try fallback to H.264 if available
          if (supportedCodecs.includes('avc')) {
            log.warn(`Codec ${clientSettings.codec} not supported, falling back to H.264`);
            clientSettings.codec = 'avc';
            clientSettings.container = 'mp4';
          } else if (supportedCodecs.length > 0) {
            // Use first available codec
            const fallbackCodec = supportedCodecs[0]!;
            clientSettings.codec = fallbackCodec;
            clientSettings.container = ['vp8', 'vp9', 'av1'].includes(fallbackCodec) ? 'webm' : 'mp4';
            log.warn(`Using fallback codec: ${fallbackCodec}`);
          } else {
            throw new Error('No supported video codecs available in this browser');
          }
        }

        // Convert timeline to Remotion format (handles I/O point trimming)
        const composition = convertTimelineToRemotion(
          tracks,
          items,
          transitions,
          fps,
          clientSettings.resolution.width,
          clientSettings.resolution.height,
          inPoint,
          outPoint,
          keyframes
        );

        // Count items per track for debugging
        const itemsPerTrack = composition.tracks.map(t => ({
          trackId: t.id,
          itemCount: t.items?.length ?? 0,
        }));
        const totalCompositionItems = composition.tracks.reduce((sum, t) => sum + (t.items?.length ?? 0), 0);
        const compositionDuration = composition.durationInFrames ?? 0;

        log.debug('Composition created', {
          durationInFrames: compositionDuration,
          durationSeconds: compositionDuration / fps,
          tracksCount: composition.tracks.length,
          totalItems: totalCompositionItems,
          itemsPerTrack,
          inPoint,
          outPoint,
          hasInOutRange: inPoint !== null && outPoint !== null && outPoint > inPoint,
        });

        // Resolve media URLs (convert mediaIds to blob URLs)
        const resolvedTracks = await resolveMediaUrls(composition.tracks);
        composition.tracks = resolvedTracks;

        // Log resolved items to verify src is set
        let totalResolvedItems = 0;
        let itemsWithSrc = 0;
        for (const track of resolvedTracks) {
          for (const item of track.items ?? []) {
            totalResolvedItems++;
            if ((item as any).src) {
              itemsWithSrc++;
              log.debug('Item with resolved src', {
                itemId: item.id,
                type: item.type,
                from: item.from,
                duration: item.durationInFrames,
                srcPrefix: ((item as any).src as string)?.substring(0, 50),
              });
            } else if (item.type === 'video' || item.type === 'audio' || item.type === 'image') {
              log.warn('Media item missing src', {
                itemId: item.id,
                type: item.type,
                mediaId: (item as any).mediaId,
              });
            }
          }
        }

        log.debug('Media URLs resolved', {
          totalItems: totalResolvedItems,
          itemsWithSrc,
        });

        // Run the render
        const renderResult = await renderComposition({
          settings: clientSettings,
          composition,
          onProgress: handleProgress,
          signal: abortControllerRef.current.signal,
        });

        setResult(renderResult);
        setStatus('completed');
        setProgress(100);

        log.debug('Render completed', {
          fileSize: formatBytes(renderResult.fileSize),
          duration: renderResult.duration,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          log.debug('Render cancelled');
          setStatus('cancelled');
        } else {
          log.error('Export error:', err);
          const message = err instanceof Error ? err.message : 'Failed to export video';
          setError(message);
          setStatus('failed');
        }
      } finally {
        setIsExporting(false);
        abortControllerRef.current = null;
      }
    },
    [handleProgress]
  );

  /**
   * Cancel the current export
   */
  const cancelExport = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setStatus('cancelled');
      setIsExporting(false);
    }
  }, []);

  /**
   * Download the rendered video
   */
  const downloadVideo = useCallback(() => {
    if (!result) return;

    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `export-${Date.now()}.${result.mimeType.includes('webm') ? 'webm' : 'mp4'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Revoke after a delay to ensure download starts
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [result]);

  /**
   * Reset state
   */
  const resetState = useCallback(() => {
    setIsExporting(false);
    setProgress(0);
    setRenderedFrames(undefined);
    setTotalFrames(undefined);
    setStatus('idle');
    setError(null);
    setResult(null);
    abortControllerRef.current = null;
  }, []);

  /**
   * Get supported codecs for the current resolution
   */
  const getSupportedCodecsForResolution = useCallback(async () => {
    const state = useTimelineStore.getState();
    const width = state.tracks.length > 0 ? 1920 : 1920; // Default to 1080p
    const height = state.tracks.length > 0 ? 1080 : 1080;

    const codecs = await getSupportedCodecs(width, height);
    return codecs;
  }, []);

  /**
   * Estimate file size for given settings
   */
  const estimateFileSizeForSettings = useCallback(
    (settings: ExportSettings, durationSeconds: number) => {
      const fps = useTimelineStore.getState().fps;
      const clientSettings = mapToClientSettings(settings, fps);
      const bytes = estimateFileSize(clientSettings, durationSeconds);
      return formatBytes(bytes);
    },
    []
  );

  return {
    isExporting,
    progress,
    renderedFrames,
    totalFrames,
    status,
    error,
    result,
    startExport,
    cancelExport,
    downloadVideo,
    resetState,
    getSupportedCodecs: getSupportedCodecsForResolution,
    estimateFileSize: estimateFileSizeForSettings,
  };
}
