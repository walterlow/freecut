import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MouseEvent, ReactNode } from 'react';
import type { MediaMetadata } from '@/types/storage';

const mediaLibraryServiceMocks = vi.hoisted(() => ({
  getThumbnailBlobUrl: vi.fn(),
  getMediaFile: vi.fn(),
  getMediaBlobUrl: vi.fn(),
  updateMediaCaptions: vi.fn(),
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
  deleteTranscript: vi.fn(),
  cancelTranscription: vi.fn(),
}));

const mediaStoreState = vi.hoisted(() => ({
  selectedMediaIds: [] as string[],
  mediaItems: [] as MediaMetadata[],
  importingIds: [] as string[],
  proxyStatus: new Map<string, 'generating' | 'ready' | 'error'>(),
  proxyProgress: new Map<string, number>(),
  transcriptStatus: new Map<string, 'idle' | 'queued' | 'transcribing' | 'ready' | 'error'>(),
  transcriptProgress: new Map(),
  taggingMediaIds: new Set<string>(),
  setProxyStatus: vi.fn(),
  clearProxyStatus: vi.fn(),
  setTranscriptStatus: vi.fn(),
  setTranscriptProgress: vi.fn(),
  clearTranscriptProgress: vi.fn(),
  setTaggingMedia: vi.fn(),
  updateMediaCaptions: vi.fn(),
  showNotification: vi.fn(),
  analysisProgress: null as null | { total: number; completed: number; cancelRequested: boolean },
  beginAnalysisRun: vi.fn(),
  incrementAnalysisCompleted: vi.fn(),
  requestAnalysisCancel: vi.fn(),
  endAnalysisRun: vi.fn(),
}));

const analysisMocks = vi.hoisted(() => ({
  captionVideo: vi.fn(),
  captionImage: vi.fn(),
}));

const editorStoreState = vi.hoisted(() => ({
  setSourcePreviewMediaId: vi.fn(),
  setMediaSkimPreview: vi.fn(),
  clearMediaSkimPreview: vi.fn(),
  mediaSkimPreviewMediaId: null as string | null,
}));

const playbackStoreState = vi.hoisted(() => ({
  pause: vi.fn(),
}));

const sourcePlayerStoreState = vi.hoisted(() => ({
  setCurrentMediaId: vi.fn(),
  clearInOutPoints: vi.fn(),
  setInPoint: vi.fn(),
  setOutPoint: vi.fn(),
  setPendingSeekFrame: vi.fn(),
}));

vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
  }) => <button disabled={disabled} onClick={onClick}>{children}</button>,
  ContextMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ContextMenuSeparator: () => <hr />,
}));

vi.mock('./transcribe-dialog', () => ({
  TranscribeDialog: ({
    open,
    onStart,
    onCancel,
  }: {
    open: boolean;
    onStart: (values: {
      model: string;
      quantization: string;
      language: string;
    }) => void;
    onCancel: () => void;
  }) =>
    open ? (
      <div data-testid="transcribe-dialog">
        <button
          type="button"
          onClick={() =>
            onStart({
              model: 'whisper-base',
              quantization: 'hybrid',
              language: '',
            })
          }
        >
          Start Transcription
        </button>
        <button type="button" onClick={() => onCancel()}>
          Stop Transcription
        </button>
      </div>
    ) : null,
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

vi.mock('@/shared/state/playback', () => {
  const usePlaybackStore = Object.assign(
    (selector: (state: typeof playbackStoreState) => unknown) => selector(playbackStoreState),
    {
      getState: () => playbackStoreState,
    }
  );

  return { usePlaybackStore };
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

vi.mock('../deps/analysis', () => analysisMocks);

const settingsStoreState = vi.hoisted(() => ({
  captioningIntervalUnit: 'seconds' as const,
  captioningIntervalValue: 3,
}));

vi.mock('../deps/settings-contract', () => ({
  useSettingsStore: {
    getState: () => settingsStoreState,
  },
  resolveCaptioningIntervalSec: (unit: 'seconds' | 'frames', value: number, fps: number) => (
    unit === 'seconds' ? value : value / (fps > 0 ? fps : 30)
  ),
  DEFAULT_CAPTIONING_INTERVAL_SECONDS: 3,
}));

vi.mock('@/infrastructure/storage', () => ({
  saveCaptionThumbnail: vi.fn(async () => undefined),
  deleteCaptionThumbnails: vi.fn(async () => undefined),
  deleteCaptionEmbeddings: vi.fn(async () => undefined),
  saveCaptionEmbeddings: vi.fn(async () => undefined),
  saveCaptionImageEmbeddings: vi.fn(async () => undefined),
  getCaptionThumbnailBlob: vi.fn(async () => null),
  getTranscript: vi.fn(async () => null),
}));

vi.mock('../deps/scene-browser', () => ({
  invalidateMediaCaptionThumbnails: vi.fn(),
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
    vi.useRealTimers();
    mediaStoreState.selectedMediaIds = [];
    mediaStoreState.mediaItems = [makeMedia()];
    mediaStoreState.importingIds = [];
    mediaStoreState.proxyStatus = new Map();
    mediaStoreState.proxyProgress = new Map();
    mediaStoreState.transcriptStatus = new Map();
    mediaStoreState.transcriptProgress = new Map();
    mediaStoreState.taggingMediaIds = new Set();
    editorStoreState.mediaSkimPreviewMediaId = null;
    playbackStoreState.pause.mockReset();

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

  it('opens the transcribe dialog and defers work until the user confirms', async () => {
    const media = makeMedia();
    mediaTranscriptionServiceMocks.transcribeMedia.mockResolvedValue(undefined);

    render(<MediaCard media={media} viewMode="list" />);

    fireEvent.click(screen.getByText('Generate Transcript'));

    // Clicking the menu item opens the dialog; transcription has NOT started.
    expect(screen.getByTestId('transcribe-dialog')).toBeInTheDocument();
    expect(mediaTranscriptionServiceMocks.transcribeMedia).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Start Transcription'));

    await waitFor(() => {
      expect(mediaTranscriptionServiceMocks.transcribeMedia).toHaveBeenCalledWith(
        'media-1',
        expect.objectContaining({
          model: 'whisper-base',
          quantization: 'hybrid',
          onProgress: expect.any(Function),
        }),
      );
    });
  });

  it('uses transcript wording in the media action menu', () => {
    const { rerender } = render(<MediaCard media={makeMedia()} viewMode="list" />);
    expect(screen.getByText('Generate Transcript')).toBeInTheDocument();

    mediaStoreState.transcriptStatus = new Map([['media-1', 'ready']]);
    rerender(<MediaCard media={makeMedia()} viewMode="list" />);
    expect(screen.getByText('Refresh Transcript')).toBeInTheDocument();
    expect(screen.getByText('Delete Transcript')).toBeInTheDocument();
  });

  it('shows the inline transcript progress bar while transcribing', () => {
    mediaStoreState.transcriptStatus = new Map([['media-1', 'queued']]);
    mediaStoreState.transcriptProgress = new Map([
      ['media-1', { stage: 'queued', progress: 0 }],
    ]);

    render(<MediaCard media={makeMedia()} viewMode="list" />);

    expect(screen.getByRole('progressbar', { name: 'Transcript progress' }))
      .toHaveAttribute('aria-valuenow', '0');
  });

  it('deletes a transcript from the media action menu', async () => {
    mediaStoreState.transcriptStatus = new Map([['media-1', 'ready']]);
    mediaTranscriptionServiceMocks.deleteTranscript.mockResolvedValue(undefined);

    render(<MediaCard media={makeMedia()} viewMode="list" />);

    fireEvent.click(screen.getByText('Delete Transcript'));

    await waitFor(() => {
      expect(mediaTranscriptionServiceMocks.deleteTranscript).toHaveBeenCalledWith('media-1');
    });
    expect(mediaStoreState.setTranscriptStatus).toHaveBeenCalledWith('media-1', 'idle');
    expect(mediaStoreState.clearTranscriptProgress).toHaveBeenCalledWith('media-1');
    expect(mediaStoreState.showNotification).toHaveBeenCalledWith({
      type: 'success',
      message: 'Transcript deleted for "clip.mp4"',
    });
  });

  it('uses the shared action menu to relink broken media in grid view', () => {
    const onRelink = vi.fn();
    render(<MediaCard media={makeMedia()} isBroken onRelink={onRelink} viewMode="grid" />);

    fireEvent.click(screen.getByText('Relink File...'));

    expect(onRelink).toHaveBeenCalledTimes(1);
  });

  it('shows an active AI analysis badge in list view while analysis is running', () => {
    mediaStoreState.taggingMediaIds = new Set(['media-1']);

    const { container } = render(<MediaCard media={makeMedia()} viewMode="list" />);

    expect(container.querySelector('[title="Analyzing with AI"]')).toBeTruthy();
  });

  it('shows an active AI analysis badge in grid view while analysis is running', () => {
    mediaStoreState.taggingMediaIds = new Set(['media-1']);

    const { container } = render(<MediaCard media={makeMedia()} viewMode="grid" />);

    expect(container.querySelector('[title="Analyzing with AI"]')).toBeTruthy();
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

  it('pauses timeline playback and updates skim preview while hovering a video thumbnail', () => {
    const { container } = render(<MediaCard media={makeMedia()} viewMode="list" />);

    const thumbnail = container.querySelector('.w-12.h-9') as HTMLDivElement;
    expect(thumbnail).toBeTruthy();
    vi.spyOn(thumbnail, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 36,
      right: 100,
      width: 100,
      height: 36,
      toJSON: () => ({}),
    });

    fireEvent.pointerEnter(thumbnail, {
      clientX: 20,
      pointerType: 'mouse',
    });

    expect(playbackStoreState.pause).toHaveBeenCalledTimes(1);
    expect(editorStoreState.setMediaSkimPreview).toHaveBeenCalledWith('media-1', 30);

    fireEvent.pointerMove(thumbnail, {
      clientX: 50,
      pointerType: 'mouse',
    });

    fireEvent.pointerLeave(thumbnail);

    expect(editorStoreState.clearMediaSkimPreview).toHaveBeenCalledTimes(1);
  });

  it('stores AI analysis on the media item without inserting timeline captions', async () => {
    const media = makeMedia({
      fileName: 'frame.png',
      mimeType: 'image/png',
      duration: 0,
      fps: 0,
      codec: '',
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      blob: async () => new Blob(['image-data']),
    } as Response);
    analysisMocks.captionImage.mockResolvedValue([
      {
        timeSec: 1.25,
        text: 'First line',
        sceneData: {
          caption: 'First line',
          shotType: 'medium close-up',
          timeOfDay: 'dusk',
          weather: 'rainy',
        },
      },
      { timeSec: 2.5, text: 'Second line' },
    ]);

    render(<MediaCard media={media} viewMode="list" />);

    fireEvent.click(screen.getByText('Analyze with AI'));

    await waitFor(() => {
      expect(mediaLibraryServiceMocks.updateMediaCaptions).toHaveBeenCalledWith(
        'media-1',
        [
          {
            timeSec: 1.25,
            text: 'First line',
            sceneData: {
              caption: 'First line',
              shotType: 'medium close-up',
              timeOfDay: 'dusk',
              weather: 'rainy',
            },
          },
          { timeSec: 2.5, text: 'Second line' },
        ],
        expect.objectContaining({ sampleIntervalSec: expect.any(Number) }),
      );
    });

    expect(mediaStoreState.updateMediaCaptions).toHaveBeenCalledWith('media-1', [
      {
        timeSec: 1.25,
        text: 'First line',
        sceneData: {
          caption: 'First line',
          shotType: 'medium close-up',
          timeOfDay: 'dusk',
          weather: 'rainy',
        },
      },
      { timeSec: 2.5, text: 'Second line' },
    ]);
    expect(mediaStoreState.showNotification).toHaveBeenCalledWith({
      type: 'success',
      message: 'Generated 2 scene captions for "frame.png"',
    });
    fetchMock.mockRestore();
  });
});
