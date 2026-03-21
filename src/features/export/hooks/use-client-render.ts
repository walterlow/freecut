/**
 * Client-side render hook
 *
 * Provides a React hook for video rendering using mediabunny.
 * Uses blob URLs directly, runs entirely in the browser with WebCodecs.
 */

import { useState, useCallback, useRef } from 'react';
import type { ExportSettings, ExtendedExportSettings, CompositionInputProps } from '@/types/export';
import type { RenderProgress, ClientRenderResult, ClientVideoContainer, ClientAudioContainer } from '../utils/client-renderer';
import {
  mapToClientSettings,
  validateSettings,
  getSupportedCodecs,
  formatBytes,
  estimateFileSize,
  getDefaultAudioCodec,
  getAudioBitrateForQuality,
} from '../utils/client-renderer';
import { renderComposition, renderAudioOnly } from '../utils/client-render-engine';
import { convertTimelineToComposition } from '../utils/timeline-to-composition';
import { useTimelineStore } from '@/features/export/deps/timeline';
import { useProjectStore } from '@/features/export/deps/projects';
import { resolveMediaUrls } from '@/features/export/deps/media-library';
import { createLogger, createOperationId } from '@/shared/logging/logger';
import { createManagedWorker } from '@/shared/utils/managed-worker';
import type {
  ExportRenderWorkerRequest,
  ExportRenderWorkerResponse,
} from '../workers/export-render-worker.types';

const log = createLogger('Export');

type ClientRenderStatus =
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
  startExport: (settings: ExportSettings | ExtendedExportSettings) => Promise<void>;
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
  const exportWorkerManagerRef = useRef<ReturnType<typeof createManagedWorker<Worker>> | null>(null);
  const exportWorkerRequestIdRef = useRef<string | null>(null);

  if (!exportWorkerManagerRef.current) {
    exportWorkerManagerRef.current = createManagedWorker({
      createWorker: () => new Worker(
        new URL('../workers/export-render.worker.ts', import.meta.url),
        { type: 'module' }
      ),
      setupWorker: (worker) => () => {
        worker.onmessage = null;
        worker.onerror = null;
      },
    });
  }

  const exportWorkerManager = exportWorkerManagerRef.current;

  const terminateExportWorker = useCallback(() => {
    exportWorkerManager.terminate();
    exportWorkerRequestIdRef.current = null;
  }, [exportWorkerManager]);

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
  }, []);

  /**
   * Check if settings are extended
   */
  const isExtendedSettings = (settings: ExportSettings | ExtendedExportSettings): settings is ExtendedExportSettings => {
    return 'mode' in settings;
  };

  const renderOnMainThread = useCallback(async (
    exportMode: 'video' | 'audio',
    clientSettings: ReturnType<typeof mapToClientSettings>,
    composition: CompositionInputProps,
    signal: AbortSignal
  ): Promise<ClientRenderResult> => {
    if (exportMode === 'audio') {
      return renderAudioOnly({
        settings: clientSettings,
        composition,
        onProgress: handleProgress,
        signal,
      });
    }

    return renderComposition({
      settings: clientSettings,
      composition,
      onProgress: handleProgress,
      signal,
    });
  }, [handleProgress]);

  const renderInWorker = useCallback(async (
    clientSettings: ReturnType<typeof mapToClientSettings>,
    composition: CompositionInputProps,
    signal: AbortSignal
  ): Promise<ClientRenderResult> => {
    if (typeof Worker === 'undefined') {
      throw new Error('WORKER_UNAVAILABLE');
    }

    return new Promise<ClientRenderResult>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Render cancelled', 'AbortError'));
        return;
      }

      const requestId = `export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const worker = exportWorkerManager.getWorker();
      exportWorkerRequestIdRef.current = requestId;

      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
        terminateExportWorker();
      };

      const onAbort = () => {
        const cancelMessage: ExportRenderWorkerRequest = {
          type: 'cancel',
          requestId,
        };
        worker.postMessage(cancelMessage);
      };

      signal.addEventListener('abort', onAbort, { once: true });

      worker.onmessage = (event: MessageEvent<ExportRenderWorkerResponse>) => {
        const response = event.data;
        if (response.requestId !== requestId) {
          return;
        }

        switch (response.type) {
          case 'progress':
            handleProgress(response.progress);
            break;
          case 'complete':
            cleanup();
            resolve(response.result);
            break;
          case 'cancelled':
            cleanup();
            reject(new DOMException('Render cancelled', 'AbortError'));
            break;
          case 'error':
            cleanup();
            reject(new Error(response.error));
            break;
        }
      };

      worker.onerror = (event: ErrorEvent) => {
        cleanup();
        const location = event.filename
          ? ` @${event.filename}:${event.lineno}:${event.colno}`
          : '';
        reject(new Error(`EXPORT_WORKER_RUNTIME_ERROR:${event.message}${location}`));
      };

      const startMessage: ExportRenderWorkerRequest = {
        type: 'start',
        requestId,
        settings: clientSettings,
        composition,
      };
      worker.postMessage(startMessage);
    });
  }, [exportWorkerManager, handleProgress, terminateExportWorker]);

  /**
   * Start client-side export
   */
  const startExport = useCallback(
    async (settings: ExportSettings | ExtendedExportSettings) => {
      const opId = createOperationId();
      const event = log.startEvent('render', opId);

      try {
        setIsExporting(true);
        setProgress(0);
        setError(null);
        setResult(null);
        setStatus('preparing');

        // Create abort controller for cancellation
        abortControllerRef.current = new AbortController();

        // Read current state from stores
        const state = useTimelineStore.getState();
        const { tracks, items, transitions, fps, inPoint, outPoint, keyframes } = state;

        // Get project metadata (background color and native resolution)
        const currentProject = useProjectStore.getState().currentProject;
        const backgroundColor = currentProject?.metadata?.backgroundColor;
        // Use PROJECT resolution for composition (transform calculations match preview)
        const projectWidth = currentProject?.metadata?.width ?? 1920;
        const projectHeight = currentProject?.metadata?.height ?? 1080;

        // Determine export mode and container from extended settings
        const exportMode = isExtendedSettings(settings) ? settings.mode : 'video';
        const videoContainer = isExtendedSettings(settings) ? settings.videoContainer : undefined;
        const audioContainer = isExtendedSettings(settings) ? settings.audioContainer : undefined;
        const renderWholeProject = isExtendedSettings(settings) ? settings.renderWholeProject : false;

        // When renderWholeProject is true, ignore in/out points
        const effectiveInPoint = renderWholeProject ? null : inPoint;
        const effectiveOutPoint = renderWholeProject ? null : outPoint;

        event.merge({
          mode: exportMode,
          fps,
          tracks: tracks.length,
          items: items.length,
          inPoint: effectiveInPoint,
          outPoint: effectiveOutPoint,
          renderWholeProject,
          keyframes: keyframes?.length ?? 0,
          projectResolution: `${projectWidth}x${projectHeight}`,
          videoContainer,
          audioContainer,
          projectId: currentProject?.id,
        });

        // Map settings to client-compatible settings
        const clientSettings = mapToClientSettings(settings, fps);

        // Override container if specified in extended settings
        if (exportMode === 'video' && videoContainer) {
          clientSettings.container = videoContainer as ClientVideoContainer;
        } else if (exportMode === 'audio' && audioContainer) {
          clientSettings.container = audioContainer as ClientAudioContainer;
          clientSettings.mode = 'audio';
          clientSettings.audioCodec = getDefaultAudioCodec(audioContainer);
          clientSettings.audioBitrate = getAudioBitrateForQuality(settings.quality);
        }

        // Set the mode
        clientSettings.mode = exportMode;

        // Validate settings (skip video codec validation for audio-only)
        if (exportMode === 'video') {
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
              clientSettings.codec = 'avc';
              if (!videoContainer) {
                clientSettings.container = 'mp4';
              }
              event.set('codecFallback', 'avc');
            } else if (supportedCodecs.length > 0) {
              // Use first available codec
              const fallbackCodec = supportedCodecs[0]!;
              clientSettings.codec = fallbackCodec;
              if (!videoContainer) {
                clientSettings.container = ['vp8', 'vp9', 'av1'].includes(fallbackCodec) ? 'webm' : 'mp4';
              }
              event.set('codecFallback', fallbackCodec);
            } else {
              throw new Error('No supported video codecs available in this browser');
            }
          }
        }

        event.set('codec', clientSettings.codec);
        event.set('container', clientSettings.container);
        event.set('resolution', `${clientSettings.resolution.width}x${clientSettings.resolution.height}`);

        // Convert timeline to Composition format (handles I/O point trimming)
        // Use PROJECT resolution so transforms match preview (will scale to export res later)
        const composition = convertTimelineToComposition(
          tracks,
          items,
          transitions,
          fps,
          projectWidth,
          projectHeight,
          effectiveInPoint,
          effectiveOutPoint,
          keyframes,
          backgroundColor
        );

        const totalCompositionItems = composition.tracks.reduce((sum, t) => sum + (t.items?.length ?? 0), 0);
        const compositionDuration = composition.durationInFrames ?? 0;

        event.merge({
          compositionDuration: compositionDuration,
          compositionDurationSec: compositionDuration / fps,
          compositionTracks: composition.tracks.length,
          compositionItems: totalCompositionItems,
        });

        // Resolve media URLs (convert mediaIds to blob URLs)
        // Export always uses full-res source, never proxies
        const resolvedTracks = await resolveMediaUrls(composition.tracks, { useProxy: false });
        composition.tracks = resolvedTracks;

        // Count resolved items for diagnostics
        let totalResolvedItems = 0;
        let itemsWithSrc = 0;
        let itemsMissingSrc = 0;
        for (const track of resolvedTracks) {
          for (const item of track.items ?? []) {
            totalResolvedItems++;
            if ('src' in item && item.src) {
              itemsWithSrc++;
            } else if (item.type === 'video' || item.type === 'audio' || item.type === 'image') {
              itemsMissingSrc++;
              log.warn('Media item missing src after resolve', {
                opId,
                itemId: item.id,
                type: item.type,
                mediaId: item.mediaId,
              });
            }
          }
        }

        event.merge({
          resolvedItems: totalResolvedItems,
          itemsWithSrc,
          itemsMissingSrc,
        });

        // Run the render based on export mode
        let renderResult: ClientRenderResult;
        const signal = abortControllerRef.current.signal;
        let renderPath: 'worker' | 'main-thread' = 'worker';

        try {
          renderResult = await renderInWorker(clientSettings, composition, signal);
        } catch (workerError) {
          if (workerError instanceof DOMException && workerError.name === 'AbortError') {
            throw workerError;
          }

          const workerMessage = workerError instanceof Error
            ? workerError.message
            : String(workerError);

          const shouldFallbackToMainThread = workerMessage.startsWith('WORKER_REQUIRES_MAIN_THREAD:')
            || workerMessage.startsWith('WORKER_UNAVAILABLE')
            || workerMessage.startsWith('EXPORT_WORKER_RUNTIME_ERROR:');

          if (!shouldFallbackToMainThread) {
            throw workerError;
          }

          renderPath = 'main-thread';
          event.set('workerFallbackReason', workerMessage);

          renderResult = await renderOnMainThread(exportMode, clientSettings, composition, signal);
        }

        setResult(renderResult);
        setStatus('completed');
        setProgress(100);

        event.set('renderPath', renderPath);
        event.success({
          fileSize: renderResult.fileSize,
          fileSizeFormatted: formatBytes(renderResult.fileSize),
          duration: renderResult.duration,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          event.set('outcome', 'cancelled');
          event.set('duration_ms', Date.now());
          log.event('render', { opId, outcome: 'cancelled' });
          setStatus('cancelled');
        } else {
          event.failure(err);
          const message = err instanceof Error ? err.message : 'Failed to export';
          setError(message);
          setStatus('failed');
        }
      } finally {
        terminateExportWorker();
        setIsExporting(false);
        abortControllerRef.current = null;
      }
    },
    [renderInWorker, renderOnMainThread, terminateExportWorker]
  );

  /**
   * Cancel the current export
   */
  const cancelExport = useCallback(() => {
    const worker = exportWorkerManager.peekWorker();
    if (worker && exportWorkerRequestIdRef.current) {
      const cancelMessage: ExportRenderWorkerRequest = {
        type: 'cancel',
        requestId: exportWorkerRequestIdRef.current,
      };
      worker.postMessage(cancelMessage);
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setStatus('cancelled');
      setIsExporting(false);
    }
    terminateExportWorker();
  }, [exportWorkerManager, terminateExportWorker]);

  /**
   * Download the rendered video/audio
   */
  const downloadVideo = useCallback(() => {
    if (!result) return;

    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;

    // Determine file extension from MIME type
    let extension = 'mp4';
    const mime = result.mimeType.toLowerCase();
    if (mime.includes('webm')) extension = 'webm';
    else if (mime.includes('matroska')) extension = 'mkv';
    else if (mime.includes('quicktime') || mime.includes('mov')) extension = 'mov';
    else if (mime.includes('audio/mpeg') || mime.includes('mp3')) extension = 'mp3';
    else if (mime.includes('audio/wav') || mime.includes('wave')) extension = 'wav';
    else if (mime.includes('audio/flac') || mime.includes('flac')) extension = 'flac';
    else if (mime.includes('audio/aac') || mime.includes('adts')) extension = 'aac';

    a.download = `export-${Date.now()}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Revoke during idle — download has already started by then
    requestIdleCallback(() => URL.revokeObjectURL(url));
  }, [result]);

  /**
   * Reset state
   */
  const resetState = useCallback(() => {
    terminateExportWorker();
    setIsExporting(false);
    setProgress(0);
    setRenderedFrames(undefined);
    setTotalFrames(undefined);
    setStatus('idle');
    setError(null);
    setResult(null);
    abortControllerRef.current = null;
  }, [terminateExportWorker]);

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
