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
  validateProjectMediaReferences: vi.fn(),
}));

const mediaLibraryMocks = vi.hoisted(() => ({
  mediaById: {},
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
import { useProjectStore } from '@/features/timeline/deps/projects';
import { captureSnapshot } from './commands/snapshot';

describe('TimelineStoreFacade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    playbackMocks.currentFrame = 0;
    playbackMocks.setCurrentFrame.mockImplementation((frame: number) => {
      playbackMocks.currentFrame = frame;
    });
    zoomMocks.level = 1;
    zoomMocks.setZoomLevel.mockImplementation((level: number) => {
      zoomMocks.level = level;
    });
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
    mediaLibraryMocks.mediaById = {};
    useProjectStore.setState({
      projects: [],
      currentProject: null,
      isLoading: false,
      error: null,
      searchQuery: '',
      sortField: 'updatedAt',
      sortDirection: 'desc',
      filterResolution: undefined,
      filterFps: undefined,
    });
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

    it('undos and redos audio volume updates through the facade', () => {
      useItemsStore.getState().setTracks([
        {
          id: 'track-a1',
          name: 'A1',
          kind: 'audio',
          height: 80,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
          items: [],
        },
      ]);
      useItemsStore.getState().setItems([
        {
          id: 'audio-1',
          type: 'audio',
          trackId: 'track-a1',
          from: 0,
          durationInFrames: 90,
          label: 'voiceover.wav',
          src: 'blob:audio',
          mediaId: 'media-a1',
          volume: 0,
        },
      ]);

      useTimelineStore.getState().updateItem('audio-1', { volume: -9.5 });
      expect(useItemsStore.getState().itemById['audio-1']?.volume).toBe(-9.5);

      useTimelineCommandStore.getState().undo();
      expect(useItemsStore.getState().itemById['audio-1']?.volume).toBe(0);

      useTimelineCommandStore.getState().redo();
      expect(useItemsStore.getState().itemById['audio-1']?.volume).toBe(-9.5);
    });

    it('undos and redos current project metadata changes through the shared history', async () => {
      useProjectStore.setState({
        projects: [{
          id: 'project-1',
          name: 'Test Project',
          description: '',
          createdAt: 1,
          updatedAt: 1,
          duration: 0,
          metadata: {
            width: 1920,
            height: 1080,
            fps: 30,
            backgroundColor: '#000000',
          },
        }],
        currentProject: {
          id: 'project-1',
          name: 'Test Project',
          description: '',
          createdAt: 1,
          updatedAt: 1,
          duration: 0,
          metadata: {
            width: 1920,
            height: 1080,
            fps: 30,
            backgroundColor: '#000000',
          },
        },
      });

      const beforeSnapshot = captureSnapshot();
      useProjectStore.setState((state) => ({
        currentProject: state.currentProject
          ? {
            ...state.currentProject,
            metadata: {
              ...state.currentProject.metadata,
              width: 1280,
              height: 720,
            },
          }
          : null,
        projects: state.projects.map((project) => (
          project.id === 'project-1'
            ? {
              ...project,
              metadata: {
                ...project.metadata,
                width: 1280,
                height: 720,
              },
            }
            : project
        )),
      }));
      useTimelineCommandStore.getState().addUndoEntry(
        { type: 'UPDATE_PROJECT_METADATA', payload: { fields: ['width', 'height'] } },
        beforeSnapshot
      );

      expect(useProjectStore.getState().currentProject?.metadata).toMatchObject({
        width: 1280,
        height: 720,
      });

      useTimelineCommandStore.getState().undo();
      expect(useProjectStore.getState().currentProject?.metadata).toMatchObject({
        width: 1920,
        height: 1080,
      });

      useTimelineCommandStore.getState().redo();
      expect(useProjectStore.getState().currentProject?.metadata).toMatchObject({
        width: 1280,
        height: 720,
      });

      await Promise.resolve();
      expect(indexedDbMocks.updateProject).toHaveBeenCalledWith(
        'project-1',
        expect.objectContaining({
          metadata: expect.objectContaining({
            width: 1280,
            height: 720,
          }),
        })
      );
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

  describe('saveTimeline', () => {
    it('persists full transition metadata', async () => {
      indexedDbMocks.getProject.mockResolvedValue({
        id: 'project-1',
        metadata: { fps: 30, width: 1920, height: 1080 },
      });

      useItemsStore.getState().setTracks([
        {
          id: 'track-1',
          name: 'Video',
          height: 80,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
          items: [],
        },
      ]);

      useTransitionsStore.getState().setTransitions([
        {
          id: 'transition-1',
          type: 'crossfade',
          leftClipId: 'clip-1',
          rightClipId: 'clip-2',
          trackId: 'track-1',
          durationInFrames: 24,
          presentation: 'wipe',
          timing: 'cubic-bezier',
          direction: 'from-left',
          alignment: 0.25,
          bezierPoints: { x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.8 },
          presetId: 'preset-1',
          properties: { softness: 0.7, customMode: 'smooth' },
          createdAt: 1000,
          lastModifiedAt: 2000,
        },
      ]);

      await useTimelineStore.getState().saveTimeline('project-1');

      expect(indexedDbMocks.updateProject).toHaveBeenCalledWith(
        'project-1',
        expect.objectContaining({
          timeline: expect.objectContaining({
            transitions: [
              expect.objectContaining({
                id: 'transition-1',
                type: 'crossfade',
                leftClipId: 'clip-1',
                rightClipId: 'clip-2',
                trackId: 'track-1',
                durationInFrames: 24,
                presentation: 'wipe',
                timing: 'cubic-bezier',
                direction: 'from-left',
                alignment: 0.25,
                bezierPoints: { x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.8 },
                presetId: 'preset-1',
                properties: { softness: 0.7, customMode: 'smooth' },
                createdAt: 1000,
                lastModifiedAt: 2000,
              }),
            ],
          }),
          updatedAt: expect.any(Number),
        })
      );
    });

    it('restores the full nested composition path after saving', async () => {
      indexedDbMocks.getProject.mockResolvedValue({
        id: 'project-1',
        metadata: { fps: 30, width: 1920, height: 1080 },
        timeline: {
          tracks: [],
          items: [],
          currentFrame: 0,
          zoomLevel: 1,
          scrollPosition: 0,
          keyframes: [],
          transitions: [],
          markers: [],
        },
      });

      useCompositionsStore.getState().setCompositions([
        {
          id: 'comp-a',
          name: 'Comp A',
          tracks: [{
            id: 'track-a',
            name: 'V1',
            kind: 'video',
            order: 0,
            height: 80,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
            items: [],
          }],
          items: [{
            id: 'item-a',
            type: 'composition',
            compositionId: 'comp-b',
            trackId: 'track-a',
            from: 0,
            durationInFrames: 40,
            label: 'Comp B',
            compositionWidth: 1920,
            compositionHeight: 1080,
          }],
          transitions: [],
          keyframes: [],
          fps: 30,
          width: 1920,
          height: 1080,
          durationInFrames: 40,
        },
        {
          id: 'comp-b',
          name: 'Comp B',
          tracks: [],
          items: [],
          transitions: [],
          keyframes: [],
          fps: 30,
          width: 1920,
          height: 1080,
          durationInFrames: 40,
        },
      ]);

      useCompositionNavigationStore.getState().enterComposition('comp-a', 'Comp A');
      useCompositionNavigationStore.getState().enterComposition('comp-b', 'Comp B');

      await useTimelineStore.getState().saveTimeline('project-1');

      const navState = useCompositionNavigationStore.getState();
      expect(navState.breadcrumbs.map((breadcrumb) => breadcrumb.label)).toEqual([
        'Main Timeline',
        'Comp A',
        'Comp B',
      ]);
      expect(navState.activeCompositionId).toBe('comp-b');
    });

    it('restores the exact nested entry instance after saving', async () => {
      indexedDbMocks.getProject.mockResolvedValue({
        id: 'project-1',
        metadata: { fps: 30, width: 1920, height: 1080 },
        timeline: {
          tracks: [],
          items: [],
          currentFrame: 0,
          zoomLevel: 1,
          scrollPosition: 0,
          keyframes: [],
          transitions: [],
          markers: [],
        },
      });

      useItemsStore.getState().setTracks([{
        id: 'root-track',
        name: 'V1',
        kind: 'video',
        order: 0,
        height: 80,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        items: [],
      }]);
      useItemsStore.getState().setItems([{
        id: 'root-comp-a',
        type: 'composition',
        compositionId: 'comp-a',
        trackId: 'root-track',
        from: 50,
        durationInFrames: 200,
        label: 'Comp A',
        compositionWidth: 1920,
        compositionHeight: 1080,
      }]);

      useCompositionsStore.getState().setCompositions([
        {
          id: 'comp-a',
          name: 'Comp A',
          tracks: [{
            id: 'track-a',
            name: 'V1',
            kind: 'video',
            order: 0,
            height: 80,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
            items: [],
          }],
          items: [
            {
              id: 'item-b-first',
              type: 'composition',
              compositionId: 'comp-b',
              trackId: 'track-a',
              from: 0,
              durationInFrames: 40,
              label: 'Comp B',
              compositionWidth: 1920,
              compositionHeight: 1080,
            },
            {
              id: 'item-b-second',
              type: 'composition',
              compositionId: 'comp-b',
              trackId: 'track-a',
              from: 100,
              durationInFrames: 40,
              label: 'Comp B',
              compositionWidth: 1920,
              compositionHeight: 1080,
            },
          ],
          transitions: [],
          keyframes: [],
          fps: 30,
          width: 1920,
          height: 1080,
          durationInFrames: 140,
        },
        {
          id: 'comp-b',
          name: 'Comp B',
          tracks: [],
          items: [],
          transitions: [],
          keyframes: [],
          fps: 30,
          width: 1920,
          height: 1080,
          durationInFrames: 40,
        },
      ]);

      playbackMocks.currentFrame = 160;
      useCompositionNavigationStore.getState().enterComposition('comp-a', 'Comp A', 'root-comp-a');
      useCompositionNavigationStore.getState().enterComposition('comp-b', 'Comp B', 'item-b-second');

      expect(playbackMocks.currentFrame).toBe(10);

      await useTimelineStore.getState().saveTimeline('project-1');

      expect(playbackMocks.currentFrame).toBe(10);
      expect(useCompositionNavigationStore.getState().breadcrumbs).toMatchObject([
        { compositionId: null, label: 'Main Timeline' },
        { compositionId: 'comp-a', label: 'Comp A', entryItemId: 'root-comp-a' },
        { compositionId: 'comp-b', label: 'Comp B', entryItemId: 'item-b-second' },
      ]);
    });
  });

  describe('loadTimeline', () => {
    it('requires explicit approval before upgrading an older stored project', async () => {
      indexedDbMocks.getProject.mockResolvedValue({
        id: 'project-1',
        schemaVersion: 0,
        metadata: { fps: 30 },
        timeline: null,
      });

      await expect(
        useTimelineStore.getState().loadTimeline('project-1')
      ).rejects.toThrow('requires confirmation before upgrading');
    });

    it('initializes default tracks for new project with no timeline', async () => {
      indexedDbMocks.getProject.mockResolvedValue({
        id: 'project-1',
        metadata: { fps: 30 },
        timeline: null,
      });
      mediaValidationMocks.validateProjectMediaReferences.mockResolvedValue([]);

      await useTimelineStore.getState().loadTimeline('project-1');

      const itemsState = useItemsStore.getState();
      expect(itemsState.tracks).toHaveLength(2);
      expect(itemsState.tracks[0]!.id).toBe('track-1');
      expect(itemsState.tracks[0]!).toMatchObject({ name: 'V1', kind: 'video' });
      expect(itemsState.tracks[1]!).toMatchObject({ id: 'track-2', name: 'A1', kind: 'audio' });
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
      mediaValidationMocks.validateProjectMediaReferences.mockResolvedValue([]);

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
      mediaValidationMocks.validateProjectMediaReferences.mockResolvedValue([]);

      await useTimelineStore.getState().loadTimeline('project-1');

      expect(useTimelineSettingsStore.getState().isTimelineLoading).toBe(false);
    });

    it('repairs legacy AV track layout inside compound clips on load', async () => {
      mediaLibraryMocks.mediaById = {
        'media-comp-1': { audioCodec: 'aac' },
      };
      indexedDbMocks.getProject.mockResolvedValue({
        id: 'project-1',
        metadata: { fps: 30 },
        timeline: {
          tracks: [{ id: 'root-v1', name: 'V1', kind: 'video', order: 0, height: 80, locked: false, visible: true, muted: false, solo: false }],
          items: [{
            id: 'root-comp-1',
            type: 'composition',
            trackId: 'root-v1',
            from: 0,
            durationInFrames: 60,
            label: 'Compound 1',
            compositionId: 'comp-1',
            compositionWidth: 1920,
            compositionHeight: 1080,
          }],
          currentFrame: 0,
          zoomLevel: 1,
          scrollPosition: 0,
          keyframes: [],
          transitions: [],
          markers: [],
          compositions: [{
            id: 'comp-1',
            name: 'Compound 1',
            fps: 30,
            width: 1920,
            height: 1080,
            durationInFrames: 120,
            tracks: [{ id: 'comp-track-1', name: 'Track 1', order: 0, height: 80, locked: false, visible: true, muted: false, solo: false }],
            items: [{
              id: 'comp-video-1',
              type: 'video',
              trackId: 'comp-track-1',
              from: 0,
              durationInFrames: 60,
              label: 'compound.mp4',
              src: 'blob:compound',
              mediaId: 'media-comp-1',
              sourceStart: 0,
              sourceEnd: 60,
              sourceDuration: 120,
            }],
            transitions: [],
            keyframes: [],
          }],
        },
      });
      mediaValidationMocks.validateProjectMediaReferences.mockResolvedValue([]);

      await useTimelineStore.getState().loadTimeline('project-1');

      const rootTracks = useItemsStore.getState().tracks;
      const rootItems = useItemsStore.getState().items;
      const composition = useCompositionsStore.getState().compositions[0];
      const rootAudioTrack = rootTracks.find((track) => track.kind === 'audio');
      expect(rootTracks.map((track) => `${track.name}:${track.kind}`)).toEqual([
        'V1:video',
        'A1:audio',
      ]);
      const rootCompoundVideo = rootItems.find((item) => item.type === 'composition');
      const rootCompoundAudio = rootItems.find((item) => item.type === 'audio' && item.compositionId === 'comp-1');
      expect(rootCompoundVideo).toMatchObject({ trackId: 'root-v1', sourceStart: 0, sourceEnd: 60, sourceDuration: 120 });
      expect(rootCompoundAudio).toMatchObject({ trackId: rootAudioTrack?.id, compositionId: 'comp-1', sourceStart: 0, sourceEnd: 60, sourceDuration: 120 });
      expect(rootCompoundAudio?.linkedGroupId).toBe(rootCompoundVideo?.linkedGroupId);

      expect(composition?.tracks.map((track) => `${track.name}:${track.kind}`)).toEqual([
        'V1:video',
        'A1:audio',
      ]);
      expect(composition?.items.filter((item) => item.type === 'video')).toHaveLength(1);
      expect(composition?.items.filter((item) => item.type === 'audio')).toHaveLength(1);

      const compoundVideo = composition?.items.find((item) => item.type === 'video');
      const compoundAudio = composition?.items.find((item) => item.type === 'audio');
      expect(compoundVideo?.linkedGroupId).toBeDefined();
      expect(compoundAudio?.linkedGroupId).toBe(compoundVideo?.linkedGroupId);
      expect(indexedDbMocks.updateProject).toHaveBeenCalledTimes(1);
    });

    it('does not create extra audio tracks for already repaired compound wrappers on reload', async () => {
      mediaLibraryMocks.mediaById = {
        'media-comp-1': { audioCodec: 'aac' },
      };
      indexedDbMocks.getProject.mockResolvedValue({
        id: 'project-1',
        metadata: { fps: 30 },
        timeline: {
          tracks: [
            { id: 'root-a1', name: 'A1', kind: 'audio', order: 0, height: 80, locked: false, visible: true, muted: false, solo: false },
            { id: 'root-v1', name: 'V1', kind: 'video', order: 1, height: 80, locked: false, visible: true, muted: false, solo: false },
            { id: 'root-a2', name: 'A2', kind: 'audio', order: 2, height: 80, locked: false, visible: true, muted: false, solo: false },
          ],
          items: [
            {
              id: 'root-comp-1',
              type: 'composition',
              trackId: 'root-v1',
              from: 10,
              durationInFrames: 60,
              label: 'Compound 1',
              compositionId: 'comp-1',
              linkedGroupId: 'group-1',
              sourceStart: 15,
              sourceEnd: 75,
              sourceDuration: 120,
              sourceFps: 30,
              speed: 1,
              compositionWidth: 1920,
              compositionHeight: 1080,
            },
            {
              id: 'root-comp-a1',
              type: 'audio',
              trackId: 'root-a1',
              from: 10,
              durationInFrames: 60,
              label: 'Compound 1',
              compositionId: 'comp-1',
              linkedGroupId: 'group-1',
              sourceStart: 15,
              sourceEnd: 75,
              sourceDuration: 120,
              sourceFps: 30,
              speed: 1,
              src: '',
            },
          ],
          currentFrame: 0,
          zoomLevel: 1,
          scrollPosition: 0,
          keyframes: [],
          transitions: [],
          markers: [],
          compositions: [{
            id: 'comp-1',
            name: 'Compound 1',
            fps: 30,
            width: 1920,
            height: 1080,
            durationInFrames: 120,
            tracks: [
              { id: 'comp-v1', name: 'V1', kind: 'video', order: 0, height: 80, locked: false, visible: true, muted: false, solo: false },
              { id: 'comp-a1', name: 'A1', kind: 'audio', order: 1, height: 80, locked: false, visible: true, muted: false, solo: false },
            ],
            items: [
              {
                id: 'comp-video-1',
                type: 'video',
                trackId: 'comp-v1',
                from: 0,
                durationInFrames: 120,
                label: 'compound.mp4',
                src: 'blob:compound',
                mediaId: 'media-comp-1',
                sourceStart: 0,
                sourceEnd: 120,
                sourceDuration: 120,
              },
              {
                id: 'comp-audio-1',
                type: 'audio',
                trackId: 'comp-a1',
                from: 0,
                durationInFrames: 120,
                label: 'compound.mp4',
                src: 'blob:compound-audio',
                mediaId: 'media-comp-1',
                sourceStart: 0,
                sourceEnd: 120,
                sourceDuration: 120,
              },
            ],
            transitions: [],
            keyframes: [],
          }],
        },
      });
      mediaValidationMocks.validateProjectMediaReferences.mockResolvedValue([]);

      await useTimelineStore.getState().loadTimeline('project-1');

      const rootTracks = useItemsStore.getState().tracks;
      const rootItems = useItemsStore.getState().items;
      expect(rootTracks.map((track) => track.id)).toEqual(['root-a1', 'root-v1']);
      expect(rootItems.find((item) => item.id === 'root-comp-1')).toMatchObject({ trackId: 'root-v1', sourceStart: 15, sourceEnd: 75 });
      expect(rootItems.find((item) => item.id === 'root-comp-a1')).toMatchObject({ trackId: 'root-a1', sourceStart: 15, sourceEnd: 75 });
      expect(indexedDbMocks.updateProject).toHaveBeenCalledTimes(1);
    });
  });
});
