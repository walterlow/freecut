import { describe, expect, it } from 'vitest';
import type { TimelineTrack } from '@/types/timeline';
import {
  buildStableDomTracks,
  buildItemIdMap,
  buildFrameRenderTasks,
  collectAudioTrackItems,
  collectFrameVideoCandidates,
  collectTransitionClipItems,
  collectVisualTrackItems,
  collectVisibleAdjustmentLayers,
  collectVisibleShapeMasks,
  collectVisibleTextFontFamilies,
  groupTransitionsByTrackOrder,
  resolveCompositionRenderPlan,
  resolveTransitionWindowsForItems,
  resolveFrameRenderScene,
  resolveTrackRenderState,
  resolveOcclusionCutoffOrder,
} from './scene-assembly';

describe('scene assembly', () => {
  const tracks: TimelineTrack[] = [
    {
      id: 'track-hidden',
      name: 'Hidden',
      height: 60,
      locked: false,
      visible: false,
      muted: false,
      solo: false,
      order: 2,
      items: [
        {
          id: 'mask-hidden',
          type: 'shape',
          trackId: 'track-hidden',
          from: 0,
          durationInFrames: 30,
          label: 'Hidden mask',
          shapeType: 'rectangle',
          fillColor: '#fff',
          isMask: true,
        },
      ],
    },
    {
      id: 'track-visible',
      name: 'Visible',
      height: 60,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 1,
      items: [
        {
          id: 'mask-visible',
          type: 'shape',
          trackId: 'track-visible',
          from: 0,
          durationInFrames: 30,
          label: 'Visible mask',
          shapeType: 'rectangle',
          fillColor: '#fff',
          isMask: true,
        },
        {
          id: 'adj-visible',
          type: 'adjustment',
          trackId: 'track-visible',
          from: 0,
          durationInFrames: 30,
          label: 'Visible adj',
          effects: [],
        },
      ],
    },
    {
      id: 'track-solo',
      name: 'Solo',
      height: 60,
      locked: false,
      visible: true,
      muted: false,
      solo: true,
      order: 3,
      items: [
        {
          id: 'mask-solo',
          type: 'shape',
          trackId: 'track-solo',
          from: 0,
          durationInFrames: 30,
          label: 'Solo mask',
          shapeType: 'rectangle',
          fillColor: '#fff',
          isMask: true,
        },
      ],
    },
  ];

  it('uses solo semantics and preserves ordering metadata', () => {
    const state = resolveTrackRenderState(tracks);

    expect(state.hasSoloTracks).toBe(true);
    expect(Array.from(state.visibleTrackIds)).toEqual(['track-solo']);
    expect(state.visibleTracks.map((track) => track.id)).toEqual(['track-solo']);
    expect(state.visibleTracksByOrderDesc.map((track) => track.id)).toEqual(['track-solo']);
    expect(state.visibleTracksByOrderAsc.map((track) => track.id)).toEqual(['track-solo']);
    expect(state.maxOrder).toBe(3);
    expect(state.trackOrderMap.get('track-hidden')).toBe(2);
  });

  it('collects masks and adjustment layers from visible tracks only', () => {
    const visibleState = resolveTrackRenderState(tracks.filter((track) => track.id !== 'track-solo'));

    expect(collectVisibleShapeMasks(visibleState.visibleTracks).map(({ mask }) => mask.id)).toEqual(['mask-visible']);
    expect(collectVisibleAdjustmentLayers(visibleState.visibleTracks).map(({ layer }) => layer.id)).toEqual(['adj-visible']);
  });

  it('collects stable-dom visual and audio items with track metadata', () => {
    const state = resolveTrackRenderState([
      {
        id: 'visible-track',
        name: 'Visible',
        height: 60,
        locked: false,
        visible: true,
        muted: true,
        solo: false,
        order: 2,
        items: [
          {
            id: 'video-1',
            type: 'video',
            trackId: 'visible-track',
            from: 0,
            durationInFrames: 30,
            src: 'video.mp4',
            label: 'Video',
          },
          {
            id: 'audio-1',
            type: 'audio',
            trackId: 'visible-track',
            from: 0,
            durationInFrames: 30,
            src: 'audio.mp3',
            label: 'Audio',
          },
        ],
      } as TimelineTrack,
      {
        id: 'hidden-track',
        name: 'Hidden',
        height: 60,
        locked: false,
        visible: false,
        muted: false,
        solo: false,
        order: 0,
        items: [{
          id: 'image-1',
          type: 'image',
          trackId: 'hidden-track',
          from: 0,
          durationInFrames: 30,
          src: 'image.png',
          label: 'Image',
        }],
      } as TimelineTrack,
    ]);

    expect(collectVisualTrackItems({
      tracks: state.allTracksByOrderDesc,
      visibleTrackIds: state.visibleTrackIds,
      maxOrder: state.maxOrder,
    }).map(({ id, zIndex, trackOrder, trackVisible }) => ({ id, zIndex, trackOrder, trackVisible }))).toEqual([
      { id: 'video-1', zIndex: 0, trackOrder: 2, trackVisible: true },
      { id: 'image-1', zIndex: 2000, trackOrder: 0, trackVisible: false },
    ]);

    expect(collectAudioTrackItems({
      tracks: state.allTracksByOrderDesc,
      visibleTrackIds: state.visibleTrackIds,
    }).map(({ id, muted, trackVisible }) => ({ id, muted, trackVisible }))).toEqual([
      { id: 'audio-1', muted: true, trackVisible: true },
    ]);
  });

  it('builds stable DOM tracks and visible font families from shared track state', () => {
    const state = resolveTrackRenderState([
      {
        id: 'track-1',
        name: 'Track 1',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 1,
        items: [
          {
            id: 'text-1',
            type: 'text',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 30,
            label: 'Headline',
            text: 'Hello',
            color: '#fff',
            fontFamily: 'Sora',
          },
          {
            id: 'shape-1',
            type: 'shape',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 30,
            label: 'Shape',
            shapeType: 'rectangle',
            fillColor: '#fff',
          },
          {
            id: 'mask-1',
            type: 'shape',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 30,
            label: 'Mask',
            shapeType: 'rectangle',
            fillColor: '#fff',
            isMask: true,
          },
          {
            id: 'adjustment-1',
            type: 'adjustment',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 30,
            label: 'Adjustment',
            effects: [],
          },
        ],
      } as TimelineTrack,
      {
        id: 'track-2',
        name: 'Track 2',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [{
          id: 'text-2',
          type: 'text',
          trackId: 'track-2',
          from: 0,
          durationInFrames: 30,
          label: 'Body',
          text: 'World',
          color: '#fff',
        }],
      } as TimelineTrack,
    ]);

    expect(buildStableDomTracks({
      tracks: state.allTracksByOrderDesc,
      visibleTrackIds: state.visibleTrackIds,
    }).map((track) => ({
      id: track.id,
      trackVisible: track.trackVisible,
      itemIds: track.items.map((item) => item.id),
    }))).toEqual([
      { id: 'track-1', trackVisible: true, itemIds: ['text-1', 'shape-1'] },
      { id: 'track-2', trackVisible: true, itemIds: ['text-2'] },
    ]);

    expect(collectVisibleTextFontFamilies(state.visibleTracks)).toEqual(['Sora', 'Inter']);
  });

  it('collects transition clips and resolves transition windows from shared items', () => {
    const transitionTracks: TimelineTrack[] = [
      {
        id: 'track-1',
        name: 'Track 1',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 1,
        items: [
          {
            id: 'video-1',
            type: 'video',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 30,
            src: 'video-1.mp4',
            label: 'Video 1',
          },
          {
            id: 'shape-1',
            type: 'shape',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 30,
            label: 'Shape 1',
            shapeType: 'rectangle',
            fillColor: '#fff',
          },
        ],
      } as TimelineTrack,
      {
        id: 'track-2',
        name: 'Track 2',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [{
          id: 'image-1',
          type: 'image',
          trackId: 'track-2',
          from: 20,
          durationInFrames: 20,
          src: 'image-1.png',
          label: 'Image 1',
        }],
      } as TimelineTrack,
    ];

    const clips = collectTransitionClipItems(transitionTracks);
    expect(clips.map((item) => item.id)).toEqual(['video-1', 'image-1']);
    expect([...buildItemIdMap(clips).keys()]).toEqual(['video-1', 'image-1']);

    const windows = resolveTransitionWindowsForItems([
      {
        id: 'transition-1',
        leftClipId: 'video-1',
        rightClipId: 'image-1',
        durationInFrames: 10,
        timing: 'linear',
        presentation: 'fade',
      },
    ], clips);

    expect(windows).toEqual([
      expect.objectContaining({
        transition: expect.objectContaining({ id: 'transition-1' }),
        leftClip: expect.objectContaining({ id: 'video-1' }),
        rightClip: expect.objectContaining({ id: 'image-1' }),
        startFrame: 20,
        endFrame: 30,
        durationInFrames: 10,
      }),
    ]);
  });

  it('resolves a composed render plan from shared track state', () => {
    const tracks: TimelineTrack[] = [
      {
        id: 'track-1',
        name: 'Track 1',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 1,
        items: [
          {
            id: 'video-1',
            type: 'video',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 30,
            src: 'video-1.mp4',
            label: 'Video 1',
          },
          {
            id: 'audio-1',
            type: 'audio',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 30,
            src: 'audio-1.mp3',
            label: 'Audio 1',
          },
          {
            id: 'mask-1',
            type: 'shape',
            trackId: 'track-1',
            from: 0,
            durationInFrames: 30,
            label: 'Mask 1',
            shapeType: 'rectangle',
            fillColor: '#fff',
            isMask: true,
          },
        ],
      },
      {
        id: 'track-2',
        name: 'Track 2',
        height: 60,
        locked: false,
        visible: true,
        muted: true,
        solo: false,
        order: 0,
        items: [
          {
            id: 'text-1',
            type: 'text',
            trackId: 'track-2',
            from: 0,
            durationInFrames: 30,
            label: 'Text 1',
            text: 'Hello',
            color: '#fff',
            fontFamily: 'Sora',
          },
          {
            id: 'image-1',
            type: 'image',
            trackId: 'track-2',
            from: 0,
            durationInFrames: 30,
            src: 'image-1.png',
            label: 'Image 1',
          },
        ],
      },
    ];

    const plan = resolveCompositionRenderPlan({ tracks });

    expect(plan.trackRenderState.visibleTrackIds).toEqual(new Set(['track-1', 'track-2']));
    expect(plan.visualItems.map((item) => item.id)).toEqual(['video-1', 'image-1']);
    expect(plan.videoItems.map((item) => item.id)).toEqual(['video-1']);
    expect(plan.audioItems.map((item) => item.id)).toEqual(['audio-1']);
    expect(plan.stableDomTracks.map((track) => ({
      id: track.id,
      itemIds: track.items.map((item) => item.id),
    }))).toEqual([
      { id: 'track-1', itemIds: [] },
      { id: 'track-2', itemIds: ['text-1', 'image-1'] },
    ]);
    expect(plan.visibleShapeMasks.map(({ mask }) => mask.id)).toEqual(['mask-1']);
    expect(plan.visibleTextFontFamilies).toEqual(['Sora']);
    expect([...plan.transitionClipMap.keys()]).toEqual(['video-1', 'image-1']);
  });

  it('builds frame render tasks in track z-order with transitions appended to their track', () => {
    const visibleState = resolveTrackRenderState(tracks.filter((track) => track.id !== 'track-solo'));
    const renderTasks = buildFrameRenderTasks({
      tracksByOrderDesc: visibleState.visibleTracksByOrderDesc,
      visibleTrackIds: visibleState.visibleTrackIds,
      shouldRenderItem: (item) => item.id !== 'adj-visible',
      transitionsByTrackOrder: new Map([[1, [{ id: 'transition-1' }]]]),
      occlusionCutoffOrder: null,
    });

    expect(renderTasks).toEqual([
      { type: 'item', item: visibleState.visibleTracksByOrderDesc[0]!.items[0], trackOrder: 1 },
      { type: 'transition', transition: { id: 'transition-1' }, trackOrder: 1 },
    ]);
  });

  it('groups active transitions by resolved track order', () => {
    const transitionsByTrackOrder = groupTransitionsByTrackOrder({
      activeTransitions: [
        { transition: { id: 'transition-top' } },
        { transition: { id: 'transition-bottom' } },
        { transition: { id: 'transition-top-2' } },
      ],
      getTrackOrder: (activeTransition) => (
        activeTransition.transition.id.includes('top') ? 1 : 2
      ),
    });

    expect([...transitionsByTrackOrder.entries()]).toEqual([
      [1, [
        { transition: { id: 'transition-top' } },
        { transition: { id: 'transition-top-2' } },
      ]],
      [2, [{ transition: { id: 'transition-bottom' } }]],
    ]);
  });

  it('resolves the first fully occluding visible track order unless occlusion is disabled', () => {
    const state = resolveTrackRenderState([
      {
        id: 'bottom',
        name: 'Bottom',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 2,
        items: [{
          id: 'bottom-video',
          type: 'video',
          trackId: 'bottom',
          from: 0,
          durationInFrames: 30,
        }],
      } as TimelineTrack,
      {
        id: 'top',
        name: 'Top',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [{
          id: 'top-video',
          type: 'video',
          trackId: 'top',
          from: 0,
          durationInFrames: 30,
        }],
      } as TimelineTrack,
    ]);

    expect(resolveOcclusionCutoffOrder({
      tracksByOrderAsc: state.visibleTracksByOrderAsc,
      visibleTrackIds: state.visibleTrackIds,
      disableOcclusion: false,
      shouldRenderItem: () => true,
      isFullyOccluding: (item) => item.id === 'top-video',
    })).toBe(0);

    expect(resolveOcclusionCutoffOrder({
      tracksByOrderAsc: state.visibleTracksByOrderAsc,
      visibleTrackIds: state.visibleTrackIds,
      disableOcclusion: true,
      shouldRenderItem: () => true,
      isFullyOccluding: () => true,
    })).toBeNull();
  });

  it('builds a frame render scene from shared transition and occlusion inputs', () => {
    const state = resolveTrackRenderState([
      {
        id: 'bottom',
        name: 'Bottom',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 2,
        items: [{
          id: 'video-bottom',
          type: 'video',
          trackId: 'bottom',
          from: 0,
          durationInFrames: 30,
        }],
      } as TimelineTrack,
      {
        id: 'top',
        name: 'Top',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [{
          id: 'video-top',
          type: 'video',
          trackId: 'top',
          from: 0,
          durationInFrames: 30,
        }],
      } as TimelineTrack,
    ]);

    const scene = resolveFrameRenderScene({
      tracksByOrderDesc: state.visibleTracksByOrderDesc,
      tracksByOrderAsc: state.visibleTracksByOrderAsc,
      visibleTrackIds: state.visibleTrackIds,
      activeTransitions: [{ transition: { id: 'transition-top' } }],
      getTransitionTrackOrder: () => 0,
      disableOcclusion: false,
      shouldRenderItem: (item) => item.id !== 'video-top',
      isFullyOccluding: (item) => item.id === 'video-bottom',
    });

    expect(scene.occlusionCutoffOrder).toBe(2);
    expect([...scene.transitionsByTrackOrder.entries()]).toEqual([
      [0, [{ transition: { id: 'transition-top' } }]],
    ]);
    expect(scene.renderTasks).toEqual([
      { type: 'item', item: state.visibleTracksByOrderDesc[0]!.items[0], trackOrder: 2 },
      { type: 'transition', transition: { transition: { id: 'transition-top' } }, trackOrder: 0 },
    ]);
  });

  it('limits frame video candidates using top-to-bottom visible tracks', () => {
    const state = resolveTrackRenderState([
      {
        id: 'bottom',
        name: 'Bottom',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 2,
        items: [{
          id: 'video-bottom',
          type: 'video',
          trackId: 'bottom',
          from: 0,
          durationInFrames: 30,
        }],
      } as TimelineTrack,
      {
        id: 'top',
        name: 'Top',
        height: 60,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items: [{
          id: 'video-top',
          type: 'video',
          trackId: 'top',
          from: 0,
          durationInFrames: 30,
        }],
      } as TimelineTrack,
    ]);

    const candidates = collectFrameVideoCandidates({
      tracksByOrderAsc: state.visibleTracksByOrderAsc,
      visibleTrackIds: state.visibleTrackIds,
      minFrame: 0,
      maxFrame: 1,
      maxItems: 1,
    });

    expect(candidates.map((item) => item.id)).toEqual(['video-top']);
  });
});
