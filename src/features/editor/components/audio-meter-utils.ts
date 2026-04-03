import type { AudioItem, CompositionItem, TimelineItem, TimelineTrack } from '@/types/timeline';
import type { Transition } from '@/types/transition';
import { getAudioClipFadeMultiplier, getAudioFadeMultiplier } from '@/shared/utils/audio-fade-curve';
import {
  getManagedLinkedAudioTransitions,
  hasLinkedAudioCompanion,
  isCompositionAudioItem,
} from '@/shared/utils/linked-media';
import { timelineToSourceFrames } from '@/features/editor/deps/timeline-utils';
import { getTrackKind, resolveEffectiveTrackStates } from '@/features/editor/deps/timeline-utils';
import {
  buildCompoundAudioTransitionSegments,
  buildStandaloneAudioSegments,
  buildTransitionVideoAudioSegments,
  resolveCompositionRenderPlan,
  type AudioSegment,
  type CompoundAudioSegment,
  type VideoAudioSegment,
} from '@/features/editor/deps/composition-runtime';

// Safety guard against corrupted circular composition graphs while allowing deep nesting.
const AUDIO_METER_MAX_DEPTH = 16;
const AUDIO_METER_MIN_DB = -54;
const AUDIO_METER_MAX_DB = 6;
const DEFAULT_WINDOW_SECONDS = 1 / 24;

const normalizationPeakCache = new WeakMap<Float32Array, number>();

export type AudioMeterCompositionLookup = Record<string, {
  id: string;
  tracks: TimelineTrack[];
  transitions: Transition[];
  fps: number;
}>;

export interface AudioMeterGraphNode {
  fps: number;
  directSegments: Array<{
    segment: AudioSegment | VideoAudioSegment;
    trackId: string;
    committedTrackVolumeGain: number;
  }>;
  compoundSegments: Array<{
    segment: CompoundAudioSegment;
    compositionId: string;
    trackId: string;
    committedTrackVolumeGain: number;
  }>;
  compositionWrappers: Array<{
    wrapper: EnrichedCompositionAudioItem | EnrichedCompositionItem;
    wrapperGain: number;
    trackId: string;
    committedTrackVolumeGain: number;
  }>;
}

export interface AudioMeterGraph {
  root: AudioMeterGraphNode;
  compositionsById: Record<string, AudioMeterGraphNode>;
}

type EnrichedCompositionAudioItem = AudioItem & {
  compositionId: string;
  muted: boolean;
  trackVisible: boolean;
  trackVolumeDb: number;
};

type EnrichedCompositionItem = CompositionItem & {
  muted: boolean;
  trackVisible: boolean;
};

export interface AudioMeterSource {
  mediaId: string;
  /** Item-level gain (fades, crossfades, item volumeDb) — excludes track and master faders. */
  gain: number;
  /** Live fader correction applied on top of the gain already baked into the source graph. */
  trackVolumeGain: number;
  sourceTimeSeconds: number;
  windowSeconds: number;
  trackId?: string;
}

export interface AudioMeterWaveform {
  peaks: Float32Array;
  sampleRate: number;
  channels: number;  // 1 = mono, 2 = interleaved stereo
}

export interface AudioMeterEstimate {
  left: number;
  right: number;
  resolvedSourceCount: number;
  unresolvedSourceCount: number;
}

// Live track volume overrides (dB) set during fader drag.
// The meter source builder reads these to produce real-time post-fader levels
// without waiting for the store to commit on drag release.
const liveTrackVolumeOverrides = new Map<string, number>();
let liveOverrideVersion = 0;
const liveOverrideListeners = new Set<() => void>();

function notifyLiveOverrideListeners(): void {
  liveOverrideVersion += 1;
  for (const listener of liveOverrideListeners) {
    listener();
  }
}

export function subscribeLiveOverrideVersion(callback: () => void): () => void {
  liveOverrideListeners.add(callback);
  return () => { liveOverrideListeners.delete(callback); };
}

export function getLiveOverrideVersion(): number {
  return liveOverrideVersion;
}

export function setLiveTrackVolumeOverride(trackId: string, volumeDb: number): void {
  if (liveTrackVolumeOverrides.get(trackId) === volumeDb) return;
  liveTrackVolumeOverrides.set(trackId, volumeDb);
  notifyLiveOverrideListeners();
}

export function clearLiveTrackVolumeOverride(trackId: string): void {
  if (!liveTrackVolumeOverrides.has(trackId)) return;
  liveTrackVolumeOverrides.delete(trackId);
  notifyLiveOverrideListeners();
}

// Live bus/master volume override (dB) set during bus fader drag.
let liveBusVolumeOverrideDb: number | null = null;

export function setLiveBusVolumeOverride(volumeDb: number): void {
  if (liveBusVolumeOverrideDb === volumeDb) return;
  liveBusVolumeOverrideDb = volumeDb;
  notifyLiveOverrideListeners();
}

export function clearLiveBusVolumeOverride(): void {
  if (liveBusVolumeOverrideDb === null) return;
  liveBusVolumeOverrideDb = null;
  notifyLiveOverrideListeners();
}

export function getLiveBusVolumeOverride(): number | null {
  return liveBusVolumeOverrideDb;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toLinearGain(volumeDb: number): number {
  return Math.pow(10, volumeDb / 20);
}

function getTrackGainCorrection(trackId: string, committedTrackVolumeGain: number): number {
  const liveOverrideDb = liveTrackVolumeOverrides.get(trackId);
  if (liveOverrideDb === undefined) {
    return 1;
  }

  const committedGain = Math.max(committedTrackVolumeGain, 0.000001);
  return toLinearGain(liveOverrideDb) / committedGain;
}

function getSegmentSourceTimeSeconds(params: {
  trimBefore: number;
  sourceFps: number;
  localFrame: number;
  playbackRate: number;
  timelineFps: number;
}): number {
  return (params.trimBefore / params.sourceFps)
    + ((params.localFrame * params.playbackRate) / params.timelineFps);
}

function getDirectSegmentGain(segment: AudioSegment | VideoAudioSegment, localFrame: number, fps: number): number {
  const clipFadeMultiplier = segment.clipFadeSpans
    ? getAudioClipFadeMultiplier(localFrame, segment.clipFadeSpans)
    : getAudioFadeMultiplier({
      frame: localFrame,
      durationInFrames: segment.durationInFrames,
      fadeInFrames: (segment.audioFadeIn ?? 0) * fps,
      fadeOutFrames: (segment.audioFadeOut ?? 0) * fps,
      contentStartOffsetFrames: 'contentStartOffsetFrames' in segment ? segment.contentStartOffsetFrames : 0,
      contentEndOffsetFrames: 'contentEndOffsetFrames' in segment ? segment.contentEndOffsetFrames : 0,
      fadeInDelayFrames: 'fadeInDelayFrames' in segment ? segment.fadeInDelayFrames : 0,
      fadeOutLeadFrames: 'fadeOutLeadFrames' in segment ? segment.fadeOutLeadFrames : 0,
      fadeInCurve: segment.audioFadeInCurve ?? 0,
      fadeOutCurve: segment.audioFadeOutCurve ?? 0,
      fadeInCurveX: segment.audioFadeInCurveX ?? 0.52,
      fadeOutCurveX: segment.audioFadeOutCurveX ?? 0.52,
    });

  const crossfadeMultiplier = getAudioFadeMultiplier({
    frame: localFrame,
    durationInFrames: segment.durationInFrames,
    fadeInFrames: 'crossfadeFadeIn' in segment ? segment.crossfadeFadeIn : undefined,
    fadeOutFrames: 'crossfadeFadeOut' in segment ? segment.crossfadeFadeOut : undefined,
    useEqualPower: true,
  });

  return Math.max(0, toLinearGain(segment.volumeDb) * clipFadeMultiplier * crossfadeMultiplier);
}

function appendDirectSegmentSources(params: {
  frame: number;
  fps: number;
  gainMultiplier: number;
  trackVolumeGain: number;
  segments: Array<AudioSegment | VideoAudioSegment>;
  sources: AudioMeterSource[];
  trackId?: string;
}): void {
  const { frame, fps, gainMultiplier, trackVolumeGain, segments, sources } = params;

  for (const segment of segments) {
    if (segment.muted || !segment.mediaId) continue;
    const localFrame = frame - segment.from;
    if (localFrame < 0 || localFrame >= segment.durationInFrames) continue;

    const segmentGain = getDirectSegmentGain(segment, localFrame, fps) * gainMultiplier;
    if (segmentGain <= 0.0001) continue;

    const sourceFps = segment.sourceFps ?? fps;
    sources.push({
      mediaId: segment.mediaId,
      gain: segmentGain,
      trackVolumeGain,
      sourceTimeSeconds: getSegmentSourceTimeSeconds({
        trimBefore: segment.trimBefore,
        sourceFps,
        localFrame,
        playbackRate: segment.playbackRate,
        timelineFps: fps,
      }),
      windowSeconds: Math.max(DEFAULT_WINDOW_SECONDS, 1 / Math.max(1, fps)),
      trackId: params.trackId ?? '',
    });
  }
}

function appendCompositionWrapperSources(params: {
  frame: number;
  fps: number;
  gainMultiplier: number;
  depth: number;
  compositionsById: AudioMeterCompositionLookup;
  sources: AudioMeterSource[];
  wrapper: EnrichedCompositionAudioItem | EnrichedCompositionItem;
  wrapperGain: number;
  ownerTrackId?: string;
}): void {
  const {
    frame,
    fps,
    gainMultiplier,
    depth,
    compositionsById,
    ownerTrackId,
    sources,
    wrapper,
    wrapperGain,
  } = params;

  if (depth > AUDIO_METER_MAX_DEPTH || wrapper.muted || !wrapper.trackVisible) {
    return;
  }

  const localFrame = frame - wrapper.from;
  if (localFrame < 0 || localFrame >= wrapper.durationInFrames) {
    return;
  }

  const composition = compositionsById[wrapper.compositionId];
  if (!composition) {
    return;
  }

  const sourceFps = wrapper.sourceFps ?? composition.fps ?? fps;
  const sourceStart = wrapper.sourceStart ?? wrapper.trimStart ?? 0;
  const nestedFrame = sourceStart + timelineToSourceFrames(
    localFrame,
    wrapper.speed ?? 1,
    fps,
    sourceFps,
  );

  appendAudioMeterSources({
    tracks: composition.tracks,
    transitions: composition.transitions ?? [],
    frame: nestedFrame,
    fps: composition.fps,
    gainMultiplier: gainMultiplier * wrapperGain,
    depth: depth + 1,
    compositionsById,
    ownerTrackId: ownerTrackId ?? wrapper.trackId,
    sources,
  });
}

function appendCompoundSegmentSources(params: {
  frame: number;
  fps: number;
  gainMultiplier: number;
  depth: number;
  compositionsById: AudioMeterCompositionLookup;
  ownerTrackId?: string;
  sources: AudioMeterSource[];
  segment: CompoundAudioSegment;
  wrapper: EnrichedCompositionAudioItem;
}): void {
  const { frame, fps, gainMultiplier, depth, compositionsById, ownerTrackId, sources, segment, wrapper } = params;
  if (depth > AUDIO_METER_MAX_DEPTH || segment.muted) {
    return;
  }

  const localFrame = frame - segment.from;
  if (localFrame < 0 || localFrame >= segment.durationInFrames) {
    return;
  }

  const composition = compositionsById[wrapper.compositionId];
  if (!composition) {
    return;
  }

  const sourceFps = segment.sourceFps ?? composition.fps ?? fps;
  const crossfadeMultiplier = getAudioFadeMultiplier({
    frame: localFrame,
    durationInFrames: segment.durationInFrames,
    fadeInFrames: segment.crossfadeFadeIn,
    fadeOutFrames: segment.crossfadeFadeOut,
    useEqualPower: true,
  });
  const nestedFrame = segment.trimBefore + timelineToSourceFrames(
    localFrame,
    segment.playbackRate,
    fps,
    sourceFps,
  );

  appendAudioMeterSources({
    tracks: composition.tracks,
    transitions: composition.transitions ?? [],
    frame: nestedFrame,
    fps: composition.fps,
    gainMultiplier: gainMultiplier * Math.max(0, toLinearGain(segment.volumeDb) * crossfadeMultiplier),
    depth: depth + 1,
    compositionsById,
    ownerTrackId: ownerTrackId ?? wrapper.trackId,
    sources,
  });
}

function appendAudioMeterSources(params: {
  tracks: TimelineTrack[];
  transitions: Transition[];
  frame: number;
  fps: number;
  gainMultiplier: number;
  depth: number;
  compositionsById: AudioMeterCompositionLookup;
  ownerTrackId?: string;
  sources: AudioMeterSource[];
}): void {
  const {
    tracks,
    transitions,
    frame,
    fps,
    gainMultiplier,
    depth,
    compositionsById,
    ownerTrackId,
    sources,
  } = params;

  if (gainMultiplier <= 0.0001 || tracks.length === 0) {
    return;
  }

  const effectiveTracks = resolveEffectiveTrackStates(tracks);
  const items = effectiveTracks.flatMap((track) => track.items);
  const renderPlan = resolveCompositionRenderPlan({ tracks: effectiveTracks, transitions });
  const audioItems = renderPlan.audioItems;
  const visibleTrackIds = renderPlan.trackRenderState.visibleTrackIds;

  const managedLinkedAudioTransitions = getManagedLinkedAudioTransitions(items, transitions);
  const managedLinkedAudioIds = new Set<string>();
  for (const managed of managedLinkedAudioTransitions) {
    managedLinkedAudioIds.add(managed.leftAudio.id);
    managedLinkedAudioIds.add(managed.rightAudio.id);
  }

  const managedLinkedAudioItems = audioItems.filter((item) => (
    !isCompositionAudioItem(item) && managedLinkedAudioIds.has(item.id)
  ));
  const managedLinkedAudioItemsById = new Map(managedLinkedAudioItems.map((item) => [item.id, item]));
  const managedLinkedAudioTransitionDefs = managedLinkedAudioTransitions.flatMap(({ transition, leftAudio, rightAudio }) => {
    const left = managedLinkedAudioItemsById.get(leftAudio.id);
    const right = managedLinkedAudioItemsById.get(rightAudio.id);
    if (!left || !right) return [];

    return [{
      ...transition,
      leftClipId: left.id,
      rightClipId: right.id,
      trackId: left.trackId,
    }];
  });

  const standaloneAudioItems = audioItems.filter((item) => (
    !isCompositionAudioItem(item) && !managedLinkedAudioIds.has(item.id)
  ));
  const videoAudioItems = renderPlan.videoItems.filter((item) => !hasLinkedAudioCompanion(audioItems, item));
  const directTrackIdByItemId = new Map<string, string>([
    ...standaloneAudioItems.map((item) => [item.id, item.trackId] as const),
    ...videoAudioItems.map((item) => [item.id, item.trackId] as const),
    ...managedLinkedAudioItems.map((item) => [item.id, item.trackId] as const),
  ]);
  const directSegments = [
    ...buildStandaloneAudioSegments(standaloneAudioItems, fps),
    ...buildTransitionVideoAudioSegments(videoAudioItems, transitions, fps),
    ...buildTransitionVideoAudioSegments(managedLinkedAudioItems, managedLinkedAudioTransitionDefs, fps),
  ];

  const trackVolumeByTrackId = new Map(effectiveTracks.map((track) => [
    track.id,
    toLinearGain(liveTrackVolumeOverrides.get(track.id) ?? track.volume ?? 0),
  ]));
  const committedTrackVolumeByTrackId = new Map(effectiveTracks.map((track) => [
    track.id,
    toLinearGain(track.volume ?? 0),
  ]));

  for (const segment of directSegments) {
    const sourceTrackId = directTrackIdByItemId.get(segment.itemId) ?? '';
    const trackId = ownerTrackId ?? sourceTrackId;
    appendDirectSegmentSources({
      frame,
      fps,
      gainMultiplier,
      trackVolumeGain: trackVolumeByTrackId.get(sourceTrackId) !== undefined
        ? (trackVolumeByTrackId.get(sourceTrackId) ?? 1) / Math.max(committedTrackVolumeByTrackId.get(sourceTrackId) ?? 1, 0.000001)
        : 1,
      segments: [segment],
      sources,
      trackId,
    });
  }

  const compoundAudioItems = audioItems.filter((item): item is EnrichedCompositionAudioItem => isCompositionAudioItem(item));
  const managedCompoundAudioItems = compoundAudioItems.filter((item) => managedLinkedAudioIds.has(item.id));
  const managedCompoundAudioItemsById = new Map(managedCompoundAudioItems.map((item) => [item.id, item]));
  const managedCompoundAudioTransitionDefs = managedLinkedAudioTransitions.flatMap(({ transition, leftAudio, rightAudio }) => {
    const left = managedCompoundAudioItemsById.get(leftAudio.id);
    const right = managedCompoundAudioItemsById.get(rightAudio.id);
    if (!left || !right) return [];

    return [{
      ...transition,
      leftClipId: left.id,
      rightClipId: right.id,
      trackId: left.trackId,
    }];
  });

  const managedCompoundAudioSegments = buildCompoundAudioTransitionSegments(
    managedCompoundAudioItems,
    managedCompoundAudioTransitionDefs,
    fps,
  );

  for (const segment of managedCompoundAudioSegments) {
    const wrapper = managedCompoundAudioItemsById.get(segment.itemId);
    if (!wrapper) continue;

    appendCompoundSegmentSources({
      frame,
      fps,
      gainMultiplier,
      depth,
      compositionsById,
      ownerTrackId,
      sources,
      segment,
      wrapper,
    });
  }

  const standaloneCompoundAudioItems = compoundAudioItems.filter((item) => !managedLinkedAudioIds.has(item.id));
  for (const wrapper of standaloneCompoundAudioItems) {
    appendCompositionWrapperSources({
      frame,
      fps,
      gainMultiplier,
      depth,
      compositionsById,
      ownerTrackId,
      sources,
      wrapper,
      wrapperGain: toLinearGain((wrapper.volume ?? 0) + (wrapper.trackVolumeDb ?? 0))
        * getTrackGainCorrection(wrapper.trackId, toLinearGain(wrapper.trackVolumeDb ?? 0)),
    });
  }

  const standaloneCompositionVisualItems = effectiveTracks.flatMap((track) => (
    track.items.flatMap((item): EnrichedCompositionItem[] => {
      if (item.type !== 'composition') return [];
      if (hasLinkedAudioCompanion(audioItems as TimelineItem[], item)) return [];
      return [{
        ...item,
        muted: track.muted ?? false,
        trackVisible: visibleTrackIds.has(track.id),
      }];
    })
  ));

  for (const wrapper of standaloneCompositionVisualItems) {
    appendCompositionWrapperSources({
      frame,
      fps,
      gainMultiplier,
      depth,
      compositionsById,
      ownerTrackId,
      sources,
      wrapper,
      wrapperGain: getTrackGainCorrection(wrapper.trackId, committedTrackVolumeByTrackId.get(wrapper.trackId) ?? 1),
    });
  }
}

export function resolveAudioMeterSources(params: {
  tracks: TimelineTrack[];
  transitions: Transition[];
  frame: number;
  fps: number;
  masterGain?: number;
  compositionsById?: AudioMeterCompositionLookup;
}): AudioMeterSource[] {
  const sources: AudioMeterSource[] = [];
  appendAudioMeterSources({
    tracks: params.tracks,
    transitions: params.transitions,
    frame: params.frame,
    fps: params.fps,
    gainMultiplier: params.masterGain ?? 1,
    depth: 0,
    compositionsById: params.compositionsById ?? {},
    sources,
  });
  return sources;
}

function buildAudioMeterGraphNode(params: {
  tracks: TimelineTrack[];
  transitions: Transition[];
  fps: number;
}): AudioMeterGraphNode {
  const { transitions, fps } = params;
  const tracks = resolveEffectiveTrackStates(params.tracks);
  const items = tracks.flatMap((track) => track.items);
  const renderPlan = resolveCompositionRenderPlan({ tracks, transitions });
  const audioItems = renderPlan.audioItems;
  const visibleTrackIds = renderPlan.trackRenderState.visibleTrackIds;

  const managedLinkedAudioTransitions = getManagedLinkedAudioTransitions(items, transitions);
  const managedLinkedAudioIds = new Set<string>();
  for (const managed of managedLinkedAudioTransitions) {
    managedLinkedAudioIds.add(managed.leftAudio.id);
    managedLinkedAudioIds.add(managed.rightAudio.id);
  }

  const managedLinkedAudioItems = audioItems.filter((item) => (
    !isCompositionAudioItem(item) && managedLinkedAudioIds.has(item.id)
  ));
  const managedLinkedAudioItemsById = new Map(managedLinkedAudioItems.map((item) => [item.id, item]));
  const managedLinkedAudioTransitionDefs = managedLinkedAudioTransitions.flatMap(({ transition, leftAudio, rightAudio }) => {
    const left = managedLinkedAudioItemsById.get(leftAudio.id);
    const right = managedLinkedAudioItemsById.get(rightAudio.id);
    if (!left || !right) return [];

    return [{
      ...transition,
      leftClipId: left.id,
      rightClipId: right.id,
      trackId: left.trackId,
    }];
  });

  const standaloneAudioItems = audioItems.filter((item) => (
    !isCompositionAudioItem(item) && !managedLinkedAudioIds.has(item.id)
  ));
  const videoAudioItems = renderPlan.videoItems.filter((item) => !hasLinkedAudioCompanion(audioItems, item));
  const directTrackIdByItemId = new Map<string, string>([
    ...standaloneAudioItems.map((item) => [item.id, item.trackId] as const),
    ...videoAudioItems.map((item) => [item.id, item.trackId] as const),
    ...managedLinkedAudioItems.map((item) => [item.id, item.trackId] as const),
  ]);
  const trackVolumeByTrackId = new Map(tracks.map((track) => [track.id, toLinearGain(track.volume ?? 0)]));
  const directSegments = [
    ...buildStandaloneAudioSegments(standaloneAudioItems, fps),
    ...buildTransitionVideoAudioSegments(videoAudioItems, transitions, fps),
    ...buildTransitionVideoAudioSegments(managedLinkedAudioItems, managedLinkedAudioTransitionDefs, fps),
  ].map((segment) => ({
    segment,
    trackId: directTrackIdByItemId.get(segment.itemId) ?? '',
    committedTrackVolumeGain: trackVolumeByTrackId.get(directTrackIdByItemId.get(segment.itemId) ?? '') ?? 1,
  }));

  const compoundAudioItems = audioItems.filter((item): item is EnrichedCompositionAudioItem => isCompositionAudioItem(item));
  const managedCompoundAudioItems = compoundAudioItems.filter((item) => managedLinkedAudioIds.has(item.id));
  const managedCompoundAudioItemsById = new Map(managedCompoundAudioItems.map((item) => [item.id, item]));
  const managedCompoundAudioTransitionDefs = managedLinkedAudioTransitions.flatMap(({ transition, leftAudio, rightAudio }) => {
    const left = managedCompoundAudioItemsById.get(leftAudio.id);
    const right = managedCompoundAudioItemsById.get(rightAudio.id);
    if (!left || !right) return [];

    return [{
      ...transition,
      leftClipId: left.id,
      rightClipId: right.id,
      trackId: left.trackId,
    }];
  });

  const compoundSegments = buildCompoundAudioTransitionSegments(
    managedCompoundAudioItems,
    managedCompoundAudioTransitionDefs,
    fps,
  ).flatMap((segment) => {
    const wrapper = managedCompoundAudioItemsById.get(segment.itemId);
    if (!wrapper) return [];
    return [{
      segment,
      compositionId: wrapper.compositionId,
      trackId: wrapper.trackId,
      committedTrackVolumeGain: toLinearGain(wrapper.trackVolumeDb ?? 0),
    }];
  });

  const compositionWrappers = [
    ...compoundAudioItems
      .filter((item) => !managedLinkedAudioIds.has(item.id))
      .map((wrapper) => ({
        wrapper,
        wrapperGain: toLinearGain((wrapper.volume ?? 0) + (wrapper.trackVolumeDb ?? 0)),
        trackId: wrapper.trackId,
        committedTrackVolumeGain: toLinearGain(wrapper.trackVolumeDb ?? 0),
      })),
    ...tracks.flatMap((track) => (
      track.items.flatMap((item): Array<{
        wrapper: EnrichedCompositionItem;
        wrapperGain: number;
        trackId: string;
        committedTrackVolumeGain: number;
      }> => {
        if (item.type !== 'composition') return [];
        if (hasLinkedAudioCompanion(audioItems as TimelineItem[], item)) return [];
        return [{
          wrapper: {
            ...item,
            muted: track.muted ?? false,
            trackVisible: visibleTrackIds.has(track.id),
          },
          wrapperGain: 1,
          trackId: track.id,
          committedTrackVolumeGain: toLinearGain(track.volume ?? 0),
        }];
      })
    )),
  ];

  return {
    fps,
    directSegments,
    compoundSegments,
    compositionWrappers,
  };
}

function appendAudioMeterSourcesFromGraph(params: {
  graph: AudioMeterGraph;
  graphNode: AudioMeterGraphNode;
  frame: number;
  gainMultiplier: number;
  depth: number;
  sources: AudioMeterSource[];
  ownerTrackId?: string;
}): void {
  const { graph, graphNode, frame, gainMultiplier, depth, sources, ownerTrackId } = params;

  if (gainMultiplier <= 0.0001) {
    return;
  }

  for (const directEntry of graphNode.directSegments) {
    appendDirectSegmentSources({
      frame,
      fps: graphNode.fps,
      gainMultiplier,
      trackVolumeGain: getTrackGainCorrection(directEntry.trackId, directEntry.committedTrackVolumeGain),
      segments: [directEntry.segment],
      sources,
      trackId: ownerTrackId ?? directEntry.trackId,
    });
  }

  for (const compoundEntry of graphNode.compoundSegments) {
    const nestedGraph = graph.compositionsById[compoundEntry.compositionId];
    if (!nestedGraph || depth > AUDIO_METER_MAX_DEPTH || compoundEntry.segment.muted) {
      continue;
    }

    const localFrame = frame - compoundEntry.segment.from;
    if (localFrame < 0 || localFrame >= compoundEntry.segment.durationInFrames) {
      continue;
    }

    const sourceFps = compoundEntry.segment.sourceFps ?? nestedGraph.fps ?? graphNode.fps;
    const crossfadeMultiplier = getAudioFadeMultiplier({
      frame: localFrame,
      durationInFrames: compoundEntry.segment.durationInFrames,
      fadeInFrames: compoundEntry.segment.crossfadeFadeIn,
      fadeOutFrames: compoundEntry.segment.crossfadeFadeOut,
      useEqualPower: true,
    });
    const nestedFrame = compoundEntry.segment.trimBefore + timelineToSourceFrames(
      localFrame,
      compoundEntry.segment.playbackRate,
      graphNode.fps,
      sourceFps,
    );

    appendAudioMeterSourcesFromGraph({
      graph,
      graphNode: nestedGraph,
      frame: nestedFrame,
      gainMultiplier: gainMultiplier
        * Math.max(0, toLinearGain(compoundEntry.segment.volumeDb) * crossfadeMultiplier)
        * getTrackGainCorrection(compoundEntry.trackId, compoundEntry.committedTrackVolumeGain),
      depth: depth + 1,
      sources,
      ownerTrackId: ownerTrackId ?? compoundEntry.trackId,
    });
  }

  for (const compositionEntry of graphNode.compositionWrappers) {
    if (depth > AUDIO_METER_MAX_DEPTH || compositionEntry.wrapper.muted || !compositionEntry.wrapper.trackVisible) {
      continue;
    }

    const nestedGraph = graph.compositionsById[compositionEntry.wrapper.compositionId];
    if (!nestedGraph) {
      continue;
    }

    const localFrame = frame - compositionEntry.wrapper.from;
    if (localFrame < 0 || localFrame >= compositionEntry.wrapper.durationInFrames) {
      continue;
    }

    const sourceFps = compositionEntry.wrapper.sourceFps ?? nestedGraph.fps ?? graphNode.fps;
    const sourceStart = compositionEntry.wrapper.sourceStart ?? compositionEntry.wrapper.trimStart ?? 0;
    const nestedFrame = sourceStart + timelineToSourceFrames(
      localFrame,
      compositionEntry.wrapper.speed ?? 1,
      graphNode.fps,
      sourceFps,
    );

    appendAudioMeterSourcesFromGraph({
      graph,
      graphNode: nestedGraph,
      frame: nestedFrame,
      gainMultiplier: gainMultiplier
        * compositionEntry.wrapperGain
        * getTrackGainCorrection(compositionEntry.trackId, compositionEntry.committedTrackVolumeGain),
      depth: depth + 1,
      sources,
      ownerTrackId: ownerTrackId ?? compositionEntry.trackId,
    });
  }
}

export function compileAudioMeterGraph(params: {
  tracks: TimelineTrack[];
  transitions: Transition[];
  fps: number;
  compositionsById?: AudioMeterCompositionLookup;
}): AudioMeterGraph {
  const compositionsById: Record<string, AudioMeterGraphNode> = {};
  for (const composition of Object.values(params.compositionsById ?? {})) {
    compositionsById[composition.id] = buildAudioMeterGraphNode({
      tracks: composition.tracks,
      transitions: composition.transitions,
      fps: composition.fps,
    });
  }

  return {
    root: buildAudioMeterGraphNode({
      tracks: params.tracks,
      transitions: params.transitions,
      fps: params.fps,
    }),
    compositionsById,
  };
}

export function resolveCompiledAudioMeterSources(params: {
  graph: AudioMeterGraph;
  frame: number;
  masterGain?: number;
}): AudioMeterSource[] {
  const sources: AudioMeterSource[] = [];
  appendAudioMeterSourcesFromGraph({
    graph: params.graph,
    graphNode: params.graph.root,
    frame: params.frame,
    gainMultiplier: params.masterGain ?? 1,
    depth: 0,
    sources,
  });
  return sources;
}

function getWaveformNormalizationPeak(peaks: Float32Array): number {
  const cached = normalizationPeakCache.get(peaks);
  if (cached !== undefined) {
    return cached;
  }

  let maxPeak = 0;
  for (let i = 0; i < peaks.length; i += 1) {
    const value = peaks[i] ?? 0;
    if (value > maxPeak) {
      maxPeak = value;
    }
  }

  const resolved = maxPeak > 0 ? maxPeak : 1;
  normalizationPeakCache.set(peaks, resolved);
  return resolved;
}

export function estimateWaveformLevelAtTime(params: {
  waveform: AudioMeterWaveform;
  sourceTimeSeconds: number;
  windowSeconds: number;
}): number {
  const { waveform, sourceTimeSeconds, windowSeconds } = params;
  if (waveform.sampleRate <= 0 || waveform.peaks.length === 0) {
    return 0;
  }

  const peakIndex = Math.floor(sourceTimeSeconds * waveform.sampleRate);
  if (peakIndex < 0 || peakIndex >= waveform.peaks.length) {
    return 0;
  }

  const samplesPerPoint = Math.max(1, Math.ceil(windowSeconds * waveform.sampleRate));
  const halfWindow = Math.floor(samplesPerPoint / 2);
  const windowStart = Math.max(0, peakIndex - halfWindow);
  const windowEnd = Math.min(waveform.peaks.length, peakIndex + halfWindow + 1);
  const normalizationPeak = getWaveformNormalizationPeak(waveform.peaks);

  let max1 = 0;
  let max2 = 0;
  let windowSum = 0;
  let sampleCount = 0;

  for (let index = windowStart; index < windowEnd; index += 1) {
    const value = waveform.peaks[index] ?? 0;
    if (value >= max1) {
      max2 = max1;
      max1 = value;
    } else if (value > max2) {
      max2 = value;
    }
    windowSum += value;
    sampleCount += 1;
  }

  if (sampleCount === 0) {
    return 0;
  }

  const normalizedMax1 = Math.min(1.5, max1 / normalizationPeak);
  const normalizedMax2 = Math.min(1.5, max2 / normalizationPeak);
  const normalizedMean = Math.min(1.5, (windowSum / sampleCount) / normalizationPeak);
  const needle = Math.max(0, normalizedMax1 - normalizedMax2);
  const peakValue = Math.min(1.5, normalizedMean * 0.38 + normalizedMax2 * 0.34 + needle * 2.35);
  return peakValue <= 0.001 ? 0 : Math.pow(peakValue, 1.05);
}

export function estimateWaveformStereoLevelAtTime(params: {
  waveform: AudioMeterWaveform;
  sourceTimeSeconds: number;
  windowSeconds: number;
}): { left: number; right: number } {
  const { waveform, sourceTimeSeconds, windowSeconds } = params;

  if (waveform.channels === 1) {
    const level = estimateWaveformLevelAtTime(params);
    return { left: level, right: level };
  }

  // Stereo interleaved: L at even indices, R at odd indices
  if (waveform.sampleRate <= 0 || waveform.peaks.length === 0) {
    return { left: 0, right: 0 };
  }

  const peakIndex = Math.floor(sourceTimeSeconds * waveform.sampleRate);
  const totalSamplesPerChannel = Math.floor(waveform.peaks.length / 2);
  if (peakIndex < 0 || peakIndex >= totalSamplesPerChannel) {
    return { left: 0, right: 0 };
  }

  const samplesPerPoint = Math.max(1, Math.ceil(windowSeconds * waveform.sampleRate));
  const halfWindow = Math.floor(samplesPerPoint / 2);
  const windowStart = Math.max(0, peakIndex - halfWindow);
  const windowEnd = Math.min(totalSamplesPerChannel, peakIndex + halfWindow + 1);
  const normalizationPeak = getWaveformNormalizationPeak(waveform.peaks);

  function computeChannelLevel(channelOffset: number): number {
    let max1 = 0;
    let max2 = 0;
    let windowSum = 0;
    let sampleCount = 0;

    for (let index = windowStart; index < windowEnd; index += 1) {
      const value = waveform.peaks[index * 2 + channelOffset] ?? 0;
      if (value >= max1) {
        max2 = max1;
        max1 = value;
      } else if (value > max2) {
        max2 = value;
      }
      windowSum += value;
      sampleCount += 1;
    }

    if (sampleCount === 0) {
      return 0;
    }

    const normalizedMax1 = Math.min(1.5, max1 / normalizationPeak);
    const normalizedMax2 = Math.min(1.5, max2 / normalizationPeak);
    const normalizedMean = Math.min(1.5, (windowSum / sampleCount) / normalizationPeak);
    const needle = Math.max(0, normalizedMax1 - normalizedMax2);
    const peakValue = Math.min(1.5, normalizedMean * 0.38 + normalizedMax2 * 0.34 + needle * 2.35);
    return peakValue <= 0.001 ? 0 : Math.pow(peakValue, 1.05);
  }

  return {
    left: computeChannelLevel(0),
    right: computeChannelLevel(1),
  };
}

export function estimateAudioMeterLevel(params: {
  sources: AudioMeterSource[];
  waveformsByMediaId: ReadonlyMap<string, AudioMeterWaveform | null | undefined>;
}): AudioMeterEstimate {
  let resolvedSourceCount = 0;
  let unresolvedSourceCount = 0;
  let totalEnergyL = 0;
  let totalEnergyR = 0;

  for (const source of params.sources) {
    const waveform = params.waveformsByMediaId.get(source.mediaId);
    if (!waveform) {
      unresolvedSourceCount += 1;
      continue;
    }

    const stereoLevel = estimateWaveformStereoLevelAtTime({
      waveform,
      sourceTimeSeconds: source.sourceTimeSeconds,
      windowSeconds: source.windowSeconds,
    });
    if (stereoLevel.left <= 0 && stereoLevel.right <= 0) {
      resolvedSourceCount += 1;
      continue;
    }

    const effectiveGain = source.gain * source.trackVolumeGain;
    totalEnergyL += Math.pow(stereoLevel.left * effectiveGain, 2);
    totalEnergyR += Math.pow(stereoLevel.right * effectiveGain, 2);
    resolvedSourceCount += 1;
  }

  return {
    left: Math.sqrt(totalEnergyL),
    right: Math.sqrt(totalEnergyR),
    resolvedSourceCount,
    unresolvedSourceCount,
  };
}

export function linearLevelToDb(level: number): number {
  if (level <= 0.000001) {
    return AUDIO_METER_MIN_DB;
  }
  return clamp(20 * Math.log10(level), AUDIO_METER_MIN_DB, AUDIO_METER_MAX_DB);
}

export function linearLevelToPercent(level: number): number {
  const db = linearLevelToDb(level);
  return ((db - AUDIO_METER_MIN_DB) / (AUDIO_METER_MAX_DB - AUDIO_METER_MIN_DB)) * 100;
}

export function formatMeterDb(level: number): string {
  if (level <= 0.000001) {
    return '-inf dB';
  }
  const db = linearLevelToDb(level);
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

export const AUDIO_METER_SCALE_MARKS = [-50, -40, -30, -20, -15, -10, -5, 0] as const;

export function dbMarkToPercent(mark: number): number {
  return linearLevelToPercent(Math.pow(10, mark / 20));
}

export function isAudioMixerTrack(track: TimelineTrack, timelineItems: readonly TimelineItem[] = track.items): boolean {
  if (track.isGroup) {
    return false;
  }

  if (track.items.some((item) => item.type === 'audio')) {
    return true;
  }

  const trackKind = getTrackKind(track);
  if (trackKind === 'audio') {
    return true;
  }

  return track.items.some((item) => (
    (item.type === 'video' || item.type === 'composition')
    && !hasLinkedAudioCompanion(timelineItems as TimelineItem[], item)
  ));
}

export function estimatePerTrackLevels(params: {
  tracks: TimelineTrack[];
  sources: AudioMeterSource[];
  waveformsByMediaId: ReadonlyMap<string, AudioMeterWaveform | null | undefined>;
  targetTrackIds?: readonly string[];
}): Map<string, AudioMeterEstimate> {
  const result = new Map<string, AudioMeterEstimate>();
  const targetTrackIds = params.targetTrackIds ? new Set(params.targetTrackIds) : null;
  const sourcesByTrackId = new Map<string, AudioMeterSource[]>();

  for (const source of params.sources) {
    if (!source.trackId) continue;
    const existing = sourcesByTrackId.get(source.trackId);
    if (existing) {
      existing.push(source);
      continue;
    }
    sourcesByTrackId.set(source.trackId, [source]);
  }

  for (const track of params.tracks) {
    if (track.isGroup) continue;
    if (targetTrackIds && !targetTrackIds.has(track.id)) continue;

    const trackSources = sourcesByTrackId.get(track.id) ?? [];
    if (trackSources.length === 0) {
      result.set(track.id, { left: 0, right: 0, resolvedSourceCount: 0, unresolvedSourceCount: 0 });
      continue;
    }

    result.set(track.id, estimateAudioMeterLevel({ sources: trackSources, waveformsByMediaId: params.waveformsByMediaId }));
  }

  return result;
}
