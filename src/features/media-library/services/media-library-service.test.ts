import { beforeEach, describe, expect, it, vi } from 'vitest';

const indexedDbMocks = vi.hoisted(() => ({
  getAllMedia: vi.fn(),
  getMedia: vi.fn(),
  createMedia: vi.fn(),
  updateMedia: vi.fn(),
  deleteMedia: vi.fn(),
  saveThumbnail: vi.fn(),
  getThumbnailByMediaId: vi.fn(),
  deleteThumbnailsByMediaId: vi.fn(),
  incrementContentRef: vi.fn(),
  decrementContentRef: vi.fn(),
  deleteContent: vi.fn(),
  associateMediaWithProject: vi.fn(),
  removeMediaFromProject: vi.fn(),
  getProjectMediaIds: vi.fn(),
  getProjectsUsingMedia: vi.fn(),
  getMediaForProject: vi.fn(),
  deleteTranscript: vi.fn(),
}));

const opfsMocks = vi.hoisted(() => ({
  saveFile: vi.fn(),
  deleteFile: vi.fn(),
  getFile: vi.fn(),
  getFileBlob: vi.fn(),
}));

const proxyMocks = vi.hoisted(() => ({
  deleteProxy: vi.fn(),
  clearProxyKey: vi.fn(),
}));

const mediaProcessorMocks = vi.hoisted(() => ({
  processMedia: vi.fn(),
  hasUnsupportedAudioCodec: vi.fn(),
}));

const compositionRuntimeMocks = vi.hoisted(() => ({
  needsCustomAudioDecoder: vi.fn(() => false),
  startPreviewAudioConform: vi.fn(async () => undefined),
  startPreviewAudioStartupWarm: vi.fn(async () => undefined),
}));

const previewAudioConformMocks = vi.hoisted(() => ({
  deletePreviewAudioConform: vi.fn(async () => undefined),
}));

const gifFrameCacheMocks = vi.hoisted(() => ({
  getGifFrames: vi.fn(),
  clearMedia: vi.fn(),
}));

const filmstripCacheMocks = vi.hoisted(() => ({
  prewarmPriorityWindow: vi.fn(async () => undefined),
  clearMedia: vi.fn(async () => undefined),
}));

const waveformCacheMocks = vi.hoisted(() => ({
  clearMedia: vi.fn(async () => undefined),
}));

const backgroundMediaWorkMocks = vi.hoisted(() => ({
  enqueueBackgroundMediaWork: vi.fn((run: () => unknown) => {
    const result = run();
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      void (result as PromiseLike<unknown>);
    }
    return vi.fn();
  }),
}));

vi.mock('@/infrastructure/storage', () => indexedDbMocks);

vi.mock('./opfs-service', () => ({
  opfsService: opfsMocks,
}));

vi.mock('./proxy-service', () => ({
  proxyService: proxyMocks,
}));

vi.mock('./background-media-work', () => backgroundMediaWorkMocks);

vi.mock('./media-processor-service', () => ({
  mediaProcessorService: mediaProcessorMocks,
}));

vi.mock('@/features/composition-runtime/utils/audio-codec-detection', () => ({
  needsCustomAudioDecoder: compositionRuntimeMocks.needsCustomAudioDecoder,
}));

vi.mock('@/features/composition-runtime/utils/audio-decode-cache', () => ({
  startPreviewAudioConform: compositionRuntimeMocks.startPreviewAudioConform,
  startPreviewAudioStartupWarm: compositionRuntimeMocks.startPreviewAudioStartupWarm,
}));

vi.mock('@/features/composition-runtime/utils/preview-audio-conform', () => ({
  deletePreviewAudioConform: previewAudioConformMocks.deletePreviewAudioConform,
}));

vi.mock('@/features/media-library/deps/timeline-services', () => ({
  gifFrameCache: gifFrameCacheMocks,
  filmstripCache: filmstripCacheMocks,
  waveformCache: waveformCacheMocks,
}));

vi.mock('../utils/validation', () => ({
  validateMediaFile: vi.fn(() => ({ valid: true })),
  getMimeType: vi.fn((file: File) => file.type || 'application/octet-stream'),
}));

vi.mock('../utils/proxy-key', () => ({
  getSharedProxyKey: vi.fn((media: { id: string }) => `proxy-${media.id}`),
}));

import { mediaLibraryService, FileAccessError } from './media-library-service';
import type { MediaMetadata } from '@/types/storage';

function makeMediaMetadata(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id: 'media-1',
    storageType: 'handle',
    fileName: 'video.mp4',
    fileSize: 1024,
    mimeType: 'video/mp4',
    duration: 10,
    width: 1920,
    height: 1080,
    fps: 30,
    codec: 'avc1',
    bitrate: 5000,
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('MediaLibraryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    compositionRuntimeMocks.needsCustomAudioDecoder.mockReturnValue(false);
    compositionRuntimeMocks.startPreviewAudioStartupWarm.mockResolvedValue(undefined);
    filmstripCacheMocks.prewarmPriorityWindow.mockResolvedValue(undefined);
  });

  describe('getAllMedia', () => {
    it('returns all media from IndexedDB', async () => {
      const media = [makeMediaMetadata({ id: 'm1' }), makeMediaMetadata({ id: 'm2' })];
      indexedDbMocks.getAllMedia.mockResolvedValue(media);

      const result = await mediaLibraryService.getAllMedia();
      expect(result).toEqual(media);
      expect(indexedDbMocks.getAllMedia).toHaveBeenCalledTimes(1);
    });
  });

  describe('getMedia', () => {
    it('returns media by ID', async () => {
      const media = makeMediaMetadata({ id: 'm1' });
      indexedDbMocks.getMedia.mockResolvedValue(media);

      const result = await mediaLibraryService.getMedia('m1');
      expect(result).toEqual(media);
    });

    it('returns null when media not found', async () => {
      indexedDbMocks.getMedia.mockResolvedValue(undefined);

      const result = await mediaLibraryService.getMedia('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('importMediaWithHandle', () => {
    it('imports a media file via handle and associates with project', async () => {
      const mockFile = new File(['data'], 'video.mp4', { type: 'video/mp4' });
      const mockHandle = {
        name: 'video.mp4',
        getFile: vi.fn().mockResolvedValue(mockFile),
        queryPermission: vi.fn().mockResolvedValue('granted'),
        requestPermission: vi.fn().mockResolvedValue('granted'),
      } as unknown as FileSystemFileHandle;

      mediaProcessorMocks.processMedia.mockResolvedValue({
        metadata: {
          type: 'video',
          duration: 10,
          width: 1920,
          height: 1080,
          fps: 30,
          codec: 'avc1',
          audioCodec: 'aac',
          audioCodecSupported: true,
          bitrate: 5000,
        },
        thumbnail: new Blob(['thumb'], { type: 'image/webp' }),
      });
      mediaProcessorMocks.hasUnsupportedAudioCodec.mockReturnValue({ unsupported: false });
      indexedDbMocks.getMediaForProject.mockResolvedValue([]);

      const result = await mediaLibraryService.importMediaWithHandle(mockHandle, 'project-1');

      expect(result.storageType).toBe('handle');
      expect(result.fileName).toBe('video.mp4');
      expect(result.isDuplicate).toBeUndefined();
      expect(indexedDbMocks.createMedia).toHaveBeenCalledTimes(1);
      expect(indexedDbMocks.associateMediaWithProject).toHaveBeenCalledWith('project-1', result.id);
      expect(indexedDbMocks.saveThumbnail).toHaveBeenCalledTimes(1);
      expect(filmstripCacheMocks.prewarmPriorityWindow).toHaveBeenNthCalledWith(
        1,
        result.id,
        mockFile,
        10,
        { startTime: 0, endTime: 1 },
      );
      expect(filmstripCacheMocks.prewarmPriorityWindow).toHaveBeenNthCalledWith(
        2,
        result.id,
        mockFile,
        10,
        { startTime: 0, endTime: 10 },
      );
    });

    it('returns existing media with isDuplicate flag when file already in project', async () => {
      const existingMedia = makeMediaMetadata({
        id: 'existing-1',
        fileName: 'video.mp4',
        fileSize: 4,
      });
      indexedDbMocks.getMediaForProject.mockResolvedValue([existingMedia]);

      const mockFile = new File(['data'], 'video.mp4', { type: 'video/mp4' });
      const mockHandle = {
        name: 'video.mp4',
        getFile: vi.fn().mockResolvedValue(mockFile),
        queryPermission: vi.fn().mockResolvedValue('granted'),
        requestPermission: vi.fn().mockResolvedValue('granted'),
      } as unknown as FileSystemFileHandle;

      const result = await mediaLibraryService.importMediaWithHandle(mockHandle, 'project-1');

      expect(result.isDuplicate).toBe(true);
      expect(result.id).toBe('existing-1');
      expect(indexedDbMocks.createMedia).not.toHaveBeenCalled();
    });

    it('starts preview audio conform in background for custom-decoded imports', async () => {
      const mockFile = new File(['audio'], 'clip.webm', { type: 'video/webm' });
      const mockHandle = {
        name: 'clip.webm',
        getFile: vi.fn().mockResolvedValue(mockFile),
        queryPermission: vi.fn().mockResolvedValue('granted'),
        requestPermission: vi.fn().mockResolvedValue('granted'),
      } as unknown as FileSystemFileHandle;

      mediaProcessorMocks.processMedia.mockResolvedValue({
        metadata: {
          type: 'video',
          duration: 10,
          width: 1920,
          height: 1080,
          fps: 30,
          codec: 'vp9',
          audioCodec: 'vorbis',
          audioCodecSupported: true,
          bitrate: 5000,
        },
      });
      mediaProcessorMocks.hasUnsupportedAudioCodec.mockReturnValue({ unsupported: false });
      indexedDbMocks.getMediaForProject.mockResolvedValue([]);
      compositionRuntimeMocks.needsCustomAudioDecoder.mockReturnValue(true);

      const result = await mediaLibraryService.importMediaWithHandle(mockHandle, 'project-1');
      await Promise.resolve();

      expect(result.id).toBeTruthy();
      expect(compositionRuntimeMocks.startPreviewAudioStartupWarm).toHaveBeenCalledWith(result.id, mockFile);
      expect(compositionRuntimeMocks.startPreviewAudioConform).toHaveBeenCalledWith(result.id, mockFile);
    });

    it('throws FileAccessError when permission is denied', async () => {
      const mockHandle = {
        name: 'video.mp4',
        queryPermission: vi.fn().mockResolvedValue('denied'),
        requestPermission: vi.fn().mockResolvedValue('denied'),
      } as unknown as FileSystemFileHandle;

      await expect(
        mediaLibraryService.importMediaWithHandle(mockHandle, 'project-1')
      ).rejects.toThrow(FileAccessError);
    });
  });

  describe('deleteMediaFromProject', () => {
    it('removes association and deletes media when no other projects use it', async () => {
      const media = makeMediaMetadata({ id: 'm1', storageType: 'handle' });
      indexedDbMocks.getMedia.mockResolvedValue(media);
      indexedDbMocks.getProjectsUsingMedia.mockResolvedValue([]);
      indexedDbMocks.getAllMedia.mockResolvedValue([]);

      await mediaLibraryService.deleteMediaFromProject('project-1', 'm1');

      expect(indexedDbMocks.removeMediaFromProject).toHaveBeenCalledWith('project-1', 'm1');
      expect(indexedDbMocks.deleteMedia).toHaveBeenCalledWith('m1');
      expect(previewAudioConformMocks.deletePreviewAudioConform).toHaveBeenCalledWith(media, { clearMetadata: false });
    });

    it('only removes association when other projects still use the media', async () => {
      const media = makeMediaMetadata({ id: 'm1', storageType: 'handle' });
      indexedDbMocks.getMedia.mockResolvedValue(media);
      indexedDbMocks.getProjectsUsingMedia.mockResolvedValue(['project-2']);

      await mediaLibraryService.deleteMediaFromProject('project-1', 'm1');

      expect(indexedDbMocks.removeMediaFromProject).toHaveBeenCalledWith('project-1', 'm1');
      expect(indexedDbMocks.deleteMedia).not.toHaveBeenCalled();
    });

    it('deletes OPFS content when ref count reaches zero', async () => {
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'opfs',
        contentHash: 'abc123',
        opfsPath: 'content/ab/cd/m1/data',
      });
      indexedDbMocks.getMedia.mockResolvedValue(media);
      indexedDbMocks.getProjectsUsingMedia.mockResolvedValue([]);
      indexedDbMocks.decrementContentRef.mockResolvedValue(0);
      indexedDbMocks.getAllMedia.mockResolvedValue([]);

      await mediaLibraryService.deleteMediaFromProject('project-1', 'm1');

      expect(opfsMocks.deleteFile).toHaveBeenCalledWith('content/ab/cd/m1/data');
      expect(indexedDbMocks.deleteContent).toHaveBeenCalledWith('abc123');
    });

    it('throws when media not found', async () => {
      indexedDbMocks.getMedia.mockResolvedValue(undefined);

      await expect(
        mediaLibraryService.deleteMediaFromProject('project-1', 'nonexistent')
      ).rejects.toThrow('Media not found');
    });
  });

  describe('deleteMediaBatchFromProject', () => {
    it('deletes multiple media items in parallel', async () => {
      const media1 = makeMediaMetadata({ id: 'm1', storageType: 'handle' });
      const media2 = makeMediaMetadata({ id: 'm2', storageType: 'handle' });
      indexedDbMocks.getMedia.mockImplementation((id: string) =>
        id === 'm1' ? Promise.resolve(media1) : Promise.resolve(media2)
      );
      indexedDbMocks.getProjectsUsingMedia.mockResolvedValue([]);
      indexedDbMocks.getAllMedia.mockResolvedValue([]);

      await mediaLibraryService.deleteMediaBatchFromProject('project-1', ['m1', 'm2']);

      expect(indexedDbMocks.deleteMedia).toHaveBeenCalledTimes(2);
    });

    it('throws when all deletions fail', async () => {
      indexedDbMocks.getMedia.mockRejectedValue(new Error('not found'));

      await expect(
        mediaLibraryService.deleteMediaBatchFromProject('project-1', ['m1', 'm2'])
      ).rejects.toThrow('Failed to delete all');
    });
  });

  describe('getMediaFile', () => {
    it('returns file from FileSystemFileHandle', async () => {
      const mockFile = new File(['data'], 'video.mp4', { type: 'video/mp4' });
      const mockHandle = {
        getFile: vi.fn().mockResolvedValue(mockFile),
        queryPermission: vi.fn().mockResolvedValue('granted'),
      };
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'handle',
        fileHandle: mockHandle as unknown as FileSystemFileHandle,
      });
      indexedDbMocks.getMedia.mockResolvedValue(media);

      const result = await mediaLibraryService.getMediaFile('m1');
      expect(result).toBe(mockFile);
    });

    it('returns blob from OPFS storage', async () => {
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'opfs',
        opfsPath: 'content/ab/cd/m1/data',
        mimeType: 'video/mp4',
      });
      indexedDbMocks.getMedia.mockResolvedValue(media);
      opfsMocks.getFileBlob.mockResolvedValue(new File(['data'], 'video.mp4', { type: 'video/mp4' }));

      const result = await mediaLibraryService.getMediaFile('m1');
      expect(result).toBeInstanceOf(Blob);
      expect(result?.type).toBe('video/mp4');
    });

    it('falls back to ArrayBuffer OPFS reads when direct file access fails', async () => {
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'opfs',
        opfsPath: 'content/ab/cd/m1/data',
        mimeType: 'video/mp4',
      });
      indexedDbMocks.getMedia.mockResolvedValue(media);
      opfsMocks.getFileBlob.mockRejectedValue(new Error('direct file unsupported'));
      opfsMocks.getFile.mockResolvedValue(new ArrayBuffer(1024));

      const result = await mediaLibraryService.getMediaFile('m1');
      expect(result).toBeInstanceOf(Blob);
      expect(opfsMocks.getFileBlob).toHaveBeenCalledWith('content/ab/cd/m1/data');
      expect(opfsMocks.getFile).toHaveBeenCalledWith('content/ab/cd/m1/data');
    });

    it('returns null when media not found', async () => {
      indexedDbMocks.getMedia.mockResolvedValue(undefined);

      const result = await mediaLibraryService.getMediaFile('nonexistent');
      expect(result).toBeNull();
    });

    it('throws FileAccessError when handle permission is denied', async () => {
      const mockHandle = {
        queryPermission: vi.fn().mockResolvedValue('denied'),
        requestPermission: vi.fn().mockResolvedValue('denied'),
      };
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'handle',
        fileHandle: mockHandle as unknown as FileSystemFileHandle,
      });
      indexedDbMocks.getMedia.mockResolvedValue(media);

      await expect(mediaLibraryService.getMediaFile('m1')).rejects.toThrow(FileAccessError);
    });
  });

  describe('copyMediaToProject', () => {
    it('creates association and increments OPFS ref count', async () => {
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'opfs',
        contentHash: 'abc123',
      });
      indexedDbMocks.getMedia.mockResolvedValue(media);

      await mediaLibraryService.copyMediaToProject('m1', 'project-2');

      expect(indexedDbMocks.associateMediaWithProject).toHaveBeenCalledWith('project-2', 'm1');
      expect(indexedDbMocks.incrementContentRef).toHaveBeenCalledWith('abc123');
    });

    it('creates association without incrementing ref for handle storage', async () => {
      const media = makeMediaMetadata({ id: 'm1', storageType: 'handle' });
      indexedDbMocks.getMedia.mockResolvedValue(media);

      await mediaLibraryService.copyMediaToProject('m1', 'project-2');

      expect(indexedDbMocks.associateMediaWithProject).toHaveBeenCalledWith('project-2', 'm1');
      expect(indexedDbMocks.incrementContentRef).not.toHaveBeenCalled();
    });

    it('throws when media not found', async () => {
      indexedDbMocks.getMedia.mockResolvedValue(undefined);

      await expect(
        mediaLibraryService.copyMediaToProject('nonexistent', 'project-2')
      ).rejects.toThrow('Media not found');
    });
  });

  describe('thumbnail caching', () => {
    beforeEach(() => {
      // Clear singleton cache between tests
      mediaLibraryService.clearThumbnailCache('thumb-m1');
      mediaLibraryService.clearThumbnailCache('thumb-m2');
    });

    it('caches thumbnail blob URLs', async () => {
      const blob = new Blob(['thumb'], { type: 'image/webp' });
      indexedDbMocks.getThumbnailByMediaId.mockResolvedValue({ blob });

      const url1 = await mediaLibraryService.getThumbnailBlobUrl('thumb-m1');
      const url2 = await mediaLibraryService.getThumbnailBlobUrl('thumb-m1');

      expect(url1).toBe(url2);
      expect(indexedDbMocks.getThumbnailByMediaId).toHaveBeenCalledTimes(1);
    });

    it('clears thumbnail cache', async () => {
      const blob = new Blob(['thumb'], { type: 'image/webp' });
      indexedDbMocks.getThumbnailByMediaId.mockResolvedValue({ blob });

      await mediaLibraryService.getThumbnailBlobUrl('thumb-m2');
      mediaLibraryService.clearThumbnailCache('thumb-m2');

      // After clearing, next call should fetch again
      await mediaLibraryService.getThumbnailBlobUrl('thumb-m2');
      expect(indexedDbMocks.getThumbnailByMediaId).toHaveBeenCalledTimes(2);
    });

    it('returns null when no thumbnail exists', async () => {
      indexedDbMocks.getThumbnailByMediaId.mockResolvedValue(null);

      const result = await mediaLibraryService.getThumbnailBlobUrl('thumb-nope');
      expect(result).toBeNull();
    });
  });

  describe('needsPermission', () => {
    it('returns true when handle permission is not granted', async () => {
      const mockHandle = {
        queryPermission: vi.fn().mockResolvedValue('denied'),
      };
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'handle',
        fileHandle: mockHandle as unknown as FileSystemFileHandle,
      });
      indexedDbMocks.getMedia.mockResolvedValue(media);

      const result = await mediaLibraryService.needsPermission('m1');
      expect(result).toBe(true);
    });

    it('returns false when handle permission is granted', async () => {
      const mockHandle = {
        queryPermission: vi.fn().mockResolvedValue('granted'),
      };
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'handle',
        fileHandle: mockHandle as unknown as FileSystemFileHandle,
      });
      indexedDbMocks.getMedia.mockResolvedValue(media);

      const result = await mediaLibraryService.needsPermission('m1');
      expect(result).toBe(false);
    });

    it('returns false for non-handle storage', async () => {
      const media = makeMediaMetadata({ id: 'm1', storageType: 'opfs' });
      indexedDbMocks.getMedia.mockResolvedValue(media);

      const result = await mediaLibraryService.needsPermission('m1');
      expect(result).toBe(false);
    });
  });

  describe('validateSync', () => {
    it('identifies orphaned metadata entries', async () => {
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'opfs',
        opfsPath: 'content/ab/cd/m1/data',
      });
      indexedDbMocks.getAllMedia.mockResolvedValue([media]);
      opfsMocks.getFile.mockRejectedValue(new Error('not found'));

      const result = await mediaLibraryService.validateSync();
      expect(result.orphanedMetadata).toContain('m1');
    });

    it('returns empty for healthy storage', async () => {
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'opfs',
        opfsPath: 'content/ab/cd/m1/data',
      });
      indexedDbMocks.getAllMedia.mockResolvedValue([media]);
      opfsMocks.getFile.mockResolvedValue(new ArrayBuffer(1024));

      const result = await mediaLibraryService.validateSync();
      expect(result.orphanedMetadata).toHaveLength(0);
    });
  });

  describe('repairSync', () => {
    it('cleans up orphaned metadata', async () => {
      const media = makeMediaMetadata({
        id: 'm1',
        storageType: 'opfs',
        opfsPath: 'content/ab/cd/m1/data',
      });
      indexedDbMocks.getAllMedia.mockResolvedValue([media]);
      opfsMocks.getFile.mockRejectedValue(new Error('not found'));

      const result = await mediaLibraryService.repairSync();
      expect(result.cleaned).toBe(1);
      expect(indexedDbMocks.deleteMedia).toHaveBeenCalledWith('m1');
    });
  });

  describe('relinkMediaHandle', () => {
    it('updates media with new file handle', async () => {
      const media = makeMediaMetadata({ id: 'm1' });
      indexedDbMocks.getMedia.mockResolvedValue(media);

      const newFile = new File(['data'], 'renamed.mp4', { type: 'video/mp4' });
      const newHandle = {
        name: 'renamed.mp4',
        getFile: vi.fn().mockResolvedValue(newFile),
        queryPermission: vi.fn().mockResolvedValue('granted'),
        requestPermission: vi.fn().mockResolvedValue('granted'),
      } as unknown as FileSystemFileHandle;

      indexedDbMocks.updateMedia.mockResolvedValue({ ...media, fileName: 'renamed.mp4' });

      const result = await mediaLibraryService.relinkMediaHandle('m1', newHandle);
      expect(result.fileName).toBe('renamed.mp4');
      expect(indexedDbMocks.updateMedia).toHaveBeenCalledTimes(1);
    });

    it('throws when permission denied for new handle', async () => {
      const media = makeMediaMetadata({ id: 'm1' });
      indexedDbMocks.getMedia.mockResolvedValue(media);

      const newHandle = {
        name: 'file.mp4',
        queryPermission: vi.fn().mockResolvedValue('denied'),
        requestPermission: vi.fn().mockResolvedValue('denied'),
      } as unknown as FileSystemFileHandle;

      await expect(
        mediaLibraryService.relinkMediaHandle('m1', newHandle)
      ).rejects.toThrow(FileAccessError);
    });
  });
});
