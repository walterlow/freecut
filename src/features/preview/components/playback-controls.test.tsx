import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaybackStore } from '@/shared/state/playback';
import { useMediaLibraryStore, mediaLibraryService } from '@/features/preview/deps/media-library-contract';
import { PlaybackControls } from './playback-controls';

const sonnerMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: sonnerMocks,
}));

describe('PlaybackControls frame capture', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();

    vi.stubGlobal('ResizeObserver', class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    });

    usePlaybackStore.setState({
      currentFrame: 12,
      previewFrame: null,
      displayedFrame: null,
      isPlaying: false,
      volume: 1,
      useProxy: true,
      captureFrame: null,
      captureCanvasSource: async () =>
        ({
          width: 1920,
          height: 1080,
          convertToBlob: async () => new Blob(['frame-bytes'], { type: 'image/png' }),
        }) as unknown as OffscreenCanvas,
    });

    useMediaLibraryStore.setState({
      currentProjectId: 'project-1',
      mediaItems: [],
      mediaById: {},
      selectedMediaIds: [],
      notification: null,
    });

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:frame-download'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('captures the current frame, downloads it, and saves it to the media library', async () => {
    const savedMedia = {
      id: 'captured-frame-1',
      storageType: 'opfs' as const,
      opfsPath: 'content/ca/pt/captured-frame-1/data',
      fileName: 'frame-12.png',
      fileSize: 11,
      mimeType: 'image/png',
      duration: 0,
      width: 1920,
      height: 1080,
      fps: 0,
      codec: 'png',
      bitrate: 0,
      thumbnailId: 'thumbnail-1',
      tags: ['frame-capture'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const importGeneratedImageSpy = vi
      .spyOn(mediaLibraryService, 'importGeneratedImage')
      .mockResolvedValue(savedMedia);

    render(<PlaybackControls totalFrames={1000} fps={30} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save frame' }));

    await waitFor(() => {
      expect(importGeneratedImageSpy).toHaveBeenCalledTimes(1);
    });

    const [importedFile, projectId, options] = importGeneratedImageSpy.mock.calls[0] ?? [];
    expect(importedFile).toBeInstanceOf(File);
    expect((importedFile as File).name).toBe('frame-012-00-00-00-12.png');
    expect(projectId).toBe('project-1');
    expect(options).toEqual(expect.objectContaining({
      width: 1920,
      height: 1080,
      tags: ['frame-capture'],
      codec: 'png',
    }));

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(useMediaLibraryStore.getState().mediaItems[0]?.id).toBe('captured-frame-1');
    expect(sonnerMocks.success).toHaveBeenCalledTimes(1);
    expect(sonnerMocks.error).not.toHaveBeenCalled();
  });
});
