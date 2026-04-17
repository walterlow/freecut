import { beforeEach, describe, expect, it } from 'vitest';
import type { AudioItem, CompositionItem, TimelineTrack, VideoItem } from '@/types/timeline';
import { useItemsStore } from '../items-store';
import { useTransitionsStore } from '../transitions-store';
import { useKeyframesStore } from '../keyframes-store';
import { useTimelineCommandStore } from '../timeline-command-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { useEditorStore } from '@/app/state/editor';
import {
  addTransition,
} from './transition-actions';
import {
  joinItems,
  rateStretchItem,
  rippleTrimItem,
  rollingTrimItems,
  slideItem,
  slipItem,
  splitItem,
  trimItemBreakingTransition,
  trimItemStart,
} from './item-actions';

function makeTrack(overrides: Partial<TimelineTrack> & Pick<TimelineTrack, 'id' | 'name' | 'order'>): TimelineTrack {
  return {
    height: 80,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    items: [],
    ...overrides,
  };
}

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'video-1',
    type: 'video',
    trackId: 'video-track',
    from: 0,
    durationInFrames: 60,
    label: 'clip.mp4',
    src: 'blob:video',
    mediaId: 'media-1',
    linkedGroupId: 'group-1',
    sourceStart: 0,
    sourceEnd: 60,
    sourceDuration: 180,
    sourceFps: 30,
    speed: 1,
    ...overrides,
  } as VideoItem;
}

function makeAudioItem(overrides: Partial<AudioItem> = {}): AudioItem {
  return {
    id: 'audio-1',
    type: 'audio',
    trackId: 'audio-track',
    from: 0,
    durationInFrames: 60,
    label: 'clip.wav',
    src: 'blob:audio',
    mediaId: 'media-1',
    linkedGroupId: 'group-1',
    sourceStart: 0,
    sourceEnd: 60,
    sourceDuration: 180,
    sourceFps: 30,
    speed: 1,
    ...overrides,
  } as AudioItem;
}

function makeCompositionItem(overrides: Partial<CompositionItem> = {}): CompositionItem {
  return {
    id: 'comp-1',
    type: 'composition',
    trackId: 'video-track',
    from: 0,
    durationInFrames: 60,
    label: 'Compound 1',
    compositionId: 'composition-1',
    compositionWidth: 1920,
    compositionHeight: 1080,
    linkedGroupId: 'group-1',
    sourceStart: 0,
    sourceEnd: 120,
    sourceDuration: 120,
    sourceFps: 30,
    speed: 1,
    ...overrides,
  } as CompositionItem;
}

describe('linked edit tools', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory();
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false });
    useEditorStore.setState({ linkedSelectionEnabled: true });
    useItemsStore.getState().setTracks([
      makeTrack({ id: 'video-track', name: 'V1', order: 0, kind: 'video' }),
      makeTrack({ id: 'audio-track', name: 'A1', order: 1, kind: 'audio' }),
    ]);
    useItemsStore.getState().setItems([]);
    useTransitionsStore.getState().setTransitions([]);
    useKeyframesStore.getState().setKeyframes([]);
  });

  it('trims synchronized linked companions together', () => {
    useItemsStore.getState().setItems([
      makeVideoItem(),
      makeAudioItem(),
    ]);

    trimItemStart('video-1', 10);

    const itemById = useItemsStore.getState().itemById;
    expect(itemById['video-1']).toMatchObject({ from: 10, durationInFrames: 50, sourceStart: 10, sourceEnd: 60 });
    expect(itemById['audio-1']).toMatchObject({ from: 10, durationInFrames: 50, sourceStart: 10, sourceEnd: 60 });
  });

  it('trims only the targeted clip when linked selection is off', () => {
    useEditorStore.setState({ linkedSelectionEnabled: false });
    useItemsStore.getState().setItems([
      makeVideoItem(),
      makeAudioItem(),
    ]);

    trimItemStart('video-1', 10);

    const itemById = useItemsStore.getState().itemById;
    expect(itemById['video-1']).toMatchObject({ from: 10, durationInFrames: 50, sourceStart: 10, sourceEnd: 60 });
    expect(itemById['audio-1']).toMatchObject({ from: 0, durationInFrames: 60, sourceStart: 0, sourceEnd: 60 });
  });

  it('trims synchronized compound wrappers together', () => {
    useItemsStore.getState().setItems([
      makeCompositionItem({ sourceStart: 10, sourceEnd: 70, sourceDuration: 120 }),
      makeAudioItem({ id: 'comp-audio-1', mediaId: undefined, src: '', label: 'Compound 1', compositionId: 'composition-1', sourceStart: 10, sourceEnd: 70, sourceDuration: 120 }),
    ]);

    trimItemStart('comp-1', 10);

    const itemById = useItemsStore.getState().itemById;
    expect(itemById['comp-1']).toMatchObject({ from: 10, durationInFrames: 50, sourceStart: 20, sourceEnd: 70 });
    expect(itemById['comp-audio-1']).toMatchObject({ from: 10, durationInFrames: 50, sourceStart: 20, sourceEnd: 70 });
  });

  it('rate stretches synchronized linked companions together', () => {
    useItemsStore.getState().setItems([
      makeVideoItem(),
      makeAudioItem(),
    ]);

    rateStretchItem('video-1', 0, 120, 0.5);

    const itemById = useItemsStore.getState().itemById;
    expect(itemById['video-1']).toMatchObject({ from: 0, durationInFrames: 120, speed: 0.5 });
    expect(itemById['audio-1']).toMatchObject({ from: 0, durationInFrames: 120, speed: 0.5 });
  });

  it('slips synchronized compound wrappers together', () => {
    useItemsStore.getState().setItems([
      makeCompositionItem({ sourceStart: 10, sourceEnd: 70, sourceDuration: 120 }),
      makeAudioItem({ id: 'comp-audio-1', mediaId: undefined, src: '', label: 'Compound 1', compositionId: 'composition-1', sourceStart: 10, sourceEnd: 70, sourceDuration: 120 }),
    ]);

    slipItem('comp-1', 12);

    const itemById = useItemsStore.getState().itemById;
    expect(itemById['comp-1']).toMatchObject({ from: 0, durationInFrames: 60, sourceStart: 22, sourceEnd: 82 });
    expect(itemById['comp-audio-1']).toMatchObject({ from: 0, durationInFrames: 60, sourceStart: 22, sourceEnd: 82 });
  });

  it('rate stretches synchronized compound wrappers together', () => {
    useItemsStore.getState().setItems([
      makeCompositionItem({ sourceStart: 10, sourceEnd: 70, sourceDuration: 120 }),
      makeAudioItem({ id: 'comp-audio-1', mediaId: undefined, src: '', label: 'Compound 1', compositionId: 'composition-1', sourceStart: 10, sourceEnd: 70, sourceDuration: 120 }),
    ]);

    rateStretchItem('comp-1', 0, 120, 0.5);

    const itemById = useItemsStore.getState().itemById;
    expect(itemById['comp-1']).toMatchObject({ from: 0, durationInFrames: 120, speed: 0.5, sourceStart: 10, sourceEnd: 70 });
    expect(itemById['comp-audio-1']).toMatchObject({ from: 0, durationInFrames: 120, speed: 0.5, sourceStart: 10, sourceEnd: 70 });
  });

  it('rolls linked companions with the transitioned clip pair', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({ id: 'video-1', sourceEnd: 80, sourceDuration: 120, linkedGroupId: 'group-1' }),
      makeAudioItem({ id: 'audio-1', sourceEnd: 80, sourceDuration: 120, linkedGroupId: 'group-1' }),
      makeVideoItem({ id: 'video-2', from: 60, sourceStart: 20, sourceEnd: 80, sourceDuration: 120, mediaId: 'media-2', linkedGroupId: 'group-2' }),
      makeAudioItem({ id: 'audio-2', from: 60, sourceStart: 20, sourceEnd: 80, sourceDuration: 120, mediaId: 'media-2', linkedGroupId: 'group-2' }),
    ]);
    addTransition('video-1', 'video-2', 'crossfade', 12);

    rollingTrimItems('video-1', 'video-2', 10);

    const itemById = useItemsStore.getState().itemById;
    expect(itemById['video-1']).toMatchObject({ durationInFrames: 70, sourceEnd: 90 });
    expect(itemById['audio-1']).toMatchObject({ durationInFrames: 70, sourceEnd: 90 });
    expect(itemById['video-2']).toMatchObject({ from: 70, durationInFrames: 50, sourceStart: 30 });
    expect(itemById['audio-2']).toMatchObject({ from: 70, durationInFrames: 50, sourceStart: 30 });
    expect(useTransitionsStore.getState().transitions).toHaveLength(1);
  });

  it('ripple trims linked companions and shifts downstream linked pairs across tracks', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({ id: 'video-1', linkedGroupId: 'group-1' }),
      makeAudioItem({ id: 'audio-1', linkedGroupId: 'group-1' }),
      makeVideoItem({ id: 'video-2', from: 90, durationInFrames: 30, linkedGroupId: 'group-2', mediaId: 'media-2' }),
      makeAudioItem({ id: 'audio-2', from: 90, durationInFrames: 30, linkedGroupId: 'group-2', mediaId: 'media-2' }),
    ]);

    rippleTrimItem('video-1', 'start', 10);

    const itemById = useItemsStore.getState().itemById;
    expect(itemById['video-1']).toMatchObject({ from: 0, durationInFrames: 50, sourceStart: 10 });
    expect(itemById['audio-1']).toMatchObject({ from: 0, durationInFrames: 50, sourceStart: 10 });
    expect(itemById['video-2']).toMatchObject({ from: 80 });
    expect(itemById['audio-2']).toMatchObject({ from: 80 });
  });

  it('ripple trim auto-blades a sync-locked continuous clip on another track', () => {
    useEditorStore.setState({ linkedSelectionEnabled: false });
    useItemsStore.getState().setItems([
      makeVideoItem({ id: 'video-1', linkedGroupId: undefined }),
      makeAudioItem({
        id: 'music-bed',
        linkedGroupId: undefined,
        from: 0,
        durationInFrames: 120,
        sourceEnd: 120,
        sourceDuration: 180,
      }),
    ]);

    rippleTrimItem('video-1', 'end', -10);

    const audioItems = useItemsStore.getState().items
      .filter((item) => item.trackId === 'audio-track')
      .toSorted((left, right) => left.from - right.from);

    expect(audioItems).toHaveLength(2);
    expect(audioItems.map((item) => ({ from: item.from, durationInFrames: item.durationInFrames }))).toEqual([
      { from: 0, durationInFrames: 50 },
      { from: 50, durationInFrames: 60 },
    ]);
  });

  it('ripple trim leaves sync-lock disabled tracks static', () => {
    useEditorStore.setState({ linkedSelectionEnabled: false });
    useItemsStore.getState().setTracks([
      makeTrack({ id: 'video-track', name: 'V1', order: 0, kind: 'video' }),
      makeTrack({ id: 'audio-track', name: 'A1', order: 1, kind: 'audio', syncLock: false }),
    ]);
    useItemsStore.getState().setItems([
      makeVideoItem({ id: 'video-1', linkedGroupId: undefined }),
      makeAudioItem({
        id: 'music-bed',
        linkedGroupId: undefined,
        from: 0,
        durationInFrames: 120,
        sourceEnd: 120,
        sourceDuration: 180,
      }),
    ]);

    rippleTrimItem('video-1', 'end', -10);

    const audioItems = useItemsStore.getState().items
      .filter((item) => item.trackId === 'audio-track')
      .toSorted((left, right) => left.from - right.from);

    expect(audioItems).toEqual([
      expect.objectContaining({
        id: 'music-bed',
        from: 0,
        durationInFrames: 120,
      }),
    ]);
  });

  it('allows ripple trim on a transitioned edge and keeps the cut aligned', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({ id: 'video-1', linkedGroupId: 'group-1', sourceEnd: 80, sourceDuration: 140 }),
      makeAudioItem({ id: 'audio-1', linkedGroupId: 'group-1', sourceEnd: 80, sourceDuration: 140 }),
      makeVideoItem({ id: 'video-2', from: 60, linkedGroupId: 'group-2', mediaId: 'media-2', sourceStart: 12, sourceEnd: 72, sourceDuration: 140 }),
      makeAudioItem({ id: 'audio-2', from: 60, linkedGroupId: 'group-2', mediaId: 'media-2', sourceStart: 12, sourceEnd: 72, sourceDuration: 140 }),
      makeVideoItem({ id: 'video-3', from: 120, durationInFrames: 30, linkedGroupId: 'group-3', mediaId: 'media-3' }),
      makeAudioItem({ id: 'audio-3', from: 120, durationInFrames: 30, linkedGroupId: 'group-3', mediaId: 'media-3' }),
    ]);
    addTransition('video-1', 'video-2', 'crossfade', 12);

    rippleTrimItem('video-1', 'end', -8);

    const itemById = useItemsStore.getState().itemById;
    expect(itemById['video-1']).toMatchObject({ durationInFrames: 52 });
    expect(itemById['audio-1']).toMatchObject({ durationInFrames: 52 });
    expect(itemById['video-2']).toMatchObject({ from: 52 });
    expect(itemById['audio-2']).toMatchObject({ from: 52 });
    expect(itemById['video-3']).toMatchObject({ from: 112 });
    expect(itemById['audio-3']).toMatchObject({ from: 112 });
    expect(useTransitionsStore.getState().transitions).toEqual([
      expect.objectContaining({ leftClipId: 'video-1', rightClipId: 'video-2', durationInFrames: 12 }),
    ]);
  });

  it('undoes a bridge-breaking trim in a single step', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({ id: 'video-1', linkedGroupId: 'group-1', sourceEnd: 80, sourceDuration: 140 }),
      makeAudioItem({ id: 'audio-1', linkedGroupId: 'group-1', sourceEnd: 80, sourceDuration: 140 }),
      makeVideoItem({ id: 'video-2', from: 60, linkedGroupId: 'group-2', mediaId: 'media-2', sourceStart: 12, sourceEnd: 72, sourceDuration: 140 }),
      makeAudioItem({ id: 'audio-2', from: 60, linkedGroupId: 'group-2', mediaId: 'media-2', sourceStart: 12, sourceEnd: 72, sourceDuration: 140 }),
    ]);
    addTransition('video-1', 'video-2', 'crossfade', 12);

    const transitionId = useTransitionsStore.getState().transitions[0]?.id;
    expect(transitionId).toBeTruthy();

    trimItemBreakingTransition('video-2', 'start', 10, [transitionId!]);

    let itemById = useItemsStore.getState().itemById;
    expect(itemById['video-2']).toMatchObject({ from: 70, durationInFrames: 50, sourceStart: 22, sourceEnd: 72 });
    expect(itemById['audio-2']).toMatchObject({ from: 70, durationInFrames: 50, sourceStart: 22, sourceEnd: 72 });
    expect(useTransitionsStore.getState().transitions).toHaveLength(0);

    useTimelineCommandStore.getState().undo();

    itemById = useItemsStore.getState().itemById;
    expect(itemById['video-2']).toMatchObject({ from: 60, durationInFrames: 60, sourceStart: 12, sourceEnd: 72 });
    expect(itemById['audio-2']).toMatchObject({ from: 60, durationInFrames: 60, sourceStart: 12, sourceEnd: 72 });
    expect(useTransitionsStore.getState().transitions).toEqual([
      expect.objectContaining({ id: transitionId, leftClipId: 'video-1', rightClipId: 'video-2', durationInFrames: 12 }),
    ]);
  });

  it('slips a linked audio edit back onto video and repairs transition duration', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({ id: 'video-1', sourceEnd: 80, sourceDuration: 120, linkedGroupId: 'group-1' }),
      makeAudioItem({ id: 'audio-1', sourceEnd: 80, sourceDuration: 120, linkedGroupId: 'group-1' }),
      makeVideoItem({ id: 'video-2', from: 60, sourceStart: 6, sourceEnd: 66, sourceDuration: 120, mediaId: 'media-2', linkedGroupId: 'group-2' }),
      makeAudioItem({ id: 'audio-2', from: 60, sourceStart: 6, sourceEnd: 66, sourceDuration: 120, mediaId: 'media-2', linkedGroupId: 'group-2' }),
    ]);
    addTransition('video-1', 'video-2', 'crossfade', 12);

    slipItem('audio-2', -4);

    const itemById = useItemsStore.getState().itemById;
    expect(itemById['audio-2']).toMatchObject({ sourceStart: 2, sourceEnd: 62 });
    expect(itemById['video-2']).toMatchObject({ sourceStart: 2, sourceEnd: 62 });
    expect(useTransitionsStore.getState().transitions).toEqual([
      expect.objectContaining({ durationInFrames: 4 }),
    ]);
  });

  it('slides linked companions and matching neighbor companions together', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({ id: 'video-left', linkedGroupId: 'group-left' }),
      makeAudioItem({ id: 'audio-left', linkedGroupId: 'group-left' }),
      makeVideoItem({ id: 'video-middle', from: 60, linkedGroupId: 'group-middle', mediaId: 'media-2' }),
      makeAudioItem({ id: 'audio-middle', from: 60, linkedGroupId: 'group-middle', mediaId: 'media-2' }),
      makeVideoItem({ id: 'video-right', from: 120, linkedGroupId: 'group-right', mediaId: 'media-3' }),
      makeAudioItem({ id: 'audio-right', from: 120, linkedGroupId: 'group-right', mediaId: 'media-3' }),
    ]);

    slideItem('video-middle', 20, 'video-left', 'video-right');

    const itemById = useItemsStore.getState().itemById;
    expect(itemById['video-left']).toMatchObject({ durationInFrames: 80 });
    expect(itemById['audio-left']).toMatchObject({ durationInFrames: 80 });
    expect(itemById['video-middle']).toMatchObject({ from: 80 });
    expect(itemById['audio-middle']).toMatchObject({ from: 80 });
    expect(itemById['video-right']).toMatchObject({ from: 140, durationInFrames: 40 });
    expect(itemById['audio-right']).toMatchObject({ from: 140, durationInFrames: 40 });
  });

  it('slide trims companion-only adjacent neighbors (solo audio next to companion)', () => {
    useItemsStore.getState().setItems([
      // Video track: [video-left][video-middle] — no video-right neighbor
      makeVideoItem({ id: 'video-left', linkedGroupId: 'group-left' }),
      makeAudioItem({ id: 'audio-left', linkedGroupId: 'group-left' }),
      makeVideoItem({ id: 'video-middle', from: 60, linkedGroupId: 'group-middle', mediaId: 'media-2' }),
      makeAudioItem({ id: 'audio-middle', from: 60, linkedGroupId: 'group-middle', mediaId: 'media-2' }),
      // Solo audio adjacent to audio-middle on the right (no video counterpart)
      makeAudioItem({
        id: 'solo-audio',
        from: 120,
        durationInFrames: 60,
        linkedGroupId: undefined,
        originId: 'origin-solo',
        mediaId: 'media-solo',
        sourceStart: 30,
        sourceEnd: 90,
        sourceDuration: 200,
        sourceFps: 30,
      }),
    ]);

    // Slide video-middle right by 10: audio-middle also moves right,
    // solo-audio should be trimmed from start (shrink start by 10)
    slideItem('video-middle', 10, 'video-left', null);

    const itemById = useItemsStore.getState().itemById;
    expect(itemById['video-middle']).toMatchObject({ from: 70 });
    expect(itemById['audio-middle']).toMatchObject({ from: 70 });
    // Solo audio: start trimmed by 10 (from 120 to 130, duration 50)
    expect(itemById['solo-audio']).toMatchObject({ from: 130, durationInFrames: 50 });
  });

  it('clamps slide edits before they break an existing transition on split segments', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({ id: 'video-left', durationInFrames: 60, sourceStart: 0, sourceEnd: 60, sourceDuration: 66, linkedGroupId: 'group-left' }),
      makeAudioItem({ id: 'audio-left', durationInFrames: 60, sourceStart: 0, sourceEnd: 60, sourceDuration: 180, linkedGroupId: 'group-left' }),
      makeVideoItem({ id: 'video-middle', from: 60, durationInFrames: 60, sourceStart: 60, sourceEnd: 120, sourceDuration: 240, linkedGroupId: 'group-middle', mediaId: 'media-2' }),
      makeAudioItem({ id: 'audio-middle', from: 60, durationInFrames: 60, sourceStart: 60, sourceEnd: 120, sourceDuration: 240, linkedGroupId: 'group-middle', mediaId: 'media-2' }),
      makeVideoItem({ id: 'video-right', from: 120, durationInFrames: 60, sourceStart: 120, sourceEnd: 180, sourceDuration: 300, linkedGroupId: 'group-right', mediaId: 'media-3' }),
      makeAudioItem({ id: 'audio-right', from: 120, durationInFrames: 60, sourceStart: 120, sourceEnd: 180, sourceDuration: 300, linkedGroupId: 'group-right', mediaId: 'media-3' }),
    ]);
    addTransition('video-left', 'video-middle', 'crossfade', 12);

    slideItem('video-middle', 5, 'video-left', 'video-right');

    const itemById = useItemsStore.getState().itemById;
    expect(itemById['video-left']).toMatchObject({ durationInFrames: 60, sourceEnd: 60 });
    expect(itemById['video-middle']).toMatchObject({ from: 60, sourceStart: 60, sourceEnd: 120 });
    expect(itemById['video-right']).toMatchObject({ from: 120, durationInFrames: 60 });
    expect(useTransitionsStore.getState().transitions).toEqual([
      expect.objectContaining({ leftClipId: 'video-left', rightClipId: 'video-middle', durationInFrames: 12 }),
    ]);
  });

  it('blocks splitting a linked companion inside the video transition bridge', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({ id: 'video-1', sourceEnd: 80, sourceDuration: 120, linkedGroupId: 'group-1' }),
      makeAudioItem({ id: 'audio-1', sourceEnd: 80, sourceDuration: 120, linkedGroupId: 'group-1' }),
      makeVideoItem({ id: 'video-2', from: 60, sourceStart: 10, sourceEnd: 70, sourceDuration: 120, mediaId: 'media-2', linkedGroupId: 'group-2' }),
      makeAudioItem({ id: 'audio-2', from: 60, sourceStart: 10, sourceEnd: 70, sourceDuration: 120, mediaId: 'media-2', linkedGroupId: 'group-2' }),
    ]);
    addTransition('video-1', 'video-2', 'crossfade', 20);

    const result = splitItem('audio-1', 55);

    expect(result).toBeNull();
    expect(useItemsStore.getState().items).toHaveLength(4);
  });

  it('splits linked compound wrappers together', () => {
    useItemsStore.getState().setItems([
      makeCompositionItem({ id: 'comp-1', compositionId: 'composition-1', sourceStart: 10, sourceEnd: 70, sourceDuration: 120, linkedGroupId: 'group-1' }),
      makeAudioItem({ id: 'comp-audio-1', mediaId: undefined, src: '', label: 'Compound 1', compositionId: 'composition-1', sourceStart: 10, sourceEnd: 70, sourceDuration: 120, linkedGroupId: 'group-1' }),
    ]);

    splitItem('comp-1', 30);

    const items = useItemsStore.getState().items;
    const leftVisual = items.find((item) => item.id === 'comp-1');
    const rightVisual = items.find((item) => item.type === 'composition' && item.id !== 'comp-1');
    const leftAudio = items.find((item) => item.id === 'comp-audio-1');
    const rightAudio = items.find((item) => item.type === 'audio' && item.id !== 'comp-audio-1');

    expect(leftVisual).toMatchObject({ from: 0, durationInFrames: 30, sourceStart: 10, sourceEnd: 40 });
    expect(rightVisual).toMatchObject({ from: 30, durationInFrames: 30, sourceStart: 40, sourceEnd: 70 });
    expect(leftAudio).toMatchObject({ from: 0, durationInFrames: 30, sourceStart: 10, sourceEnd: 40 });
    expect(rightAudio).toMatchObject({ from: 30, durationInFrames: 30, sourceStart: 40, sourceEnd: 70 });
    expect(leftVisual?.linkedGroupId).toBe(leftAudio?.linkedGroupId);
    expect(rightVisual?.linkedGroupId).toBe(rightAudio?.linkedGroupId);
  });

  it('joins linked compound wrappers back together', () => {
    useItemsStore.getState().setItems([
      makeCompositionItem({ id: 'comp-1', compositionId: 'composition-1', durationInFrames: 30, sourceStart: 10, sourceEnd: 40, sourceDuration: 120, linkedGroupId: 'group-left' }),
      makeCompositionItem({ id: 'comp-2', from: 30, compositionId: 'composition-1', durationInFrames: 30, sourceStart: 40, sourceEnd: 70, sourceDuration: 120, linkedGroupId: 'group-right' }),
      makeAudioItem({ id: 'comp-audio-1', mediaId: undefined, src: '', label: 'Compound 1', compositionId: 'composition-1', durationInFrames: 30, sourceStart: 10, sourceEnd: 40, sourceDuration: 120, linkedGroupId: 'group-left' }),
      makeAudioItem({ id: 'comp-audio-2', mediaId: undefined, src: '', label: 'Compound 1', compositionId: 'composition-1', from: 30, durationInFrames: 30, sourceStart: 40, sourceEnd: 70, sourceDuration: 120, linkedGroupId: 'group-right' }),
    ]);
    useItemsStore.getState().setTracks([
      makeTrack({ id: 'video-track', name: 'V1', order: 0, kind: 'video' }),
      makeTrack({ id: 'audio-track', name: 'A1', order: 1, kind: 'audio' }),
    ]);

    joinItems(['comp-1', 'comp-2']);

    const items = useItemsStore.getState().items;
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.id === 'comp-1')).toMatchObject({ from: 0, durationInFrames: 60, sourceStart: 10, sourceEnd: 70 });
    expect(items.find((item) => item.id === 'comp-audio-1')).toMatchObject({ from: 0, durationInFrames: 60, sourceStart: 10, sourceEnd: 70 });
  });

  it('remaps joined-away transition endpoints and removes internal joined transitions', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({
        id: 'video-a',
        from: 0,
        durationInFrames: 30,
        linkedGroupId: undefined,
        sourceStart: 0,
        sourceEnd: 30,
        sourceDuration: 100,
      }),
      makeVideoItem({
        id: 'video-b',
        from: 30,
        durationInFrames: 30,
        linkedGroupId: undefined,
        mediaId: 'media-2',
        sourceStart: 30,
        sourceEnd: 60,
        sourceDuration: 100,
      }),
      makeVideoItem({
        id: 'video-c',
        from: 60,
        durationInFrames: 30,
        linkedGroupId: undefined,
        mediaId: 'media-3',
        sourceStart: 10,
        sourceEnd: 40,
        sourceDuration: 120,
      }),
    ]);
    useTransitionsStore.getState().setTransitions([
      {
        id: 'transition-internal',
        type: 'crossfade',
        leftClipId: 'video-a',
        rightClipId: 'video-b',
        trackId: 'video-track',
        durationInFrames: 8,
        timing: 'linear',
        presentation: 'fade',
      },
      {
        id: 'transition-outgoing',
        type: 'crossfade',
        leftClipId: 'video-b',
        rightClipId: 'video-c',
        trackId: 'video-track',
        durationInFrames: 8,
        timing: 'linear',
        presentation: 'fade',
      },
    ]);

    joinItems(['video-a', 'video-b']);

    expect(useItemsStore.getState().items.find((item) => item.id === 'video-b')).toBeUndefined();
    expect(useTransitionsStore.getState().transitions).toEqual([
      expect.objectContaining({ id: 'transition-outgoing', leftClipId: 'video-a', rightClipId: 'video-c' }),
    ]);
  });
});
