import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all external dependencies before importing the facade
const indexedDbMocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  updateProject: vi.fn(),
  saveThumbnail: vi.fn(),
}));

const playbackMocks = vi.hoisted(() => ({
  currentFrame: 0,
  setCurrentFrame: vi.fn(),
  pause: vi.fn(),
  play: vi.fn(),
  setPreviewFrame: vi.fn(),
}));

const zoomMocks = vi.hoisted(() => ({
  level: 1,
  setZoomLevel: vi.fn(),
}));

const exportMocks = vi.hoisted(() => ({
  renderSingleFrame: vi.fn(),
  convertTimelineToComposition: vi.fn(),
}));

const mediaResolverMocks = vi.hoisted(() => ({
  resolveMediaUrls: vi.fn(),
}));

const mediaValidationMocks = vi.hoisted(() => ({
  validateMediaReferences: vi.fn(),
}));

const mediaLibraryMocks = vi.hoisted(() => ({
  setOrphanedClips: vi.fn(),
  openOrphanedClipsDialog: vi.fn(),
}));

vi.mock('@/infrastructure/storage/indexeddb', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    ...indexedDbMocks,
  };
});

vi.mock('@/shared/state/playback', () => ({
  usePlaybackStore: {
    getState: () => playbackMocks,
  },
}));

vi.mock('../zoom-store', () => ({
  useZoomStore: {
    getState: () => zoomMocks,
  },
}));

vi.mock('@/features/timeline/deps/export-contract', () => exportMocks);
vi.mock('@/features/timeline/deps/media-library-resolver', () => mediaResolverMocks);
vi.mock('@/features/timeline/utils/media-validation', () => mediaValidationMocks);
vi.mock('@/features/timeline/deps/media-library-store', () => ({
  useMediaLibraryStore: {
    getState: () => mediaLibraryMocks,
  },
}));

vi.mock('@/domain/projects/migrations', () => ({
  migrateProject: vi.fn((project) => ({
    project,
    migrated: false,
    fromVersion: 1,
    toVersion: 1,
    appliedMigrations: [],
  })),
  CURRENT_SCHEMA_VERSION: 1,
}));

// Import stores and facade after mocks
import { useItemsStore } from './items-store';
import { useTransitionsStore } from './transitions-store';
import { useKeyframesStore } from './keyframes-store';
import { useMarkersStore } from './markers-store';
import { useTimelineSettingsStore } from './timeline-settings-store';
import { useTimelineCommandStore } from './timeline-command-store';
import { useCompositionsStore } from './compositions-store';
import { useCompositionNavigationStore } from './composition-navigation-store';
import { useTimelineStore } from './timeline-store-facade';

describe('TimelineStoreFacade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset all domain stores
    useItemsStore.getState().setItems([]);
    useItemsStore.getState().setTracks([]);
    useTransitionsStore.getState().setTransitions([]);
    useKeyframesStore.getState().setKeyframes([]);
    useMarkersStore.getState().setMarkers([]);
    useMarkersStore.getState().setInPoint(null);
    useMarkersStore.getState().setOutPoint(null);
    useTimelineSettingsStore.getState().setFps(30);
    useTimelineSettingsStore.getState().setScrollPosition(0);
    useTimelineSettingsStore.getState().setSnapEnabled(true);
    useTimelineSettingsStore.getState().markClean();
    useCompositionsStore.getState().setCompositions([]);
    useCompositionNavigationStore.getState().resetToRoot();
    useTimelineCommandStore.getState().clearHistory();
  });

  describe('getSnapshot / getState', () => {
    it('returns combined state from all domain stores', () => {
      useItemsStore.getState().setItems([
        {
          id: 'item-1',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 100,
          label: 'clip.mp4',
          src: 'blob:test',
          mediaId: 'media-1',
        },
      ]);
      useItemsStore.getState().setTracks([
        {
          id: 'track-1',
          name: 'Track 1',
          height: 80,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
          items: [],
        },
      ]);
      useTimelineSettingsStore.getState().setFps(24);

      const state = useTimelineStore.getState();

      expect(state.items).toHaveLength(1);
      expect(state.items[0]!.id).toBe('item-1');
      expect(state.tracks).toHaveLength(1);
      expect(state.tracks[0]!.id).toBe('track-1');
      expect(state.fps).toBe(24);
    });

    it('returns stable snapshot references when state has not changed', () => {
      const state1 = useTimelineStore.getState();
      const state2 = useTimelineStore.getState();
      expect(state1).toBe(state2);
    });

    it('returns new snapshot when underlying state changes', () => {
      const state1 = useTimelineStore.getState();
      useItemsStore.getState().setItems([
        {
          id: 'new-item',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 50,
          label: 'new.mp4',
          src: 'blob:new',
          mediaId: 'media-2',
        },
      ]);
      const state2 = useTimelineStore.getState();
      expect(state1).not.toBe(state2);
      expect(state2.items).toHaveLength(1);
    });
  });

  describe('setState', () => {
    it('maps items to items store', () => {
      const items = [
        {
          id: 'item-1',
          type: 'video' as const,
          trackId: 'track-1',
          from: 0,
          durationInFrames: 100,
          label: 'clip.mp4',
          src: 'blob:test',
          mediaId: 'media-1',
        },
      ];

      useTimelineStore.setState({ items });

      expect(useItemsStore.getState().items).toEqual(items);
    });

    it('maps tracks to items store', () => {
      const tracks = [
        {
          id: 'track-1',
          name: 'Track 1',
          height: 80,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
          items: [],
        },
      ];

      useTimelineStore.setState({ tracks });

      expect(useItemsStore.getState().tracks).toEqual(tracks);
    });

    it('maps fps to settings store', () => {
      useTimelineStore.setState({ fps: 24 });
      expect(useTimelineSettingsStore.getState().fps).toBe(24);
    });

    it('maps scrollPosition to settings store', () => {
      useTimelineStore.setState({ scrollPosition: 500 });
      expect(useTimelineSettingsStore.getState().scrollPosition).toBe(500);
    });

    it('maps snapEnabled to settings store', () => {
      useTimelineStore.setState({ snapEnabled: false });
      expect(useTimelineSettingsStore.getState().snapEnabled).toBe(false);
    });
  });

  describe('subscribe', () => {
    it('notifies when items change', () => {
      const listener = vi.fn();
      const unsubscribe = useTimelineStore.subscribe(listener);

      useItemsStore.getState().setItems([
        {
          id: 'item-1',
          type: 'video',
          trackId: 'track-1',
          from: 0,
          durationInFrames: 100,
          label: 'clip.mp4',
          src: 'blob:test',
          mediaId: 'media-1',
        },
      ]);

      expect(listener).toHaveBeenCalled();
      unsubscribe();
    });

    it('notifies when transitions change', () => {
      const listener = vi.fn();
      const unsubscribe = useTimelineStore.subscribe(listener);

      useTransitionsStore.getState().setTransitions([
        {
          id: 't1',
          type: 'crossfade',
          leftClipId: 'clip-1',
          rightClipId: 'clip-2',
          trackId: 'track-1',
          durationInFrames: 15,
          presentation: 'fade' as const,
          timing: 'linear' as const,
        },
      ]);

      expect(listener).toHaveBeenCalled();
      unsubscribe();
    });

    it('stops notifying after unsubscribe', () => {
      const listener = vi.fn();
      const unsubscribe = useTimelineStore.subscribe(listener);

      useItemsStore.getState().setItems([]);
      listener.mockClear();

      unsubscribe();
      useItemsStore.getState().setTracks([
        {
          id: 'track-1',
          name: 'Track 1',
          height: 80,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
          items: [],
        },
      ]);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('temporal (undo/redo)', () => {
    it('exposes undo/redo/clear through temporal', () => {
      const temporal = useTimelineStore.temporal.getState();
      expect(typeof temporal.undo).toBe('function');
      expect(typeof temporal.redo).toBe('function');
      expect(typeof temporal.clear).toBe('function');
    });
  });

  describe('actions', () => {
    it('exposes timeline actions', () => {
      const state = useTimelineStore.getState();
      expect(typeof state.addItem).toBe('function');
      expect(typeof state.removeItems).toBe('function');
      expect(typeof state.updateItem).toBe('function');
      expect(typeof state.moveItem).toBe('function');
      expect(typeof state.splitItem).toBe('function');
      expect(typeof state.addTransition).toBe('function');
      expect(typeof state.removeTransition).toBe('function');
      expect(typeof state.addKeyframe).toBe('function');
      expect(typeof state.removeKeyframe).toBe('function');
      expect(typeof state.saveTimeline).toBe('function');
      expect(typeof state.loadTimeline).toBe('function');
      expect(typeof state.clearTimeline).toBe('function');
      expect(typeof state.markDirty).toBe('function');
      expect(typeof state.markClean).toBe('function');
    });
  });

  describe('loadTimeline', () => {
    it('initializes default tracks for new project with no timeline', async () => {
      indexedDbMocks.getProject.mockResolvedValue({
        id: 'project-1',
        metadata: { fps: 30 },
        timeline: null,
      });
      mediaValidationMocks.validateMediaReferences.mockResolvedValue([]);

      await useTimelineStore.getState().loadTimeline('project-1');

      const itemsState = useItemsStore.getState();
      expect(itemsState.tracks).toHaveLength(1);
      expect(itemsState.tracks[0]!.id).toBe('track-1');
      expect(itemsState.items).toHaveLength(0);
    });

    it('restores timeline state from project data', async () => {
      indexedDbMocks.getProject.mockResolvedValue({
        id: 'project-1',
        metadata: { fps: 24 },
        timeline: {
          tracks: [{ id: 't1', name: 'Video', order: 0, height: 80, locked: false, visible: true, muted: false, solo: false }],
          items: [{ id: 'i1', type: 'video', trackId: 't1', from: 0, durationInFrames: 100, label: 'test.mp4' }],
          currentFrame: 50,
          zoomLevel: 2,
          scrollPosition: 100,
          keyframes: [],
          transitions: [],
          markers: [],
        },
      });
      mediaValidationMocks.validateMediaReferences.mockResolvedValue([]);

      await useTimelineStore.getState().loadTimeline('project-1');

      const itemsState = useItemsStore.getState();
      expect(itemsState.tracks).toHaveLength(1);
      expect(itemsState.items).toHaveLength(1);
      expect(itemsState.items[0]!.id).toBe('i1');
      expect(useTimelineSettingsStore.getState().fps).toBe(24);
      expect(playbackMocks.setCurrentFrame).toHaveBeenCalledWith(50);
    });

    it('throws when project not found', async () => {
      indexedDbMocks.getProject.mockResolvedValue(null);

      await expect(
        useTimelineStore.getState().loadTimeline('nonexistent')
      ).rejects.toThrow('Project not found');
    });

    it('marks timeline as not loading after completion', async () => {
      indexedDbMocks.getProject.mockResolvedValue({
        id: 'project-1',
        metadata: { fps: 30 },
        timeline: null,
      });
      mediaValidationMocks.validateMediaReferences.mockResolvedValue([]);

      await useTimelineStore.getState().loadTimeline('project-1');

      expect(useTimelineSettingsStore.getState().isTimelineLoading).toBe(false);
    });
  });
});
