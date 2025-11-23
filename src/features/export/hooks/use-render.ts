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
import { mediaLibraryService } from '@/features/media-library/services/media-library-service';

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
}

const SOCKET_URL = 'http://localhost:3001';

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
  const tracks = useTimelineStore((state) => state.tracks);
  const items = useTimelineStore((state) => state.items);
  const fps = useTimelineStore((state) => state.fps);

  // Initialize Socket.IO connection
  useEffect(() => {
    socketRef.current = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: false, // Don't connect until we need it
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current.on('connect', () => {
      console.log('[useRender] Socket connected');
    });

    socketRef.current.on('disconnect', () => {
      console.log('[useRender] Socket disconnected');
    });

    socketRef.current.on('connect_error', (error) => {
      console.warn('[useRender] Socket connection error:', error.message);
      // Don't set error state here - only set it if export is actually in progress
    });

    socketRef.current.on('render:progress', (data: Partial<RenderStatus> & { jobId: string }) => {
      console.log('[useRender] Progress update:', data);

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

        // Convert timeline to Remotion format with export settings
        const composition = convertTimelineToRemotion(
          tracks,
          items,
          settings.fps,
          settings.resolution.width,
          settings.resolution.height
        );

        // Get all unique media IDs from timeline
        const mediaIds = new Set<string>();
        for (const item of items) {
          if (item.mediaId) {
            mediaIds.add(item.mediaId);
          }
        }

        console.log('[useRender] Uploading', mediaIds.size, 'media files...');

        // Upload media files
        const mediaFiles: { mediaId: string; blob: Blob; filename: string }[] = [];

        for (const mediaId of mediaIds) {
          try {
            const blob = await mediaLibraryService.getMediaFile(mediaId);
            const metadata = await mediaLibraryService.getMedia(mediaId);

            if (blob && metadata) {
              mediaFiles.push({
                mediaId,
                blob,
                filename: metadata.fileName,
              });
            }
          } catch (err) {
            console.error(`[useRender] Failed to get media ${mediaId}:`, err);
          }
        }

        if (mediaFiles.length > 0) {
          await uploadMediaFiles(newJobId, mediaFiles);
        }

        setIsUploading(false);
        setStatus('processing');

        console.log('[useRender] Starting render...');

        // Start render
        await startRender({
          jobId: newJobId,
          composition,
          settings,
          mediaFiles: Array.from(mediaIds),
        });

        console.log('[useRender] Render started with job ID:', newJobId);
      } catch (err: any) {
        console.error('[useRender] Export error:', err);
        setError(err?.message || 'Failed to start export');
        setIsExporting(false);
        setIsUploading(false);
        setStatus('failed');
      }
    },
    [tracks, items, fps]
  );

  /**
   * Cancel export
   */
  const cancelExport = useCallback(() => {
    if (jobId) {
      cancelRenderAPI(jobId)
        .then(() => {
          console.log('[useRender] Render cancelled');
          setIsExporting(false);
          setIsUploading(false);
          setStatus('cancelled');
        })
        .catch((err) => {
          console.error('[useRender] Failed to cancel:', err);
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
      } catch (err: any) {
        console.error('[useRender] Download error:', err);
        setError(err?.message || 'Failed to download video');
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
