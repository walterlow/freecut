import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { Video, FileAudio, Image as ImageIcon, MoreVertical, Trash2, Loader2, Link2Off, RefreshCw, Zap, FileText, Play, Square, Sparkles } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import type { MediaMetadata } from '@/types/storage';
import { mediaLibraryService } from '../services/media-library-service';
import { mediaAnalysisService } from '../services/media-analysis-service';
import { getMediaType, formatDuration } from '../utils/validation';
import { MediaInfoPopover } from './media-info-popover';
import { getSharedProxyKey } from '../utils/proxy-key';
import { useMediaLibraryStore } from '../stores/media-library-store';
import { CARD_GRID_BASE, CARD_LIST_BASE, CARD_PERF_STYLE } from './card-styles';
import { setMediaDragData, clearMediaDragData } from '../utils/drag-data-cache';
import { proxyService } from '../services/proxy-service';
import { mediaTranscriptionService } from '../services/media-transcription-service';
import { useEditorStore } from '@/app/state/editor';
import { usePlaybackStore } from '@/shared/state/playback';
import { useSourcePlayerStore } from '@/shared/state/source-player';
import {
  getTranscriptionOverallPercent,
  getTranscriptionStageLabel,
} from '@/shared/utils/transcription-progress';
import { scheduleAfterPaint } from '@/shared/utils/schedule-after-paint';
import {
  isTranscriptionCancellationError,
  isTranscriptionOutOfMemoryError,
  TRANSCRIPTION_OOM_HINT,
} from '@/shared/utils/transcription-cancellation';
import { TranscribeDialog, type TranscribeDialogValues } from './transcribe-dialog';

interface MediaCardProps {
  media: MediaMetadata;
  selected?: boolean;
  isBroken?: boolean;
  onSelect?: (event: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  onDelete?: () => void;
  onRelink?: () => void;
  viewMode?: 'grid' | 'list';
}

interface MediaCardActionMenuProps {
  isBroken: boolean;
  onRelink?: () => void;
  canGenerateProxy: boolean;
  hasProxy: boolean;
  proxyStatus?: 'generating' | 'ready' | 'error';
  proxyProgress?: number;
  isTranscribable: boolean;
  isTranscribing: boolean;
  hasTranscript: boolean;
  transcriptProgressPercent: number | null;
  transcriptBusyLabel: string;
  isTaggable: boolean;
  isTagging: boolean;
  hasTags: boolean;
  onGenerateProxy: (event: React.MouseEvent) => void | Promise<void>;
  onCancelProxy: (event: React.MouseEvent) => void | Promise<void>;
  onDeleteProxy: (event: React.MouseEvent) => Promise<void>;
  onGenerateTranscript: (event: React.MouseEvent) => void | Promise<void>;
  onCancelTranscript: (event: React.MouseEvent) => void;
  onDeleteTranscript: (event: React.MouseEvent) => Promise<void>;
  onAnalyzeWithAI: (event: React.MouseEvent) => void;
  onDelete: (event: React.MouseEvent) => void;
}

const DEFAULT_CAPTION_SELECTION_DURATION_SEC = 3;

function MediaCardActionMenuItems({
  isBroken,
  onRelink,
  canGenerateProxy,
  hasProxy,
  proxyStatus,
  proxyProgress,
  isTranscribable,
  isTranscribing,
  hasTranscript,
  transcriptProgressPercent,
  transcriptBusyLabel,
  isTaggable,
  isTagging,
  hasTags,
  onGenerateProxy,
  onCancelProxy,
  onDeleteProxy,
  onGenerateTranscript,
  onCancelTranscript,
  onDeleteTranscript,
  onAnalyzeWithAI,
  onDelete,
}: MediaCardActionMenuProps) {
  return (
    <>
      {isBroken && onRelink && (
        <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onRelink(); }} className="text-primary focus:text-primary">
          <RefreshCw className="w-3 h-3 mr-2" />
          Relink File...
        </DropdownMenuItem>
      )}
      {canGenerateProxy && !hasProxy && proxyStatus !== 'generating' && (
        <DropdownMenuItem onClick={onGenerateProxy}>
          <Zap className="w-3 h-3 mr-2" />
          Generate Proxy
        </DropdownMenuItem>
      )}
      {isTranscribable && !isBroken && !isTranscribing && (
        <DropdownMenuItem onClick={onGenerateTranscript}>
          <FileText className="w-3 h-3 mr-2" />
          {hasTranscript ? 'Refresh Transcript' : 'Generate Transcript'}
        </DropdownMenuItem>
      )}
      {isTranscribable && !isBroken && hasTranscript && !isTranscribing && (
        <DropdownMenuItem onClick={onDeleteTranscript} className="text-destructive focus:text-destructive">
          <Trash2 className="w-3 h-3 mr-2" />
          Delete Transcript
        </DropdownMenuItem>
      )}
      {isTranscribable && !isBroken && isTranscribing && (
        <DropdownMenuItem disabled>
          <div className="flex w-full min-w-48 flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
              <span className="min-w-0 truncate">
                {transcriptBusyLabel}
              </span>
            </div>
            {transcriptProgressPercent !== null && (
              <div
                role="progressbar"
                aria-label="Transcript menu progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={transcriptProgressPercent}
                className="h-1 overflow-hidden rounded-full bg-secondary"
              >
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${transcriptProgressPercent}%` }}
                />
              </div>
            )}
          </div>
        </DropdownMenuItem>
      )}
      {isTranscribable && !isBroken && isTranscribing && (
        <DropdownMenuItem onClick={onCancelTranscript}>
          <Square className="w-3 h-3 mr-2" />
          Cancel Transcript
        </DropdownMenuItem>
      )}
      {proxyStatus === 'generating' && (
        <>
          <DropdownMenuItem disabled>
            <Loader2 className="w-3 h-3 mr-2 animate-spin" />
            Generating Proxy{proxyProgress != null ? ` (${Math.round(proxyProgress * 100)}%)` : '...'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onCancelProxy}>
            <Square className="w-3 h-3 mr-2" />
            Cancel Proxy Generation
          </DropdownMenuItem>
        </>
      )}
      {hasProxy && (
        <DropdownMenuItem onClick={onDeleteProxy} className="text-destructive focus:text-destructive">
          <Trash2 className="w-3 h-3 mr-2" />
          Delete Proxy
        </DropdownMenuItem>
      )}
      {isTaggable && !isBroken && !isTagging && (
        <DropdownMenuItem onClick={onAnalyzeWithAI}>
          <Sparkles className="w-3 h-3 mr-2" />
          {hasTags ? 'Re-analyze with AI' : 'Analyze with AI'}
        </DropdownMenuItem>
      )}
      {isTaggable && !isBroken && isTagging && (
        <DropdownMenuItem disabled>
          <Loader2 className="w-3 h-3 mr-2 animate-spin" />
          Analyzing...
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
        <Trash2 className="w-3 h-3 mr-2" />
        Delete
      </DropdownMenuItem>
    </>
  );
}

export const MediaCard = memo(function MediaCard({
  media,
  selected = false,
  isBroken = false,
  onSelect,
  onDoubleClick,
  onDelete,
  onRelink,
  viewMode = 'grid',
}: MediaCardProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [skimProgress, setSkimProgress] = useState<number | null>(null);
  const isImporting = useMediaLibraryStore(
    useCallback((s) => s.importingIds.includes(media.id), [media.id])
  );

  const proxyStatus = useMediaLibraryStore((s) => s.proxyStatus.get(media.id));
  const proxyProgress = useMediaLibraryStore((s) => s.proxyProgress.get(media.id));
  const transcriptStatus = useMediaLibraryStore((s) => s.transcriptStatus.get(media.id) ?? 'idle');
  const transcriptProgress = useMediaLibraryStore((s) => s.transcriptProgress.get(media.id));

  const mediaType = getMediaType(media.mimeType);
  const isTranscribable = mediaType === 'video' || mediaType === 'audio';
  const canGenerateProxy =
    mediaType === 'video'
    && !isBroken
    && !isImporting
    && proxyService.canGenerateProxy(media.mimeType);
  const hasProxy = proxyStatus === 'ready';
  const hasTranscript = transcriptStatus === 'ready';
  const isTranscribing = transcriptStatus === 'transcribing' || transcriptStatus === 'queued';
  const isTagging = useMediaLibraryStore((s) => s.taggingMediaIds.has(media.id));
  const isTaggable = mediaType === 'video' || mediaType === 'image';
  const hasCaptions = (media.aiCaptions?.length ?? 0) > 0;
  const [audioPlaying, setAudioPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const thumbnailRef = useRef<HTMLImageElement>(null);
  const thumbnailContainerRef = useRef<HTMLDivElement | null>(null);
  const dragImageRef = useRef<HTMLDivElement | null>(null);
  const setMediaSkimPreview = useEditorStore((s) => s.setMediaSkimPreview);
  const clearMediaSkimPreview = useEditorStore((s) => s.clearMediaSkimPreview);
  const isTranscriptionDialogOpen = useEditorStore((s) => s.transcriptionDialogDepth > 0);
  const pauseTimelinePlayback = usePlaybackStore((s) => s.pause);

  const isAudio = mediaType === 'audio' && !isBroken && !isImporting;
  const [transcribeDialogOpen, setTranscribeDialogOpen] = useState(false);
  const [transcribeErrorMessage, setTranscribeErrorMessage] = useState<string | null>(null);

  // Load thumbnail on mount and when thumbnailId changes (e.g. after regeneration)
  useEffect(() => {
    let mounted = true;

    const loadThumbnail = async () => {
      const url = await mediaLibraryService.getThumbnailBlobUrl(media.id);
      if (mounted) {
        setThumbnailUrl(url);
      }
    };

    loadThumbnail();

    return () => {
      mounted = false;
    };
  }, [media.id, media.thumbnailId]);

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDelete?.();
  };

  const handleGenerateProxy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const proxyKey = getSharedProxyKey(media);
      proxyService.setProxyKey(media.id, proxyKey);
      proxyService.generateProxy(
        media.id,
        media.storageType === 'opfs' && media.opfsPath
          ? { kind: 'opfs', path: media.opfsPath, mimeType: media.mimeType }
          : () => mediaLibraryService.getMediaFile(media.id),
        media.width,
        media.height,
        proxyKey
      );
    } catch {
      useMediaLibraryStore.getState().setProxyStatus(media.id, 'error');
    }
  };

  const handleDeleteProxy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const sharedProxyKey = getSharedProxyKey(media);
      await proxyService.deleteProxy(media.id, sharedProxyKey);

      const store = useMediaLibraryStore.getState();
      for (const item of store.mediaItems) {
        if (item.mimeType.startsWith('video/') && getSharedProxyKey(item) === sharedProxyKey) {
          store.clearProxyStatus(item.id);
          proxyService.clearProxyKey(item.id);
        }
      }
    } catch {
      useMediaLibraryStore.getState().setProxyStatus(media.id, 'error');
    }
  };

  const handleCancelProxy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    proxyService.cancelProxy(media.id, getSharedProxyKey(media));
  };

  const handleOpenTranscribeDialog = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTranscribeErrorMessage(null);
    setTranscribeDialogOpen(true);
  };

  const handleStartTranscription = useCallback((values: TranscribeDialogValues) => {
    const store = useMediaLibraryStore.getState();
    const previousStatus = store.transcriptStatus.get(media.id) ?? 'idle';

    setTranscribeErrorMessage(null);
    store.setTranscriptStatus(media.id, 'queued');
    store.setTranscriptProgress(media.id, { stage: 'queued', progress: 0 });

    scheduleAfterPaint(() => {
      void (async () => {
        try {
          await mediaTranscriptionService.transcribeMedia(media.id, {
            model: values.model,
            quantization: values.quantization,
            language: values.language || undefined,
            onQueueStatusChange: (state) => {
              if (state === 'queued') {
                store.setTranscriptStatus(media.id, 'queued');
                store.setTranscriptProgress(media.id, { stage: 'queued', progress: 0 });
                return;
              }

              store.setTranscriptStatus(media.id, 'transcribing');
              store.setTranscriptProgress(media.id, { stage: 'loading', progress: 0 });
            },
            onProgress: (progress) => {
              store.setTranscriptProgress(media.id, progress);
            },
          });
          store.setTranscriptStatus(media.id, 'ready');
          store.clearTranscriptProgress(media.id);
          store.showNotification({
            type: 'success',
            message: `Transcript ready for "${media.fileName}"`,
          });
          setTranscribeDialogOpen(false);
        } catch (error) {
          if (isTranscriptionCancellationError(error)) {
            store.setTranscriptStatus(media.id, previousStatus);
            store.clearTranscriptProgress(media.id);
            return;
          }

          store.setTranscriptStatus(media.id, previousStatus === 'ready' ? 'ready' : 'error');
          store.clearTranscriptProgress(media.id);

          const baseMessage = error instanceof Error ? error.message : 'Failed to transcribe media';
          const dialogMessage = isTranscriptionOutOfMemoryError(error)
            ? TRANSCRIPTION_OOM_HINT
            : baseMessage;
          setTranscribeErrorMessage(dialogMessage);
          store.showNotification({
            type: 'error',
            message: dialogMessage,
          });
        }
      })();
    });
  }, [media.id, media.fileName]);

  const handleCancelTranscript = (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    mediaTranscriptionService.cancelTranscription(media.id);
  };

  const handleDeleteTranscript = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const store = useMediaLibraryStore.getState();

    try {
      await mediaTranscriptionService.deleteTranscript(media.id);
      store.setTranscriptStatus(media.id, 'idle');
      store.clearTranscriptProgress(media.id);
      store.showNotification({
        type: 'success',
        message: `Transcript deleted for "${media.fileName}"`,
      });
    } catch (error) {
      store.showNotification({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to delete transcript',
      });
    }
  };

  const handleAnalyzeWithAI = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await mediaAnalysisService.analyzeMedia(media);
  }, [media]);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    // Set drag data for timeline drop
    e.dataTransfer.effectAllowed = 'copy';
    const mediaStore = useMediaLibraryStore.getState();
    const selectedMediaIds = mediaStore.selectedMediaIds;
    const mediaItems = mediaStore.mediaItems;

    // If this item is selected and there are multiple selected items, drag all of them
    const isPartOfSelection = selectedMediaIds.includes(media.id);
    const hasMultipleSelected = selectedMediaIds.length > 1;

    if (isPartOfSelection && hasMultipleSelected) {
      // Build array of all selected media items in their current order
      const selectedItems = selectedMediaIds
        .map(id => mediaItems.find(m => m.id === id))
        .filter((m): m is MediaMetadata => m !== undefined)
        .map(m => ({
          mediaId: m.id,
          mediaType: getMediaType(m.mimeType),
          fileName: m.fileName,
          duration: m.duration,
        }));

      const dragData = {
        type: 'media-items' as const,
        items: selectedItems,
      };

      e.dataTransfer.setData('application/json', JSON.stringify(dragData));
      // Cache for dragover access
      setMediaDragData(dragData);
    } else {
      // Single item drag
      const dragData = {
        type: 'media-item' as const,
        mediaId: media.id,
        mediaType: mediaType,
        fileName: media.fileName,
        duration: media.duration,
      };

      e.dataTransfer.setData('application/json', JSON.stringify(dragData));
      // Cache for dragover access
      setMediaDragData(dragData);
    }

    // Custom drag image: show just the thumbnail at natural aspect ratio.
    // thumbnailRef is on the grid-view <img>; for list view, query the card element.
    const thumbEl = thumbnailRef.current
      ?? (e.currentTarget as HTMLElement).querySelector<HTMLImageElement>('img[alt]');
    if (thumbEl && thumbEl.naturalWidth > 0) {
      const maxDim = 120;
      const ratio = thumbEl.naturalWidth / thumbEl.naturalHeight;
      const w = ratio >= 1 ? maxDim : Math.round(maxDim * ratio);
      const h = ratio >= 1 ? Math.round(maxDim / ratio) : maxDim;

      const ghost = document.createElement('div');
      ghost.style.cssText = `position:fixed;top:-9999px;left:-9999px;width:${w}px;height:${h}px;border-radius:4px;overflow:hidden;opacity:0.85;`;
      const img = document.createElement('img');
      img.src = thumbEl.src;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      ghost.appendChild(img);
      document.body.appendChild(ghost);
      dragImageRef.current = ghost;

      e.dataTransfer.setDragImage(ghost, w / 2, h / 2);
    }
  }, [media.id, media.fileName, media.duration, mediaType]);

  const handleDragEnd = useCallback(() => {
    clearMediaDragData();
    if (dragImageRef.current) {
      document.body.removeChild(dragImageRef.current);
      dragImageRef.current = null;
    }
  }, []);

  const handleClick = (e: React.MouseEvent) => {
    onSelect?.(e);
  };

  const canHoverPreview = (mediaType === 'video' || mediaType === 'image')
    && !isBroken
    && !isImporting
    && !isTranscriptionDialogOpen;
  const canScrubPreview = mediaType === 'video'
    && media.duration > 0
    && !isBroken
    && !isImporting
    && !isTranscriptionDialogOpen;
  const skimRafRef = useRef<number | null>(null);
  const pendingSkimClientXRef = useRef<number | null>(null);

  const updateSkimPreview = useCallback((clientX: number) => {
    const thumbnailContainer = thumbnailContainerRef.current;
    if (!thumbnailContainer || !canHoverPreview) return;

    if (!canScrubPreview) {
      setSkimProgress(null);
      setMediaSkimPreview(media.id, 0);
      return;
    }

    const rect = thumbnailContainer.getBoundingClientRect();
    if (rect.width <= 0) return;

    const progress = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const durationInFrames = Math.max(1, Math.round(media.duration * (media.fps || 30)));
    const frame = Math.min(durationInFrames - 1, Math.max(0, Math.round(progress * (durationInFrames - 1))));

    setSkimProgress(progress);
    setMediaSkimPreview(media.id, frame);
  }, [canHoverPreview, canScrubPreview, media.duration, media.fps, media.id, setMediaSkimPreview]);

  const flushScheduledSkimPreview = useCallback(() => {
    skimRafRef.current = null;
    const clientX = pendingSkimClientXRef.current;
    pendingSkimClientXRef.current = null;
    if (clientX === null) return;
    updateSkimPreview(clientX);
  }, [updateSkimPreview]);

  const scheduleSkimPreview = useCallback((clientX: number) => {
    pendingSkimClientXRef.current = clientX;
    if (skimRafRef.current !== null) {
      return;
    }

    skimRafRef.current = requestAnimationFrame(flushScheduledSkimPreview);
  }, [flushScheduledSkimPreview]);

  const cancelScheduledSkimPreview = useCallback(() => {
    pendingSkimClientXRef.current = null;
    if (skimRafRef.current !== null) {
      cancelAnimationFrame(skimRafRef.current);
      skimRafRef.current = null;
    }
  }, []);

  const handleThumbnailPointerEnter = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!canHoverPreview || event.pointerType === 'touch') return;
    pauseTimelinePlayback();
    updateSkimPreview(event.clientX);
  }, [canHoverPreview, pauseTimelinePlayback, updateSkimPreview]);

  const handleThumbnailPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!canScrubPreview || event.pointerType === 'touch') return;
    scheduleSkimPreview(event.clientX);
  }, [canScrubPreview, scheduleSkimPreview]);

  const handleThumbnailPointerLeave = useCallback(() => {
    if (!canHoverPreview) return;
    cancelScheduledSkimPreview();
    setSkimProgress(null);
    clearMediaSkimPreview();
  }, [canHoverPreview, cancelScheduledSkimPreview, clearMediaSkimPreview]);

  useEffect(() => {
    if (!canHoverPreview) return;
    return () => {
      cancelScheduledSkimPreview();
      if (useEditorStore.getState().mediaSkimPreviewMediaId === media.id) {
        clearMediaSkimPreview();
      }
    };
  }, [canHoverPreview, cancelScheduledSkimPreview, clearMediaSkimPreview, media.id]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
        audioRef.current = null;
      }
    };
  }, []);

  const audioLoadingRef = useRef(false);

  const handleAudioToggle = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (audioPlaying && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setAudioPlaying(false);
      return;
    }

    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play();
      setAudioPlaying(true);
      return;
    }

    if (audioLoadingRef.current) return;
    audioLoadingRef.current = true;

    try {
      const blobUrl = await mediaLibraryService.getMediaBlobUrl(media.id);
      if (!blobUrl) return;

      // Another toggle may have created an element while we awaited
      const existing = audioRef.current as HTMLAudioElement | null;
      if (existing) {
        URL.revokeObjectURL(blobUrl);
        existing.currentTime = 0;
        existing.play();
        setAudioPlaying(true);
        return;
      }

      const audio = new Audio(blobUrl);
      audio.addEventListener('ended', () => {
        setAudioPlaying(false);
      });
      audioRef.current = audio;
      audio.play();
      setAudioPlaying(true);
    } finally {
      audioLoadingRef.current = false;
    }
  }, [audioPlaying, media.id]);

  const handleSeekToCaption = useCallback((timeSec: number) => {
    const fps = media.fps || 30;
    const sourceDurationFrames = Math.max(1, Math.round(media.duration * fps));
    const frame = Math.max(0, Math.min(sourceDurationFrames - 1, Math.round(timeSec * fps)));
    const outFrame = Math.min(
      sourceDurationFrames,
      frame + Math.max(1, Math.round(DEFAULT_CAPTION_SELECTION_DURATION_SEC * fps)),
    );
    const sourceStore = useSourcePlayerStore.getState();

    sourceStore.setCurrentMediaId(media.id);
    sourceStore.clearInOutPoints();
    sourceStore.setInPoint(frame);
    sourceStore.setOutPoint(outFrame);
    sourceStore.setPendingSeekFrame(frame);
    useEditorStore.getState().setSourcePreviewMediaId(media.id);
  }, [media.duration, media.fps, media.id]);

  const transcriptProgressPercent = transcriptProgress
    ? Math.round(getTranscriptionOverallPercent(transcriptProgress))
    : null;
  const transcriptProgressLabel = transcriptProgress
    ? `${getTranscriptionStageLabel(transcriptProgress.stage)} (${transcriptProgressPercent}%)`
    : 'Transcribing...';
  const transcriptBusyLabel = hasTranscript
    ? `Refreshing Transcript (${transcriptProgressLabel})`
    : transcriptProgressLabel;

  const transcribeDialog = (
    <TranscribeDialog
      open={transcribeDialogOpen}
      onOpenChange={(next) => {
        if (!next) setTranscribeErrorMessage(null);
        setTranscribeDialogOpen(next);
      }}
      fileName={media.fileName}
      hasTranscript={hasTranscript}
      isRunning={isTranscribing}
      progressPercent={transcriptProgressPercent}
      progressLabel={transcriptProgressLabel}
      errorMessage={transcribeErrorMessage}
      onStart={handleStartTranscription}
      onCancel={handleCancelTranscript}
    />
  );

  const actionMenuItems = (
    <MediaCardActionMenuItems
      isBroken={isBroken}
      onRelink={onRelink}
      canGenerateProxy={canGenerateProxy}
      hasProxy={hasProxy}
      proxyStatus={proxyStatus}
      proxyProgress={proxyProgress}
      isTranscribable={isTranscribable}
      isTranscribing={isTranscribing}
      hasTranscript={hasTranscript}
      transcriptProgressPercent={transcriptProgressPercent}
      transcriptBusyLabel={transcriptBusyLabel}
      isTaggable={isTaggable}
      isTagging={isTagging}
      hasTags={hasCaptions}
      onGenerateProxy={handleGenerateProxy}
      onCancelProxy={handleCancelProxy}
      onDeleteProxy={handleDeleteProxy}
      onGenerateTranscript={handleOpenTranscribeDialog}
      onCancelTranscript={handleCancelTranscript}
      onDeleteTranscript={handleDeleteTranscript}
      onAnalyzeWithAI={handleAnalyzeWithAI}
      onDelete={handleDelete}
    />
  );

  const getIcon = () => {
    switch (mediaType) {
      case 'video':
        return <Video className="w-5 h-5 text-primary" />;
      case 'audio':
        return <FileAudio className="w-5 h-5 text-green-500" />;
      case 'image':
        return <ImageIcon className="w-5 h-5 text-blue-500" />;
      default:
        return <Video className="w-5 h-5 text-muted-foreground" />;
    }
  };

  // List view
  if (viewMode === 'list') {
    return (
      <>
      {transcribeDialog}
      <div
        style={CARD_PERF_STYLE}
        className={`
          ${CARD_LIST_BASE} cursor-pointer
          ${selected
            ? 'border-primary ring-1 ring-primary/20'
            : 'border-border hover:border-primary/50'
          }
          ${isImporting ? 'opacity-80 cursor-default' : ''}
        `}
        draggable={!isImporting}
        onDragStart={isImporting ? undefined : handleDragStart}
        onDragEnd={isImporting ? undefined : handleDragEnd}
        onClick={isImporting ? undefined : handleClick}
        onDoubleClick={isImporting ? undefined : (e) => { e.stopPropagation(); onDoubleClick?.(); }}
      >
        {/* Thumbnail */}
        <div
          ref={thumbnailContainerRef}
          className="w-12 h-9 bg-secondary rounded overflow-hidden flex-shrink-0 relative"
          onPointerEnter={handleThumbnailPointerEnter}
          onPointerMove={handleThumbnailPointerMove}
          onPointerLeave={handleThumbnailPointerLeave}
        >
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={media.fileName}
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              {getIcon()}
            </div>
          )}
          {/* Importing overlay for list view thumbnail */}
          {isImporting && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
              <Loader2 className="w-4 h-4 text-white animate-spin" />
            </div>
          )}
          {/* Broken indicator for list view */}
          {isBroken && !isImporting && (
            <div className="absolute top-0.5 right-0.5 p-0.5 rounded bg-destructive/90 text-destructive-foreground">
              <Link2Off className="w-2.5 h-2.5" />
            </div>
          )}
          {/* Proxy badge for list view */}
          {!isBroken && !isImporting && proxyStatus === 'generating' && (
            <div className="absolute bottom-0.5 right-0.5 p-0.5 rounded bg-green-500/90 text-black">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
            </div>
          )}
          {!isBroken && !isImporting && isTagging && (
            <div className="absolute bottom-0.5 left-0.5 p-0.5 rounded bg-purple-500/90 text-white" title="Analyzing with AI">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
            </div>
          )}
          {!isBroken && !isImporting && hasProxy && (
            <div className="absolute bottom-0.5 right-0.5 p-0.5 rounded bg-green-500/90 text-black">
              <Zap className="w-2.5 h-2.5" />
            </div>
          )}
          {canScrubPreview && skimProgress !== null && (
              <div
                className="absolute inset-y-0 w-px bg-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.25)] pointer-events-none"
                style={{ left: `${skimProgress * 100}%` }}
              />
          )}
          {!isBroken && !isImporting && isTranscribing && transcriptProgressPercent !== null && (
            <div
              role="progressbar"
              aria-label="Transcript progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={transcriptProgressPercent}
              className="absolute inset-x-0 bottom-0 z-10 h-1 overflow-hidden bg-black/25 pointer-events-none"
            >
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${transcriptProgressPercent}%` }}
              />
            </div>
          )}
          {/* Audio play button for list view */}
          {isAudio && (
            <button
              type="button"
              onClick={handleAudioToggle}
              aria-label={audioPlaying ? 'Stop audio' : 'Play audio'}
              aria-pressed={audioPlaying}
              className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/30 transition-colors"
            >
              <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                audioPlaying
                  ? 'bg-white/90 text-black'
                  : 'bg-black/50 text-white'
              }`}>
                {audioPlaying
                  ? <Square className="w-2.5 h-2.5 fill-current" />
                  : <Play className="w-3 h-3 fill-current ml-0.5" />
                }
              </div>
            </button>
          )}
        </div>

        {/* Info — single row: icon + name + duration */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          {isImporting ? (
            <span className="text-[10px] text-muted-foreground">Importing...</span>
          ) : (
            <>
              <div className="p-0.5 rounded bg-primary/90 text-primary-foreground flex-shrink-0">
                {mediaType === 'video' && <Video className="w-2.5 h-2.5" />}
                {mediaType === 'audio' && <FileAudio className="w-2.5 h-2.5" />}
                {mediaType === 'image' && <ImageIcon className="w-2.5 h-2.5" />}
              </div>
              <h3 className="text-xs font-medium text-foreground truncate">
                {media.fileName}
              </h3>
              {(mediaType === 'video' || mediaType === 'audio') && media.duration > 0 && (
                <span className="text-[10px] text-muted-foreground flex-shrink-0">
                  {formatDuration(media.duration)}
                </span>
              )}
            </>
          )}
        </div>

        {/* Actions - hidden during upload */}
        {!isImporting && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <MediaInfoPopover
              media={media}
              triggerClassName="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors"
              onSeekToCaption={handleSeekToCaption}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 transition-all hover:bg-primary/20 hover:text-primary flex-shrink-0"
                >
                  <MoreVertical className="w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
                {actionMenuItems}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      </>
    );
  }

  // Grid view
  return (
    <>
    {transcribeDialog}
    <div
      style={CARD_PERF_STYLE}
      className={`
        ${CARD_GRID_BASE} cursor-pointer
        ${selected
          ? 'border-primary ring-2 ring-primary/20'
          : 'border-border hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10'
        }
        ${isImporting ? 'cursor-default' : ''}
      `}
      draggable={!isImporting}
      onDragStart={isImporting ? undefined : handleDragStart}
      onDragEnd={isImporting ? undefined : handleDragEnd}
      onClick={isImporting ? undefined : handleClick}
      onDoubleClick={isImporting ? undefined : (e) => { e.stopPropagation(); onDoubleClick?.(); }}
    >
      {/* Film strip perforations effect */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-secondary via-muted to-secondary" />
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-secondary via-muted to-secondary" />

      {/* Thumbnail - takes most of square space */}
      <div
        ref={thumbnailContainerRef}
        className="flex-1 bg-secondary relative overflow-hidden min-h-0"
        onPointerEnter={handleThumbnailPointerEnter}
        onPointerMove={handleThumbnailPointerMove}
        onPointerLeave={handleThumbnailPointerLeave}
      >
        {thumbnailUrl ? (
          <img
            ref={thumbnailRef}
            src={thumbnailUrl}
            alt={media.fileName}
            className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-secondary to-panel-bg">
            {getIcon()}
          </div>
        )}

        {/* Selection glow - subtle overlay only */}
        {selected && !isImporting && (
          <div className="absolute inset-0 bg-primary/10 pointer-events-none" />
        )}

        {/* Importing overlay */}
        {isImporting && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 pointer-events-none">
            <Loader2 className="w-6 h-6 text-white animate-spin" />
            <div className="text-[9px] text-white/60 uppercase tracking-wider">
              Importing
            </div>
          </div>
        )}

        {/* Top-right badges & info */}
        {!isImporting && (
          <div className="absolute top-1 right-1 z-10 flex flex-col items-end gap-0.5">
            {isBroken && (
              <div className="p-1 rounded bg-destructive/90 text-destructive-foreground">
                <Link2Off className="w-3 h-3" />
              </div>
            )}
            {!isBroken && proxyStatus === 'generating' && (
              <div className="p-0.5 rounded bg-green-500/90 text-black pointer-events-none">
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
              </div>
            )}
            {!isBroken && isTagging && (
              <div className="p-0.5 rounded bg-purple-500/90 text-white pointer-events-none" title="Analyzing with AI">
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
              </div>
            )}
            {!isBroken && hasProxy && (
              <div className="p-0.5 rounded bg-green-500/90 text-black pointer-events-none">
                <Zap className="w-2.5 h-2.5" />
              </div>
            )}
            {!isBroken && hasCaptions && (
              <div className="p-0.5 rounded bg-purple-500/90 text-white pointer-events-none" title={`${media.aiCaptions!.length} AI caption${media.aiCaptions!.length === 1 ? '' : 's'}`}>
                <Sparkles className="w-2.5 h-2.5" />
              </div>
            )}
            <div className="opacity-0 group-hover:opacity-100 transition-opacity">
              <MediaInfoPopover media={media} onSeekToCaption={handleSeekToCaption} />
            </div>
          </div>
        )}

        {/* Audio play button */}
        {isAudio && (
          <button
            type="button"
            onClick={handleAudioToggle}
            aria-label={audioPlaying ? 'Stop audio' : 'Play audio'}
            aria-pressed={audioPlaying}
            className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/30 transition-colors group/play"
          >
            <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
              audioPlaying
                ? 'bg-white/90 text-black'
                : 'bg-black/50 text-white group-hover/play:bg-white/90 group-hover/play:text-black'
            }`}>
              {audioPlaying
                ? <Square className="w-4 h-4 fill-current" />
                : <Play className="w-5 h-5 fill-current ml-0.5" />
              }
            </div>
          </button>
        )}

        {/* Overlaid badges - hidden during upload */}
        {!isImporting && (
          <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/60 to-transparent flex items-center justify-between gap-1 pointer-events-none">
            {/* Type icon badge - icon only */}
            <div className="p-0.5 rounded bg-primary/90 text-primary-foreground">
              {mediaType === 'video' && <Video className="w-2.5 h-2.5" />}
              {mediaType === 'audio' && <FileAudio className="w-2.5 h-2.5" />}
              {mediaType === 'image' && <ImageIcon className="w-2.5 h-2.5" />}
            </div>

            {/* Duration badge */}
            {(mediaType === 'video' || mediaType === 'audio') && media.duration > 0 && (
              <div className="px-1 py-0.5 bg-black/70 border border-white/20 rounded text-[8px] font-mono text-white">
                {formatDuration(media.duration)}
              </div>
            )}
          </div>
        )}
        {canScrubPreview && skimProgress !== null && (
            <div
              className="absolute inset-y-0 w-px bg-white/85 shadow-[0_0_0_1px_rgba(0,0,0,0.3)] pointer-events-none"
              style={{ left: `${skimProgress * 100}%` }}
            />
        )}
        {!isBroken && !isImporting && isTranscribing && transcriptProgressPercent !== null && (
          <div
            role="progressbar"
            aria-label="Transcript progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={transcriptProgressPercent}
            className="absolute inset-x-0 bottom-0 z-10 h-1 overflow-hidden bg-black/25 pointer-events-none"
          >
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${transcriptProgressPercent}%` }}
            />
          </div>
        )}
      </div>

      {/* Content footer - minimal */}
      <div className="px-1.5 py-1 bg-panel-bg/50 flex-shrink-0">
        <div className="flex items-center justify-between gap-1">
          <div className="flex-1 min-w-0">
            <h3 className="text-[10px] font-medium text-foreground truncate group-hover:text-primary transition-colors">
              {media.fileName}
            </h3>
          </div>

          {/* Actions dropdown - hidden during upload */}
          {!isImporting && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 transition-all hover:bg-primary/20 hover:text-primary flex-shrink-0"
                >
                  <MoreVertical className="w-2.5 h-2.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
                {actionMenuItems}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Film strip edge detail */}
      <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-border via-muted to-border opacity-50" />
      <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-border via-muted to-border opacity-50" />
    </div>
    </>
  );
});
