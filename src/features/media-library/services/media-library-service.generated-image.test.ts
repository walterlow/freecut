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

const mediaProcessorMocks = vi.hoisted(() => ({
  processMedia: vi.fn(),
}));

const proxyMocks = vi.hoisted(() => ({
  onStatusChange: vi.fn(),
  deleteProxy: vi.fn(),
  clearProxyKey: vi.fn(),
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

vi.mock('@/infrastructure/storage', () => ({
  getAllMedia: vi.fn(),
  getMedia: vi.fn(),
  getTranscript: vi.fn(),
  getTranscriptMediaIds: vi.fn(),
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
  saveTranscript: vi.fn(),
}));

vi.mock('./opfs-service', () => ({
  opfsService: opfsMocks,
}));

vi.mock('./proxy-service', () => ({
  proxyService: proxyMocks,
}));

vi.mock('./background-media-work', () => backgroundMediaWorkMocks);

vi.mock('../utils/thumbnail-generator', () => ({
  generateThumbnail: thumbnailMocks.generateThumbnail,
}));

vi.mock('./media-processor-service', () => ({
  mediaProcessorService: mediaProcessorMocks,
}));

vi.mock('@/features/media-library/deps/timeline-services', () => ({
  gifFrameCache: gifFrameCacheMocks,
  filmstripCache: filmstripCacheMocks,
  waveformCache: waveformCacheMocks,
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

describe('MediaLibraryService.importGeneratedAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    indexedDbMocks.createMedia.mockImplementation(async (metadata) => metadata);
    mediaProcessorMocks.processMedia.mockResolvedValue({
      metadata: {
        type: 'audio',
        duration: 2.75,
        codec: 'pcm_s16le',
        bitrate: 384000,
      },
      thumbnail: new Blob(['waveform'], { type: 'image/webp' }),
    });
  });

  it('persists generated audio as OPFS-backed media with a waveform thumbnail', async () => {
    const file = new File(['wav-bytes'], 'ai-voice.wav', { type: 'audio/wav' });

    const result = await mediaLibraryService.importGeneratedAudio(file, 'project-1', {
      tags: ['ai-generated', 'kitten-tts'],
    });

    expect(mediaProcessorMocks.processMedia).toHaveBeenCalledWith(
      file,
      'audio/wav',
      expect.objectContaining({
        generateThumbnail: true,
        thumbnailMaxSize: 320,
        thumbnailQuality: 0.6,
      })
    );
    expect(opfsMocks.saveFile).toHaveBeenCalledTimes(1);
    expect(indexedDbMocks.saveThumbnail).toHaveBeenCalledWith(expect.objectContaining({
      mediaId: result.id,
      width: 320,
      height: 180,
    }));
    expect(indexedDbMocks.createMedia).toHaveBeenCalledWith(expect.objectContaining({
      id: result.id,
      storageType: 'opfs',
      fileName: 'ai-voice.wav',
      mimeType: 'audio/wav',
      duration: 2.75,
      codec: 'pcm_s16le',
      bitrate: 384000,
      tags: ['ai-generated', 'kitten-tts'],
      thumbnailId: expect.any(String),
    }));
    expect(indexedDbMocks.associateMediaWithProject).toHaveBeenCalledWith('project-1', result.id);
  });
});
