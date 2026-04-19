import { useEffect, useRef, useState, useMemo, memo, useCallback } from 'react';
import { Search, Filter, SortAsc, Video, FileAudio, Image as ImageIcon, Trash2, Grid3x3, List, AlertTriangle, Info, X, FolderOpen, Link2Off, ChevronRight, Film, ArrowLeft, Zap, Loader2, Copy, Check, Upload, Sparkles, FileText, ScanSearch } from 'lucide-react';
import { SceneBrowserPanel, useSceneBrowserStore } from '../deps/scene-browser';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('MediaLibrary');
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { MarqueeOverlay } from '@/components/marquee-overlay';
import { cn } from '@/shared/ui/cn';
import { MediaGrid } from './media-grid';
import { CompositionsSection } from './compositions-section';
import { BackgroundTaskProgress } from './background-task-progress';
import { MissingMediaDialog } from './missing-media-dialog';
import { OrphanedClipsDialog } from './orphaned-clips-dialog';
import { UnsupportedAudioCodecDialog } from './unsupported-audio-codec-dialog';
import { useFilteredMediaItems, useMediaLibraryStore } from '../stores/media-library-store';
import {
  deleteCompoundClips,
  getCompoundClipDeletionImpact,
  getMediaDeletionImpact,
  removeProjectItems,
  useCompositionsStore,
  useCompositionNavigationStore,
} from '@/features/media-library/deps/timeline-stores';
import { useProjectStore } from '@/features/media-library/deps/projects';
import { proxyService } from '../services/proxy-service';
import { mediaLibraryService } from '../services/media-library-service';
import { mediaTranscriptionService } from '../services/media-transcription-service';
import { mediaAnalysisService } from '../services/media-analysis-service';
import { extractValidMediaFileEntriesFromDataTransfer } from '../utils/file-drop';
import { getSharedProxyKey } from '../utils/proxy-key';
import { getMediaType } from '../utils/validation';
import { getProjectBrokenMediaIds } from '@/features/media-library/utils/broken-media';
import {
  getTranscriptionOverallProgress,
  getTranscriptionStageLabel,
} from '@/shared/utils/transcription-progress';
import type { MediaMetadata } from '@/types/storage';
import { isMarqueeJustFinished, useMarqueeSelection, type MarqueeItem } from '@/hooks/use-marquee-selection';

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

function HeaderActionTooltip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

const GROUP_ICONS = {
  video: Video,
  audio: FileAudio,
  image: ImageIcon,
  gif: Film,
} as const;

interface MediaTypeGroupProps {
  groupKey: string;
  label: string;
  icon: keyof typeof GROUP_ICONS;
  items: MediaMetadata[];
  isOpen: boolean;
  onToggle: (key: string, open: boolean) => void;
  onMediaSelect?: (mediaId: string) => void;
  viewMode: 'grid' | 'list';
  itemSize: number;
}

const MediaTypeGroup = memo(function MediaTypeGroup({
  groupKey, label, icon, items, isOpen, onToggle, onMediaSelect, viewMode, itemSize,
}: MediaTypeGroupProps) {
  const Icon = GROUP_ICONS[icon];
  return (
    <Collapsible open={isOpen} onOpenChange={(open) => onToggle(groupKey, open)}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full py-2 hover:bg-secondary/50 rounded-md px-2 -mx-2 transition-colors">
        <ChevronRight
          className={cn(
            'w-3 h-3 text-muted-foreground transition-transform',
            isOpen && 'rotate-90'
          )}
        />
        <Icon className="w-3 h-3 text-muted-foreground" />
        <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
          {label}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground/60">
          {items.length}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1 pb-2">
        <MediaGrid
          items={items}
          onMediaSelect={onMediaSelect}
          viewMode={viewMode}
          itemSize={itemSize}
        />
      </CollapsibleContent>
    </Collapsible>
  );
});

interface MediaLibraryProps {
  onMediaSelect?: (mediaId: string) => void;
}

interface PendingLibraryDeletion {
  mediaIds: string[];
  compositionIds: string[];
}

export const MediaLibrary = memo(function MediaLibrary({ onMediaSelect }: MediaLibraryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isFocusedRef = useRef(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState<PendingLibraryDeletion>({ mediaIds: [], compositionIds: [] });
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(['video', 'audio', 'image', 'gif']));
  const [isDragging, setIsDragging] = useState(false);

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
  const sceneBrowserOpen = useSceneBrowserStore((s) => s.open);
  const toggleSceneBrowser = useSceneBrowserStore((s) => s.toggleBrowser);
  const mediaItemSize = useMediaLibraryStore((s) => s.mediaItemSize);
  const setMediaItemSize = useMediaLibraryStore((s) => s.setMediaItemSize);
  const selectedMediaIds = useMediaLibraryStore((s) => s.selectedMediaIds);
  const selectedCompositionIds = useMediaLibraryStore((s) => s.selectedCompositionIds);
  const setSelection = useMediaLibraryStore((s) => s.setSelection);
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
  const transcriptStatus = useMediaLibraryStore((s) => s.transcriptStatus);
  const transcriptProgress = useMediaLibraryStore((s) => s.transcriptProgress);
  const filteredMediaItems = useFilteredMediaItems();
  const mediaGroups = useMemo(() => {
    const groups: { key: string; label: string; icon: 'video' | 'audio' | 'image' | 'gif'; items: MediaMetadata[] }[] = [];
    const videos: MediaMetadata[] = [];
    const audio: MediaMetadata[] = [];
    const gifs: MediaMetadata[] = [];
    const images: MediaMetadata[] = [];
    for (const item of filteredMediaItems) {
      if (item.mimeType === 'image/gif') {
        gifs.push(item);
      } else {
        const t = getMediaType(item.mimeType);
        if (t === 'video') videos.push(item);
        else if (t === 'audio') audio.push(item);
        else images.push(item);
      }
    }
    if (videos.length > 0) groups.push({ key: 'video', label: 'Videos', icon: 'video', items: videos });
    if (audio.length > 0) groups.push({ key: 'audio', label: 'Audio', icon: 'audio', items: audio });
    if (images.length > 0) groups.push({ key: 'image', label: 'Images', icon: 'image', items: images });
    if (gifs.length > 0) groups.push({ key: 'gif', label: 'GIFs', icon: 'gif', items: gifs });
    return groups;
  }, [filteredMediaItems]);
  const compositions = useCompositionsStore((s) => s.compositions);

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
      void loadMediaItems().catch((error) => {
        logger.error('Failed to load media library during store recovery:', error);
      });
    }
  }, [currentProjectId, loadMediaItems, projectStoreProjectId, setCurrentProject]);

  const selectedAssetCount = selectedMediaIds.length + selectedCompositionIds.length;
  const deleteAssetCount = pendingDeletion.mediaIds.length + pendingDeletion.compositionIds.length;
  const previewAssetIdsRef = useRef<string[]>([]);

  const setPreviewAssetIds = useCallback((ids: string[]) => {
    const container = scrollContainerRef.current;
    if (!container) {
      previewAssetIdsRef.current = ids;
      return;
    }

    const nextIds = new Set(ids);
    for (const previousId of previewAssetIdsRef.current) {
      if (nextIds.has(previousId)) {
        continue;
      }

      if (previousId.startsWith('media:')) {
        container
          .querySelector(`[data-media-id="${previousId.slice('media:'.length)}"]`)
          ?.classList.remove('media-marquee-preview');
      } else if (previousId.startsWith('composition:')) {
        container
          .querySelector(`[data-composition-id="${previousId.slice('composition:'.length)}"]`)
          ?.classList.remove('composition-marquee-preview');
      }
    }

    const previousIds = new Set(previewAssetIdsRef.current);
    for (const id of ids) {
      if (previousIds.has(id)) {
        continue;
      }

      if (id.startsWith('media:')) {
        container
          .querySelector(`[data-media-id="${id.slice('media:'.length)}"]`)
          ?.classList.add('media-marquee-preview');
      } else if (id.startsWith('composition:')) {
        container
          .querySelector(`[data-composition-id="${id.slice('composition:'.length)}"]`)
          ?.classList.add('composition-marquee-preview');
      }
    }

    previewAssetIdsRef.current = ids;
  }, []);

  useEffect(() => {
    return () => {
      setPreviewAssetIds([]);
    };
  }, [setPreviewAssetIds]);

  const marqueeItems: MarqueeItem[] = useMemo(
    () => [
      ...compositions.map((composition) => ({
        id: `composition:${composition.id}`,
        getBoundingRect: () => {
          const element = scrollContainerRef.current?.querySelector(`[data-composition-id="${composition.id}"]`);
          if (!element) return null;
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
      ...filteredMediaItems.map((media) => ({
        id: `media:${media.id}`,
        getBoundingRect: () => {
          const element = scrollContainerRef.current?.querySelector(`[data-media-id="${media.id}"]`);
          if (!element) return null;
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
    ],
    [compositions, filteredMediaItems]
  );

  const { marqueeState } = useMarqueeSelection({
    containerRef: scrollContainerRef as React.RefObject<HTMLElement>,
    items: marqueeItems,
    enabled: marqueeItems.length > 0,
    onPreviewSelectionChange: setPreviewAssetIds,
    commitSelectionOnMouseUp: true,
    liveCommitThrottleMs: 66,
    onSelectionChange: (ids) => {
      const nextMediaIds: string[] = [];
      const nextCompositionIds: string[] = [];

      for (const id of ids) {
        if (id.startsWith('media:')) {
          nextMediaIds.push(id.slice('media:'.length));
        } else if (id.startsWith('composition:')) {
          nextCompositionIds.push(id.slice('composition:'.length));
        }
      }

      setSelection({ mediaIds: nextMediaIds, compositionIds: nextCompositionIds });
    },
  });

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
        if (selectedAssetCount > 0) {
          clearSelection();
        }
      }
    };

    // Use capture phase to catch events before they're stopped by other handlers
    document.addEventListener('mousedown', handleMouseDown, true);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
    };
  }, [selectedAssetCount, clearSelection]);

  // Handle Delete key to delete selected items
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle Delete key
      if (event.key !== 'Delete') return;

      // Don't trigger if media library is not focused
      if (!isFocusedRef.current) return;

      // Don't trigger if no items selected
      if (selectedAssetCount === 0) return;

      // Don't trigger if dialog is already open
      if (showDeleteDialog) return;

      // Don't trigger if user is typing in an input or textarea
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Prevent default behavior and trigger delete
      event.preventDefault();
      setPendingDeletion({
        mediaIds: [...selectedMediaIds],
        compositionIds: [...selectedCompositionIds],
      });
      setShowDeleteDialog(true);
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedAssetCount, selectedCompositionIds, selectedMediaIds, showDeleteDialog]);

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
        if (data.type === 'media-item' || data.type === 'media-items' || data.type === 'composition') {
          return;
        }
      }
    } catch {
      // Not JSON data, continue with file handling
    }

    const { supported, entries, errors } = await extractValidMediaFileEntriesFromDataTransfer(e.dataTransfer);
    if (!supported) {
      showNotification({ type: 'warning', message: 'Drag-drop not supported in this browser. Use Chrome or Edge.' });
      return;
    }

    if (errors.length > 0) {
      showNotification({ type: 'error', message: `Some files were rejected: ${errors.join(', ')}` });
    }
    if (entries.length > 0) {
      await handleImportHandles(entries.map((entry) => entry.handle));
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

  const analysisProgress = useMediaLibraryStore((s) => s.analysisProgress);
  const analysisPercent = analysisProgress && analysisProgress.total > 0
    ? (analysisProgress.completed / analysisProgress.total) * 100
    : 0;

  const transcribingCount = useMemo(() => {
    let count = 0;
    for (const status of transcriptStatus.values()) {
      if (status === 'queued' || status === 'transcribing') count++;
    }
    return count;
  }, [transcriptStatus]);

  const currentProjectBrokenMediaIds = useMemo(
    () => getProjectBrokenMediaIds(brokenMediaIds, mediaById),
    [brokenMediaIds, mediaById]
  );

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

  const transcribingAvgProgress = useMemo(() => {
    if (transcribingCount === 0) return 0;
    let total = 0;
    let count = 0;
    for (const [id, status] of transcriptStatus.entries()) {
      if (status === 'queued' || status === 'transcribing') {
        const progress = transcriptProgress.get(id);
        total += progress ? getTranscriptionOverallProgress(progress) : 0;
        count++;
      }
    }
    return count > 0 ? total / count : 0;
  }, [transcriptStatus, transcriptProgress, transcribingCount]);

  const singleTranscriptionStageLabel = useMemo(() => {
    if (transcribingCount !== 1) return null;
    for (const [id, status] of transcriptStatus.entries()) {
      if (status === 'queued' || status === 'transcribing') {
        const progress = transcriptProgress.get(id);
        return progress ? getTranscriptionStageLabel(progress.stage) : null;
      }
    }
    return null;
  }, [transcriptStatus, transcriptProgress, transcribingCount]);

  const handleGenerateSelectedProxies = async () => {
    const selectedItems = selectedMediaIds
      .map((id) => mediaById[id])
      .filter((m): m is MediaMetadata =>
        m !== undefined
        && proxyService.canGenerateProxy(m.mimeType)
        && proxyStatus.get(m.id) !== 'ready'
        && proxyStatus.get(m.id) !== 'generating'
      );

    selectedItems.forEach((item) => {
      const proxyKey = getSharedProxyKey(item);
      proxyService.setProxyKey(item.id, proxyKey);
      proxyService.generateProxy(
        item.id,
        item.storageType === 'opfs' && item.opfsPath
          ? { kind: 'opfs', path: item.opfsPath, mimeType: item.mimeType }
          : () => mediaLibraryService.getMediaFile(item.id),
        item.width,
        item.height,
        proxyKey
      );
    });
  };

  const handleCancelAllProxies = () => {
    for (const [mediaId, status] of proxyStatus.entries()) {
      if (status !== 'generating') {
        continue;
      }

      const media = mediaById[mediaId];
      proxyService.cancelProxy(mediaId, media ? getSharedProxyKey(media) : undefined);
    }
  };

  const handleCancelAllTranscriptions = () => {
    for (const [mediaId, status] of transcriptStatus.entries()) {
      if (status !== 'queued' && status !== 'transcribing') {
        continue;
      }

      mediaTranscriptionService.cancelTranscription(mediaId);
    }
  };

  // Count selected items that are eligible for proxy generation
  const selectedProxyEligibleCount = useMemo(() => {
    return selectedMediaIds.filter((id) => {
      const m = mediaById[id];
      return m
        && proxyService.canGenerateProxy(m.mimeType)
        && proxyStatus.get(id) !== 'ready'
        && proxyStatus.get(id) !== 'generating';
    }).length;
  }, [selectedMediaIds, mediaById, proxyStatus]);

  const deleteSummary = useMemo(() => {
    const parts: string[] = [];
    if (pendingDeletion.mediaIds.length > 0) {
      parts.push(`${pendingDeletion.mediaIds.length} media item${pendingDeletion.mediaIds.length === 1 ? '' : 's'}`);
    }
    if (pendingDeletion.compositionIds.length > 0) {
      parts.push(`${pendingDeletion.compositionIds.length} compound clip${pendingDeletion.compositionIds.length === 1 ? '' : 's'}`);
    }
    return parts.join(' and ');
  }, [pendingDeletion.compositionIds.length, pendingDeletion.mediaIds.length]);

  const affectedMediaImpact = useMemo(() => (
    pendingDeletion.mediaIds.length > 0
      ? getMediaDeletionImpact(pendingDeletion.mediaIds)
      : { itemIds: [], rootReferenceCount: 0, nestedReferenceCount: 0, totalReferenceCount: 0 }
  ), [pendingDeletion.mediaIds]);
  const compoundClipDeleteImpact = useMemo(() => (
    pendingDeletion.compositionIds.length > 0
      ? getCompoundClipDeletionImpact(pendingDeletion.compositionIds)
      : { rootReferenceCount: 0, nestedReferenceCount: 0, totalReferenceCount: 0 }
  ), [pendingDeletion.compositionIds]);
  const affectedAssetInstanceCount = affectedMediaImpact.totalReferenceCount + compoundClipDeleteImpact.totalReferenceCount;

  const handleDeleteSelected = () => {
    if (selectedAssetCount === 0) return;
    // Capture the IDs BEFORE opening dialog (selection may be cleared by click outside)
    setPendingDeletion({
      mediaIds: [...selectedMediaIds],
      compositionIds: [...selectedCompositionIds],
    });
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = async () => {
    setShowDeleteDialog(false);
    try {
      // First remove timeline items that reference selected library assets
      if (affectedMediaImpact.itemIds.length > 0) {
        removeProjectItems(affectedMediaImpact.itemIds);
      }

      if (pendingDeletion.mediaIds.length > 0) {
        await deleteMediaBatch(pendingDeletion.mediaIds);
      }

      if (pendingDeletion.compositionIds.length > 0) {
        deleteCompoundClips(pendingDeletion.compositionIds);
      }

      clearSelection();
      setPendingDeletion({ mediaIds: [], compositionIds: [] });
    } catch (error) {
      logger.error('Delete failed:', error);
      setPendingDeletion({ mediaIds: [], compositionIds: [] });
    }
  };

  const handleScrollContentClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (isMarqueeJustFinished()) return;

    const target = event.target as HTMLElement;
    if (!target.closest('[data-media-id], [data-composition-id]')) {
      clearSelection();
    }
  }, [clearSelection]);

  return (
    <div ref={containerRef} className="h-full flex flex-col">
      {/* Header toolbar */}
      <div className="@container px-3 py-2 border-b border-border flex-shrink-0">
        <TooltipProvider>
          <div className="flex flex-wrap items-center gap-2 text-xs min-w-0">
            {/* Import action */}
            <HeaderActionTooltip label="Import media files">
              <button
                onClick={handleImport}
                disabled={!currentProjectId}
                className="flex items-center gap-1.5 h-7 px-2.5 rounded-md shrink-0
                  bg-primary text-primary-foreground
                  hover:bg-primary/90
                  disabled:opacity-40 disabled:cursor-not-allowed
                  transition-colors duration-150"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span className="hidden @[220px]:inline">Import</span>
              </button>
            </HeaderActionTooltip>

            {/* Scene browser view toggle — lives here with Import (not in
                the filter row) because it switches the whole panel between
                media-library and scene-captioner views; the search/filter
                bar below only scopes whichever view is mounted. */}
            <HeaderActionTooltip label="Search scenes (Ctrl+Shift+F)">
              <button
                onClick={toggleSceneBrowser}
                className={cn(
                  'flex items-center gap-1.5 h-7 px-2.5 rounded-md shrink-0 border transition-colors duration-150',
                  sceneBrowserOpen
                    ? 'bg-primary/10 border-primary/40 text-primary'
                    : 'bg-secondary border-border text-muted-foreground hover:text-foreground hover:bg-foreground/5',
                )}
                aria-pressed={sceneBrowserOpen}
              >
                <ScanSearch className="w-3.5 h-3.5" />
                <span className="hidden @[260px]:inline">Scenes</span>
              </button>
            </HeaderActionTooltip>

            {/* Missing media indicator */}
            {currentProjectBrokenMediaIds.length > 0 && (
              <HeaderActionTooltip label={`View ${currentProjectBrokenMediaIds.length} missing media file${currentProjectBrokenMediaIds.length === 1 ? '' : 's'}`}>
                <button
                  onClick={openMissingMediaDialog}
                  className="flex items-center gap-1.5 h-7 px-2.5 rounded-md shrink-0
                    bg-destructive/10 border border-destructive/25 text-destructive
                    hover:bg-destructive/20 hover:border-destructive/40
                    transition-colors duration-150"
                >
                  <Link2Off className="w-3.5 h-3.5" />
                  <span className="hidden @[250px]:inline">{currentProjectBrokenMediaIds.length} Missing</span>
                </button>
              </HeaderActionTooltip>
            )}


            {/* Selection indicator & actions */}
            {selectedAssetCount > 0 && (
              <>
                <div className="h-4 w-px bg-border hidden @[240px]:block" />

                {/* Selection badge */}
                <div className="flex items-center gap-1 h-7 pl-2 pr-1 rounded-md bg-accent/50 border border-border min-w-0 max-w-full">
                  <span className="tabular-nums shrink-0">{selectedAssetCount}</span>
                  <span className="text-muted-foreground hidden @[260px]:inline">selected</span>
                  <HeaderActionTooltip label="Clear selection">
                    <button
                      onClick={clearSelection}
                      className="ml-0.5 p-1 rounded hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </HeaderActionTooltip>
                </div>

                {/* Generate proxies for selection */}
                {selectedProxyEligibleCount > 0 && (
                  <HeaderActionTooltip label={`Generate proxies for ${selectedProxyEligibleCount} selected item${selectedProxyEligibleCount === 1 ? '' : 's'}`}>
                    <button
                      onClick={handleGenerateSelectedProxies}
                      className="flex items-center gap-1 h-7 px-2 rounded-md shrink-0
                        text-muted-foreground hover:text-primary hover:bg-primary/10
                        transition-colors duration-150"
                    >
                      <Zap className="w-3 h-3" />
                      <span className="hidden @[320px]:inline">Proxy ({selectedProxyEligibleCount})</span>
                    </button>
                  </HeaderActionTooltip>
                )}

                {/* Delete action */}
                <HeaderActionTooltip label="Delete selected assets">
                  <button
                    onClick={handleDeleteSelected}
                    className="flex items-center gap-1 h-7 px-2 rounded-md shrink-0
                      text-destructive/80 hover:text-destructive hover:bg-destructive/10
                      transition-colors duration-150"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span className="hidden @[280px]:inline">Delete</span>
                  </button>
                </HeaderActionTooltip>
              </>
            )}
          </div>
        </TooltipProvider>
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

      {/* Search and filters — hidden in Scene mode since they only scope
          the media library grid; the scene browser has its own search. */}
      {!sceneBrowserOpen && (
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
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Filters and sort */}
        <div className="@container flex items-center gap-1.5 min-w-0">
          {/* Filter by type */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={`h-6 bg-secondary border text-[10px] px-2 flex-shrink-0 ${
                  filterByType
                    ? 'border-primary text-primary hover:bg-primary/10'
                    : 'border-border text-muted-foreground hover:border-primary/50 hover:text-primary'
                }`}
              >
                <Filter className="w-2.5 h-2.5" />
                <span className="hidden @[280px]:inline ml-1">
                  {filterByType ? filterByType.toUpperCase() : 'ALL'}
                </span>
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
                className="h-6 bg-secondary border border-border text-muted-foreground hover:border-primary/50 hover:text-primary text-[10px] px-2 flex-shrink-0"
              >
                <SortAsc className="w-2.5 h-2.5" />
                <span className="hidden @[280px]:inline ml-1">
                  {sortBy === 'name' ? 'NAME' : sortBy === 'date' ? 'DATE' : 'SIZE'}
                </span>
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

          {/* View mode toggle + item size */}
          <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
            {viewMode === 'grid' && (
              <Slider
                min={1}
                max={5}
                step={1}
                value={[mediaItemSize]}
                onValueChange={([v]) => setMediaItemSize(v ?? 3)}
                className="flex-1 min-w-6 max-w-24"
                aria-label="Grid item size"
              />
            )}
            <div className="flex items-center border border-border rounded bg-secondary flex-shrink-0">
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
      </div>
      )}

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
        {sceneBrowserOpen && <SceneBrowserPanel className="absolute inset-0 bg-background" />}
        <div
          ref={scrollContainerRef}
          className={cn(
            'relative h-full overflow-y-auto px-4 pb-4 [scrollbar-gutter:stable]',
            sceneBrowserOpen && 'hidden',
          )}
          onClick={handleScrollContentClick}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <MarqueeOverlay marqueeState={marqueeState} />

          {/* Compositions section — collapsible, auto-hidden when empty */}
          <CompositionsSection />

          {/* Media sections — grouped by type */}
          {mediaGroups.map((group) => (
            <MediaTypeGroup
              key={group.key}
              groupKey={group.key}
              label={group.label}
              icon={group.icon}
              items={group.items}
              isOpen={openGroups.has(group.key)}
              onToggle={(key, open) => setOpenGroups((prev) => {
                const next = new Set(prev);
                if (open) next.add(key);
                else next.delete(key);
                return next;
              })}
              onMediaSelect={onMediaSelect}
              viewMode={viewMode}
              itemSize={mediaItemSize}
            />
          ))}

          {/* Loading / empty state when no groups to show */}
          {mediaGroups.length === 0 && (
            <MediaGrid
              onMediaSelect={onMediaSelect}
              viewMode={viewMode}
              itemSize={mediaItemSize}
            />
          )}
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

      {/* Background AI analysis status */}
      {analysisProgress && (
        <BackgroundTaskProgress
          icon={<Loader2 className="w-3.5 h-3.5 text-purple-400 animate-spin flex-shrink-0" />}
          label={
            analysisProgress.total > 1
              ? `Analyzing ${Math.min(analysisProgress.completed + 1, analysisProgress.total)} of ${analysisProgress.total} with AI`
              : 'Analyzing 1 item with AI'
          }
          progressAriaLabel="AI analysis progress"
          progressPercent={analysisPercent}
          meta={(
            <>
              <span className="tabular-nums">{Math.round(analysisPercent)}%</span>
              {!analysisProgress.cancelRequested ? (
                <button
                  type="button"
                  onClick={() => mediaAnalysisService.requestCancel()}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              ) : (
                <span className="text-muted-foreground/80">Cancelling…</span>
              )}
            </>
          )}
          trailing={<Sparkles className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />}
          fillClassName="bg-purple-500"
        />
      )}

      {/* Transcript generation progress bar */}
      {transcribingCount > 0 && (
        <BackgroundTaskProgress
          icon={<FileText className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />}
          label={`Generating ${transcribingCount} ${transcribingCount === 1 ? 'transcript' : 'transcripts'} in background`}
          progressAriaLabel="Transcript generation progress"
          progressPercent={transcribingAvgProgress * 100}
          meta={(
            <>
              {singleTranscriptionStageLabel && (
                <span className="hidden sm:inline truncate">
                  {singleTranscriptionStageLabel}
                </span>
              )}
              <span className="tabular-nums">
                {Math.round(transcribingAvgProgress * 100)}%
              </span>
              <button
                type="button"
                onClick={handleCancelAllTranscriptions}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel all
              </button>
            </>
          )}
          fillClassName="bg-blue-500"
        />
      )}

      {/* Proxy generation progress bar */}
      {generatingCount > 0 && (
        <BackgroundTaskProgress
          icon={<Loader2 className="w-3.5 h-3.5 text-green-500 animate-spin flex-shrink-0" />}
          label={`Generating ${generatingCount} ${generatingCount === 1 ? 'proxy' : 'proxies'} in background`}
          progressAriaLabel="Proxy generation progress"
          progressPercent={generatingAvgProgress * 100}
          meta={(
            <>
              <span className="tabular-nums">
                {Math.round(generatingAvgProgress * 100)}%
              </span>
              <button
                type="button"
                onClick={handleCancelAllProxies}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel all
              </button>
            </>
          )}
          fillClassName="bg-green-500"
        />
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={showDeleteDialog}
        onOpenChange={(open) => {
          setShowDeleteDialog(open);
          if (!open) {
            setPendingDeletion({ mediaIds: [], compositionIds: [] });
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected assets?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Are you sure you want to delete {deleteSummary || `${deleteAssetCount} selected asset${deleteAssetCount === 1 ? '' : 's'}`}?
                  This action cannot be undone.
                </p>
                {affectedAssetInstanceCount > 0 && (
                  <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-md">
                    <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-yellow-600 dark:text-yellow-400">
                      <p className="font-medium">Linked instances will be removed</p>
                      <p className="text-xs mt-1 text-yellow-600/80 dark:text-yellow-400/80">
                        {affectedAssetInstanceCount} clip{affectedAssetInstanceCount > 1 ? 's' : ''} across the timeline and nested compound clips reference these assets and will also be deleted.
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
              Delete {deleteSummary || `${deleteAssetCount} asset${deleteAssetCount === 1 ? '' : 's'}`}{affectedAssetInstanceCount > 0 ? ` & ${affectedAssetInstanceCount} clip${affectedAssetInstanceCount > 1 ? 's' : ''}` : ''}
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
