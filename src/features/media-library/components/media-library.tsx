import { useEffect, useRef, useState, useMemo, memo } from 'react';
import { Search, Filter, SortAsc, Video, FileAudio, Image as ImageIcon, Trash2, Grid3x3, List, AlertTriangle, Info, X, FolderOpen, Link2Off } from 'lucide-react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('MediaLibrary');
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { MediaGrid } from './media-grid';
import { MissingMediaDialog } from './missing-media-dialog';
import { useMediaLibraryStore } from '../stores/media-library-store';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';

export interface MediaLibraryProps {
  onMediaSelect?: (mediaId: string) => void;
}

export const MediaLibrary = memo(function MediaLibrary({ onMediaSelect }: MediaLibraryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [idsToDelete, setIdsToDelete] = useState<string[]>([]);

  // Timeline store selectors - don't subscribe to items to avoid re-renders
  // Read items from store directly when needed (in delete handler)
  const removeTimelineItems = useTimelineStore((s) => s.removeItems);

  // Store selectors
  const currentProjectId = useMediaLibraryStore((s) => s.currentProjectId);
  const loadMediaItems = useMediaLibraryStore((s) => s.loadMediaItems);
  const importMedia = useMediaLibraryStore((s) => s.importMedia);
  const importHandles = useMediaLibraryStore((s) => s.importHandles);
  const deleteMediaBatch = useMediaLibraryStore((s) => s.deleteMediaBatch);
  const showNotification = useMediaLibraryStore((s) => s.showNotification);
  const searchQuery = useMediaLibraryStore((s) => s.searchQuery);
  const setSearchQuery = useMediaLibraryStore((s) => s.setSearchQuery);
  const filterByType = useMediaLibraryStore((s) => s.filterByType);
  const setFilterByType = useMediaLibraryStore((s) => s.setFilterByType);
  const sortBy = useMediaLibraryStore((s) => s.sortBy);
  const setSortBy = useMediaLibraryStore((s) => s.setSortBy);
  const viewMode = useMediaLibraryStore((s) => s.viewMode);
  const setViewMode = useMediaLibraryStore((s) => s.setViewMode);
  const selectedMediaIds = useMediaLibraryStore((s) => s.selectedMediaIds);
  const clearSelection = useMediaLibraryStore((s) => s.clearSelection);
  const error = useMediaLibraryStore((s) => s.error);
  const clearError = useMediaLibraryStore((s) => s.clearError);
  const notification = useMediaLibraryStore((s) => s.notification);
  const clearNotification = useMediaLibraryStore((s) => s.clearNotification);
  const brokenMediaIds = useMediaLibraryStore((s) => s.brokenMediaIds);
  const openMissingMediaDialog = useMediaLibraryStore((s) => s.openMissingMediaDialog);

  // Load media items when project changes
  useEffect(() => {
    loadMediaItems();
  }, [currentProjectId, loadMediaItems]); // Reload when project context changes

  // Clear selection when clicking outside the media library
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Only clear if there's a selection
      if (selectedMediaIds.length === 0) return;

      // Check if click was outside the media library container
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        clearSelection();
      }
    };

    // Add listener
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [selectedMediaIds.length, clearSelection]);

  // Import files using file picker (instant, no copy)
  const handleImport = async () => {
    try {
      await importMedia();
    } catch (error) {
      logger.error('Import failed:', error);
    }
  };

  // Import files from drag-drop handles
  const handleImportHandles = async (handles: FileSystemFileHandle[]) => {
    try {
      await importHandles(handles);
    } catch (error) {
      logger.error('Import failed:', error);
    }
  };

  // Find timeline items that reference the media being deleted (for batch delete from selection)
  // Read from store directly to avoid subscribing to items array
  const affectedTimelineItems = useMemo(() => {
    if (idsToDelete.length === 0) return [];
    const timelineItems = useTimelineStore.getState().items;
    return timelineItems.filter((item) => item.mediaId && idsToDelete.includes(item.mediaId));
  }, [idsToDelete]);

  const handleDeleteSelected = () => {
    if (selectedMediaIds.length === 0) return;
    // Capture the IDs BEFORE opening dialog (selection may be cleared by click outside)
    setIdsToDelete([...selectedMediaIds]);
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = async () => {
    setShowDeleteDialog(false);
    try {
      // First remove timeline items that reference this media
      if (affectedTimelineItems.length > 0) {
        const timelineItemIds = affectedTimelineItems.map((item) => item.id);
        removeTimelineItems(timelineItemIds);
      }

      // Then delete the media from the library
      await deleteMediaBatch(idsToDelete);
      setIdsToDelete([]); // Clear after successful delete
    } catch (error) {
      logger.error('Delete failed:', error);
      setIdsToDelete([]); // Clear even on error
    }
  };

  return (
    <div ref={containerRef} className="h-full flex flex-col">
      {/* Header toolbar */}
      <div className="px-3 py-2 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 text-xs">
          {/* Import action */}
          <button
            onClick={handleImport}
            disabled={!currentProjectId}
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-md
              bg-primary text-primary-foreground
              hover:bg-primary/90
              disabled:opacity-40 disabled:cursor-not-allowed
              transition-colors duration-150"
            title="Import media files"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Import</span>
          </button>

          {/* Missing media indicator */}
          {brokenMediaIds.length > 0 && (
            <button
              onClick={openMissingMediaDialog}
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-md
                bg-destructive/10 border border-destructive/25 text-destructive
                hover:bg-destructive/20 hover:border-destructive/40
                transition-colors duration-150"
              title="View missing media files"
            >
              <Link2Off className="w-3.5 h-3.5" />
              <span>{brokenMediaIds.length} Missing</span>
            </button>
          )}

          {/* Selection indicator & actions */}
          {selectedMediaIds.length > 0 && (
            <>
              <div className="h-4 w-px bg-border" />

              {/* Selection badge */}
              <div className="flex items-center gap-1 h-7 pl-2 pr-1 rounded-md bg-accent/50 border border-border">
                <span className="tabular-nums">{selectedMediaIds.length}</span>
                <span className="text-muted-foreground">selected</span>
                <button
                  onClick={clearSelection}
                  className="ml-0.5 p-1 rounded hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
                  title="Clear selection"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>

              {/* Delete action */}
              <button
                onClick={handleDeleteSelected}
                className="flex items-center gap-1 h-7 px-2 rounded-md
                  text-destructive/80 hover:text-destructive hover:bg-destructive/10
                  transition-colors duration-150"
                title="Delete selected"
              >
                <Trash2 className="w-3 h-3" />
                <span>Delete</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="mx-4 mt-3 p-3 bg-destructive/10 border border-destructive/50 rounded text-xs animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-start justify-between gap-2">
            <p className="text-destructive leading-relaxed flex-1">{error}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearError}
              className="h-6 px-2 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Notification message */}
      {notification && (
        <div className={`mx-4 mt-3 p-2.5 rounded text-xs animate-in slide-in-from-top-2 duration-200 ${
          notification.type === 'info'
            ? 'bg-orange-500/10 border border-orange-500/30'
            : notification.type === 'warning'
            ? 'bg-yellow-500/10 border border-yellow-500/30'
            : notification.type === 'success'
            ? 'bg-green-500/10 border border-green-500/30'
            : 'bg-destructive/10 border border-destructive/50'
        }`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Info className={`w-3.5 h-3.5 flex-shrink-0 ${
                notification.type === 'info'
                  ? 'text-orange-500'
                  : notification.type === 'warning'
                  ? 'text-yellow-500'
                  : notification.type === 'success'
                  ? 'text-green-500'
                  : 'text-destructive'
              }`} />
              <p className={`leading-relaxed line-clamp-2 ${
                notification.type === 'info'
                  ? 'text-orange-600 dark:text-orange-400'
                  : notification.type === 'warning'
                  ? 'text-yellow-600 dark:text-yellow-400'
                  : notification.type === 'success'
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-destructive'
              }`}>{notification.message}</p>
            </div>
            <button
              onClick={clearNotification}
              className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Search and filters */}
      <div className="px-4 pt-3 pb-2 space-y-2 flex-shrink-0">
        {/* Search */}
        <div className="relative group">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground group-focus-within:text-primary transition-colors" />
          <Input
            placeholder="Search media..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-7 bg-secondary border border-border focus:border-primary text-foreground placeholder:text-muted-foreground text-xs"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
            >
              <span className="text-xs">✕</span>
            </button>
          )}
        </div>

        {/* Filters and sort */}
        <div className="flex items-center gap-1.5">
          {/* Filter by type */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={`h-6 bg-secondary border text-[10px] px-2 ${
                  filterByType
                    ? 'border-primary text-primary hover:bg-primary/10'
                    : 'border-border text-muted-foreground hover:border-primary/50 hover:text-primary'
                }`}
              >
                <Filter className="w-2.5 h-2.5 mr-1" />
                {filterByType ? filterByType.toUpperCase() : 'ALL'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="bg-popover border border-border">
              <DropdownMenuItem
                onClick={() => setFilterByType(null)}
                className="text-xs hover:bg-accent hover:text-accent-foreground"
              >
                All Types
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={() => setFilterByType('video')}
                className="text-xs hover:bg-accent hover:text-accent-foreground"
              >
                <Video className="w-3 h-3 mr-2" />
                Video
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setFilterByType('audio')}
                className="text-xs hover:bg-accent hover:text-accent-foreground"
              >
                <FileAudio className="w-3 h-3 mr-2" />
                Audio
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setFilterByType('image')}
                className="text-xs hover:bg-accent hover:text-accent-foreground"
              >
                <ImageIcon className="w-3 h-3 mr-2" />
                Image
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Sort by */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-6 bg-secondary border border-border text-muted-foreground hover:border-primary/50 hover:text-primary text-[10px] px-2"
              >
                <SortAsc className="w-2.5 h-2.5 mr-1" />
                {sortBy === 'name' ? 'NAME' : sortBy === 'date' ? 'DATE' : 'SIZE'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="bg-popover border border-border">
              <DropdownMenuItem
                onClick={() => setSortBy('date')}
                className="text-xs hover:bg-accent hover:text-accent-foreground"
              >
                Date (Newest)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setSortBy('name')}
                className="text-xs hover:bg-accent hover:text-accent-foreground"
              >
                Name (A-Z)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setSortBy('size')}
                className="text-xs hover:bg-accent hover:text-accent-foreground"
              >
                Size (Largest)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* View mode toggle */}
          <div className="flex items-center border border-border rounded bg-secondary ml-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setViewMode('grid')}
              className={`h-6 w-6 p-0 rounded-none rounded-l ${
                viewMode === 'grid'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Grid3x3 className="w-3 h-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setViewMode('list')}
              className={`h-6 w-6 p-0 rounded-none rounded-r ${
                viewMode === 'list'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <List className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* Media grid (scrollable) - now also acts as dropzone */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <MediaGrid
          onMediaSelect={onMediaSelect}
          onImportHandles={handleImportHandles}
          onShowNotification={showNotification}
          viewMode={viewMode}
        />
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected items?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Are you sure you want to delete {idsToDelete.length} selected item{idsToDelete.length > 1 ? 's' : ''}?
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
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete {idsToDelete.length} item{idsToDelete.length > 1 ? 's' : ''}{affectedTimelineItems.length > 0 ? ` & ${affectedTimelineItems.length} clip${affectedTimelineItems.length > 1 ? 's' : ''}` : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Missing Media Dialog */}
      <MissingMediaDialog />
    </div>
  );
});
