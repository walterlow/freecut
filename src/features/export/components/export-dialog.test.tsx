import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientCodec } from '../utils/client-renderer';
import { ExportDialog } from './export-dialog';

const mockStartExport = vi.fn();
const mockCancelExport = vi.fn();
const mockDownloadVideo = vi.fn();
const mockResetState = vi.fn();
const mockGetSupportedCodecs = vi.fn<(...args: unknown[]) => Promise<ClientCodec[]>>();

vi.mock('../hooks/use-client-render', () => ({
  useClientRender: () => ({
    isExporting: false,
    progress: 0,
    renderedFrames: undefined,
    totalFrames: undefined,
    status: 'idle',
    error: null,
    result: null,
    startExport: mockStartExport,
    cancelExport: mockCancelExport,
    downloadVideo: mockDownloadVideo,
    resetState: mockResetState,
    getSupportedCodecs: mockGetSupportedCodecs,
    estimateFileSize: vi.fn(),
  }),
}));

vi.mock('@/features/export/deps/projects', () => ({
  useProjectStore: (selector: (state: { currentProject: { metadata: { width: number; height: number } } }) => unknown) =>
    selector({
      currentProject: {
        metadata: {
          width: 1920,
          height: 1080,
        },
      },
    }),
}));

vi.mock('@/features/export/deps/timeline', () => ({
  useTimelineStore: (selector: (state: {
    fps: number;
    items: Array<{ from: number; durationInFrames: number }>;
    inPoint: number | null;
    outPoint: number | null;
  }) => unknown) =>
    selector({
      fps: 30,
      items: [],
      inPoint: null,
      outPoint: null,
    }),
}));

vi.mock('./export-preview-player', () => ({
  ExportPreviewPlayer: () => <div data-testid="export-preview-player" />,
}));

describe('ExportDialog', () => {
  beforeEach(() => {
    mockStartExport.mockReset();
    mockCancelExport.mockReset();
    mockDownloadVideo.mockReset();
    mockResetState.mockReset();
    mockGetSupportedCodecs.mockReset();

    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = () => {};
    }
  });

  it('defaults to mp4 with H.264 codec', async () => {
    mockGetSupportedCodecs.mockResolvedValue(['avc']);

    render(<ExportDialog open onClose={() => {}} />);

    await waitFor(() => {
      expect(mockGetSupportedCodecs).toHaveBeenCalledWith({
        resolution: { width: 1920, height: 1080 },
        quality: 'high',
      });
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Format')).toHaveTextContent('MP4');
      expect(screen.getByLabelText('Codec')).toHaveTextContent('H.264');
    });
  });

  it('disables unsupported format and codec choices in the browser capability matrix', async () => {
    mockGetSupportedCodecs.mockResolvedValue(['avc']);

    render(<ExportDialog open onClose={() => {}} />);

    await waitFor(() => {
      expect(mockGetSupportedCodecs).toHaveBeenCalled();
    });

    fireEvent.keyDown(screen.getByLabelText('Format'), { key: 'ArrowDown' });

    const webmOption = await screen.findByRole('option', { name: /WebM/i });
    expect(webmOption).toHaveAttribute('data-disabled');

    fireEvent.keyDown(screen.getByLabelText('Format'), { key: 'Escape' });
    fireEvent.keyDown(screen.getByLabelText('Codec'), { key: 'ArrowDown' });

    const h265Option = await screen.findByRole('option', { name: /H\.265/i });
    expect(h265Option).toHaveAttribute('data-disabled');
  });
});
