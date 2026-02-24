import { useState, useEffect } from 'react';
import { Video, FileAudio, Image as ImageIcon, MoreVertical, Trash2, Loader2, Link2Off, RefreshCw, Zap } from 'lucide-react';
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
import { setMediaDragData, clearMediaDragData } from '../utils/drag-data-cache';
import { proxyService } from '../services/proxy-service';

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
  const selectedMediaIds = useMediaLibraryStore((s) => s.selectedMediaIds);
  const mediaItems = useMediaLibraryStore((s) => s.mediaItems);
  const importingIds = useMediaLibraryStore((s) => s.importingIds);

  const proxyStatus = useMediaLibraryStore((s) => s.proxyStatus.get(media.id));
  const proxyProgress = useMediaLibraryStore((s) => s.proxyProgress.get(media.id));

  const mediaType = getMediaType(media.mimeType);
  const isImporting = importingIds.includes(media.id);
  const canGenerateProxy = proxyService.needsProxy(
    media.width,
    media.height,
    media.mimeType,
    media.audioCodec
  );
  const hasProxy = proxyStatus === 'ready';

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

  const handleDragStart = (e: React.DragEvent) => {
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
  };

  const handleDragEnd = () => {
    clearMediaDragData();
  };

  const handleClick = (e: React.MouseEvent) => {
    onSelect?.(e);
  };

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
        className={`
          group panel-bg border rounded overflow-hidden
          transition-all duration-200 cursor-pointer
          flex items-center gap-3 p-2
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
        <div className="w-16 h-12 bg-secondary rounded overflow-hidden flex-shrink-0 relative">
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
      className={`
        group relative panel-bg border-2 rounded-lg overflow-hidden
        transition-all duration-300 cursor-pointer
        aspect-square flex flex-col hover:scale-[1.02]
        ${selected
          ? 'border-primary ring-2 ring-primary/20 scale-[1.02]'
          : 'border-border hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10'
        }
        ${isImporting ? 'cursor-default hover:scale-100' : ''}
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
      <div className="flex-1 bg-secondary relative overflow-hidden min-h-0">
        {thumbnailUrl ? (
          <img
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
