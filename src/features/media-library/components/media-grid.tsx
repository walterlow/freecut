import { useState, useMemo, useEffect, useRef, memo } from 'react';
import { Loader2, Upload, AlertTriangle } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('MediaGrid');
import { MediaCard } from './media-card';
import { useMediaLibraryStore, useFilteredMediaItems } from '../stores/media-library-store';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { useEditorStore } from '@/features/editor/stores/editor-store';
import { validateMediaFile } from '../utils/validation';
import { useMarqueeSelection, type MarqueeItem } from '@/hooks/use-marquee-selection';
import { MarqueeOverlay } from '@/components/marquee-overlay';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface MediaGridProps {
  onMediaSelect?: (mediaId: string) => void;
  onImportHandles: (handles: FileSystemFileHandle[]) => Promise<void>;
  onShowNotification: (notification: { type: 'info' | 'warning' | 'error'; message: string }) => void;
  viewMode?: 'grid' | 'list';
}

export const MediaGrid = memo(function MediaGrid({ onMediaSelect, onImportHandles, onShowNotification, viewMode = 'grid' }: MediaGridProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [mediaIdToDelete, setMediaIdToDelete] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wasMarqueeDraggingRef = useRef(false);
  const hasAnimatedRef = useRef(false);
  const lastSelectedIdRef = useRef<string | null>(null);

  const filteredItems = useFilteredMediaItems();
  const isLoading = useMediaLibraryStore((s) => s.isLoading);
  const selectedMediaIds = useMediaLibraryStore((s) => s.selectedMediaIds);
  const brokenMediaIds = useMediaLibraryStore((s) => s.brokenMediaIds);
  const toggleMediaSelection = useMediaLibraryStore((s) => s.toggleMediaSelection);
  const selectMedia = useMediaLibraryStore((s) => s.selectMedia);
  const deleteMedia = useMediaLibraryStore((s) => s.deleteMedia);
  const relinkMedia = useMediaLibraryStore((s) => s.relinkMedia);
  const importMedia = useMediaLibraryStore((s) => s.importMedia);
  const setSourcePreviewMediaId = useEditorStore((s) => s.setSourcePreviewMediaId);

  // Timeline store for checking references - don't subscribe to items to avoid re-renders
  const removeTimelineItems = useTimelineStore((s) => s.removeItems);

  // Find timeline items that reference the media being deleted
  // Read from store directly to avoid subscribing to items array
  const affectedTimelineItems = useMemo(() => {
    if (!mediaIdToDelete) return [];
    const timelineItems = useTimelineStore.getState().items;
    return timelineItems.filter((item) => item.mediaId === mediaIdToDelete);
  }, [mediaIdToDelete]);

  // Create marquee items from filtered media
  const marqueeItems: MarqueeItem[] = useMemo(
    () =>
      filteredItems.map((media) => ({
        id: media.id,
        getBoundingRect: () => {
          const element = document.querySelector(`[data-media-id="${media.id}"]`);
          if (!element) {
            return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
          }
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          };
        },
      })),
    [filteredItems]
  );

  // Marquee selection
  const { marqueeState } = useMarqueeSelection({
    containerRef: containerRef as React.RefObject<HTMLElement>,
    items: marqueeItems,
    onSelectionChange: (ids) => {
      selectMedia(ids);
    },
    enabled: filteredItems.length > 0,
  });

  // Track when marquee was active to prevent click from clearing selection
  useEffect(() => {
    if (marqueeState.active) {
      wasMarqueeDraggingRef.current = true;
    }
  }, [marqueeState.active]);

  // Mark as animated after first render to prevent re-animation on tab switches
  useEffect(() => {
    if (filteredItems.length > 0) {
      hasAnimatedRef.current = true;
    }
  }, [filteredItems.length]);

  const handleCardSelect = (mediaId: string, event?: React.MouseEvent) => {
    // Shift click: select range from last selected item to this item
    if (event?.shiftKey && lastSelectedIdRef.current) {
      const lastIndex = filteredItems.findIndex((item) => item.id === lastSelectedIdRef.current);
      const currentIndex = filteredItems.findIndex((item) => item.id === mediaId);

      if (lastIndex !== -1 && currentIndex !== -1) {
        const startIndex = Math.min(lastIndex, currentIndex);
        const endIndex = Math.max(lastIndex, currentIndex);
        const rangeIds = filteredItems.slice(startIndex, endIndex + 1).map((item) => item.id);

        // If Ctrl/Cmd is also held, add range to existing selection
        if (event.ctrlKey || event.metaKey) {
          const newSelection = [...new Set([...selectedMediaIds, ...rangeIds])];
          selectMedia(newSelection);
        } else {
          // Replace selection with range
          selectMedia(rangeIds);
        }
      }
    } else if (event?.ctrlKey || event?.metaKey) {
      // Ctrl/Cmd click: toggle selection (add/remove from current selection)
      toggleMediaSelection(mediaId);
      lastSelectedIdRef.current = mediaId;
    } else {
      // Normal click: select only this item (clear others)
      selectMedia([mediaId]);
      lastSelectedIdRef.current = mediaId;
    }
    onMediaSelect?.(mediaId);
  };

  // Show delete confirmation dialog (called from MediaCard)
  const handleCardDelete = (mediaId: string) => {
    setMediaIdToDelete(mediaId);
    setShowDeleteDialog(true);
  };

  // Actually delete after confirmation
  const handleConfirmDelete = async () => {
    if (!mediaIdToDelete) return;

    setShowDeleteDialog(false);
    try {
      // First remove timeline items that reference this media
      if (affectedTimelineItems.length > 0) {
        const timelineItemIds = affectedTimelineItems.map((item) => item.id);
        removeTimelineItems(timelineItemIds);
      }

      // Then delete the media from the library
      await deleteMedia(mediaIdToDelete);
    } catch (error) {
      logger.error('Failed to delete media:', error);
      // Error is already set in store
    } finally {
      setMediaIdToDelete(null);
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteDialog(false);
    setMediaIdToDelete(null);
  };

  // Handle relinking a broken media file
  const handleRelink = async (mediaId: string) => {
    try {
      // Open file picker for a single file
      const handles = await window.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: 'Media files',
            accept: {
              'video/*': ['.mp4', '.webm', '.mov', '.avi', '.mkv'],
              'audio/*': ['.mp3', '.wav', '.ogg', '.m4a', '.aac'],
              'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'],
            },
          },
        ],
      });

      const handle = handles[0];
      if (!handle) return;

      await relinkMedia(mediaId, handle);
    } catch (error) {
      // User cancelled - ignore AbortError
      if (error instanceof Error && error.name !== 'AbortError') {
        logger.error('Failed to relink media:', error);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Don't show drag overlay if dragging media items from the grid
    // Media items have 'application/json' type, external files have 'Files' type
    if (!e.dataTransfer.types.includes('application/json')) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set dragging to false if leaving the container itself
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    // Check if this is a media item being dragged (not external files)
    try {
      const jsonData = e.dataTransfer.getData('application/json');
      if (jsonData) {
        const data = JSON.parse(jsonData);
        // Ignore media items being dragged from the grid itself
        if (data.type === 'media-item' || data.type === 'media-items') {
          return;
        }
      }
    } catch {
      // Not JSON data, continue with file handling
    }

    // Check if getAsFileSystemHandle is supported (Chrome/Edge only)
    const firstItem = e.dataTransfer.items[0];
    if (!firstItem || !('getAsFileSystemHandle' in firstItem)) {
      onShowNotification({
        type: 'warning',
        message: 'Drag-drop not supported. Please use Google Chrome.',
      });
      return;
    }

    // Get file handles from drop
    // IMPORTANT: Collect all handle promises SYNCHRONOUSLY first, then await them
    // The DataTransferItemList can become invalid after any async operation
    const items = Array.from(e.dataTransfer.items);
    logger.debug(`[handleDrop] Processing ${items.length} dropped items`);

    // Start all getAsFileSystemHandle calls synchronously before any await
    const handlePromises: Promise<FileSystemHandle | null>[] = [];
    for (const item of items) {
      logger.debug(`[handleDrop] Item kind: ${item.kind}, type: ${item.type}`);
      if ('getAsFileSystemHandle' in item) {
        handlePromises.push(item.getAsFileSystemHandle());
      }
    }

    // Now await all the promises
    const rawHandles = await Promise.all(handlePromises);
    logger.debug(`[handleDrop] Got ${rawHandles.length} raw handles`);

    // Filter and validate
    const handles: FileSystemFileHandle[] = [];
    const errors: string[] = [];

    for (const handle of rawHandles) {
      logger.debug(`[handleDrop] Handle:`, handle?.kind, handle?.name);
      if (handle?.kind === 'file') {
        try {
          const file = await (handle as FileSystemFileHandle).getFile();
          logger.debug(`[handleDrop] File: ${file.name}, size: ${file.size}, type: ${file.type}`);
          const validation = validateMediaFile(file);
          if (validation.valid) {
            handles.push(handle as FileSystemFileHandle);
            logger.debug(`[handleDrop] Added handle for ${file.name}`);
          } else {
            errors.push(`${file.name}: ${validation.error}`);
            logger.debug(`[handleDrop] Validation failed for ${file.name}: ${validation.error}`);
          }
        } catch (error) {
          logger.warn(`[handleDrop] Failed to get file from handle:`, error);
        }
      }
    }

    logger.debug(`[handleDrop] Total valid handles: ${handles.length}, errors: ${errors.length}`);

    // Show validation errors if any
    if (errors.length > 0) {
      onShowNotification({
        type: 'error',
        message: `Some files were rejected: ${errors.join(', ')}`,
      });
    }

    // Import valid file handles
    if (handles.length > 0) {
      await onImportHandles(handles);
    }
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    // Don't clear selection if we just finished a marquee drag
    if (wasMarqueeDraggingRef.current) {
      wasMarqueeDraggingRef.current = false;
      return;
    }

    // Check if click was on a media card by looking for the data attribute
    const clickedOnCard = (e.target as HTMLElement).closest('[data-media-id]');

    if (!clickedOnCard) {
      // Clear selection when clicking empty area (not on a card)
      selectMedia([]);
    }
  };

  // Handle click on empty state to open file picker
  const handleEmptyStateClick = async () => {
    try {
      await importMedia();
    } catch (error) {
      logger.error('Import failed:', error);
    }
  };

  // Main container with dropzone functionality
  return (
    <div
      ref={containerRef}
      className="relative min-h-full"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleContainerClick}
    >
      {/* Marquee selection overlay */}
      <MarqueeOverlay marqueeState={marqueeState} />

      {/* Drag overlay - shown when dragging */}
      {isDragging && (
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5 border-2 border-dashed border-primary z-50 flex items-center justify-center pointer-events-none">
          {/* Animated corner accents */}
          <div className="absolute top-2 left-2 w-6 h-6 border-l-2 border-t-2 border-primary" />
          <div className="absolute top-2 right-2 w-6 h-6 border-r-2 border-t-2 border-primary" />
          <div className="absolute bottom-2 left-2 w-6 h-6 border-l-2 border-b-2 border-primary" />
          <div className="absolute bottom-2 right-2 w-6 h-6 border-r-2 border-b-2 border-primary" />

          {/* Upload icon and message */}
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full flex items-center justify-center bg-primary/20 border-2 border-primary">
              <Upload className="w-7 h-7 text-primary animate-bounce" />
            </div>
            <p className="text-base font-bold tracking-wide text-primary">DROP FILES HERE</p>
            <div className="flex flex-wrap justify-center gap-2 mt-2">
              <span className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground">MP4</span>
              <span className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground">WebM</span>
              <span className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground">MOV</span>
              <span className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground">MP3</span>
              <span className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground">WAV</span>
              <span className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground">JPG</span>
              <span className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground">PNG</span>
            </div>
          </div>

          {/* Animated scan line */}
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent animate-scan" />
          </div>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <Loader2 className="w-12 h-12 animate-spin text-primary" />
              <div className="absolute inset-0 w-12 h-12 rounded-full border-2 border-primary/20 animate-pulse" />
            </div>
            <div className="text-center">
              <p className="text-sm font-mono text-foreground tracking-wider mb-1">LOADING MEDIA LIBRARY</p>
              <p className="text-xs text-muted-foreground font-mono">Initializing storage...</p>
            </div>
          </div>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="flex items-center justify-center py-24">
          <div className="text-center max-w-md">
            <div
              className="w-20 h-20 mx-auto mb-6 rounded-full border-2 border-dashed border-border flex items-center justify-center bg-secondary hover:border-primary/50 hover:bg-secondary/80 cursor-pointer transition-colors"
              onClick={handleEmptyStateClick}
            >
              <Upload className="w-10 h-10 text-muted-foreground" />
            </div>
            <p className="text-base font-bold text-foreground mb-2 tracking-wide">NO MEDIA FILES</p>
            <p className="text-sm text-muted-foreground font-light mb-3">
              Drag and drop files or click to browse
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <span className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground">MP4</span>
              <span className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground">WebM</span>
              <span className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground">MOV</span>
              <span className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground">MP3</span>
              <span className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground">WAV</span>
              <span className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground">JPG</span>
              <span className="px-2 py-0.5 bg-secondary border border-border rounded text-xs font-mono text-muted-foreground">PNG</span>
            </div>
          </div>
        </div>
      ) : (
        <div className={viewMode === 'grid' ? 'grid grid-cols-2 md:grid-cols-3 gap-4 max-w-5xl' : 'space-y-2'}>
          {filteredItems.map((media, index) => (
            <div
              key={media.id}
              data-media-id={media.id}
              className={hasAnimatedRef.current ? '' : 'animate-in fade-in slide-in-from-bottom-4 duration-300'}
              style={hasAnimatedRef.current ? {} : { animationDelay: `${index * 30}ms` }}
            >
              <MediaCard
                media={media}
                selected={selectedMediaIds.includes(media.id)}
                isBroken={brokenMediaIds.includes(media.id)}
                onSelect={(event) => handleCardSelect(media.id, event)}
                onDoubleClick={() => setSourcePreviewMediaId(media.id)}
                onDelete={() => handleCardDelete(media.id)}
                onRelink={() => handleRelink(media.id)}
                viewMode={viewMode}
              />
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation dialog with timeline warning */}
      <AlertDialog open={showDeleteDialog} onOpenChange={(open) => !open && handleCancelDelete()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete media file?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Are you sure you want to delete "{filteredItems.find(m => m.id === mediaIdToDelete)?.fileName}"?
                  This action cannot be undone.
                </p>
                {affectedTimelineItems.length > 0 && (
                  <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md">
                    <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-yellow-600 dark:text-yellow-400">
                      <p className="font-medium">Timeline clips will be removed</p>
                      <p className="text-xs mt-1 text-yellow-600/80 dark:text-yellow-400/80">
                        {affectedTimelineItems.length} clip{affectedTimelineItems.length > 1 ? 's' : ''} in the timeline use{affectedTimelineItems.length === 1 ? 's' : ''} this media and will also be deleted.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelDelete}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete{affectedTimelineItems.length > 0 ? ` & ${affectedTimelineItems.length} clip${affectedTimelineItems.length > 1 ? 's' : ''}` : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});
