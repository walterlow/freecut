import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ExportSettings } from '@/types/export';
import type { RenderStatus } from '@/api/render';
import {
  startRender,
  uploadMediaFiles,
  cancelRender as cancelRenderAPI,
  downloadRender,
} from '@/api/render';
import { convertTimelineToRemotion } from '../utils/timeline-to-remotion';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { useProjectStore } from '@/features/projects/stores/project-store';
import { mediaLibraryService } from '@/features/media-library/services/media-library-service';
import { getServerConfig } from '@/lib/config';
import { createLogger } from '@/lib/logger';

const log = createLogger('useRender');

interface UseRenderReturn {
  isExporting: boolean;
  isUploading: boolean;
  progress: number;
  renderedFrames?: number;
  totalFrames?: number;
  status?: RenderStatus['status'];
  error: string | null;
  jobId: string | null;
  startExport: (settings: ExportSettings) => Promise<void>;
  cancelExport: () => void;
  downloadVideo: () => Promise<void>;
  resetState: () => void;
}

export function useRender(): UseRenderReturn {
  const [isExporting, setIsExporting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [renderedFrames, setRenderedFrames] = useState<number>();
  const [totalFrames, setTotalFrames] = useState<number>();
  const [status, setStatus] = useState<RenderStatus['status']>();
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);

  // Initialize Socket.IO connection
  useEffect(() => {
    const { socketUrl } = getServerConfig();
    socketRef.current = io(socketUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: false, // Don't connect until we need it
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current.on('connect', () => {
      log.debug('Socket connected');
    });

    socketRef.current.on('disconnect', () => {
      log.debug('Socket disconnected');
    });

    socketRef.current.on('connect_error', (error) => {
      log.warn('Socket connection error:', error.message);
      // Don't set error state here - only set it if export is actually in progress
    });

    socketRef.current.on('render:progress', (data: Partial<RenderStatus> & { jobId: string }) => {
      log.debug('Progress update:', data);

      // Only update if it's for the current job
      setProgress(data.progress ?? 0);
      setRenderedFrames(data.renderedFrames);
      setTotalFrames(data.totalFrames);
      setStatus(data.status);

      if (data.status === 'completed') {
        setIsExporting(false);
        setIsUploading(false);
      } else if (data.status === 'failed') {
        setIsExporting(false);
        setIsUploading(false);
        setError(data.error ?? 'Render failed');
      } else if (data.status === 'cancelled') {
        setIsExporting(false);
        setIsUploading(false);
      }
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  /**
   * Start export process
   */
  const startExport = useCallback(
    async (settings: ExportSettings) => {
      try {
        setIsExporting(true);
        setIsUploading(true);
        setProgress(0);
        setError(null);
        setStatus('pending');

        // Connect socket for progress updates
        if (socketRef.current && !socketRef.current.connected) {
          socketRef.current.connect();
        }

        // Generate job ID using browser's Web Crypto API
        const newJobId = crypto.randomUUID();
        setJobId(newJobId);

        // Read current state directly from store to avoid stale closure issues
        const state = useTimelineStore.getState();
        const { tracks, items, transitions, fps, inPoint, outPoint, keyframes } = state;

        // Get project metadata (background color and native resolution)
        const currentProject = useProjectStore.getState().currentProject;
        const backgroundColor = currentProject?.metadata?.backgroundColor;
        // Use PROJECT resolution for composition (transform calculations match preview)
        const projectWidth = currentProject?.metadata?.width ?? settings.resolution.width;
        const projectHeight = currentProject?.metadata?.height ?? settings.resolution.height;

        log.debug('Export with IO points:', { inPoint, outPoint, fps, transitionCount: transitions.length, keyframeCount: keyframes.length, backgroundColor, projectResolution: { width: projectWidth, height: projectHeight } });

        // Convert timeline to Remotion format with export settings
        // Use PROJECT resolution so transforms match preview
        // Pass in/out points to export only the selected range
        const composition = convertTimelineToRemotion(
          tracks,
          items,
          transitions,
          fps,
          projectWidth,
          projectHeight,
          inPoint,
          outPoint,
          keyframes,
          backgroundColor
        );

        log.debug('Composition duration:', composition.durationInFrames, 'frames');

        // Get all unique media IDs from timeline
        const mediaIds = new Set<string>();
        for (const item of items) {
          if (item.mediaId) {
            mediaIds.add(item.mediaId);
          }
        }

        log.debug('Uploading', mediaIds.size, 'media files...');

        // Load media files in parallel for better performance
        const mediaLoadResults = await Promise.allSettled(
          Array.from(mediaIds).map(async (mediaId) => {
            const [blob, metadata] = await Promise.all([
              mediaLibraryService.getMediaFile(mediaId),
              mediaLibraryService.getMedia(mediaId),
            ]);
            return { mediaId, blob, filename: metadata?.fileName };
          })
        );

        const mediaFiles: { mediaId: string; blob: Blob; filename: string }[] = [];
        for (const result of mediaLoadResults) {
          if (result.status === 'fulfilled') {
            const { mediaId, blob, filename } = result.value;
            if (blob && filename) {
              mediaFiles.push({ mediaId, blob, filename });
            }
          } else {
            log.error('Failed to get media:', result.reason);
          }
        }

        if (mediaFiles.length > 0) {
          await uploadMediaFiles(newJobId, mediaFiles);
        }

        setIsUploading(false);
        setStatus('processing');

        log.debug('Starting render...');

        // Start render
        await startRender({
          jobId: newJobId,
          composition,
          settings,
          mediaFiles: Array.from(mediaIds),
        });

        log.debug('Render started with job ID:', newJobId);
      } catch (err) {
        log.error('Export error:', err);
        const message = err instanceof Error ? err.message : 'Failed to start export';
        setError(message);
        setIsExporting(false);
        setIsUploading(false);
        setStatus('failed');
      }
    },
    [] // Dependencies empty - we read from store directly inside callback
  );

  /**
   * Cancel export
   */
  const cancelExport = useCallback(() => {
    if (jobId) {
      cancelRenderAPI(jobId)
        .then(() => {
          log.debug('Render cancelled');
          setIsExporting(false);
          setIsUploading(false);
          setStatus('cancelled');
        })
        .catch((err) => {
          log.error('Failed to cancel:', err);
        });
    }
  }, [jobId]);

  /**
   * Download completed video
   */
  const downloadVideo = useCallback(async () => {
    if (jobId && status === 'completed') {
      try {
        await downloadRender(jobId);
      } catch (err) {
        log.error('Download error:', err);
        const message = err instanceof Error ? err.message : 'Failed to download video';
        setError(message);
      }
    }
  }, [jobId, status]);

  /**
   * Reset export state
   */
  const resetState = useCallback(() => {
    setIsExporting(false);
    setIsUploading(false);
    setProgress(0);
    setRenderedFrames(undefined);
    setTotalFrames(undefined);
    setStatus(undefined);
    setError(null);
    setJobId(null);
  }, []);

  return {
    isExporting,
    isUploading,
    progress,
    renderedFrames,
    totalFrames,
    status,
    error,
    jobId,
    startExport,
    cancelExport,
    downloadVideo,
    resetState,
  };
}
