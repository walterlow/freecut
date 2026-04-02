import { useState, useEffect, useRef, useCallback } from 'react';
import { Video, FileAudio, Image as ImageIcon, MoreVertical, Trash2, Loader2, Link2Off, RefreshCw, Zap, FileText } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import type { MediaMetadata } from '@/types/storage';
import { mediaLibraryService } from '../services/media-library-service';
import { getMediaType, formatDuration } from '../utils/validation';
import { getSharedProxyKey } from '../utils/proxy-key';
import { useMediaLibraryStore } from '../stores/media-library-store';
import { CARD_GRID_BASE, CARD_LIST_BASE, CARD_PERF_STYLE } from './card-styles';
import { setMediaDragData, clearMediaDragData } from '../utils/drag-data-cache';
import { proxyService } from '../services/proxy-service';
import { mediaTranscriptionService } from '../services/media-transcription-service';
import { isLocalInferenceCancellationError } from '@/shared/state/local-inference';
import { useEditorStore } from '@/shared/state/editor';
import {
  getTranscriptionOverallPercent,
  getTranscriptionStageLabel,
} from '@/shared/utils/transcription-progress';

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

export function MediaCard({ media, selected = false, isBroken = false, onSelect, onDoubleClick, onDelete, onRelink, viewMode = 'grid' }: MediaCardProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [skimProgress, setSkimProgress] = useState<number | null>(null);
  const selectedMediaIds = useMediaLibraryStore((s) => s.selectedMediaIds);
  const mediaItems = useMediaLibraryStore((s) => s.mediaItems);
  const importingIds = useMediaLibraryStore((s) => s.importingIds);

  const proxyStatus = useMediaLibraryStore((s) => s.proxyStatus.get(media.id));
  const proxyProgress = useMediaLibraryStore((s) => s.proxyProgress.get(media.id));
  const transcriptStatus = useMediaLibraryStore((s) => s.transcriptStatus.get(media.id) ?? 'idle');
  const transcriptProgress = useMediaLibraryStore((s) => s.transcriptProgress.get(media.id));

  const mediaType = getMediaType(media.mimeType);
  const isImporting = importingIds.includes(media.id);
  const isTranscribable = mediaType === 'video' || mediaType === 'audio';
  const canGenerateProxy = proxyService.needsProxy(
    media.width,
    media.height,
    media.mimeType,
    media.audioCodec
  );
  const hasProxy = proxyStatus === 'ready';
  const hasTranscript = transcriptStatus === 'ready';
  const isTranscribing = transcriptStatus === 'transcribing';
  const thumbnailRef = useRef<HTMLImageElement>(null);
  const thumbnailContainerRef = useRef<HTMLDivElement | null>(null);
  const dragImageRef = useRef<HTMLDivElement | null>(null);
  const setMediaSkimPreview = useEditorStore((s) => s.setMediaSkimPreview);
  const clearMediaSkimPreview = useEditorStore((s) => s.clearMediaSkimPreview);

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

  const handleGenerateProxy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const blobUrl = await mediaLibraryService.getMediaBlobUrl(media.id);
      if (blobUrl) {
        const proxyKey = getSharedProxyKey(media);
        proxyService.setProxyKey(media.id, proxyKey);
        proxyService.generateProxy(media.id, blobUrl, media.width, media.height, proxyKey);
      }
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

  const handleGenerateTranscript = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const store = useMediaLibraryStore.getState();
    const previousStatus = store.transcriptStatus.get(media.id) ?? 'idle';

    store.setTranscriptStatus(media.id, 'transcribing');
    store.setTranscriptProgress(media.id, { stage: 'loading', progress: 0 });

    try {
      await mediaTranscriptionService.transcribeMedia(media.id, {
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
    } catch (error) {
      if (isLocalInferenceCancellationError(error)) {
        store.setTranscriptStatus(media.id, previousStatus);
        store.clearTranscriptProgress(media.id);
        return;
      }

      store.setTranscriptStatus(media.id, previousStatus === 'ready' ? 'ready' : 'error');
      store.clearTranscriptProgress(media.id);
      store.showNotification({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to transcribe media',
      });
    }
  };

  const handleDragStart = useCallback((e: React.DragEvent) => {
    // Set drag data for timeline drop
    e.dataTransfer.effectAllowed = 'copy';

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
  }, [selectedMediaIds, media.id, media.fileName, media.duration, mediaItems, mediaType]);

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

  const canHoverPreview = (mediaType === 'video' || mediaType === 'image') && !isBroken && !isImporting;
  const canScrubPreview = mediaType === 'video' && media.duration > 0 && !isBroken && !isImporting;

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

  const handleThumbnailPointerEnter = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!canHoverPreview || event.pointerType === 'touch') return;
    updateSkimPreview(event.clientX);
  }, [canHoverPreview, updateSkimPreview]);

  const handleThumbnailPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!canScrubPreview || event.pointerType === 'touch') return;
    updateSkimPreview(event.clientX);
  }, [canScrubPreview, updateSkimPreview]);

  const handleThumbnailPointerLeave = useCallback(() => {
    if (!canHoverPreview) return;
    setSkimProgress(null);
    clearMediaSkimPreview();
  }, [canHoverPreview, clearMediaSkimPreview]);

  useEffect(() => {
    if (!canHoverPreview) return;
    return () => {
      if (useEditorStore.getState().mediaSkimPreviewMediaId === media.id) {
        clearMediaSkimPreview();
      }
    };
  }, [canHoverPreview, clearMediaSkimPreview, media.id]);

  const transcriptProgressLabel = transcriptProgress
    ? `${getTranscriptionStageLabel(transcriptProgress.stage)} (${Math.round(getTranscriptionOverallPercent(transcriptProgress))}%)`
    : 'Transcribing...';

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
          className="w-16 h-12 bg-secondary rounded overflow-hidden flex-shrink-0 relative"
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
            <div className="absolute bottom-0.5 right-0.5 p-0.5 rounded bg-amber-500/90 text-black">
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
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h3 className="text-xs font-medium text-foreground truncate">
            {media.fileName}
          </h3>
          {isImporting ? (
            /* Importing indicator for list view */
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-muted-foreground">Importing...</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-0.5">
              {/* Type badge inline */}
              <div className="p-0.5 rounded bg-primary/90 text-primary-foreground flex-shrink-0">
                {mediaType === 'video' && <Video className="w-2.5 h-2.5" />}
                {mediaType === 'audio' && <FileAudio className="w-2.5 h-2.5" />}
                {mediaType === 'image' && <ImageIcon className="w-2.5 h-2.5" />}
              </div>

              {/* Duration only */}
              {(mediaType === 'video' || mediaType === 'audio') && media.duration > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  {formatDuration(media.duration)}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Actions - hidden during upload */}
        {!isImporting && (
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
              {isBroken && onRelink && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRelink(); }} className="text-primary focus:text-primary">
                  <RefreshCw className="w-3 h-3 mr-2" />
                  Relink File...
                </DropdownMenuItem>
              )}
              {canGenerateProxy && !hasProxy && proxyStatus !== 'generating' && (
                <DropdownMenuItem onClick={handleGenerateProxy}>
                  <Zap className="w-3 h-3 mr-2" />
                  Generate Proxy
                </DropdownMenuItem>
              )}
              {isTranscribable && !isBroken && !isTranscribing && (
                <DropdownMenuItem onClick={handleGenerateTranscript}>
                  <FileText className="w-3 h-3 mr-2" />
                  {hasTranscript ? 'Regenerate Transcript' : 'Transcribe Audio'}
                </DropdownMenuItem>
              )}
              {isTranscribable && !isBroken && isTranscribing && (
                <DropdownMenuItem disabled>
                  <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                  {transcriptProgressLabel}
                </DropdownMenuItem>
              )}
              {proxyStatus === 'generating' && (
                <DropdownMenuItem disabled>
                  <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                  Generating Proxy{proxyProgress != null ? ` (${Math.round(proxyProgress * 100)}%)` : '...'}
                </DropdownMenuItem>
              )}
              {hasProxy && (
                <DropdownMenuItem onClick={handleDeleteProxy} className="text-destructive focus:text-destructive">
                  <Trash2 className="w-3 h-3 mr-2" />
                  Delete Proxy
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={handleDelete} className="text-destructive focus:text-destructive">
                <Trash2 className="w-3 h-3 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  }

  // Grid view
  return (
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

        {/* Broken file indicator */}
        {isBroken && !isImporting && (
          <div className="absolute top-1 right-1 p-1 rounded bg-destructive/90 text-destructive-foreground">
            <Link2Off className="w-3 h-3" />
          </div>
        )}

        {/* Proxy badge */}
        {!isBroken && !isImporting && proxyStatus === 'generating' && (
          <div className="absolute top-1 right-1 p-0.5 rounded bg-amber-500/90 text-black pointer-events-none">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
          </div>
        )}
        {!isBroken && !isImporting && hasProxy && (
          <div className="absolute top-1 right-1 p-0.5 rounded bg-green-500/90 text-black pointer-events-none">
            <Zap className="w-2.5 h-2.5" />
          </div>
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
                {isBroken && onRelink && (
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRelink(); }} className="text-primary focus:text-primary">
                    <RefreshCw className="w-3 h-3 mr-2" />
                    Relink File...
                  </DropdownMenuItem>
                )}
                {canGenerateProxy && !hasProxy && proxyStatus !== 'generating' && (
                  <DropdownMenuItem onClick={handleGenerateProxy}>
                    <Zap className="w-3 h-3 mr-2" />
                    Generate Proxy
                  </DropdownMenuItem>
                )}
                {isTranscribable && !isBroken && !isTranscribing && (
                  <DropdownMenuItem onClick={handleGenerateTranscript}>
                    <FileText className="w-3 h-3 mr-2" />
                    {hasTranscript ? 'Regenerate Transcript' : 'Transcribe Audio'}
                  </DropdownMenuItem>
                )}
                {isTranscribable && !isBroken && isTranscribing && (
                  <DropdownMenuItem disabled>
                    <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                    {transcriptProgressLabel}
                  </DropdownMenuItem>
                )}
                {proxyStatus === 'generating' && (
                  <DropdownMenuItem disabled>
                    <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                    Generating Proxy{proxyProgress != null ? ` (${Math.round(proxyProgress * 100)}%)` : '...'}
                  </DropdownMenuItem>
                )}
                {hasProxy && (
                  <DropdownMenuItem onClick={handleDeleteProxy} className="text-destructive focus:text-destructive">
                    <Trash2 className="w-3 h-3 mr-2" />
                    Delete Proxy
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleDelete} className="text-destructive focus:text-destructive">
                  <Trash2 className="w-3 h-3 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Film strip edge detail */}
      <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-border via-muted to-border opacity-50" />
      <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-gradient-to-b from-border via-muted to-border opacity-50" />
    </div>
  );
}
