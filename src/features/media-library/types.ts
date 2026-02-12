import type { MediaMetadata } from '@/types/storage';

export interface MediaLibraryNotification {
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

/**
 * Information about a file with an unsupported audio codec
 */
export interface UnsupportedCodecFile {
  fileName: string;
  audioCodec: string;
  handle: FileSystemFileHandle;
}

/**
 * Error types for media that cannot be accessed
 */
export type MediaErrorType =
  | 'permission_denied'  // File handle permission expired
  | 'file_missing'       // File moved or deleted from disk
  | 'metadata_deleted';  // Media metadata deleted from IndexedDB

/**
 * Information about a media file with a broken/invalid file handle
 */
export interface BrokenMediaInfo {
  mediaId: string;
  fileName: string;
  errorType: MediaErrorType;
}

/**
 * Information about a timeline clip that references deleted media
 */
export interface OrphanedClipInfo {
  itemId: string;           // Timeline item ID
  mediaId: string;          // Missing media ID
  itemType: 'video' | 'audio' | 'image';
  fileName: string;         // From item.label for matching
  trackId: string;
}

export interface MediaLibraryState {
  currentProjectId: string | null; // v3: Project context for scoped operations
  mediaItems: MediaMetadata[];
  isLoading: boolean;
  importingIds: string[]; // IDs of media items currently being imported
  error: string | null;
  notification: MediaLibraryNotification | null;
  selectedMediaIds: string[];
  searchQuery: string;
  filterByType: 'video' | 'audio' | 'image' | null;
  sortBy: 'name' | 'date' | 'size';
  viewMode: 'grid' | 'list';

  // Broken media tracking (lazy detection)
  brokenMediaIds: string[];
  brokenMediaInfo: Map<string, BrokenMediaInfo>;
  showMissingMediaDialog: boolean;

  // Orphaned clips tracking (clips referencing deleted media)
  orphanedClips: OrphanedClipInfo[];
  showOrphanedClipsDialog: boolean;

  // Unsupported audio codec confirmation
  unsupportedCodecFiles: UnsupportedCodecFile[];
  showUnsupportedCodecDialog: boolean;
  unsupportedCodecResolver: ((confirmed: boolean) => void) | null;

  // Proxy video generation
  proxyStatus: Map<string, 'generating' | 'ready' | 'error'>;
  proxyProgress: Map<string, number>;
}

export interface MediaLibraryActions {
  // v3: Project context
  setCurrentProject: (projectId: string | null) => void;

  // CRUD Operations (project-scoped in v3)
  loadMediaItems: () => Promise<void>;
  /**
   * Import media using file picker (instant, no copy - local-first)
   * Uses FileSystemFileHandle to reference files directly on user's disk
   */
  importMedia: () => Promise<MediaMetadata[]>;
  /**
   * Import media from file handles (for drag-drop)
   * Uses FileSystemFileHandle directly without file picker
   */
  importHandles: (handles: FileSystemFileHandle[]) => Promise<MediaMetadata[]>;
  deleteMedia: (id: string) => Promise<void>;
  deleteMediaBatch: (ids: string[]) => Promise<void>;

  // Selection
  selectMedia: (ids: string[]) => void;
  toggleMediaSelection: (id: string) => void;
  clearSelection: () => void;

  // Filters & Search
  setSearchQuery: (query: string) => void;
  setFilterByType: (type: 'video' | 'audio' | 'image' | null) => void;
  setSortBy: (sortBy: 'name' | 'date' | 'size') => void;
  setViewMode: (viewMode: 'grid' | 'list') => void;

  // Utility
  clearError: () => void;
  showNotification: (notification: MediaLibraryNotification) => void;
  clearNotification: () => void;

  // Broken media / Relinking
  markMediaBroken: (id: string, info: BrokenMediaInfo) => void;
  markMediaHealthy: (id: string) => void;
  relinkMedia: (mediaId: string, newHandle: FileSystemFileHandle) => Promise<boolean>;
  relinkMediaBatch: (
    relinks: Array<{ mediaId: string; handle: FileSystemFileHandle }>
  ) => Promise<{ success: string[]; failed: string[] }>;
  openMissingMediaDialog: () => void;
  closeMissingMediaDialog: () => void;

  // Orphaned clips management
  setOrphanedClips: (clips: OrphanedClipInfo[]) => void;
  clearOrphanedClips: () => void;
  openOrphanedClipsDialog: () => void;
  closeOrphanedClipsDialog: () => void;
  /**
   * Relink an orphaned clip to a different media item from the library.
   * Updates the clip's mediaId, label, and source dimensions.
   */
  relinkOrphanedClip: (itemId: string, newMediaId: string) => Promise<boolean>;
  /**
   * Remove orphaned clips from the timeline.
   */
  removeOrphanedClips: (itemIds: string[]) => void;

  // Unsupported audio codec dialog
  /**
   * Show the unsupported codec dialog and wait for user response.
   * Returns a promise that resolves to true if user confirms, false if cancelled.
   */
  confirmUnsupportedCodecs: (files: UnsupportedCodecFile[]) => Promise<boolean>;
  resolveUnsupportedCodecDialog: (confirmed: boolean) => void;

  // Proxy video generation
  setProxyStatus: (mediaId: string, status: 'generating' | 'ready' | 'error') => void;
  setProxyProgress: (mediaId: string, progress: number) => void;
}
