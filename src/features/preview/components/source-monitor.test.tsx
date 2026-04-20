import { StrictMode, type ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const editorStoreState = vi.hoisted(() => ({
  sourcePreviewMediaId: 'media-1' as string | null,
}));

const sourcePlayerStoreState = vi.hoisted(() => ({
  hoveredPanel: null as string | null,
  playerMethods: null as unknown,
  currentMediaId: null as string | null,
  currentSourceFrame: 0,
  inPoint: null as number | null,
  outPoint: null as number | null,
  pendingSeekFrame: null as number | null,
  setHoveredPanel: vi.fn(),
  setPlayerMethods: vi.fn(),
  setCurrentMediaId: vi.fn(),
  releaseCurrentMediaId: vi.fn(),
  setCurrentSourceFrame: vi.fn(),
  setInPoint: vi.fn(),
  setOutPoint: vi.fn(),
  clearInOutPoints: vi.fn(),
  setPendingSeekFrame: vi.fn(),
}));

const mediaStoreState = vi.hoisted(() => ({
  mediaItems: [{
    id: 'media-1',
    fileName: 'clip.mp4',
    mimeType: 'video/mp4',
    duration: 5,
    width: 1920,
    height: 1080,
    fps: 30,
    audioCodec: 'aac',
  }],
}));

const itemsStoreState = vi.hoisted(() => ({
  tracks: [],
}));

vi.mock('@/features/preview/deps/player-context', () => ({
  PlayerEmitterProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  ClockBridgeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  VideoConfigProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useClock: () => ({
    currentFrame: 0,
    isPlaying: false,
    onFrameChange: () => () => {},
  }),
  useClockIsPlaying: () => false,
  usePlayer: () => ({
    seek: vi.fn(),
    play: vi.fn(),
    toggle: vi.fn(),
    frameBack: vi.fn(),
    frameForward: vi.fn(),
  }),
}));

vi.mock('./source-composition', () => ({
  SourceComposition: () => <div data-testid="source-composition" />,
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuSeparator: () => null,
}));

vi.mock('../utils/media-resolver', () => ({
  resolveMediaUrl: vi.fn().mockResolvedValue('blob:media-1'),
}));

vi.mock('@/features/preview/deps/media-library', () => {
  const useMediaLibraryStore = Object.assign(
    (selector: (state: typeof mediaStoreState) => unknown) => selector(mediaStoreState),
    { getState: () => mediaStoreState },
  );

  return {
    useMediaLibraryStore,
    getMediaType: (mimeType: string) => {
      if (mimeType.startsWith('video/')) return 'video';
      if (mimeType.startsWith('audio/')) return 'audio';
      if (mimeType.startsWith('image/')) return 'image';
      return 'unknown';
    },
  };
});

vi.mock('@/features/preview/deps/timeline-store', () => {
  const useItemsStore = Object.assign(
    (selector: (state: typeof itemsStoreState) => unknown) => selector(itemsStoreState),
    { getState: () => itemsStoreState },
  );

  return { useItemsStore };
});

vi.mock('@/features/preview/deps/settings', () => {
  const settingsState = { editorDensity: 'compact' as const };
  const useSettingsStore = Object.assign(
    (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
    { getState: () => settingsState },
  );

  return { useSettingsStore };
});

vi.mock('@/app/state/editor', () => {
  const useEditorStore = Object.assign(
    (selector: (state: typeof editorStoreState) => unknown) => selector(editorStoreState),
    { getState: () => editorStoreState },
  );

  return { useEditorStore };
});

vi.mock('@/shared/state/source-player', () => {
  const useSourcePlayerStore = Object.assign(
    (selector: (state: typeof sourcePlayerStoreState) => unknown) => selector(sourcePlayerStoreState),
    { getState: () => sourcePlayerStoreState },
  );

  return { useSourcePlayerStore };
});

vi.mock('@/shared/state/selection', () => {
  const selectionState = { activeTrackId: null as string | null };
  const useSelectionStore = Object.assign(
    (selector: (state: typeof selectionState) => unknown) => selector(selectionState),
    { getState: () => selectionState },
  );

  return { useSelectionStore };
});

vi.mock('@/features/preview/deps/timeline-source-edit', () => ({
  getTrackKind: (track: { kind?: string | null }) => track.kind ?? null,
  performInsertEdit: vi.fn(),
  performOverwriteEdit: vi.fn(),
  resolveSourceEditTrackTargets: vi.fn(() => null),
}));

import { SourceMonitor } from './source-monitor';

describe('SourceMonitor current media ownership', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    editorStoreState.sourcePreviewMediaId = 'media-1';
  });

  it('does not release the current media during the initial Strict Mode remount', async () => {
    render(
      <StrictMode>
        <SourceMonitor mediaId="media-1" />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(sourcePlayerStoreState.setCurrentMediaId).toHaveBeenCalledWith('media-1');
    });

    expect(sourcePlayerStoreState.releaseCurrentMediaId).not.toHaveBeenCalled();
  });

  it('releases the current media once the source monitor closes', async () => {
    const rendered = render(<SourceMonitor mediaId="media-1" />);

    await waitFor(() => {
      expect(sourcePlayerStoreState.setCurrentMediaId).toHaveBeenCalledWith('media-1');
    });

    editorStoreState.sourcePreviewMediaId = null;
    rendered.unmount();

    expect(sourcePlayerStoreState.releaseCurrentMediaId).toHaveBeenCalledWith('media-1');
  });

});
