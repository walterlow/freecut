import { describe, expect, it, beforeEach, vi, type Mock } from 'vitest';
import { createRelinkingActions } from './media-relinking-actions';
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager';
import type { MediaLibraryState, MediaLibraryActions, BrokenMediaInfo } from '../types';
import type { MediaMetadata } from '@/types/storage';

// Mock external dependencies
vi.mock('../services/media-library-service', () => ({
  mediaLibraryService: {
    relinkMediaHandle: vi.fn(),
    getMedia: vi.fn(),
  },
}));

vi.mock('@/features/media-library/deps/timeline-actions', () => ({
  removeItems: vi.fn(),
  updateItem: vi.fn(),
}));

vi.mock('@/features/media-library/deps/timeline-stores', () => ({
  useTimelineSettingsStore: {
    getState: () => ({ fps: 30 }),
  },
}));

// Import after mocks
import { mediaLibraryService } from '../services/media-library-service';

// Helpers
type RelinkingState = Partial<MediaLibraryState> & Partial<MediaLibraryActions>;
type RelinkingUpdater =
  | Partial<MediaLibraryState>
  | ((state: MediaLibraryState & MediaLibraryActions) => Partial<MediaLibraryState>);

function createMockMediaMetadata(id: string, fileName: string): MediaMetadata {
  return {
    id,
    storageType: 'handle',
    fileName,
    fileSize: 1,
    mimeType: fileName.endsWith('.mp3') ? 'audio/mpeg' : 'video/mp4',
    duration: 1,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'h264',
    bitrate: 1,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function applyStateUpdate(
  state: RelinkingState,
  updater: RelinkingUpdater
): RelinkingState {
  if (typeof updater === 'function') {
    return {
      ...state,
      ...updater(state as MediaLibraryState & MediaLibraryActions),
    };
  }

  return { ...state, ...updater };
}

function createMockState(): MediaLibraryState & MediaLibraryActions {
  const state: RelinkingState = {
    mediaItems: [
      createMockMediaMetadata('media-1', 'video.mp4'),
      createMockMediaMetadata('media-2', 'audio.mp3'),
    ],
    brokenMediaIds: ['media-1'],
    brokenMediaInfo: new Map([
      [
        'media-1',
        { mediaId: 'media-1', fileName: 'video.mp4', errorType: 'file_missing' } as BrokenMediaInfo,
      ],
    ]),
    showNotification: vi.fn(),
    markMediaHealthy: vi.fn(),
    showMissingMediaDialog: false,
    orphanedClips: [],
    showOrphanedClipsDialog: false,
  };
  return state as MediaLibraryState & MediaLibraryActions;
}

let blobUrlCounter = 0;

beforeEach(() => {
  vi.clearAllMocks();
  blobUrlManager.releaseAll();
  blobUrlCounter = 0;

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => `blob:test-${++blobUrlCounter}`,
    revokeObjectURL: vi.fn(),
  });
});

describe('createRelinkingActions', () => {
  describe('markMediaBroken', () => {
    it('adds a media ID to brokenMediaIds', () => {
      let currentState: RelinkingState = {
        brokenMediaIds: [],
        brokenMediaInfo: new Map<string, BrokenMediaInfo>(),
      };
      const set = vi.fn((updater: RelinkingUpdater) => {
        currentState = applyStateUpdate(currentState, updater);
      });
      const get = vi.fn(() => currentState as MediaLibraryState & MediaLibraryActions);

      const actions = createRelinkingActions(set, get);
      actions.markMediaBroken('media-1', {
        mediaId: 'media-1',
        fileName: 'video.mp4',
        errorType: 'file_missing',
      });

      expect(set).toHaveBeenCalled();
      expect(currentState.brokenMediaIds).toContain('media-1');
      expect(currentState.brokenMediaInfo.has('media-1')).toBe(true);
    });

    it('is idempotent â€” does not duplicate entries', () => {
      let currentState: RelinkingState = {
        brokenMediaIds: ['media-1'],
        brokenMediaInfo: new Map([
          ['media-1', { mediaId: 'media-1', fileName: 'video.mp4', errorType: 'file_missing' }],
        ]),
      };
      const set = vi.fn((updater: RelinkingUpdater) => {
        currentState = applyStateUpdate(currentState, updater);
      });
      const get = vi.fn(() => currentState as MediaLibraryState & MediaLibraryActions);

      const actions = createRelinkingActions(set, get);
      actions.markMediaBroken('media-1', {
        mediaId: 'media-1',
        fileName: 'video.mp4',
        errorType: 'file_missing',
      });

      // set was called but returned same state (no mutation)
      expect(currentState.brokenMediaIds).toEqual(['media-1']);
    });
  });

  describe('markMediaHealthy', () => {
    it('removes a media ID from brokenMediaIds', () => {
      let currentState: RelinkingState = {
        brokenMediaIds: ['media-1', 'media-2'],
        brokenMediaInfo: new Map([
          ['media-1', { mediaId: 'media-1', fileName: 'a.mp4', errorType: 'file_missing' }],
          ['media-2', { mediaId: 'media-2', fileName: 'b.mp4', errorType: 'file_missing' }],
        ]),
      };
      const set = vi.fn((updater: RelinkingUpdater) => {
        currentState = applyStateUpdate(currentState, updater);
      });
      const get = vi.fn(() => currentState as MediaLibraryState & MediaLibraryActions);

      const actions = createRelinkingActions(set, get);
      actions.markMediaHealthy('media-1');

      expect(currentState.brokenMediaIds).toEqual(['media-2']);
      expect(currentState.brokenMediaInfo.has('media-1')).toBe(false);
    });
  });

  describe('relinkMedia', () => {
    it('invalidates blob URL cache on successful relink', async () => {
      const updatedMedia = { id: 'media-1', fileName: 'relocated.mp4' };
      (mediaLibraryService.relinkMediaHandle as Mock).mockResolvedValue(updatedMedia);

      // Pre-populate a stale blob URL
      blobUrlManager.acquire('media-1', new Blob(['stale']));
      expect(blobUrlManager.has('media-1')).toBe(true);

      const mockState = createMockState();
      const set = vi.fn();
      const get = vi.fn(() => mockState);

      const actions = createRelinkingActions(set, get);
      const result = await actions.relinkMedia(
        'media-1',
        {} as FileSystemFileHandle
      );

      expect(result).toBe(true);
      // Blob URL must be invalidated so preview re-fetches
      expect(blobUrlManager.has('media-1')).toBe(false);
    });

    it('calls markMediaHealthy after successful relink', async () => {
      const updatedMedia = { id: 'media-1', fileName: 'relocated.mp4' };
      (mediaLibraryService.relinkMediaHandle as Mock).mockResolvedValue(updatedMedia);

      const mockState = createMockState();
      const set = vi.fn();
      const get = vi.fn(() => mockState);

      const actions = createRelinkingActions(set, get);
      await actions.relinkMedia('media-1', {} as FileSystemFileHandle);

      expect(mockState.markMediaHealthy).toHaveBeenCalledWith('media-1');
    });

    it('does not invalidate blob URL on failed relink', async () => {
      (mediaLibraryService.relinkMediaHandle as Mock).mockRejectedValue(
        new Error('Permission denied')
      );

      blobUrlManager.acquire('media-1', new Blob(['existing']));

      const mockState = createMockState();
      const set = vi.fn();
      const get = vi.fn(() => mockState);

      const actions = createRelinkingActions(set, get);
      const result = await actions.relinkMedia(
        'media-1',
        {} as FileSystemFileHandle
      );

      expect(result).toBe(false);
      // Blob URL should still be cached since relink failed
      expect(blobUrlManager.has('media-1')).toBe(true);
    });

    it('updates mediaItems with the relinked metadata', async () => {
      const updatedMedia = { id: 'media-1', fileName: 'relocated.mp4' };
      (mediaLibraryService.relinkMediaHandle as Mock).mockResolvedValue(updatedMedia);

      const mockState = createMockState();
      let capturedUpdate: Partial<MediaLibraryState> | undefined;
      const set = vi.fn((updater: RelinkingUpdater) => {
        capturedUpdate =
          typeof updater === 'function'
            ? updater(mockState)
            : updater;
      });
      const get = vi.fn(() => mockState);

      const actions = createRelinkingActions(set, get);
      await actions.relinkMedia('media-1', {} as FileSystemFileHandle);

      expect(capturedUpdate?.mediaItems).toBeDefined();
      const updated = capturedUpdate?.mediaItems?.find((media) => media.id === 'media-1');
      expect(updated?.fileName).toBe('relocated.mp4');
    });
  });

  describe('relinkMediaBatch', () => {
    it('invalidates blob URLs for all successfully relinked media', async () => {
      (mediaLibraryService.relinkMediaHandle as Mock)
        .mockResolvedValueOnce({ id: 'media-1', fileName: 'a.mp4' })
        .mockResolvedValueOnce({ id: 'media-2', fileName: 'b.mp4' });

      blobUrlManager.acquire('media-1', new Blob(['stale-1']));
      blobUrlManager.acquire('media-2', new Blob(['stale-2']));

      const mockState = createMockState();
      mockState.brokenMediaIds = ['media-1', 'media-2'];
      const set = vi.fn();
      const get = vi.fn(() => mockState);

      const actions = createRelinkingActions(set, get);
      const result = await actions.relinkMediaBatch([
        { mediaId: 'media-1', handle: {} as FileSystemFileHandle },
        { mediaId: 'media-2', handle: {} as FileSystemFileHandle },
      ]);

      expect(result.success).toEqual(['media-1', 'media-2']);
      expect(result.failed).toEqual([]);
      expect(blobUrlManager.has('media-1')).toBe(false);
      expect(blobUrlManager.has('media-2')).toBe(false);
    });

    it('only invalidates blob URLs for successful relinks in mixed batch', async () => {
      (mediaLibraryService.relinkMediaHandle as Mock)
        .mockResolvedValueOnce({ id: 'media-1', fileName: 'a.mp4' })
        .mockRejectedValueOnce(new Error('fail'));

      blobUrlManager.acquire('media-1', new Blob(['stale-1']));
      blobUrlManager.acquire('media-2', new Blob(['stale-2']));

      const mockState = createMockState();
      const set = vi.fn();
      const get = vi.fn(() => mockState);

      const actions = createRelinkingActions(set, get);
      const result = await actions.relinkMediaBatch([
        { mediaId: 'media-1', handle: {} as FileSystemFileHandle },
        { mediaId: 'media-2', handle: {} as FileSystemFileHandle },
      ]);

      expect(result.success).toEqual(['media-1']);
      expect(result.failed).toEqual(['media-2']);
      // media-1 invalidated (success), media-2 kept (failure)
      expect(blobUrlManager.has('media-1')).toBe(false);
      expect(blobUrlManager.has('media-2')).toBe(true);
    });
  });
});

