import type {
  AdjustmentItem,
  AudioItem,
  ImageItem,
  ShapeItem,
  TextItem,
  TimelineItem,
  TimelineTrack,
  VideoItem,
} from '@/types/timeline';
import type { Transition } from '@/types/transition';
import {
  resolveTransitionWindows,
  type ResolvedTransitionWindow,
} from '@/domain/timeline/transitions/transition-planner';

export interface TrackRenderState<TTrack extends TimelineTrack = TimelineTrack> {
  hasSoloTracks: boolean;
  maxOrder: number;
  visibleTracks: TTrack[];
  visibleTrackIds: Set<string>;
  visibleTracksByOrderDesc: TTrack[];
  visibleTracksByOrderAsc: TTrack[];
  allTracksByOrderDesc: TTrack[];
  trackOrderMap: Map<string, number>;
}

export interface ShapeMaskWithTrackOrder {
  mask: ShapeItem;
  trackOrder: number;
}

export interface AdjustmentLayerWithTrackOrderLike {
  layer: AdjustmentItem;
  trackOrder: number;
}

export type VisualTrackItem = (VideoItem | ImageItem) & {
  zIndex: number;
  muted: boolean;
  trackOrder: number;
  trackVisible: boolean;
};

export type VideoTrackItem = Extract<VisualTrackItem, { type: 'video' }>;

export type AudioTrackItem = AudioItem & {
  muted: boolean;
  trackVisible: boolean;
};

export type StableDomTrack = TimelineTrack & {
  trackVisible: boolean;
  items: Exclude<TimelineItem, VideoItem | AudioItem | AdjustmentItem>[];
};

export type TransitionClipItem = VideoItem | ImageItem;

export type FrameRenderTask<TTransition> =
  | { type: 'item'; item: TimelineItem; trackOrder: number }
  | { type: 'transition'; transition: TTransition; trackOrder: number };

export interface ResolvedFrameRenderScene<TTransition> {
  transitionsByTrackOrder: Map<number, TTransition[]>;
  occlusionCutoffOrder: number | null;
  renderTasks: FrameRenderTask<TTransition>[];
}

export interface CompositionRenderPlan<TTrack extends TimelineTrack = TimelineTrack> {
  trackRenderState: TrackRenderState<TTrack>;
  visualItems: VisualTrackItem[];
  videoItems: VideoTrackItem[];
  audioItems: AudioTrackItem[];
  stableDomTracks: StableDomTrack[];
  visibleShapeMasks: ShapeMaskWithTrackOrder[];
  visibleAdjustmentLayers: AdjustmentLayerWithTrackOrderLike[];
  visibleTextFontFamilies: string[];
  transitionClipItems: TransitionClipItem[];
  transitionClipMap: Map<string, TransitionClipItem>;
  transitionWindows: ResolvedTransitionWindow<TransitionClipItem>[];
}

export function groupTransitionsByTrackOrder<TTransition>({
  activeTransitions,
  getTrackOrder,
}: {
  activeTransitions: TTransition[];
  getTrackOrder: (transition: TTransition) => number;
}): Map<number, TTransition[]> {
  const transitionsByTrackOrder = new Map<number, TTransition[]>();

  for (const activeTransition of activeTransitions) {
    const trackOrder = getTrackOrder(activeTransition);
    const trackTransitions = transitionsByTrackOrder.get(trackOrder);
    if (trackTransitions) {
      trackTransitions.push(activeTransition);
      continue;
    }
    transitionsByTrackOrder.set(trackOrder, [activeTransition]);
  }

  return transitionsByTrackOrder;
}

export function resolveTrackRenderState<TTrack extends TimelineTrack>(
  tracks: TTrack[],
): TrackRenderState<TTrack> {
  const hasSoloTracks = tracks.some((track) => track.solo);
  const maxOrder = Math.max(...tracks.map((track) => track.order ?? 0), 0);
  const visibleTracks = tracks.filter((track) => {
    if (hasSoloTracks) return track.solo === true;
    return track.visible !== false;
  });
  const visibleTrackIds = new Set(visibleTracks.map((track) => track.id));
  const visibleTracksByOrderDesc = [...visibleTracks].sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
  const visibleTracksByOrderAsc = [...visibleTracksByOrderDesc].reverse();
  const allTracksByOrderDesc = [...tracks].sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
  const trackOrderMap = new Map<string, number>();

  for (const track of tracks) {
    trackOrderMap.set(track.id, track.order ?? 0);
  }

  return {
    hasSoloTracks,
    maxOrder,
    visibleTracks,
    visibleTrackIds,
    visibleTracksByOrderDesc,
    visibleTracksByOrderAsc,
    allTracksByOrderDesc,
    trackOrderMap,
  };
}

export function resolveCompositionRenderPlan<TTrack extends TimelineTrack>({
  tracks,
  transitions = [],
}: {
  tracks: TTrack[];
  transitions?: Transition[];
}): CompositionRenderPlan<TTrack> {
  const trackRenderState = resolveTrackRenderState(tracks);
  const { visibleTracks, visibleTrackIds, maxOrder } = trackRenderState;
  const visualItems = collectVisualTrackItems({
    tracks,
    visibleTrackIds,
    maxOrder,
  });
  const transitionClipItems = collectTransitionClipItems(tracks);

  return {
    trackRenderState,
    visualItems,
    videoItems: visualItems.filter((item): item is VideoTrackItem => item.type === 'video'),
    audioItems: collectAudioTrackItems({ tracks, visibleTrackIds }),
    stableDomTracks: buildStableDomTracks({ tracks, visibleTrackIds }),
    visibleShapeMasks: collectVisibleShapeMasks(visibleTracks),
    visibleAdjustmentLayers: collectVisibleAdjustmentLayers(visibleTracks),
    visibleTextFontFamilies: collectVisibleTextFontFamilies(visibleTracks),
    transitionClipItems,
    transitionClipMap: buildItemIdMap(transitionClipItems),
    transitionWindows: resolveTransitionWindowsForItems(transitions, transitionClipItems),
  };
}

export function collectVisibleShapeMasks(
  visibleTracks: TimelineTrack[],
): ShapeMaskWithTrackOrder[] {
  const masks: ShapeMaskWithTrackOrder[] = [];

  for (const track of visibleTracks) {
    for (const item of track.items) {
      if (item.type === 'shape' && item.isMask) {
        masks.push({ mask: item, trackOrder: track.order ?? 0 });
      }
    }
  }

  return masks;
}

export function collectVisibleAdjustmentLayers(
  visibleTracks: TimelineTrack[],
): AdjustmentLayerWithTrackOrderLike[] {
  const layers: AdjustmentLayerWithTrackOrderLike[] = [];

  for (const track of visibleTracks) {
    for (const item of track.items) {
      if (item.type === 'adjustment') {
        layers.push({ layer: item, trackOrder: track.order ?? 0 });
      }
    }
  }

  return layers;
}

export function collectVisualTrackItems({
  tracks,
  visibleTrackIds,
  maxOrder,
}: {
  tracks: TimelineTrack[];
  visibleTrackIds: Set<string>;
  maxOrder: number;
}): VisualTrackItem[] {
  return tracks.flatMap((track) =>
    track.items
      .filter((item): item is VideoItem | ImageItem => item.type === 'video' || item.type === 'image')
      .map((item) => ({
        ...item,
        zIndex: (maxOrder - (track.order ?? 0)) * 1000,
        muted: track.muted ?? false,
        trackOrder: track.order ?? 0,
        trackVisible: visibleTrackIds.has(track.id),
      }))
  );
}

export function collectAudioTrackItems({
  tracks,
  visibleTrackIds,
}: {
  tracks: TimelineTrack[];
  visibleTrackIds: Set<string>;
}): AudioTrackItem[] {
  return tracks.flatMap((track) =>
    track.items
      .filter((item): item is AudioItem => item.type === 'audio')
      .map((item) => ({
        ...item,
        muted: track.muted,
        trackVisible: visibleTrackIds.has(track.id),
      }))
  );
}

export function buildStableDomTracks({
  tracks,
  visibleTrackIds,
}: {
  tracks: TimelineTrack[];
  visibleTrackIds: Set<string>;
}): StableDomTrack[] {
  return tracks.map((track) => ({
    ...track,
    trackVisible: visibleTrackIds.has(track.id),
    items: track.items.filter((item): item is Exclude<TimelineItem, VideoItem | AudioItem | AdjustmentItem> => {
      if (item.type === 'video' || item.type === 'audio' || item.type === 'adjustment') {
        return false;
      }
      if (item.type === 'shape' && item.isMask) {
        return false;
      }
      return true;
    }),
  }));
}

export function collectVisibleTextFontFamilies(
  visibleTracks: TimelineTrack[],
): string[] {
  const fontFamilies = new Set<string>();

  for (const track of visibleTracks) {
    for (const item of track.items) {
      if (item.type !== 'text') continue;
      fontFamilies.add((item as TextItem).fontFamily ?? 'Inter');
    }
  }

  return [...fontFamilies];
}

export function collectTransitionClipItems(
  tracks: TimelineTrack[],
): TransitionClipItem[] {
  return tracks.flatMap((track) =>
    track.items.filter((item): item is TransitionClipItem => (
      item.type === 'video' || item.type === 'image'
    ))
  );
}

export function buildItemIdMap<TItem extends TimelineItem>(
  items: TItem[],
): Map<string, TItem> {
  const itemsById = new Map<string, TItem>();

  for (const item of items) {
    itemsById.set(item.id, item);
  }

  return itemsById;
}

export function resolveTransitionWindowsForItems<TItem extends TimelineItem>(
  transitions: Transition[],
  items: TItem[],
): ResolvedTransitionWindow<TItem>[] {
  return resolveTransitionWindows(transitions, buildItemIdMap(items));
}

export function buildFrameRenderTasks<TTransition>({
  tracksByOrderDesc,
  visibleTrackIds,
  shouldRenderItem,
  transitionsByTrackOrder,
  occlusionCutoffOrder,
}: {
  tracksByOrderDesc: TimelineTrack[];
  visibleTrackIds: Set<string>;
  shouldRenderItem: (item: TimelineItem) => boolean;
  transitionsByTrackOrder: Map<number, TTransition[]>;
  occlusionCutoffOrder: number | null;
}): FrameRenderTask<TTransition>[] {
  const renderTasks: FrameRenderTask<TTransition>[] = [];

  for (const track of tracksByOrderDesc) {
    if (!visibleTrackIds.has(track.id)) continue;
    const trackOrder = track.order ?? 0;
    if (occlusionCutoffOrder !== null && trackOrder > occlusionCutoffOrder) {
      continue;
    }

    for (const item of track.items ?? []) {
      if (!shouldRenderItem(item)) continue;
      renderTasks.push({ type: 'item', item, trackOrder });
    }

    const trackTransitions = transitionsByTrackOrder.get(trackOrder);
    if (trackTransitions) {
      for (const transition of trackTransitions) {
        renderTasks.push({ type: 'transition', transition, trackOrder });
      }
    }
  }

  return renderTasks;
}

export function resolveOcclusionCutoffOrder({
  tracksByOrderAsc,
  visibleTrackIds,
  disableOcclusion,
  shouldRenderItem,
  isFullyOccluding,
}: {
  tracksByOrderAsc: TimelineTrack[];
  visibleTrackIds: Set<string>;
  disableOcclusion: boolean;
  shouldRenderItem: (item: TimelineItem) => boolean;
  isFullyOccluding: (item: TimelineItem, trackOrder: number) => boolean;
}): number | null {
  if (disableOcclusion) {
    return null;
  }

  for (const track of tracksByOrderAsc) {
    if (!visibleTrackIds.has(track.id)) continue;
    const trackOrder = track.order ?? 0;

    for (const item of track.items ?? []) {
      if (!shouldRenderItem(item)) continue;
      if (isFullyOccluding(item, trackOrder)) {
        return trackOrder;
      }
    }
  }

  return null;
}

export function resolveFrameRenderScene<TTransition>({
  tracksByOrderDesc,
  tracksByOrderAsc,
  visibleTrackIds,
  activeTransitions,
  getTransitionTrackOrder,
  disableOcclusion,
  shouldRenderItem,
  isFullyOccluding,
}: {
  tracksByOrderDesc: TimelineTrack[];
  tracksByOrderAsc: TimelineTrack[];
  visibleTrackIds: Set<string>;
  activeTransitions: TTransition[];
  getTransitionTrackOrder: (transition: TTransition) => number;
  disableOcclusion: boolean;
  shouldRenderItem: (item: TimelineItem) => boolean;
  isFullyOccluding: (item: TimelineItem, trackOrder: number) => boolean;
}): ResolvedFrameRenderScene<TTransition> {
  const transitionsByTrackOrder = groupTransitionsByTrackOrder({
    activeTransitions,
    getTrackOrder: getTransitionTrackOrder,
  });
  const occlusionCutoffOrder = resolveOcclusionCutoffOrder({
    tracksByOrderAsc,
    visibleTrackIds,
    disableOcclusion,
    shouldRenderItem,
    isFullyOccluding,
  });
  const renderTasks = buildFrameRenderTasks({
    tracksByOrderDesc,
    visibleTrackIds,
    shouldRenderItem,
    transitionsByTrackOrder,
    occlusionCutoffOrder,
  });

  return {
    transitionsByTrackOrder,
    occlusionCutoffOrder,
    renderTasks,
  };
}

export function collectFrameVideoCandidates({
  tracksByOrderAsc,
  visibleTrackIds,
  minFrame,
  maxFrame,
  maxItems,
}: {
  tracksByOrderAsc: TimelineTrack[];
  visibleTrackIds: Set<string>;
  minFrame: number;
  maxFrame: number;
  maxItems: number;
}): VideoItem[] {
  if (maxItems <= 0) return [];

  const candidates: VideoItem[] = [];

  for (const track of tracksByOrderAsc) {
    if (!visibleTrackIds.has(track.id)) continue;

    for (const item of track.items ?? []) {
      if (item.type !== 'video') continue;
      if (item.from > maxFrame || (item.from + item.durationInFrames) <= minFrame) continue;
      candidates.push(item);
      if (candidates.length >= maxItems) return candidates;
    }
  }

  return candidates;
}
