import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaMetadata } from '@/types/storage';
import type { ExtractedMediaFileEntry } from '@/features/timeline/deps/media-library-resolver';

const mocks = vi.hoisted(() => ({
  processMedia: vi.fn(),
  requestProjectMediaMatch: vi.fn(),
}));

let mediaLibraryState: {
  currentProjectId: string | null;
  mediaItems: MediaMetadata[];
};

vi.mock('@/features/timeline/deps/media-library-store', () => ({
  useMediaLibraryStore: Object.assign(() => undefined, {
    getState: () => mediaLibraryState,
  }),
}));

vi.mock('@/features/timeline/deps/media-library-resolver', () => ({
  getMimeType: (file: File) => file.type || 'video/mp4',
  mediaProcessorService: {
    processMedia: mocks.processMedia,
  },
}));

vi.mock('@/shared/state/project-media-match-dialog', () => ({
  useProjectMediaMatchDialogStore: {
    getState: () => ({
      requestProjectMediaMatch: mocks.requestProjectMediaMatch,
    }),
  },
}));

import { preflightFirstTimelineVideoProjectMatch } from './external-file-project-match';

function makeVideoMedia(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id: 'video-1',
    storageType: 'handle',
    fileName: 'existing.mp4',
    fileSize: 1024,
    fileLastModified: 1,
    mimeType: 'video/mp4',
    duration: 10,
    width: 1280,
    height: 720,
    fps: 30,
    codec: 'h264',
    bitrate: 1000,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeEntry(
  overrides: Partial<ExtractedMediaFileEntry> = {}
): ExtractedMediaFileEntry {
  return {
    handle: {} as FileSystemFileHandle,
    file: new File(['video'], 'drop.mp4', { type: 'video/mp4' }),
    mediaType: 'video',
    ...overrides,
  };
}

describe('preflightFirstTimelineVideoProjectMatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mediaLibraryState = {
      currentProjectId: 'project-1',
      mediaItems: [],
    };

    mocks.processMedia.mockResolvedValue({
      metadata: {
        type: 'video',
        width: 1920,
        height: 1080,
        fps: 59.94,
      },
    });
    mocks.requestProjectMediaMatch.mockResolvedValue('match-both');
  });

  it('prompts from the first dropped video before timeline import continues', async () => {
    await preflightFirstTimelineVideoProjectMatch([makeEntry()]);

    expect(mocks.processMedia).toHaveBeenCalledWith(
      expect.any(File),
      'video/mp4',
      { generateThumbnail: false }
    );
    expect(mocks.requestProjectMediaMatch).toHaveBeenCalledWith('project-1', {
      fileName: 'drop.mp4',
      width: 1920,
      height: 1080,
      fps: 59.94,
    });
  });

  it('skips prompting when the project already has video media', async () => {
    mediaLibraryState.mediaItems = [makeVideoMedia()];

    await preflightFirstTimelineVideoProjectMatch([makeEntry()]);

    expect(mocks.processMedia).not.toHaveBeenCalled();
    expect(mocks.requestProjectMediaMatch).not.toHaveBeenCalled();
  });

  it('skips prompting when no dropped entry is a video', async () => {
    await preflightFirstTimelineVideoProjectMatch([
      makeEntry({
        file: new File(['audio'], 'drop.mp3', { type: 'audio/mpeg' }),
        mediaType: 'audio',
      }),
    ]);

    expect(mocks.processMedia).not.toHaveBeenCalled();
    expect(mocks.requestProjectMediaMatch).not.toHaveBeenCalled();
  });
});
