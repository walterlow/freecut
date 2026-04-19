import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

const ensureEmbeddingsLoadedMock = vi.fn();
const indexMediaCaptionsMock = vi.fn();
const indexMediaImageCaptionsMock = vi.fn();
const isMediaMissingEmbeddingsMock = vi.fn();
const isMediaMissingImageEmbeddingsMock = vi.fn();

type MediaItem = {
  id: string;
  aiCaptions?: Array<{ timeSec: number; text: string }>;
};

const useMediaLibraryStore = create<{
  mediaItems: MediaItem[];
  taggingMediaIds: Set<string>;
}>(() => ({
  mediaItems: [],
  taggingMediaIds: new Set<string>(),
}));

const useSettingsStore = create<{
  captionSearchMode: 'keyword' | 'semantic';
}>(() => ({
  captionSearchMode: 'keyword',
}));

vi.mock('../deps/media-library', () => ({
  useMediaLibraryStore,
}));

vi.mock('../deps/settings', () => ({
  useSettingsStore,
}));

vi.mock('../utils/embeddings-cache', () => ({
  ensureEmbeddingsLoaded: ensureEmbeddingsLoadedMock,
  indexMediaCaptions: indexMediaCaptionsMock,
  indexMediaImageCaptions: indexMediaImageCaptionsMock,
  isMediaMissingEmbeddings: isMediaMissingEmbeddingsMock,
  isMediaMissingImageEmbeddings: isMediaMissingImageEmbeddingsMock,
}));

const { useSemanticIndex } = await import('./use-semantic-index');

function SemanticIndexProbe() {
  const progress = useSemanticIndex();
  return (
    <div
      data-testid="semantic-index-probe"
      data-indexing={String(progress.indexing)}
      data-total={String(progress.indexTotal)}
      data-loading={String(progress.loadingModel)}
    />
  );
}

describe('useSemanticIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ captionSearchMode: 'semantic' });
    useMediaLibraryStore.setState({
      mediaItems: [
        {
          id: 'media-1',
          aiCaptions: [{ timeSec: 0, text: 'A scene' }],
        },
      ],
      taggingMediaIds: new Set<string>(),
    });
  });

  it('clears stale progress when a rerun becomes a no-op after store updates', async () => {
    let textIndexed = false;

    ensureEmbeddingsLoadedMock.mockResolvedValue(undefined);
    isMediaMissingEmbeddingsMock.mockImplementation(() => !textIndexed);
    isMediaMissingImageEmbeddingsMock.mockReturnValue(false);
    indexMediaImageCaptionsMock.mockResolvedValue(undefined);
    indexMediaCaptionsMock.mockImplementation(async (mediaId: string) => {
      await Promise.resolve();
      textIndexed = true;
      useMediaLibraryStore.setState((state) => ({
        mediaItems: state.mediaItems.map((item) => (
          item.id === mediaId
            ? { ...item, aiCaptions: [...(item.aiCaptions ?? [])] }
            : item
        )),
      }));
      await Promise.resolve();
    });

    render(<SemanticIndexProbe />);

    await waitFor(() => {
      expect(screen.getByTestId('semantic-index-probe')).toHaveAttribute('data-total', '1');
    });

    await waitFor(() => {
      expect(indexMediaCaptionsMock).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByTestId('semantic-index-probe')).toHaveAttribute('data-indexing', '0');
      expect(screen.getByTestId('semantic-index-probe')).toHaveAttribute('data-total', '0');
      expect(screen.getByTestId('semantic-index-probe')).toHaveAttribute('data-loading', 'false');
    });
  });
});
