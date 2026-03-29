import { beforeEach, describe, expect, it, vi } from 'vitest';

const indexedDbMocks = vi.hoisted(() => ({
  createMedia: vi.fn(),
  deleteMedia: vi.fn(),
  saveThumbnail: vi.fn(),
  deleteThumbnailsByMediaId: vi.fn(),
  associateMediaWithProject: vi.fn(),
}));

const opfsMocks = vi.hoisted(() => ({
  saveFile: vi.fn(),
  deleteFile: vi.fn(),
}));

const thumbnailMocks = vi.hoisted(() => ({
  generateThumbnail: vi.fn(),
}));

const gifFrameCacheMocks = vi.hoisted(() => ({
  getGifFrames: vi.fn(),
  clearMedia: vi.fn(),
}));

vi.mock('@/infrastructure/storage/indexeddb', () => ({
  getAllMedia: vi.fn(),
  getMedia: vi.fn(),
  createMedia: indexedDbMocks.createMedia,
  updateMedia: vi.fn(),
  deleteMedia: indexedDbMocks.deleteMedia,
  saveThumbnail: indexedDbMocks.saveThumbnail,
  getThumbnailByMediaId: vi.fn(),
  deleteThumbnailsByMediaId: indexedDbMocks.deleteThumbnailsByMediaId,
  incrementContentRef: vi.fn(),
  decrementContentRef: vi.fn(),
  deleteContent: vi.fn(),
  associateMediaWithProject: indexedDbMocks.associateMediaWithProject,
  removeMediaFromProject: vi.fn(),
  getProjectMediaIds: vi.fn(),
  getProjectsUsingMedia: vi.fn(),
  getMediaForProject: vi.fn(),
  deleteTranscript: vi.fn(),
}));

vi.mock('./opfs-service', () => ({
  opfsService: opfsMocks,
}));

vi.mock('../utils/thumbnail-generator', () => ({
  generateThumbnail: thumbnailMocks.generateThumbnail,
}));

vi.mock('@/features/media-library/deps/timeline-services', () => ({
  gifFrameCache: gifFrameCacheMocks,
}));

import { mediaLibraryService } from './media-library-service';

describe('MediaLibraryService.importGeneratedImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    indexedDbMocks.createMedia.mockImplementation(async (metadata) => metadata);
    thumbnailMocks.generateThumbnail.mockResolvedValue(
      new Blob(['thumbnail-bytes'], { type: 'image/webp' })
    );
  });

  it('persists a generated still as OPFS-backed media and associates it with the project', async () => {
    const file = new File(['frame-bytes'], 'frame.png', { type: 'image/png' });

    const result = await mediaLibraryService.importGeneratedImage(file, 'project-1', {
      width: 1920,
      height: 1080,
      tags: ['frame-capture'],
      codec: 'png',
    });

    expect(opfsMocks.saveFile).toHaveBeenCalledTimes(1);
    expect(indexedDbMocks.saveThumbnail).toHaveBeenCalledWith(expect.objectContaining({
      mediaId: result.id,
      width: 320,
      height: 180,
    }));
    expect(indexedDbMocks.createMedia).toHaveBeenCalledWith(expect.objectContaining({
      id: result.id,
      storageType: 'opfs',
      fileName: 'frame.png',
      mimeType: 'image/png',
      width: 1920,
      height: 1080,
      codec: 'png',
      tags: ['frame-capture'],
      thumbnailId: expect.any(String),
    }));
    expect(indexedDbMocks.associateMediaWithProject).toHaveBeenCalledWith('project-1', result.id);
  });
});
