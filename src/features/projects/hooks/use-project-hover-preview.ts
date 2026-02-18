import { useState, useCallback, useRef } from 'react';
import { resolveMediaUrl } from '@/features/preview/utils/media-resolver';
import { blobUrlManager } from '@/lib/blob-url-manager';
import type { Project } from '@/types/project';

function getFirstVideoMediaId(project: Project): string | null {
  const items = project.timeline?.items;
  if (!items) return null;
  const videoItem = items.find((item) => item.type === 'video' && item.mediaId);
  return videoItem?.mediaId ?? null;
}

export type HoverPreviewState = 'idle' | 'loading' | 'playing' | 'ended';

export interface UseProjectHoverPreviewReturn {
  previewState: HoverPreviewState;
  videoSrc: string | null;
  onMouseEnter: () => void;
  onMouseLeave: (isDragging: () => boolean) => void;
  onVideoEnded: () => void;
}

export function useProjectHoverPreview(project: Project): UseProjectHoverPreviewReturn {
  const [previewState, setPreviewState] = useState<HoverPreviewState>('idle');
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const mediaIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const onMouseEnter = useCallback(async () => {
    const mediaId = getFirstVideoMediaId(project);
    if (!mediaId) {
      setPreviewState('ended');
      return;
    }

    setPreviewState('loading');
    mediaIdRef.current = mediaId;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const url = await resolveMediaUrl(mediaId);
      if (controller.signal.aborted) return;

      if (!url) {
        setPreviewState('idle');
        return;
      }

      setVideoSrc(url);
      setPreviewState('playing');
    } catch {
      if (!controller.signal.aborted) {
        setPreviewState('idle');
      }
    }
  }, [project]);

  const onMouseLeave = useCallback((isDragging: () => boolean) => {
    if (isDragging()) return;

    abortRef.current?.abort();
    abortRef.current = null;

    if (mediaIdRef.current) {
      blobUrlManager.release(mediaIdRef.current);
      mediaIdRef.current = null;
    }

    setVideoSrc(null);
    setPreviewState('idle');
  }, []);

  const onVideoEnded = useCallback(() => {
    setPreviewState('ended');
  }, []);

  return { previewState, videoSrc, onMouseEnter, onMouseLeave, onVideoEnded };
}
