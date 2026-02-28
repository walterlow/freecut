import { describe, expect, it, beforeEach, vi, type Mock } from 'vitest';
import { resolveMediaUrl, resolveMediaUrls, cleanupBlobUrls } from './media-resolver';
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager';
import { mediaLibraryService, FileAccessError } from '@/features/preview/deps/media-library';
import type { TimelineTrack, VideoItem } from '@/types/timeline';

const mockMarkMediaBroken = vi.fn();

// Mock dependencies used by the underlying media resolver implementation.
vi.mock('@/features/media-library/services/media-library-service', () => ({
  mediaLibraryService: {
    getMedia: vi.fn(),
    getMediaFile: vi.fn(),
  },
  FileAccessError: class FileAccessError extends Error {
    type: string;
    constructor(message: string, type: string) {
      super(message);
      this.name = 'FileAccessError';
      this.type = type;
    }
  },
}));

vi.mock('@/features/media-library/services/proxy-service', () => ({
  proxyService: {
    getProxyKey: vi.fn(() => undefined),
    setProxyKey: vi.fn(),
    getProxyBlobUrl: vi.fn(() => null),
  },
}));

vi.mock('@/features/media-library/stores/media-library-store', () => ({
  useMediaLibraryStore: {
    getState: () => ({
      markMediaBroken: mockMarkMediaBroken,
      mediaById: {},
    }),
  },
}));

let blobUrlCounter = 0;

beforeEach(() => {
  vi.clearAllMocks();
  blobUrlManager.releaseAll();
  cleanupBlobUrls();
  blobUrlCounter = 0;

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => `blob:test-${++blobUrlCounter}`,
    revokeObjectURL: vi.fn(),
  });
});

describe('resolveMediaUrl', () => {
  it('returns cached blob URL from blobUrlManager', async () => {
    blobUrlManager.acquire('media-1', new Blob(['cached']));

    const url = await resolveMediaUrl('media-1');

    expect(url).toBe('blob:test-1');
    // Should not hit the service
    expect(mediaLibraryService.getMedia).not.toHaveBeenCalled();
  });

  it('resolves media from service when not cached', async () => {
    (mediaLibraryService.getMedia as Mock).mockResolvedValue({
      id: 'media-1',
      fileName: 'video.mp4',
    });
    (mediaLibraryService.getMediaFile as Mock).mockResolvedValue(
      new Blob(['video-data'])
    );

    const url = await resolveMediaUrl('media-1');

    expect(url).toMatch(/^blob:test-/);
    expect(mediaLibraryService.getMedia).toHaveBeenCalledWith('media-1');
    expect(mediaLibraryService.getMediaFile).toHaveBeenCalledWith('media-1');
  });

  it('returns empty string when media not found', async () => {
    (mediaLibraryService.getMedia as Mock).mockResolvedValue(null);

    const url = await resolveMediaUrl('missing-media');

    expect(url).toBe('');
  });

  it('returns empty string when blob is null', async () => {
    (mediaLibraryService.getMedia as Mock).mockResolvedValue({
      id: 'media-1',
      fileName: 'video.mp4',
    });
    (mediaLibraryService.getMediaFile as Mock).mockResolvedValue(null);

    const url = await resolveMediaUrl('media-1');

    expect(url).toBe('');
  });

  it('marks media broken on FileAccessError (file_missing)', async () => {
    const mockError = new FileAccessError('File not found', 'file_missing');
    (mediaLibraryService.getMedia as Mock)
      .mockResolvedValueOnce({ id: 'media-1', fileName: 'video.mp4' }) // first call in resolve
      .mockResolvedValueOnce({ id: 'media-1', fileName: 'video.mp4' }); // second call in catch
    (mediaLibraryService.getMediaFile as Mock).mockRejectedValue(mockError);

    const url = await resolveMediaUrl('media-1');

    expect(url).toBe('');
    expect(mockMarkMediaBroken).toHaveBeenCalledWith('media-1', {
      mediaId: 'media-1',
      fileName: 'video.mp4',
      errorType: 'file_missing',
    });
  });

  it('resolves fresh URL after blobUrlManager invalidation', async () => {
    // First resolution
    (mediaLibraryService.getMedia as Mock).mockResolvedValue({
      id: 'media-1',
      fileName: 'video.mp4',
    });
    (mediaLibraryService.getMediaFile as Mock).mockResolvedValue(
      new Blob(['old-data'])
    );

    const url1 = await resolveMediaUrl('media-1');
    expect(url1).toBe('blob:test-1');

    // Simulate relinking: invalidate the cached URL
    blobUrlManager.invalidate('media-1');

    // Second resolution should fetch fresh data
    (mediaLibraryService.getMediaFile as Mock).mockResolvedValue(
      new Blob(['new-data'])
    );

    const url2 = await resolveMediaUrl('media-1');
    expect(url2).toBe('blob:test-2'); // new URL, not the cached one
    expect(mediaLibraryService.getMediaFile).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent requests for same mediaId', async () => {
    (mediaLibraryService.getMedia as Mock).mockResolvedValue({
      id: 'media-1',
      fileName: 'video.mp4',
    });
    (mediaLibraryService.getMediaFile as Mock).mockResolvedValue(
      new Blob(['data'])
    );

    const [url1, url2] = await Promise.all([
      resolveMediaUrl('media-1'),
      resolveMediaUrl('media-1'),
    ]);

    expect(url1).toBe(url2);
    // Service should only be called once (second call uses pending promise)
    expect(mediaLibraryService.getMedia).toHaveBeenCalledTimes(1);
  });
});

describe('resolveMediaUrls', () => {
  it('resolves src for video, audio, and image items', async () => {
    (mediaLibraryService.getMedia as Mock).mockResolvedValue({
      id: 'media-1',
      fileName: 'video.mp4',
    });
    (mediaLibraryService.getMediaFile as Mock).mockResolvedValue(
      new Blob(['data'])
    );

    const tracks: TimelineTrack[] = [
      {
        id: 'track-1',
        name: 'Track 1',
        height: 40,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [
          {
            id: 'item-1',
            type: 'video',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 30,
            mediaId: 'media-1',
            src: '',
            label: 'clip',
          },
          {
            id: 'item-2',
            type: 'text',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 30,
            text: 'test',
            color: '#ffffff',
            label: 'text',
          },
        ],
      },
    ];

    const resolved = await resolveMediaUrls(tracks, { useProxy: false });

    // Video item should have src resolved
    expect((resolved[0]!.items[0]! as VideoItem).src).toMatch(/^blob:test-/);
    // Text item should be unchanged (no mediaId)
    expect('src' in resolved[0]!.items[1]!).toBe(false);
  });

  it('does not mutate original tracks', async () => {
    (mediaLibraryService.getMedia as Mock).mockResolvedValue({
      id: 'media-1',
      fileName: 'video.mp4',
    });
    (mediaLibraryService.getMediaFile as Mock).mockResolvedValue(
      new Blob(['data'])
    );

    const tracks: TimelineTrack[] = [
      {
        id: 'track-1',
        name: 'Track 1',
        height: 40,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [
          {
            id: 'item-1',
            type: 'video',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 30,
            mediaId: 'media-1',
            src: '',
            label: 'clip',
          },
        ],
      },
    ];

    await resolveMediaUrls(tracks, { useProxy: false });

    // Original should not be mutated
    expect((tracks[0]!.items[0]! as VideoItem).src).toBe('');
  });
});

describe('relinking regression', () => {
  it('resolves URL after failed initial resolution + blobUrlManager invalidation', async () => {
    // Step 1: Initial resolution fails (file missing)
    const mockError = new FileAccessError('Not found', 'file_missing');
    (mediaLibraryService.getMedia as Mock).mockResolvedValue({
      id: 'media-1',
      fileName: 'video.mp4',
    });
    (mediaLibraryService.getMediaFile as Mock).mockRejectedValue(mockError);

    const failedUrl = await resolveMediaUrl('media-1');
    expect(failedUrl).toBe('');
    expect(blobUrlManager.has('media-1')).toBe(false);

    // Step 2: User relinks â€” invalidate is called (no-op since nothing cached)
    blobUrlManager.invalidate('media-1');

    // Step 3: Re-resolve with the new (working) file handle
    (mediaLibraryService.getMediaFile as Mock).mockResolvedValue(
      new Blob(['relinked-data'])
    );

    const relinkedUrl = await resolveMediaUrl('media-1');
    expect(relinkedUrl).toMatch(/^blob:test-/);
    expect(relinkedUrl).not.toBe('');
    expect(blobUrlManager.has('media-1')).toBe(true);
  });

  it('resolves fresh URL after successful resolution + invalidation + re-resolve', async () => {
    // Step 1: Initial resolution succeeds
    (mediaLibraryService.getMedia as Mock).mockResolvedValue({
      id: 'media-1',
      fileName: 'video.mp4',
    });
    (mediaLibraryService.getMediaFile as Mock).mockResolvedValue(
      new Blob(['original'])
    );

    const originalUrl = await resolveMediaUrl('media-1');
    expect(originalUrl).toBe('blob:test-1');

    // Step 2: Media becomes inaccessible, user relinks, blob cache invalidated
    blobUrlManager.invalidate('media-1');
    expect(blobUrlManager.has('media-1')).toBe(false);

    // Step 3: Re-resolve â€” should create new blob URL from new file handle
    (mediaLibraryService.getMediaFile as Mock).mockResolvedValue(
      new Blob(['relinked'])
    );

    const relinkedUrl = await resolveMediaUrl('media-1');
    expect(relinkedUrl).toBe('blob:test-2');
    expect(relinkedUrl).not.toBe(originalUrl);
  });
});

