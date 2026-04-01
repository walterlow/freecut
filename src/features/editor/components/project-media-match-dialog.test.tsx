import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { MediaMetadata } from '@/types/storage';
import { useProjectMediaMatchDialogStore } from '@/shared/state/project-media-match-dialog';

const mocks = vi.hoisted(() => ({
  updateProject: vi.fn(),
  markDirty: vi.fn(),
  setFps: vi.fn(),
  addUndoEntry: vi.fn(),
  captureSnapshot: vi.fn(() => ({
    items: [],
    tracks: [],
    transitions: [],
    keyframes: [],
    markers: [],
    compositions: [],
    inPoint: null,
    outPoint: null,
    fps: 30,
    scrollPosition: 0,
    snapEnabled: true,
    currentFrame: 0,
    projectId: 'project-1',
    projectMetadata: {
      width: 1280,
      height: 720,
      fps: 30,
      backgroundColor: '#000000',
    },
  })),
  toastError: vi.fn(),
}));

let mediaState: {
  mediaItems: MediaMetadata[];
  isLoading: boolean;
};

let projectState: {
  currentProject: {
    id: string;
    metadata: {
      width: number;
      height: number;
      fps: number;
    };
  } | null;
};

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

vi.mock('@/features/editor/deps/media-library', () => ({
  useMediaLibraryStore: (selector: (state: typeof mediaState) => unknown) => selector(mediaState),
}));

vi.mock('@/features/editor/deps/projects', () => ({
  useProjectStore: Object.assign(
    (selector: (state: typeof projectState & { updateProject: typeof mocks.updateProject }) => unknown) =>
      selector({
        ...projectState,
        updateProject: mocks.updateProject,
      }),
    {
      getState: () => ({
        ...projectState,
        updateProject: mocks.updateProject,
      }),
    }
  ),
  formatFpsValue: (fps: number) =>
    Number.isInteger(fps) ? `${fps}` : fps.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''),
  resolveAutoMatchProjectFps: (sourceFps: number) => {
    const candidates = [24, 25, 30, 50, 60];
    let closest = candidates[0];
    let smallestDelta = Math.abs(sourceFps - closest);

    for (const candidate of candidates.slice(1)) {
      const delta = Math.abs(sourceFps - candidate);
      if (delta < smallestDelta) {
        closest = candidate;
        smallestDelta = delta;
      }
    }

    return { fps: closest, exact: Math.abs(sourceFps - closest) < 0.001 };
  },
}));

vi.mock('@/features/editor/deps/timeline-store', () => ({
  useTimelineStore: (selector: (state: { markDirty: typeof mocks.markDirty; setFps: typeof mocks.setFps }) => unknown) =>
    selector({
      markDirty: mocks.markDirty,
      setFps: mocks.setFps,
    }),
  useTimelineSettingsStore: (selector: (state: { setFps: typeof mocks.setFps }) => unknown) =>
    selector({
      setFps: mocks.setFps,
    }),
  useTimelineCommandStore: Object.assign(
    (selector: (state: { addUndoEntry: typeof mocks.addUndoEntry }) => unknown) =>
      selector({
        addUndoEntry: mocks.addUndoEntry,
      }),
    {
      getState: () => ({
        addUndoEntry: mocks.addUndoEntry,
      }),
    }
  ),
  captureSnapshot: mocks.captureSnapshot,
}));

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
  },
}));

import { ProjectMediaMatchDialog } from './project-media-match-dialog';

function makeVideo(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    id: 'video-1',
    storageType: 'handle',
    fileName: 'clip.mp4',
    fileSize: 1_000,
    fileLastModified: 1,
    mimeType: 'video/mp4',
    duration: 10,
    width: 1920,
    height: 1080,
    fps: 59.94,
    codec: 'h264',
    bitrate: 10_000_000,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('ProjectMediaMatchDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectMediaMatchDialogStore.getState().resetProjectMediaMatchDialog();

    mediaState = {
      mediaItems: [],
      isLoading: true,
    };

    projectState = {
      currentProject: {
        id: 'project-1',
        metadata: {
          width: 1280,
          height: 720,
          fps: 30,
        },
      },
    };

    mocks.updateProject.mockImplementation(async (_id: string, data: Record<string, unknown>) => ({
      ...projectState.currentProject!,
      metadata: {
        ...projectState.currentProject!.metadata,
        ...data,
      },
    }));
  });

  it('prompts on the first imported video and can match both size and fps', async () => {
    const { rerender } = render(<ProjectMediaMatchDialog projectId="project-1" />);

    mediaState = {
      mediaItems: [],
      isLoading: false,
    };
    rerender(<ProjectMediaMatchDialog projectId="project-1" />);

    mediaState = {
      mediaItems: [makeVideo()],
      isLoading: false,
    };
    rerender(<ProjectMediaMatchDialog projectId="project-1" />);

    await waitFor(() =>
      expect(screen.getByText('Match Project To First Video?')).toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: 'Match Both' }));

    await waitFor(() =>
      expect(mocks.updateProject).toHaveBeenCalledWith('project-1', {
        width: 1920,
        height: 1080,
        fps: 60,
      })
    );
    expect(mocks.setFps).toHaveBeenCalledWith(60);
    expect(mocks.markDirty).toHaveBeenCalledTimes(1);
  });

  it('does not prompt again once the project already had a video', async () => {
    mediaState = {
      mediaItems: [makeVideo({ id: 'existing-video' })],
      isLoading: false,
    };

    const { rerender } = render(<ProjectMediaMatchDialog projectId="project-1" />);

    mediaState = {
      mediaItems: [
        makeVideo({ id: 'new-video', createdAt: 2 }),
        makeVideo({ id: 'existing-video', createdAt: 1 }),
      ],
      isLoading: false,
    };
    rerender(<ProjectMediaMatchDialog projectId="project-1" />);

    await waitFor(() =>
      expect(screen.queryByText('Match Project To First Video?')).not.toBeInTheDocument()
    );
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it('can be requested imperatively before import flows continue', async () => {
    render(<ProjectMediaMatchDialog projectId="project-1" />);

    let pendingChoice: Promise<'match-both' | 'fps-only' | 'size-only' | 'keep-current'>;
    await act(async () => {
      pendingChoice = useProjectMediaMatchDialogStore.getState().requestProjectMediaMatch('project-1', {
        fileName: 'drop.mp4',
        width: 1920,
        height: 1080,
        fps: 59.94,
      });
    });

    await waitFor(() =>
      expect(screen.getByText('Match Project To First Video?')).toBeInTheDocument()
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'FPS Only' }));
    });

    await expect(pendingChoice!).resolves.toBe('fps-only');
    expect(mocks.updateProject).toHaveBeenCalledWith('project-1', { fps: 60 });
    expect(mocks.setFps).toHaveBeenCalledWith(60);
  });
});
