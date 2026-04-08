import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn(),
  loadTimeline: vi.fn().mockResolvedValue(undefined),
  loadMediaItems: vi.fn().mockResolvedValue(undefined),
  saveTimeline: vi.fn().mockResolvedValue(undefined),
  setMediaProject: vi.fn(),
  setProject: vi.fn(),
  pausePlayback: vi.fn(),
  setPreviewFrame: vi.fn(),
  setPreviewQuality: vi.fn(),
  toggleSnap: vi.fn(),
  syncSidebarLayout: vi.fn(),
  clearPreviewAudioCache: vi.fn(),
  importExportDialog: vi.fn().mockResolvedValue({
    ExportDialog: () => <div data-testid="export-dialog" />,
  }),
  importBundleExportDialog: vi.fn().mockResolvedValue({
    BundleExportDialog: () => <div data-testid="bundle-export-dialog" />,
  }),
  initTransitionChainSubscription: vi.fn(() => vi.fn()),
  createProjectUpgradeBackup: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useRouter: () => ({
    invalidate: mocks.invalidate,
  }),
}));

vi.mock('@/shared/logging/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div data-testid="resizable-handle" />,
}));

vi.mock('@/components/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('./toolbar', () => ({
  Toolbar: () => <div data-testid="toolbar" />,
}));

vi.mock('./media-sidebar', () => ({
  MediaSidebar: () => <div data-testid="media-sidebar" />,
}));

vi.mock('./properties-sidebar', () => ({
  PropertiesSidebar: () => <div data-testid="properties-sidebar" />,
}));

vi.mock('./preview-area', () => ({
  PreviewArea: () => <div data-testid="preview-area" />,
}));

vi.mock('./project-debug-panel', () => ({
  ProjectDebugPanel: () => <div data-testid="project-debug-panel" />,
}));

vi.mock('./interaction-lock-region', () => ({
  InteractionLockRegion: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('./audio-meter-panel', () => ({
  AudioMeterPanel: () => <div data-testid="audio-meter-panel" />,
}));

vi.mock('@/features/editor/deps/timeline-ui', () => ({
  Timeline: () => <div data-testid="timeline" />,
  BentoLayoutDialog: () => null,
}));

vi.mock('./clear-keyframes-dialog', () => ({
  ClearKeyframesDialog: () => null,
}));

vi.mock('./project-media-match-dialog', () => ({
  ProjectMediaMatchDialog: () => null,
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@/features/editor/hooks/use-editor-hotkeys', () => ({
  useEditorHotkeys: vi.fn(),
}));

vi.mock('../hooks/use-auto-save', () => ({
  useAutoSave: vi.fn(),
}));

vi.mock('@/features/editor/deps/timeline-hooks', () => ({
  useTimelineShortcuts: vi.fn(),
  useTransitionBreakageNotifications: vi.fn(),
}));

vi.mock('@/features/editor/deps/timeline-subscriptions', () => ({
  initTransitionChainSubscription: mocks.initTransitionChainSubscription,
}));

vi.mock('@/features/editor/deps/timeline-store', () => {
  const useTimelineStore = Object.assign(
    (selector: (state: { isDirty: boolean }) => unknown) => selector({ isDirty: false }),
    {
      getState: () => ({
        loadTimeline: mocks.loadTimeline,
        saveTimeline: mocks.saveTimeline,
        snapEnabled: true,
        toggleSnap: mocks.toggleSnap,
      }),
    }
  );

  return { useTimelineStore };
});

vi.mock('@/features/editor/deps/project-bundle', () => ({
  importBundleExportDialog: mocks.importBundleExportDialog,
}));

vi.mock('@/features/editor/deps/media-library', () => {
  const useMediaLibraryStore = Object.assign(() => undefined, {
    getState: () => ({
      setCurrentProject: mocks.setMediaProject,
      loadMediaItems: mocks.loadMediaItems,
    }),
  });

  return { useMediaLibraryStore };
});

vi.mock('@/features/editor/deps/settings', () => ({
  useSettingsStore: (
    selector: (state: {
      editorDensity: string;
      snapEnabled: boolean;
    }) => unknown
  ) =>
    selector({
      editorDensity: 'comfortable',
      snapEnabled: true,
    }),
}));

vi.mock('@/features/editor/deps/preview', () => ({
  useMaskEditorStore: (selector: (state: { isEditing: boolean }) => unknown) =>
    selector({ isEditing: false }),
}));

vi.mock('@/shared/state/playback', () => {
  const usePlaybackStore = Object.assign(() => undefined, {
    getState: () => ({
      pause: mocks.pausePlayback,
      setPreviewFrame: mocks.setPreviewFrame,
      setPreviewQuality: mocks.setPreviewQuality,
    }),
  });

  return { usePlaybackStore };
});

vi.mock('@/shared/state/editor', () => ({
  useEditorStore: (selector: (state: { syncSidebarLayout: typeof mocks.syncSidebarLayout }) => unknown) =>
    selector({ syncSidebarLayout: mocks.syncSidebarLayout }),
}));

vi.mock('@/features/editor/deps/composition-runtime', () => ({
  clearPreviewAudioCache: mocks.clearPreviewAudioCache,
}));

vi.mock('@/features/editor/deps/projects', () => {
  const useProjectStore = Object.assign(() => undefined, {
    getState: () => ({
      setCurrentProject: mocks.setProject,
    }),
  });

  return { useProjectStore };
});

vi.mock('@/features/editor/deps/export-contract', () => ({
  importExportDialog: mocks.importExportDialog,
}));

vi.mock('@/shared/ui/editor-layout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/ui/editor-layout')>();
  const layout = {
    ...actual.EDITOR_LAYOUT,
    timelineDefaultSize: 35,
    timelineMinSize: 20,
    timelineMaxSize: 60,
  };

  return {
    ...actual,
    EDITOR_LAYOUT: layout,
    getEditorLayout: () => layout,
    getEditorLayoutCssVars: () => ({}),
  };
});

vi.mock('@/features/projects/services/project-upgrade-service', () => ({
  createProjectUpgradeBackup: mocks.createProjectUpgradeBackup,
}));

vi.mock('@/features/projects/utils/project-helpers', () => ({
  formatProjectUpgradeBackupName: () => 'Backup',
}));

vi.mock('./project-upgrade-dialog', () => ({
  ProjectUpgradeDialog: () => null,
}));

import { LoadedEditor } from './editor';

describe('LoadedEditor migration metadata refresh', () => {
  beforeAll(() => {
    vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
      callback({
        didTimeout: false,
        timeRemaining: () => 50,
      } as IdleDeadline);
      return 1;
    });
    vi.stubGlobal('cancelIdleCallback', vi.fn());
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadTimeline.mockResolvedValue(undefined);
    mocks.loadMediaItems.mockResolvedValue(undefined);
    mocks.invalidate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('refreshes the editor route cache after opening an approved legacy project', async () => {
    render(
      <LoadedEditor
        projectId="project-1"
        project={{
          id: 'project-1',
          name: 'Legacy Project',
          width: 1920,
          height: 1080,
          fps: 30,
        }}
        migration={{
          storedSchemaVersion: 4,
          currentSchemaVersion: 9,
          requiresUpgrade: true,
        }}
      />
    );

    await waitFor(() =>
      expect(mocks.loadTimeline).toHaveBeenCalledWith('project-1', {
        allowProjectUpgrade: true,
      })
    );
    expect(mocks.loadMediaItems).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledTimes(1));

    const invalidateOptions = mocks.invalidate.mock.calls[0]?.[0];
    expect(invalidateOptions).toBeTruthy();
    expect(
      invalidateOptions.filter({
        routeId: '/editor/$projectId',
        params: { projectId: 'project-1' },
      })
    ).toBe(true);
    expect(
      invalidateOptions.filter({
        routeId: '/editor/$projectId',
        params: { projectId: 'project-2' },
      })
    ).toBe(false);
  });

  it('skips the route cache refresh for current-schema projects', async () => {
    render(
      <LoadedEditor
        projectId="project-1"
        project={{
          id: 'project-1',
          name: 'Current Project',
          width: 1920,
          height: 1080,
          fps: 30,
        }}
        migration={{
          storedSchemaVersion: 9,
          currentSchemaVersion: 9,
          requiresUpgrade: false,
        }}
      />
    );

    await waitFor(() =>
      expect(mocks.loadTimeline).toHaveBeenCalledWith('project-1', {
        allowProjectUpgrade: false,
      })
    );
    expect(mocks.loadMediaItems).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(mocks.invalidate).not.toHaveBeenCalled());
  });
});
