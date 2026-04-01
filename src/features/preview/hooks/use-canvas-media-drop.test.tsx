import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaMetadata } from '@/types/storage';

const mocks = vi.hoisted(() => ({
  addItem: vi.fn(),
  setActiveTrack: vi.fn(),
  selectItems: vi.fn(),
  findBestCanvasDropPlacement: vi.fn(() => ({ trackId: 'track-1', from: 24 })),
  getDroppedMediaDurationInFrames: vi.fn(() => 120),
  buildDroppedMediaTimelineItem: vi.fn((params: {
    canvasWidth: number;
    canvasHeight: number;
    placement: { trackId: string; from: number; durationInFrames: number };
  }) => ({
    id: 'item-1',
    type: 'video' as const,
    trackId: params.placement.trackId,
    from: params.placement.from,
    durationInFrames: params.placement.durationInFrames,
    label: 'clip.mp4',
    mediaId: 'media-1',
    originId: 'origin-1',
    sourceStart: 0,
    sourceEnd: params.placement.durationInFrames,
    sourceDuration: params.placement.durationInFrames,
    sourceFps: 30,
    trimStart: 0,
    trimEnd: 0,
    src: 'blob:test',
    transform: {
      x: 0,
      y: 0,
      width: params.canvasWidth,
      height: params.canvasHeight,
      rotation: 0,
    },
  })),
  extractValidMediaFileEntriesFromDataTransfer: vi.fn(),
  getMimeType: vi.fn(() => 'video/mp4'),
  processMedia: vi.fn(),
  requestProjectMediaMatch: vi.fn(),
  importHandlesForPlacement: vi.fn(),
  resolveMediaUrl: vi.fn(async () => 'blob:test'),
  getThumbnailBlobUrl: vi.fn(async () => null),
  screenToCanvas: vi.fn(() => ({ x: 320, y: 240 })),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
}));

let mediaStoreState: {
  currentProjectId: string | null;
  mediaItems: MediaMetadata[];
  mediaById: Record<string, MediaMetadata>;
  importHandlesForPlacement: typeof mocks.importHandlesForPlacement;
};

vi.mock('@/shared/state/selection', () => ({
  useSelectionStore: Object.assign(() => undefined, {
    getState: () => ({
      activeTrackId: 'track-1',
      setActiveTrack: mocks.setActiveTrack,
      selectItems: mocks.selectItems,
    }),
  }),
}));

vi.mock('@/shared/state/playback', () => ({
  usePlaybackStore: Object.assign(() => undefined, {
    getState: () => ({
      currentFrame: 48,
    }),
  }),
}));

vi.mock('@/features/preview/deps/timeline-store', () => ({
  useTimelineStore: Object.assign(() => undefined, {
    getState: () => ({
      fps: 30,
      tracks: [],
      items: [],
      addItem: mocks.addItem,
    }),
  }),
}));

vi.mock('@/features/preview/deps/timeline-utils', () => ({
  findBestCanvasDropPlacement: mocks.findBestCanvasDropPlacement,
  getDroppedMediaDurationInFrames: mocks.getDroppedMediaDurationInFrames,
  buildDroppedMediaTimelineItem: mocks.buildDroppedMediaTimelineItem,
}));

vi.mock('@/features/preview/deps/media-library', () => ({
  extractValidMediaFileEntriesFromDataTransfer: mocks.extractValidMediaFileEntriesFromDataTransfer,
  getMediaDragData: () => null,
  getMediaType: (mimeType: string) => (mimeType.startsWith('video/') ? 'video' : 'image'),
  getMimeType: mocks.getMimeType,
  mediaLibraryService: {
    getThumbnailBlobUrl: mocks.getThumbnailBlobUrl,
  },
  mediaProcessorService: {
    processMedia: mocks.processMedia,
  },
  resolveMediaUrl: mocks.resolveMediaUrl,
  useMediaLibraryStore: Object.assign(
    (selector: (state: typeof mediaStoreState) => unknown) => selector(mediaStoreState),
    {
      getState: () => mediaStoreState,
    }
  ),
}));

vi.mock('../utils/coordinate-transform', () => ({
  screenToCanvas: mocks.screenToCanvas,
}));

vi.mock('@/shared/state/project-media-match-dialog', () => ({
  useProjectMediaMatchDialogStore: {
    getState: () => ({
      requestProjectMediaMatch: mocks.requestProjectMediaMatch,
    }),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    warning: mocks.toastWarning,
    error: mocks.toastError,
  },
}));

import { useCanvasMediaDrop } from './use-canvas-media-drop';

function makeImportedVideo(): MediaMetadata {
  return {
    id: 'media-1',
    storageType: 'handle',
    fileHandle: {} as FileSystemFileHandle,
    fileName: 'clip.mp4',
    fileSize: 10_000,
    fileLastModified: 1,
    mimeType: 'video/mp4',
    duration: 4,
    width: 1920,
    height: 1080,
    fps: 59.94,
    codec: 'h264',
    bitrate: 10_000_000,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function DropProbe() {
  const { handleDrop } = useCanvasMediaDrop({
    coordParams: {} as never,
    projectSize: { width: 1280, height: 720 },
  });

  return <div data-testid="drop-target" onDrop={handleDrop} />;
}

describe('useCanvasMediaDrop', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mediaStoreState = {
      currentProjectId: 'project-1',
      mediaItems: [],
      mediaById: {},
      importHandlesForPlacement: mocks.importHandlesForPlacement,
    };

    mocks.extractValidMediaFileEntriesFromDataTransfer.mockResolvedValue({
      supported: true,
      entries: [
        {
          handle: {} as FileSystemFileHandle,
          file: new File(['video'], 'clip.mp4', { type: 'video/mp4' }),
          mediaType: 'video',
        },
      ],
      errors: [],
    });
    mocks.processMedia.mockResolvedValue({
      metadata: {
        type: 'video',
        width: 1919,
        height: 1079,
        fps: 59.94,
      },
    });
    mocks.requestProjectMediaMatch.mockResolvedValue('size-only');
    mocks.importHandlesForPlacement.mockResolvedValue([makeImportedVideo()]);
  });

  it('keeps matched preview drops centered and sized to the matched project', async () => {
    render(<DropProbe />);

    await act(async () => {
      fireEvent.drop(screen.getByTestId('drop-target'), {
        clientX: 640,
        clientY: 360,
        dataTransfer: {
          types: ['Files'],
          items: [{ kind: 'file' }],
        },
      });
    });

    await waitFor(() => expect(mocks.addItem).toHaveBeenCalledTimes(1));

    expect(mocks.requestProjectMediaMatch).toHaveBeenCalledWith('project-1', {
      fileName: 'clip.mp4',
      width: 1919,
      height: 1079,
      fps: 59.94,
    });
    expect(mocks.buildDroppedMediaTimelineItem).toHaveBeenCalledWith(
      expect.objectContaining({
        canvasWidth: 1920,
        canvasHeight: 1080,
      })
    );
    expect(mocks.screenToCanvas).not.toHaveBeenCalled();
    expect(mocks.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        transform: expect.objectContaining({
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
        }),
      })
    );
  });
});
