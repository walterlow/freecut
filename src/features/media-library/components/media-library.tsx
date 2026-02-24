import { useEffect, useRef, useState, useMemo, memo, useCallback } from 'react';
import { Search, Filter, SortAsc, Video, FileAudio, Image as ImageIcon, Trash2, Grid3x3, List, AlertTriangle, Info, X, FolderOpen, Link2Off, ChevronRight, Film, ArrowLeft, Zap, Loader2, Copy, Check, Upload } from 'lucide-react';
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { MediaGrid } from './media-grid';
import { MediaInfoPanel } from './media-info-panel';
import { CompositionsSection } from './compositions-section';
import { MissingMediaDialog } from './missing-media-dialog';
import { OrphanedClipsDialog } from './orphaned-clips-dialog';
import { UnsupportedAudioCodecDialog } from './unsupported-audio-codec-dialog';
import { useMediaLibraryStore } from '../stores/media-library-store';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { useCompositionNavigationStore } from '@/features/timeline/stores/composition-navigation-store';
import { useProjectStore } from '@/features/projects/stores/project-store';
import { proxyService } from '../services/proxy-service';
import { mediaLibraryService } from '../services/media-library-service';
import { validateMediaFile } from '../utils/validation';
import { getSharedProxyKey } from '../utils/proxy-key';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-muted transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
    </button>
  );
}

interface MediaLibraryProps {
  onMediaSelect?: (mediaId: string) => void;
}

export const MediaLibrary = memo(function MediaLibrary({ onMediaSelect }: MediaLibraryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isFocusedRef = useRef(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [idsToDelete, setIdsToDelete] = useState<string[]>([]);
  const [infoPanelDismissed, setInfoPanelDismissed] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(true);
  const [isDragging, setIsDragging] = useState(false);

  // Timeline store selectors - don't subscribe to items to avoid re-renders
  // Read items from store directly when needed (in delete handler)
  const removeTimelineItems = useTimelineStore((s) => s.removeItems);

  // Store selectors
  const currentProjectId = useMediaLibraryStore((s) => s.currentProjectId);
  const setCurrentProject = useMediaLibraryStore((s) => s.setCurrentProject);
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
  const mediaItems = useMediaLibraryStore((s) => s.mediaItems);
  const mediaById = useMediaLibraryStore((s) => s.mediaById);
  const clearSelection = useMediaLibraryStore((s) => s.clearSelection);
  const error = useMediaLibraryStore((s) => s.error);
  const errorLink = useMediaLibraryStore((s) => s.errorLink);
  const clearError = useMediaLibraryStore((s) => s.clearError);
  const notification = useMediaLibraryStore((s) => s.notification);
  const clearNotification = useMediaLibraryStore((s) => s.clearNotification);
  const brokenMediaIds = useMediaLibraryStore((s) => s.brokenMediaIds);
  const openMissingMediaDialog = useMediaLibraryStore((s) => s.openMissingMediaDialog);
  const projectStoreProjectId = useProjectStore((s) => s.currentProject?.id ?? null);
  const proxyStatus = useMediaLibraryStore((s) => s.proxyStatus);
  const proxyProgress = useMediaLibraryStore((s) => s.proxyProgress);

  // Composition navigation — show banner when inside a sub-comp
  const activeCompositionId = useCompositionNavigationStore((s) => s.activeCompositionId);
  const breadcrumbs = useCompositionNavigationStore((s) => s.breadcrumbs);
  const exitComposition = useCompositionNavigationStore((s) => s.exitComposition);
  const activeCompLabel = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 1]?.label : null;

  // Unsupported codec dialog state
  const unsupportedCodecFiles = useMediaLibraryStore((s) => s.unsupportedCodecFiles);
  const showUnsupportedCodecDialog = useMediaLibraryStore((s) => s.showUnsupportedCodecDialog);
  const resolveUnsupportedCodecDialog = useMediaLibraryStore((s) => s.resolveUnsupportedCodecDialog);

  // HMR recovery: if media store lost project context, rehydrate it from project store.
  useEffect(() => {
    if (!currentProjectId && projectStoreProjectId) {
      setCurrentProject(projectStoreProjectId);
    }
  }, [currentProjectId, projectStoreProjectId, setCurrentProject]);

  // Load media items on mount and when project changes.
  // We keep both paths because HMR can remount components without a project-id change.
  useEffect(() => {
    if (currentProjectId) {
      loadMediaItems();
    }
  }, [currentProjectId, loadMediaItems]);

  // Also load on mount specifically (handles HMR case where deps haven't changed)
  useEffect(() => {
    if (currentProjectId) {
      loadMediaItems();
    }
  }, []); // Intentionally empty - run only on mount

  // Reset info panel dismissed state when selection changes
  const prevSelectionRef = useRef<string[]>([]);
  useEffect(() => {
    const changed = selectedMediaIds.length !== prevSelectionRef.current.length ||
      selectedMediaIds.some((id, i) => id !== prevSelectionRef.current[i]);
    if (changed) {
      setInfoPanelDismissed(false);
      prevSelectionRef.current = selectedMediaIds;
    }
  }, [selectedMediaIds]);

  // Resolve the selected media item for the info panel (single selection only)
  const selectedMediaForInfo = useMemo(() => {
    if (selectedMediaIds.length !== 1 || infoPanelDismissed) return null;
    return mediaById[selectedMediaIds[0]!] ?? null;
  }, [selectedMediaIds, mediaById, infoPanelDismissed]);

  // Track focus and clear selection when clicking outside the media library
  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      const isInside = containerRef.current?.contains(event.target as Node);

      if (isInside) {
        // Clicked inside - mark as focused
        isFocusedRef.current = true;
      } else {
        // Clicked outside - clear focus and selection
        isFocusedRef.current = false;
        if (selectedMediaIds.length > 0) {
          clearSelection();
        }
      }
    };

    // Use capture phase to catch events before they're stopped by other handlers
    document.addEventListener('mousedown', handleMouseDown, true);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
    };
  }, [selectedMediaIds.length, clearSelection]);

  // Handle Delete key to delete selected items
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle Delete key
      if (event.key !== 'Delete') return;

      // Don't trigger if media library is not focused
      if (!isFocusedRef.current) return;

      // Don't trigger if no items selected
      if (selectedMediaIds.length === 0) return;

      // Don't trigger if dialog is already open
      if (showDeleteDialog) return;

      // Don't trigger if user is typing in an input or textarea
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Prevent default behavior and trigger delete
      event.preventDefault();
      setIdsToDelete([...selectedMediaIds]);
      setShowDeleteDialog(true);
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedMediaIds, showDeleteDialog]);

  // Import files using file picker (instant, no copy)
  const handleImport = async () => {
    try {
      await importMedia();
    } catch (error) {
      logger.error('Import failed:', error);
    }
  };

  // Import files from drag-drop handles - memoized to prevent MediaGrid re-renders
  const handleImportHandles = useCallback(async (handles: FileSystemFileHandle[]) => {
    try {
      await importHandles(handles);
    } catch (error) {
      logger.error('Import failed:', error);
    }
  }, [importHandles]);

  // Panel-level drag/drop handlers so the drop zone covers the full panel height.
  // Uses an enter/leave counter to avoid flicker when dragging over child elements.
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1 && !e.dataTransfer.types.includes('application/json')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    // Ignore media items being dragged from the grid itself
    try {
      const jsonData = e.dataTransfer.getData('application/json');
      if (jsonData) {
        const data = JSON.parse(jsonData);
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
      showNotification({ type: 'warning', message: 'Drag-drop not supported. Please use Google Chrome.' });
      return;
    }

    // Collect all handle promises SYNCHRONOUSLY before any await
    const items = Array.from(e.dataTransfer.items);
    const handlePromises: Promise<FileSystemHandle | null>[] = [];
    for (const item of items) {
      if ('getAsFileSystemHandle' in item) {
        handlePromises.push(item.getAsFileSystemHandle());
      }
    }

    const rawHandles = await Promise.all(handlePromises);

    const handles: FileSystemFileHandle[] = [];
    const errors: string[] = [];
    for (const handle of rawHandles) {
      if (handle?.kind === 'file') {
        try {
          const file = await (handle as FileSystemFileHandle).getFile();
          const validation = validateMediaFile(file);
          if (validation.valid) {
            handles.push(handle as FileSystemFileHandle);
          } else {
            errors.push(`${file.name}: ${validation.error}`);
          }
        } catch (error) {
          logger.warn('Failed to get file from handle:', error);
        }
      }
    }

    if (errors.length > 0) {
      showNotification({ type: 'error', message: `Some files were rejected: ${errors.join(', ')}` });
    }
    if (handles.length > 0) {
      await handleImportHandles(handles);
    }
  }, [showNotification, handleImportHandles]);

  // Count of items currently generating proxies
  const generatingCount = useMemo(() => {
    let count = 0;
    for (const status of proxyStatus.values()) {
      if (status === 'generating') count++;
    }
    return count;
  }, [proxyStatus]);

  // Average progress of all generating proxies
  const generatingAvgProgress = useMemo(() => {
    if (generatingCount === 0) return 0;
    let total = 0;
    let count = 0;
    for (const [id, status] of proxyStatus.entries()) {
      if (status === 'generating') {
        total += proxyProgress.get(id) ?? 0;
        count++;
      }
    }
    return count > 0 ? total / count : 0;
  }, [proxyStatus, proxyProgress, generatingCount]);

  const handleGenerateSelectedProxies = async () => {
    const selectedItems = selectedMediaIds
      .map((id) => mediaById[id])
      .filter((m): m is typeof mediaItems[number] =>
        m !== undefined
        && proxyService.needsProxy(m.width, m.height, m.mimeType, m.audioCodec)
        && proxyStatus.get(m.id) !== 'ready'
        && proxyStatus.get(m.id) !== 'generating'
      );
    const urls = await Promise.all(
      selectedItems.map((item) => mediaLibraryService.getMediaBlobUrl(item.id))
    );
    selectedItems.forEach((item, i) => {
      const blobUrl = urls[i];
      if (blobUrl) {
        const proxyKey = getSharedProxyKey(item);
        proxyService.setProxyKey(item.id, proxyKey);
        proxyService.generateProxy(item.id, blobUrl, item.width, item.height, proxyKey);
      }
    });
  };

  // Count selected items that are eligible for proxy generation
  const selectedProxyEligibleCount = useMemo(() => {
    return selectedMediaIds.filter((id) => {
      const m = mediaById[id];
      return m
        && proxyService.needsProxy(m.width, m.height, m.mimeType, m.audioCodec)
        && proxyStatus.get(id) !== 'ready'
        && proxyStatus.get(id) !== 'generating';
    }).length;
  }, [selectedMediaIds, mediaById, proxyStatus]);

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

              {/* Generate proxies for selection */}
              {selectedProxyEligibleCount > 0 && (
                <button
                  onClick={handleGenerateSelectedProxies}
                  className="flex items-center gap-1 h-7 px-2 rounded-md
                    text-muted-foreground hover:text-primary hover:bg-primary/10
                    transition-colors duration-150"
                  title="Generate proxies for selected"
                >
                  <Zap className="w-3 h-3" />
                  <span>Proxy ({selectedProxyEligibleCount})</span>
                </button>
              )}

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
            <div className="text-destructive leading-relaxed flex-1">
              <p>{error}</p>
              {errorLink && (
                <div className="mt-2 flex items-center gap-1.5">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground select-text">
                    {errorLink}
                  </code>
                  <CopyButton text={errorLink} />
                </div>
              )}
            </div>
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

      {/* Composition navigation banner — shown when inside a sub-composition */}
      {activeCompositionId !== null && activeCompLabel && (
        <div className="px-3 py-1.5 border-b border-violet-500/30 bg-violet-500/10 flex items-center gap-2 flex-shrink-0">
          <button
            onClick={exitComposition}
            className="flex items-center gap-1.5 text-xs text-violet-300 hover:text-violet-100 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>
          <span className="text-xs text-violet-400/60">/</span>
          <span className="text-xs text-violet-300 font-medium truncate">{activeCompLabel}</span>
        </div>
      )}

      {/* Scrollable content: wrapper provides relative context for the drag overlay */}
      <div className="flex-1 relative min-h-0">
        <div
          className="h-full overflow-y-auto px-4 pb-4 [scrollbar-gutter:stable]"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Compositions section — collapsible, auto-hidden when empty */}
          <CompositionsSection />

          {/* Media section — collapsible, matches compositions header style */}
          <Collapsible open={mediaOpen} onOpenChange={setMediaOpen}>
            <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 hover:bg-secondary/50 rounded-md px-2 -mx-2 transition-colors">
              <ChevronRight
                className={cn(
                  'w-3 h-3 text-muted-foreground transition-transform',
                  mediaOpen && 'rotate-90'
                )}
              />
              <Film className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
                Media
              </span>
              <span className="text-[10px] tabular-nums text-muted-foreground/60">
                {mediaItems.length}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-1 pb-2">
              <MediaGrid
                onMediaSelect={onMediaSelect}
                viewMode={viewMode}
              />
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* Drag overlay — absolute sibling, always covers the visible viewport */}
        {isDragging && (
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5 border-2 border-dashed border-primary z-50 flex items-center justify-center pointer-events-none">
            <div className="absolute top-2 left-2 w-6 h-6 border-l-2 border-t-2 border-primary" />
            <div className="absolute top-2 right-2 w-6 h-6 border-r-2 border-t-2 border-primary" />
            <div className="absolute bottom-2 left-2 w-6 h-6 border-l-2 border-b-2 border-primary" />
            <div className="absolute bottom-2 right-2 w-6 h-6 border-r-2 border-b-2 border-primary" />
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
            <div className="absolute inset-0 overflow-hidden">
              <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent animate-scan" />
            </div>
          </div>
        )}
      </div>

      {/* Proxy generation progress bar */}
      {generatingCount > 0 && (
        <div className="px-3 py-2 border-t border-border flex-shrink-0 bg-panel-bg/50">
          <div className="flex items-center gap-2 text-xs">
            <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-muted-foreground">
                  Generating {generatingCount} {generatingCount === 1 ? 'proxy' : 'proxies'}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {Math.round(generatingAvgProgress * 100)}%
                </span>
              </div>
              <div className="h-1 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full transition-all duration-300"
                  style={{ width: `${Math.round(generatingAvgProgress * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Media info panel - slides up from bottom when single item selected */}
      {selectedMediaForInfo && (
        <MediaInfoPanel
          key={selectedMediaForInfo.id}
          media={selectedMediaForInfo}
          onClose={() => setInfoPanelDismissed(true)}
        />
      )}

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

      {/* Orphaned Clips Dialog */}
      <OrphanedClipsDialog />

      {/* Unsupported Audio Codec Dialog */}
      <UnsupportedAudioCodecDialog
        open={showUnsupportedCodecDialog}
        files={unsupportedCodecFiles.map((f) => ({
          fileName: f.fileName,
          audioCodec: f.audioCodec,
        }))}
        onConfirm={() => resolveUnsupportedCodecDialog(true)}
        onCancel={() => resolveUnsupportedCodecDialog(false)}
      />
    </div>
  );
});
