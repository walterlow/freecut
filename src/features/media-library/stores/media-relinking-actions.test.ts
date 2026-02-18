import { describe, expect, it, beforeEach, vi, type Mock } from 'vitest';
import { createRelinkingActions } from './media-relinking-actions';
import { blobUrlManager } from '@/lib/blob-url-manager';
import type { MediaLibraryState, MediaLibraryActions, BrokenMediaInfo } from '../types';

// Mock external dependencies
vi.mock('../services/media-library-service', () => ({
  mediaLibraryService: {
    relinkMediaHandle: vi.fn(),
    getMedia: vi.fn(),
  },
}));

vi.mock('@/features/timeline/stores/timeline-actions', () => ({
  removeItems: vi.fn(),
  updateItem: vi.fn(),
}));

vi.mock('@/features/timeline/stores/timeline-settings-store', () => ({
  useTimelineSettingsStore: {
    getState: () => ({ fps: 30 }),
  },
}));

// Import after mocks
import { mediaLibraryService } from '../services/media-library-service';

// Helpers
function createMockState(): MediaLibraryState & MediaLibraryActions {
  const state: Partial<MediaLibraryState & MediaLibraryActions> = {
    mediaItems: [
      { id: 'media-1', fileName: 'video.mp4' } as any,
      { id: 'media-2', fileName: 'audio.mp3' } as any,
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
      let currentState: any = {
        brokenMediaIds: [],
        brokenMediaInfo: new Map(),
      };
      const set = vi.fn((updater: any) => {
        if (typeof updater === 'function') {
          currentState = { ...currentState, ...updater(currentState) };
        } else {
          currentState = { ...currentState, ...updater };
        }
      });
      const get = vi.fn(() => currentState);

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

    it('is idempotent — does not duplicate entries', () => {
      let currentState: any = {
        brokenMediaIds: ['media-1'],
        brokenMediaInfo: new Map([
          ['media-1', { mediaId: 'media-1', fileName: 'video.mp4', errorType: 'file_missing' }],
        ]),
      };
      const set = vi.fn((updater: any) => {
        if (typeof updater === 'function') {
          const result = updater(currentState);
          currentState = { ...currentState, ...result };
        }
      });
      const get = vi.fn(() => currentState);

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
      let currentState: any = {
        brokenMediaIds: ['media-1', 'media-2'],
        brokenMediaInfo: new Map([
          ['media-1', { mediaId: 'media-1', fileName: 'a.mp4', errorType: 'file_missing' }],
          ['media-2', { mediaId: 'media-2', fileName: 'b.mp4', errorType: 'file_missing' }],
        ]),
      };
      const set = vi.fn((updater: any) => {
        if (typeof updater === 'function') {
          currentState = { ...currentState, ...updater(currentState) };
        }
      });
      const get = vi.fn(() => currentState);

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
      let capturedUpdater: any;
      const set = vi.fn((updater: any) => {
        if (typeof updater === 'function') {
          capturedUpdater = updater(mockState);
        }
      });
      const get = vi.fn(() => mockState);

      const actions = createRelinkingActions(set, get);
      await actions.relinkMedia('media-1', {} as FileSystemFileHandle);

      expect(capturedUpdater.mediaItems).toBeDefined();
      const updated = capturedUpdater.mediaItems.find((m: any) => m.id === 'media-1');
      expect(updated.fileName).toBe('relocated.mp4');
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
