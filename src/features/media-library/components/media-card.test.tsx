import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MouseEvent, ReactNode } from 'react';
import type { MediaMetadata } from '@/types/storage';

const mediaLibraryServiceMocks = vi.hoisted(() => ({
  getThumbnailBlobUrl: vi.fn(),
  getMediaFile: vi.fn(),
  getMediaBlobUrl: vi.fn(),
}));

const proxyServiceMocks = vi.hoisted(() => ({
  canGenerateProxy: vi.fn(),
  setProxyKey: vi.fn(),
  generateProxy: vi.fn(),
  cancelProxy: vi.fn(),
  deleteProxy: vi.fn(),
  clearProxyKey: vi.fn(),
}));

const mediaTranscriptionServiceMocks = vi.hoisted(() => ({
  transcribeMedia: vi.fn(),
}));

const mediaStoreState = vi.hoisted(() => ({
  selectedMediaIds: [] as string[],
  mediaItems: [] as MediaMetadata[],
  importingIds: [] as string[],
  proxyStatus: new Map<string, 'generating' | 'ready' | 'error'>(),
  proxyProgress: new Map<string, number>(),
  transcriptStatus: new Map<string, 'idle' | 'transcribing' | 'ready' | 'error'>(),
  transcriptProgress: new Map(),
  taggingMediaIds: new Set<string>(),
  setProxyStatus: vi.fn(),
  clearProxyStatus: vi.fn(),
  setTranscriptStatus: vi.fn(),
  setTranscriptProgress: vi.fn(),
  clearTranscriptProgress: vi.fn(),
  setTaggingMedia: vi.fn(),
  showNotification: vi.fn(),
}));

const editorStoreState = vi.hoisted(() => ({
  setSourcePreviewMediaId: vi.fn(),
  setMediaSkimPreview: vi.fn(),
  clearMediaSkimPreview: vi.fn(),
  mediaSkimPreviewMediaId: null as string | null,
}));

const sourcePlayerStoreState = vi.hoisted(() => ({
  setCurrentMediaId: vi.fn(),
  clearInOutPoints: vi.fn(),
  setInPoint: vi.fn(),
  setOutPoint: vi.fn(),
  setPendingSeekFrame: vi.fn(),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
  }) => <button disabled={disabled} onClick={onClick}>{children}</button>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
  }) => <button disabled={disabled} onClick={onClick}>{children}</button>,
}));

vi.mock('./media-info-popover', () => ({
  MediaInfoPopover: ({ onSeekToCaption }: { onSeekToCaption?: (timeSec: number) => void }) => (
    <button data-testid="media-info-popover" onClick={() => onSeekToCaption?.(2.5)}>
      Open media info
    </button>
  ),
}));

vi.mock('../services/media-library-service', () => ({
  mediaLibraryService: mediaLibraryServiceMocks,
}));

vi.mock('../services/proxy-service', () => ({
  proxyService: proxyServiceMocks,
}));

vi.mock('../services/media-transcription-service', () => ({
  mediaTranscriptionService: mediaTranscriptionServiceMocks,
}));

vi.mock('../stores/media-library-store', () => {
  const useMediaLibraryStore = Object.assign(
    (selector: (state: typeof mediaStoreState) => unknown) => selector(mediaStoreState),
    {
      getState: () => mediaStoreState,
    }
  );

  return { useMediaLibraryStore };
});

vi.mock('@/app/state/editor', () => {
  const useEditorStore = Object.assign(
    (selector: (state: typeof editorStoreState) => unknown) => selector(editorStoreState),
    {
      getState: () => editorStoreState,
    }
  );

  return { useEditorStore };
});

vi.mock('@/shared/state/source-player', () => ({
  useSourcePlayerStore: {
    getState: () => sourcePlayerStoreState,
  },
}));

vi.mock('../utils/proxy-key', () => ({
  getSharedProxyKey: vi.fn((media: { id: string }) => `proxy-${media.id}`),
}));

vi.mock('../utils/drag-data-cache', () => ({
  setMediaDragData: vi.fn(),
  clearMediaDragData: vi.fn(),
}));

vi.mock('@/shared/state/local-inference', () => ({
  isLocalInferenceCancellationError: vi.fn(() => false),
}));

import { MediaCard } from './media-card';

function makeMedia(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id: 'media-1',
    storageType: 'handle',
    fileName: 'clip.mp4',
    fileSize: 1024,
    mimeType: 'video/mp4',
    duration: 5,
    width: 3840,
    height: 2160,
    fps: 30,
    codec: 'h264',
    bitrate: 5000,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('MediaCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mediaStoreState.selectedMediaIds = [];
    mediaStoreState.mediaItems = [makeMedia()];
    mediaStoreState.importingIds = [];
    mediaStoreState.proxyStatus = new Map();
    mediaStoreState.proxyProgress = new Map();
    mediaStoreState.transcriptStatus = new Map();
    mediaStoreState.transcriptProgress = new Map();
    mediaStoreState.taggingMediaIds = new Set();
    editorStoreState.mediaSkimPreviewMediaId = null;

    mediaLibraryServiceMocks.getThumbnailBlobUrl.mockResolvedValue(null);
    mediaLibraryServiceMocks.getMediaFile.mockResolvedValue(new Blob(['video-data']));
    mediaLibraryServiceMocks.getMediaBlobUrl.mockResolvedValue('blob:media-1');
    proxyServiceMocks.canGenerateProxy.mockReturnValue(true);
    proxyServiceMocks.deleteProxy.mockResolvedValue(undefined);
    mediaTranscriptionServiceMocks.transcribeMedia.mockResolvedValue(undefined);
  });

  it('uses the shared action menu to generate a proxy', async () => {
    const media = makeMedia();
    render(<MediaCard media={media} viewMode="list" />);

    fireEvent.click(screen.getByText('Generate Proxy'));

    await waitFor(() => {
      expect(proxyServiceMocks.generateProxy).toHaveBeenCalledTimes(1);
    });
    expect(proxyServiceMocks.setProxyKey).toHaveBeenCalledWith('media-1', 'proxy-media-1');
    const generateProxyCall = proxyServiceMocks.generateProxy.mock.calls[0];
    expect(generateProxyCall?.[0]).toBe('media-1');
    expect(generateProxyCall?.[2]).toBe(3840);
    expect(generateProxyCall?.[3]).toBe(2160);
    expect(generateProxyCall?.[4]).toBe('proxy-media-1');
    expect(typeof generateProxyCall?.[1]).toBe('function');
  });

  it('uses the shared action menu to relink broken media in grid view', () => {
    const onRelink = vi.fn();
    render(<MediaCard media={makeMedia()} isBroken onRelink={onRelink} viewMode="grid" />);

    fireEvent.click(screen.getByText('Relink File...'));

    expect(onRelink).toHaveBeenCalledTimes(1);
  });

  it('allows cancelling proxy generation from the action menu', () => {
    mediaStoreState.proxyStatus = new Map([['media-1', 'generating']]);
    mediaStoreState.proxyProgress = new Map([['media-1', 0.42]]);

    render(<MediaCard media={makeMedia()} viewMode="list" />);

    fireEvent.click(screen.getByText('Cancel Proxy Generation'));

    expect(proxyServiceMocks.cancelProxy).toHaveBeenCalledWith('media-1', 'proxy-media-1');
  });

  it('opens a caption in the source monitor with a default three-second I/O range', () => {
    render(<MediaCard media={makeMedia()} viewMode="list" />);

    fireEvent.click(screen.getByTestId('media-info-popover'));

    expect(sourcePlayerStoreState.setCurrentMediaId).toHaveBeenCalledWith('media-1');
    expect(sourcePlayerStoreState.clearInOutPoints).toHaveBeenCalledTimes(1);
    expect(sourcePlayerStoreState.setInPoint).toHaveBeenCalledWith(75);
    expect(sourcePlayerStoreState.setOutPoint).toHaveBeenCalledWith(150);
    expect(sourcePlayerStoreState.setPendingSeekFrame).toHaveBeenCalledWith(75);
    expect(editorStoreState.setSourcePreviewMediaId).toHaveBeenCalledWith('media-1');
  });
});
