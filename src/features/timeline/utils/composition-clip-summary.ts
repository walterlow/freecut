import type { TimelineItem, TimelineTrack } from '@/types/timeline';
import type { SubComposition } from '../stores/compositions-store';
import { hasLinkedAudioCompanion } from '@/shared/utils/linked-media';
import { sourceToTimelineFrames, timelineToSourceFrames } from './source-calculations';

export interface CompositionOwnedAudioSource {
  itemId: string;
  mediaId: string;
  from: number;
  durationInFrames: number;
  sourceStart: number;
  sourceFps: number;
  speed: number;
}

export interface CompositionVisualSource {
  itemId: string;
  mediaId: string;
  sourceStart: number;
  sourceDuration: number;
  sourceFps: number;
  speed: number;
}

export interface CompositionClipSummary {
  visualMediaId: string | null;
  audioMediaId: string | null;
  hasOwnedAudio: boolean;
  hasMultipleOwnedAudioSources: boolean;
  visualSource: CompositionVisualSource | null;
}

type CompositionLookup = Record<string, SubComposition | undefined>;

function getVisibleTrackIds(tracks: TimelineTrack[]): Set<string> {
  const hasSoloTracks = tracks.some((track) => track.solo);
  return new Set(
    tracks
      .filter((track) => (hasSoloTracks ? track.solo === true : track.visible !== false))
      .map((track) => track.id)
  );
}

function getOrderedActiveCompositionItems(params: {
  items: TimelineItem[];
  tracks: TimelineTrack[];
}): TimelineItem[] {
  const visibleTrackIds = getVisibleTrackIds(params.tracks);
  const trackOrderMap = new Map(params.tracks.map((track) => [track.id, track.order ?? 0]));
  return params.items
    .filter((item) => visibleTrackIds.has(item.trackId))
    .toSorted((left, right) => {
      const leftOrder = trackOrderMap.get(left.trackId) ?? 0;
      const rightOrder = trackOrderMap.get(right.trackId) ?? 0;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      if (left.from !== right.from) return left.from - right.from;
      return left.id.localeCompare(right.id);
    });
}

function getBaseSourceStart(item: TimelineItem): number {
  if (item.type === 'video' || item.type === 'audio') {
    return item.sourceStart ?? item.trimStart ?? item.offset ?? 0;
  }
  if (item.type === 'composition') {
    return item.sourceStart ?? item.trimStart ?? 0;
  }
  return 0;
}

function mapNestedItemToWrapperWindow(params: {
  subItem: TimelineItem;
  wrapper: Extract<TimelineItem, { compositionId?: string }>;
  parentFps: number;
  subCompFps: number;
}): TimelineItem | null {
  const { subItem, wrapper, parentFps, subCompFps } = params;
  const wrapperSpeed = wrapper.speed ?? 1;
  const wrapperSourceFps = wrapper.sourceFps ?? subCompFps;
  const wrapperSourceStart = getBaseSourceStart(wrapper);
  const wrapperSourceEnd = wrapper.sourceEnd
    ?? (wrapperSourceStart + timelineToSourceFrames(
      wrapper.durationInFrames,
      wrapperSpeed,
      parentFps,
      wrapperSourceFps,
    ));
  const subItemStart = subItem.from;
  const subItemEnd = subItem.from + subItem.durationInFrames;
  const overlapStart = Math.max(subItemStart, wrapperSourceStart);
  const overlapEnd = Math.min(subItemEnd, wrapperSourceEnd);

  if (overlapEnd <= overlapStart) {
    return null;
  }

  const mappedFrom = sourceToTimelineFrames(
    overlapStart - wrapperSourceStart,
    wrapperSpeed,
    wrapperSourceFps,
    parentFps,
  );
  const mappedEnd = sourceToTimelineFrames(
    overlapEnd - wrapperSourceStart,
    wrapperSpeed,
    wrapperSourceFps,
    parentFps,
  );
  const mappedDuration = Math.max(1, mappedEnd - mappedFrom);
  const effectiveSpeed = (subItem.speed ?? 1) * wrapperSpeed;
  const mappedItem: TimelineItem = {
    ...subItem,
    from: mappedFrom,
    durationInFrames: mappedDuration,
    speed: effectiveSpeed,
  };

  if (subItem.type === 'video' || subItem.type === 'audio' || subItem.type === 'composition') {
    const childSourceFps = subItem.sourceFps ?? subCompFps;
    const clippedStartFrames = overlapStart - subItemStart;
    const clippedEndFrames = subItemEnd - overlapEnd;
    const childSpeed = subItem.speed ?? 1;
    const nextSourceStart = getBaseSourceStart(subItem) + timelineToSourceFrames(
      clippedStartFrames,
      childSpeed,
      subCompFps,
      childSourceFps,
    );

    mappedItem.sourceStart = nextSourceStart;
    mappedItem.sourceFps = childSourceFps;
    if (subItem.sourceEnd !== undefined) {
      mappedItem.sourceEnd = Math.max(
        nextSourceStart + 1,
        subItem.sourceEnd - timelineToSourceFrames(
          clippedEndFrames,
          childSpeed,
          subCompFps,
          childSourceFps,
        ),
      );
    }
  }

  return mappedItem;
}

function getNestedCompositionAudioSources(params: {
  wrapper: TimelineItem & { compositionId: string };
  parentFps: number;
  compositionById?: CompositionLookup;
  activeCompositionPath: ReadonlySet<string>;
  mediaFpsById?: Record<string, number | undefined>;
}): CompositionOwnedAudioSource[] {
  const { wrapper, parentFps, compositionById, activeCompositionPath, mediaFpsById } = params;
  if (!compositionById) return [];
  if (activeCompositionPath.has(wrapper.compositionId)) return [];

  const subComp = compositionById[wrapper.compositionId];
  if (!subComp) return [];

  const nextPath = new Set(activeCompositionPath);
  nextPath.add(wrapper.compositionId);
  const mappedItems = subComp.items.flatMap((subItem) => {
    const mappedItem = mapNestedItemToWrapperWindow({
      subItem,
      wrapper,
      parentFps,
      subCompFps: subComp.fps,
    });
    return mappedItem ? [mappedItem] : [];
  });

  return getCompositionOwnedAudioSources({
    items: mappedItems,
    tracks: subComp.tracks,
    fps: parentFps,
    mediaFpsById,
    compositionById,
    activeCompositionPath: nextPath,
  });
}

function getNestedCompositionVisualSource(params: {
  wrapper: TimelineItem & { compositionId: string };
  parentFps: number;
  compositionById?: CompositionLookup;
  activeCompositionPath: ReadonlySet<string>;
  mediaFpsById?: Record<string, number | undefined>;
}): CompositionVisualSource | null {
  const { wrapper, parentFps, compositionById, activeCompositionPath, mediaFpsById } = params;
  if (!compositionById) return null;
  if (activeCompositionPath.has(wrapper.compositionId)) return null;

  const subComp = compositionById[wrapper.compositionId];
  if (!subComp) return null;

  const nextPath = new Set(activeCompositionPath);
  nextPath.add(wrapper.compositionId);
  const mappedItems = subComp.items.flatMap((subItem) => {
    const mappedItem = mapNestedItemToWrapperWindow({
      subItem,
      wrapper,
      parentFps,
      subCompFps: subComp.fps,
    });
    return mappedItem ? [mappedItem] : [];
  });

  return findCompositionVisualSource({
    items: mappedItems,
    tracks: subComp.tracks,
    fps: parentFps,
    mediaFpsById,
    compositionById,
    activeCompositionPath: nextPath,
  });
}

function findCompositionVisualSource(params: {
  items: TimelineItem[];
  tracks: TimelineTrack[];
  fps: number;
  mediaFpsById?: Record<string, number | undefined>;
  compositionById?: CompositionLookup;
  activeCompositionPath?: ReadonlySet<string>;
}): CompositionVisualSource | null {
  const orderedItems = getOrderedActiveCompositionItems(params);
  const activeCompositionPath = params.activeCompositionPath ?? new Set<string>();

  for (const item of orderedItems) {
    if (item.type === 'video' && item.mediaId) {
      return {
        itemId: item.id,
        mediaId: item.mediaId,
        sourceStart: getBaseSourceStart(item),
        sourceDuration: item.sourceDuration ?? item.durationInFrames,
        sourceFps: item.sourceFps ?? params.mediaFpsById?.[item.mediaId] ?? params.fps,
        speed: item.speed ?? 1,
      };
    }

    if (item.type === 'composition') {
      const nestedVisual = getNestedCompositionVisualSource({
        wrapper: item,
        parentFps: params.fps,
        compositionById: params.compositionById,
        activeCompositionPath,
        mediaFpsById: params.mediaFpsById,
      });
      if (nestedVisual) {
        return nestedVisual;
      }
    }
  }

  return null;
}

export function getCompositionOwnedAudioSources(params: {
  items: TimelineItem[];
  tracks: TimelineTrack[];
  fps: number;
  mediaFpsById?: Record<string, number | undefined>;
  compositionById?: CompositionLookup;
  activeCompositionPath?: ReadonlySet<string>;
}): CompositionOwnedAudioSource[] {
  const orderedItems = getOrderedActiveCompositionItems(params);
  const trackById = new Map(params.tracks.map((track) => [track.id, track]));
  const activeCompositionPath = params.activeCompositionPath ?? new Set<string>();

  return orderedItems.flatMap((item) => {
    const track = trackById.get(item.trackId);
    if (track?.muted) return [];

    if (item.type === 'audio' && item.compositionId) {
      return getNestedCompositionAudioSources({
        wrapper: item as TimelineItem & { compositionId: string },
        parentFps: params.fps,
        compositionById: params.compositionById,
        activeCompositionPath,
        mediaFpsById: params.mediaFpsById,
      });
    }

    if (item.type === 'composition') {
      if (hasLinkedAudioCompanion(orderedItems, item)) {
        return [];
      }
      return getNestedCompositionAudioSources({
        wrapper: item,
        parentFps: params.fps,
        compositionById: params.compositionById,
        activeCompositionPath,
        mediaFpsById: params.mediaFpsById,
      });
    }

    if (!item.mediaId) return [];

    if (item.type === 'audio') {
      return [{
        itemId: item.id,
        mediaId: item.mediaId,
        from: item.from,
        durationInFrames: item.durationInFrames,
        sourceStart: getBaseSourceStart(item),
        sourceFps: item.sourceFps ?? params.mediaFpsById?.[item.mediaId] ?? params.fps,
        speed: item.speed ?? 1,
      }];
    }

    if (item.type === 'video' && !hasLinkedAudioCompanion(orderedItems, item)) {
      return [{
        itemId: item.id,
        mediaId: item.mediaId,
        from: item.from,
        durationInFrames: item.durationInFrames,
        sourceStart: getBaseSourceStart(item),
        sourceFps: item.sourceFps ?? params.mediaFpsById?.[item.mediaId] ?? params.fps,
        speed: item.speed ?? 1,
      }];
    }

    return [];
  });
}

export function summarizeCompositionClipContent(params: {
  items: TimelineItem[];
  tracks: TimelineTrack[];
  fps?: number;
  mediaFpsById?: Record<string, number | undefined>;
  compositionById?: CompositionLookup;
}): CompositionClipSummary {
  const ownedAudioSources = getCompositionOwnedAudioSources({
    items: params.items,
    tracks: params.tracks,
    fps: params.fps ?? 30,
    mediaFpsById: params.mediaFpsById,
    compositionById: params.compositionById,
  });
  const visualSource = findCompositionVisualSource({
    items: params.items,
    tracks: params.tracks,
    fps: params.fps ?? 30,
    mediaFpsById: params.mediaFpsById,
    compositionById: params.compositionById,
  });

  return {
    visualMediaId: visualSource?.mediaId ?? null,
    audioMediaId: ownedAudioSources[0]?.mediaId ?? null,
    hasOwnedAudio: ownedAudioSources.length > 0,
    hasMultipleOwnedAudioSources: ownedAudioSources.length > 1,
    visualSource,
  };
}
