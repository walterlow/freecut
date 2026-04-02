import { useState, useMemo, useRef, memo } from 'react';
import { Loader2, Upload, AlertTriangle } from 'lucide-react';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('MediaGrid');
import { MediaCard } from './media-card';
import { useMediaLibraryStore, useFilteredMediaItems } from '../stores/media-library-store';
import {
  getMediaDeletionImpact,
  removeProjectItems,
} from '@/features/media-library/deps/timeline-stores';
import { useEditorStore } from '@/shared/state/editor';
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

import { GRID_COLS_BY_SIZE } from './media-grid-constants';

interface MediaGridProps {
  onMediaSelect?: (mediaId: string) => void;
  viewMode?: 'grid' | 'list';
  /** Grid item size (1 = largest, 5 = smallest) */
  itemSize?: number;
}

export const MediaGrid = memo(function MediaGrid({ onMediaSelect, viewMode = 'grid', itemSize = 3 }: MediaGridProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [mediaIdToDelete, setMediaIdToDelete] = useState<string | null>(null);
  const lastSelectedIdRef = useRef<string | null>(null);

  const filteredItems = useFilteredMediaItems();
  const isLoading = useMediaLibraryStore((s) => s.isLoading);
  const selectedMediaIds = useMediaLibraryStore((s) => s.selectedMediaIds);
  const selectedCompositionIds = useMediaLibraryStore((s) => s.selectedCompositionIds);
  const brokenMediaIds = useMediaLibraryStore((s) => s.brokenMediaIds);
  const toggleMediaSelection = useMediaLibraryStore((s) => s.toggleMediaSelection);
  const setSelection = useMediaLibraryStore((s) => s.setSelection);
  const deleteMedia = useMediaLibraryStore((s) => s.deleteMedia);
  const relinkMedia = useMediaLibraryStore((s) => s.relinkMedia);
  const importMedia = useMediaLibraryStore((s) => s.importMedia);
  const setSourcePreviewMediaId = useEditorStore((s) => s.setSourcePreviewMediaId);

  const affectedMediaImpact = useMemo(() => (
    mediaIdToDelete
      ? getMediaDeletionImpact([mediaIdToDelete])
      : { itemIds: [], rootReferenceCount: 0, nestedReferenceCount: 0, totalReferenceCount: 0 }
  ), [mediaIdToDelete]);

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
          setSelection({ mediaIds: newSelection, compositionIds: selectedCompositionIds });
        } else {
          // Replace selection with range
          setSelection({ mediaIds: rangeIds, compositionIds: [] });
        }
      }
    } else if (event?.ctrlKey || event?.metaKey) {
      // Ctrl/Cmd click: toggle selection (add/remove from current selection)
      toggleMediaSelection(mediaId);
      lastSelectedIdRef.current = mediaId;
    } else {
      // Normal click: select only this item (clear others)
      setSelection({ mediaIds: [mediaId], compositionIds: [] });
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
      if (affectedMediaImpact.itemIds.length > 0) {
        removeProjectItems(affectedMediaImpact.itemIds);
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
    <div>
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
        <div className={viewMode === 'grid' ? `grid ${GRID_COLS_BY_SIZE[itemSize] ?? GRID_COLS_BY_SIZE[3]}` : 'space-y-2'}>
          {filteredItems.map((media) => (
            <div
              key={media.id}
              data-media-id={media.id}
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
                {affectedMediaImpact.totalReferenceCount > 0 && (
                  <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md">
                    <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-yellow-600 dark:text-yellow-400">
                      <p className="font-medium">Timeline clips will be removed</p>
                      <p className="text-xs mt-1 text-yellow-600/80 dark:text-yellow-400/80">
                        {affectedMediaImpact.totalReferenceCount} clip{affectedMediaImpact.totalReferenceCount > 1 ? 's' : ''} across the timeline and nested compound clips reference this media and will also be deleted.
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
              Delete{affectedMediaImpact.totalReferenceCount > 0 ? ` & ${affectedMediaImpact.totalReferenceCount} clip${affectedMediaImpact.totalReferenceCount > 1 ? 's' : ''}` : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});
