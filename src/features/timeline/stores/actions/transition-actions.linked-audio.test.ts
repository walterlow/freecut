import { beforeEach, describe, expect, it } from 'vitest';
import type { AudioItem, CompositionItem, TimelineTrack, VideoItem } from '@/types/timeline';
import { useItemsStore } from '../items-store';
import { useTransitionsStore } from '../transitions-store';
import { useKeyframesStore } from '../keyframes-store';
import { useTimelineCommandStore } from '../timeline-command-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { addTransition, removeTransition, updateTransition } from './transition-actions';
import { updateItem } from './item-actions';
import { getManagedLinkedAudioTransitions } from '@/shared/utils/linked-media';

function makeTrack(overrides: Partial<TimelineTrack> & Pick<TimelineTrack, 'id' | 'name' | 'order'>): TimelineTrack {
  return {
    height: 80,
    locked: false,
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
    label: 'clip.mp4',
    src: 'blob:audio',
    mediaId: 'media-1',
    linkedGroupId: 'group-1',
    sourceStart: 0,
    sourceEnd: 60,
    sourceDuration: 180,
    sourceFps: 30,
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
    sourceEnd: 60,
    sourceDuration: 120,
    sourceFps: 30,
    ...overrides,
  } as CompositionItem;
}

describe('transition actions with linked audio companions', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory();
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false });
    useItemsStore.getState().setTracks([
      makeTrack({ id: 'video-track', name: 'V1', order: 0, kind: 'video' }),
      makeTrack({ id: 'audio-track', name: 'A1', order: 1, kind: 'audio' }),
    ]);
    useItemsStore.getState().setItems([]);
    useTransitionsStore.getState().setTransitions([]);
    useKeyframesStore.getState().setKeyframes([]);
  });

  it('keeps synchronized linked audio geometry centered on the cut when adding a transition', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({ id: 'video-1', linkedGroupId: 'group-1' }),
      makeAudioItem({ id: 'audio-1', linkedGroupId: 'group-1' }),
      makeVideoItem({ id: 'video-2', from: 60, linkedGroupId: 'group-2', sourceStart: 30, sourceEnd: 90, mediaId: 'media-2' }),
      makeAudioItem({ id: 'audio-2', from: 60, linkedGroupId: 'group-2', sourceStart: 30, sourceEnd: 90, mediaId: 'media-2' }),
      makeAudioItem({ id: 'audio-3', from: 150, linkedGroupId: undefined, mediaId: 'music-bed' }),
    ]);

    const added = addTransition('video-1', 'video-2', 'crossfade', 30);

    expect(added).toBe(true);
    expect(useItemsStore.getState().itemById['video-2']).toMatchObject({ from: 60 });
    expect(useItemsStore.getState().itemById['audio-2']?.from).toBe(60);
    expect(useItemsStore.getState().itemById['audio-2']?.audioFadeIn ?? 0).toBe(0);
    expect(useItemsStore.getState().itemById['audio-1']?.audioFadeOut ?? 0).toBe(0);
    expect(useItemsStore.getState().itemById['audio-3']).toMatchObject({ from: 150 });
  });

  it('manages linked compound audio transitions from compound visual transitions', () => {
    useItemsStore.getState().setItems([
      makeCompositionItem({ id: 'comp-1', linkedGroupId: 'group-1', compositionId: 'composition-1', sourceStart: 0, sourceEnd: 80, sourceDuration: 120 }),
      makeAudioItem({ id: 'comp-audio-1', mediaId: undefined, src: '', label: 'Compound 1', linkedGroupId: 'group-1', compositionId: 'composition-1', sourceStart: 0, sourceEnd: 80, sourceDuration: 120 }),
      makeCompositionItem({ id: 'comp-2', from: 60, linkedGroupId: 'group-2', compositionId: 'composition-2', label: 'Compound 2', sourceStart: 20, sourceEnd: 80, sourceDuration: 120 }),
      makeAudioItem({ id: 'comp-audio-2', from: 60, mediaId: undefined, src: '', label: 'Compound 2', linkedGroupId: 'group-2', compositionId: 'composition-2', sourceStart: 20, sourceEnd: 80, sourceDuration: 120 }),
    ]);

    const added = addTransition('comp-1', 'comp-2', 'crossfade', 20);

    expect(added).toBe(true);
    const managedTransitions = getManagedLinkedAudioTransitions(
      useItemsStore.getState().items,
      useTransitionsStore.getState().transitions,
    );
    expect(managedTransitions).toEqual([
      expect.objectContaining({
        leftAudio: expect.objectContaining({ id: 'comp-audio-1' }),
        rightAudio: expect.objectContaining({ id: 'comp-audio-2' }),
        transition: expect.objectContaining({ leftClipId: 'comp-1', rightClipId: 'comp-2' }),
      }),
    ]);
  });

  it('clamps the default applied duration to the valid handle at the cut', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({ id: 'video-1', sourceEnd: 68, sourceDuration: 180 }),
      makeVideoItem({ id: 'video-2', from: 60, sourceStart: 6, sourceEnd: 66, sourceDuration: 180, linkedGroupId: 'group-2', mediaId: 'media-2' }),
    ]);

    const added = addTransition('video-1', 'video-2');

    expect(added).toBe(true);
    expect(useTransitionsStore.getState().transitions).toEqual([
      expect.objectContaining({ durationInFrames: 12 }),
    ]);
  });

  it('adds a side-aligned transition when centered placement is not possible but one-sided handles exist', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({ id: 'video-1', sourceEnd: 120, sourceDuration: 240 }),
      makeVideoItem({ id: 'video-2', from: 60, sourceStart: 0, sourceEnd: 60, sourceDuration: 60, linkedGroupId: 'group-2', mediaId: 'media-2' }),
    ]);

    const added = addTransition('video-1', 'video-2', 'crossfade', 24);

    expect(added).toBe(true);
    expect(useTransitionsStore.getState().transitions).toEqual([
      expect.objectContaining({
        durationInFrames: 24,
        alignment: 1,
      }),
    ]);
  });

  it('does not move synchronized linked audio when transition duration changes', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({ id: 'video-1', linkedGroupId: 'group-1' }),
      makeAudioItem({ id: 'audio-1', linkedGroupId: 'group-1' }),
      makeVideoItem({ id: 'video-2', from: 60, linkedGroupId: 'group-2', sourceStart: 45, sourceEnd: 105, mediaId: 'media-2' }),
      makeAudioItem({ id: 'audio-2', from: 60, linkedGroupId: 'group-2', sourceStart: 45, sourceEnd: 105, mediaId: 'media-2' }),
    ]);
    addTransition('video-1', 'video-2', 'crossfade', 30);
    const transitionId = useTransitionsStore.getState().transitions[0]?.id;

    expect(transitionId).toBeDefined();
    updateTransition(transitionId!, { durationInFrames: 45 });

    expect(useItemsStore.getState().itemById['video-2']).toMatchObject({ from: 60 });
    expect(useItemsStore.getState().itemById['audio-2']?.from).toBe(60);
    expect(useItemsStore.getState().itemById['audio-2']?.audioFadeIn ?? 0).toBe(0);
    expect(useItemsStore.getState().itemById['audio-1']?.audioFadeOut ?? 0).toBe(0);
  });

  it('leaves synchronized linked audio in place when removing the transition', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({ id: 'video-1', linkedGroupId: 'group-1' }),
      makeAudioItem({ id: 'audio-1', linkedGroupId: 'group-1' }),
      makeVideoItem({ id: 'video-2', from: 60, linkedGroupId: 'group-2', sourceStart: 30, sourceEnd: 90, mediaId: 'media-2' }),
      makeAudioItem({ id: 'audio-2', from: 60, linkedGroupId: 'group-2', sourceStart: 30, sourceEnd: 90, mediaId: 'media-2' }),
    ]);
    addTransition('video-1', 'video-2', 'crossfade', 30);
    const transitionId = useTransitionsStore.getState().transitions[0]?.id;

    removeTransition(transitionId!);

    expect(useItemsStore.getState().itemById['video-2']).toMatchObject({ from: 60 });
    expect(useItemsStore.getState().itemById['audio-2']?.from).toBe(60);
    expect(useItemsStore.getState().itemById['audio-2']?.audioFadeIn ?? 0).toBe(0);
    expect(useItemsStore.getState().itemById['audio-1']?.audioFadeOut ?? 0).toBe(0);
    expect(useTransitionsStore.getState().transitions).toEqual([]);
  });

  it('preserves manual linked-audio fades across transition edits', () => {
    useItemsStore.getState().setItems([
      makeVideoItem({ id: 'video-1', linkedGroupId: 'group-1' }),
      makeAudioItem({ id: 'audio-1', linkedGroupId: 'group-1' }),
      makeVideoItem({ id: 'video-2', from: 60, linkedGroupId: 'group-2', sourceStart: 45, sourceEnd: 105, mediaId: 'media-2' }),
      makeAudioItem({ id: 'audio-2', from: 60, linkedGroupId: 'group-2', sourceStart: 45, sourceEnd: 105, mediaId: 'media-2' }),
    ]);
    addTransition('video-1', 'video-2', 'crossfade', 30);
    const transitionId = useTransitionsStore.getState().transitions[0]?.id;

    updateItem('audio-1', { audioFadeOut: 0.25 });
    updateTransition(transitionId!, { durationInFrames: 45 });

    expect(useItemsStore.getState().itemById['audio-1']).toMatchObject({ audioFadeOut: 0.25 });
    expect(useItemsStore.getState().itemById['audio-2']?.from).toBe(60);
    expect(useItemsStore.getState().itemById['audio-2']?.audioFadeIn ?? 0).toBe(0);

    removeTransition(transitionId!);

    expect(useItemsStore.getState().itemById['audio-1']).toMatchObject({ audioFadeOut: 0.25 });
    expect(useItemsStore.getState().itemById['audio-2']?.from).toBe(60);
    expect(useItemsStore.getState().itemById['audio-2']?.audioFadeIn ?? 0).toBe(0);
  });
});
