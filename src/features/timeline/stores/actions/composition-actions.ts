/**
 * Composition Actions — create, dissolve, and manage pre-compositions.
 */

import type { AudioItem, TimelineItem, TimelineTrack, CompositionItem } from '@/types/timeline';
import {
  createClassicTrack,
  findNearestTrackByKind,
  getAdjacentTrackOrder,
  getTrackKind,
  type TrackKind,
} from '../../utils/classic-tracks';
import { sourceToTimelineFrames, timelineToSourceFrames } from '../../utils/source-calculations';
import { getCompositionOwnedAudioSources } from '../../utils/composition-clip-summary';
import { expandSelectionWithLinkedItems } from '../../utils/linked-items';
import { useItemsStore } from '../items-store';
import { useTransitionsStore } from '../transitions-store';
import { useKeyframesStore } from '../keyframes-store';
import { useTimelineSettingsStore } from '../timeline-settings-store';
import { useCompositionsStore, type SubComposition } from '../compositions-store';
import { useEditorStore } from '@/shared/state/editor';
import { useSelectionStore } from '@/shared/state/selection';
import { DEFAULT_TRACK_HEIGHT } from '../../constants';
import { useCompositionNavigationStore } from '../composition-navigation-store';
import { useProjectStore } from '@/features/timeline/deps/projects';
import {
  getLinkedCompositionAudioCompanion,
  getLinkedCompositionVisualCompanion,
  isCompositionAudioItem,
} from '@/shared/utils/linked-media';
import {
  getDirectReferencedCompositionIds,
  wouldCreateCompositionCycle,
} from '../../utils/composition-graph';
import {
  applyTransitionRepairs,
  computeCompositionDuration,
  execute,
  getCurrentTimelineSnapshot,
  getEffectiveCompositions,
  getRootTimelineSnapshot,
  type TimelineSnapshotLike,
} from './shared';

function getTrackKindForSelectedItems(track: TimelineTrack | undefined, trackItems: TimelineItem[]): TrackKind {
  return getTrackKind(track ?? { id: '', name: '', height: DEFAULT_TRACK_HEIGHT, locked: false, visible: true, muted: false, solo: false, order: 0, items: [] })
    ?? (trackItems.every((item) => item.type === 'audio') ? 'audio' : 'video');
}

function hasCompositionVisualItems(items: TimelineItem[]): boolean {
  return items.some((item) => item.type !== 'audio');
}

function buildCompoundWrapperSourceFields(composition: SubComposition) {
  return {
    sourceStart: 0,
    sourceEnd: composition.durationInFrames,
    sourceDuration: composition.durationInFrames,
    sourceFps: composition.fps,
    speed: 1,
  };
}

function expandSelectionWithCompoundClipCompanions(
  items: TimelineItem[],
  selectedIds: readonly string[],
): string[] {
  const expandedIds = new Set(selectedIds);

  for (const item of items) {
    if (!expandedIds.has(item.id)) continue;

    if (item.type === 'composition') {
      const companion = getLinkedCompositionAudioCompanion(items, item);
      if (companion) {
        expandedIds.add(companion.id);
      }
      continue;
    }

    if (isCompositionAudioItem(item)) {
      const companion = getLinkedCompositionVisualCompanion(items, item);
      if (companion) {
        expandedIds.add(companion.id);
      }
    }
  }

  return Array.from(expandedIds);
}

export interface CompoundClipDeletionImpact {
  rootReferenceCount: number;
  nestedReferenceCount: number;
  totalReferenceCount: number;
}

function renameCompositionReferences(items: TimelineItem[], compositionId: string, nextLabel: string): TimelineItem[] {
  const targetIds = new Set([compositionId]);
  let changed = false;
  const renamedItems = items.map((item) => {
    if (!isCompoundClipReference(item, targetIds)) {
      return item;
    }
    if (item.label === nextLabel) {
      return item;
    }
    changed = true;
    return {
      ...item,
      label: nextLabel,
    };
  });

  return changed ? renamedItems : items;
}

function isCompoundClipReference(item: TimelineItem, targetIds: ReadonlySet<string>): boolean {
  return !!item.compositionId
    && (item.type === 'composition' || isCompositionAudioItem(item))
    && targetIds.has(item.compositionId);
}

function countCompoundClipReferences(items: TimelineItem[], targetIds: ReadonlySet<string>): number {
  return items.filter((item) => isCompoundClipReference(item, targetIds)).length;
}

function sanitizeTimelineSnapshot<TSnapshot extends TimelineSnapshotLike>(
  snapshot: TSnapshot,
  targetIds: ReadonlySet<string>,
): TSnapshot & { removedItemIds: string[] } {
  const removedItemIds = snapshot.items
    .filter((item) => isCompoundClipReference(item, targetIds))
    .map((item) => item.id);

  if (removedItemIds.length === 0) {
    return {
      ...snapshot,
      removedItemIds,
    };
  }

  const removedIdSet = new Set(removedItemIds);
  return {
    ...snapshot,
    items: snapshot.items.filter((item) => !removedIdSet.has(item.id)),
    transitions: snapshot.transitions.filter((transition) => (
      !removedIdSet.has(transition.leftClipId) && !removedIdSet.has(transition.rightClipId)
    )),
    keyframes: snapshot.keyframes.filter((keyframe) => !removedIdSet.has(keyframe.itemId)),
    removedItemIds,
  };
}

export function getCompoundClipDeletionImpact(compositionIds: string[]): CompoundClipDeletionImpact {
  const targetIds = new Set(compositionIds.filter(Boolean));
  if (targetIds.size === 0) {
    return {
      rootReferenceCount: 0,
      nestedReferenceCount: 0,
      totalReferenceCount: 0,
    };
  }

  const currentSnapshot = getCurrentTimelineSnapshot();
  const rootReferenceCount = countCompoundClipReferences(
    getRootTimelineSnapshot(currentSnapshot).items,
    targetIds,
  );
  const nestedReferenceCount = getEffectiveCompositions(currentSnapshot)
    .filter((composition) => !targetIds.has(composition.id))
    .reduce((count, composition) => count + countCompoundClipReferences(composition.items, targetIds), 0);

  return {
    rootReferenceCount,
    nestedReferenceCount,
    totalReferenceCount: rootReferenceCount + nestedReferenceCount,
  };
}

export function renameCompoundClip(compositionId: string, nextName: string): boolean {
  const trimmedName = nextName.trim();
  if (!compositionId || !trimmedName) return false;

  return execute('RENAME_COMPOUND_CLIP', () => {
    const composition = useCompositionsStore.getState().getComposition(compositionId);
    if (!composition || composition.name === trimmedName) {
      return false;
    }

    useCompositionsStore.getState().updateComposition(compositionId, { name: trimmedName });

    const currentSnapshot = getCurrentTimelineSnapshot();
    const renamedCurrentItems = renameCompositionReferences(currentSnapshot.items, compositionId, trimmedName);
    if (renamedCurrentItems !== currentSnapshot.items) {
      useItemsStore.getState().setItems(renamedCurrentItems);
    }

    const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId;
    const nextCompositions = useCompositionsStore.getState().compositions.map((entry) => {
      if (entry.id === compositionId) {
        return entry;
      }

      const sourceItems = entry.id === activeCompositionId ? renamedCurrentItems : entry.items;
      const renamedItems = renameCompositionReferences(sourceItems, compositionId, trimmedName);
      return renamedItems === sourceItems
        ? entry
        : {
          ...entry,
          items: renamedItems,
        };
    });
    useCompositionsStore.getState().setCompositions(nextCompositions);

    useCompositionNavigationStore.setState((state) => ({
      breadcrumbs: state.breadcrumbs.map((breadcrumb) => (
        breadcrumb.compositionId === compositionId
          ? { ...breadcrumb, label: trimmedName }
          : breadcrumb
      )),
      stashStack: state.stashStack.map((stash) => ({
        ...stash,
        items: renameCompositionReferences(stash.items, compositionId, trimmedName),
      })),
    }));

    useTimelineSettingsStore.getState().markDirty();
    return true;
  }, { compositionId, nextName: trimmedName });
}

function mapRestoredTrackGroup(params: {
  subTracks: TimelineTrack[];
  subItems: TimelineItem[];
  anchorTrackId: string | null;
  kind: TrackKind;
  compFrom: number;
  existingTracks: TimelineTrack[];
  currentItems: TimelineItem[];
  trackIdMapping: Map<string, string>;
  newTracks: TimelineTrack[];
}): void {
  const {
    subTracks,
    subItems,
    anchorTrackId,
    kind,
    compFrom,
    existingTracks,
    currentItems,
    trackIdMapping,
    newTracks,
  } = params;
  if (subTracks.length === 0 || !anchorTrackId) return;

  const sortedSubTracks = [...subTracks].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  const anchorTrack = [...existingTracks, ...newTracks].find((track) => track.id === anchorTrackId);
  if (!anchorTrack) return;

  const usedTrackIds = new Set<string>(trackIdMapping.values());
  const lastIdx = sortedSubTracks.length - 1;
  trackIdMapping.set(sortedSubTracks[lastIdx]!.id, anchorTrackId);
  usedTrackIds.add(anchorTrackId);

  const candidatesAbove = [...existingTracks, ...newTracks]
    .filter((track) => track.id !== anchorTrackId && getTrackKind(track) === kind)
    .filter((track) => (track.order ?? 0) < (anchorTrack.order ?? 0))
    .sort((left, right) => (right.order ?? 0) - (left.order ?? 0));

  for (let i = lastIdx - 1; i >= 0; i -= 1) {
    const subTrack = sortedSubTracks[i]!;
    const restoredRanges = subItems
      .filter((item) => item.trackId === subTrack.id)
      .map((item) => ({ from: item.from + compFrom, end: item.from + compFrom + item.durationInFrames }));

    let foundTrackId: string | null = null;
    for (const candidate of candidatesAbove) {
      if (usedTrackIds.has(candidate.id)) continue;

      const existingOnTrack = currentItems.filter((item) => item.trackId === candidate.id);
      const overlaps = existingOnTrack.some((existing) => {
        const existingEnd = existing.from + existing.durationInFrames;
        return restoredRanges.some((range) => range.from < existingEnd && existing.from < range.end);
      });

      if (!overlaps) {
        foundTrackId = candidate.id;
        usedTrackIds.add(candidate.id);
        break;
      }
    }

    if (foundTrackId) {
      trackIdMapping.set(subTrack.id, foundTrackId);
      continue;
    }

    const distanceFromBottom = lastIdx - i;
    const newTrackId = crypto.randomUUID();
    trackIdMapping.set(subTrack.id, newTrackId);
    usedTrackIds.add(newTrackId);
    newTracks.push({
      ...subTrack,
      id: newTrackId,
      kind,
      order: (anchorTrack.order ?? 0) - distanceFromBottom * 0.01,
    });
  }
}

function mapSubCompItemToWrapperWindow(params: {
  subItem: TimelineItem;
  wrapper: CompositionItem | (AudioItem & { compositionId: string });
  timelineFps: number;
  subCompFps: number;
}): TimelineItem | null {
  const { subItem, wrapper, timelineFps, subCompFps } = params;
  const wrapperSpeed = wrapper.speed ?? 1;
  const wrapperSourceFps = wrapper.sourceFps ?? subCompFps;
  const wrapperSourceStart = wrapper.sourceStart ?? wrapper.trimStart ?? 0;
  const wrapperSourceEnd = wrapper.sourceEnd
    ?? (wrapperSourceStart + timelineToSourceFrames(wrapper.durationInFrames, wrapperSpeed, timelineFps, wrapperSourceFps));
  const subItemStart = subItem.from;
  const subItemEnd = subItem.from + subItem.durationInFrames;
  const overlapStart = Math.max(subItemStart, wrapperSourceStart);
  const overlapEnd = Math.min(subItemEnd, wrapperSourceEnd);

  if (overlapEnd <= overlapStart) {
    return null;
  }

  const mappedFrom = wrapper.from + sourceToTimelineFrames(
    overlapStart - wrapperSourceStart,
    wrapperSpeed,
    wrapperSourceFps,
    timelineFps,
  );
  const mappedEnd = wrapper.from + sourceToTimelineFrames(
    overlapEnd - wrapperSourceStart,
    wrapperSpeed,
    wrapperSourceFps,
    timelineFps,
  );
  const mappedDuration = Math.max(1, mappedEnd - mappedFrom);
  const mappedItem: TimelineItem = {
    ...subItem,
    from: mappedFrom,
    durationInFrames: mappedDuration,
    speed: (subItem.speed ?? 1) * wrapperSpeed,
  };

  if (subItem.type === 'video' || subItem.type === 'audio' || subItem.type === 'composition') {
    const childSourceFps = subItem.sourceFps ?? subCompFps;
    const childSpeed = subItem.speed ?? 1;
    const clippedStartFrames = overlapStart - subItemStart;
    const clippedEndFrames = subItemEnd - overlapEnd;
    const nextSourceStart = (subItem.sourceStart ?? 0) + timelineToSourceFrames(
      clippedStartFrames,
      childSpeed,
      subCompFps,
      childSourceFps,
    );

    mappedItem.sourceStart = nextSourceStart;
    if (subItem.sourceEnd !== undefined) {
      mappedItem.sourceEnd = Math.max(
        nextSourceStart + 1,
        subItem.sourceEnd - timelineToSourceFrames(clippedEndFrames, childSpeed, subCompFps, childSourceFps),
      );
    }
  }

  return mappedItem;
}

/**
 * Create a pre-composition from the currently selected items.
 *
 * 1. Calculates bounding box of selected items (earliest from, latest end).
 * 2. Creates a SubComposition with repositioned items (starting at frame 0).
 * 3. Creates tracks within the sub-composition.
 * 4. Removes original items from the main timeline.
 * 5. Inserts linked compound wrappers on the target video/audio lanes.
 *
 * Supports nested compound clips, but prevents circular composition references.
 */
export function createPreComp(name?: string, itemIds?: string[]): TimelineItem | null {
  return execute('CREATE_PRE_COMP', () => {
    const { items, tracks } = useItemsStore.getState();
    const { transitions } = useTransitionsStore.getState();
    const { keyframes } = useKeyframesStore.getState();
    const { fps } = useTimelineSettingsStore.getState();
    const requestedIds = itemIds ?? useSelectionStore.getState().selectedItemIds;
    const linkedSelectionEnabled = useEditorStore.getState().linkedSelectionEnabled;
    const baseSelectedIds = linkedSelectionEnabled
      ? expandSelectionWithLinkedItems(items, requestedIds)
      : Array.from(new Set(requestedIds));
    const selectedIds = expandSelectionWithCompoundClipCompanions(items, baseSelectedIds);

    if (selectedIds.length === 0) return null;

    const selectedItems = items.filter((i) => selectedIds.includes(i.id));
    if (selectedItems.length === 0) return null;
    const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId;
    const compositionById = useCompositionsStore.getState().compositionById;

    if (activeCompositionId !== null) {
      const selectedCompositionIds = getDirectReferencedCompositionIds(selectedItems);
      const wouldCycle = selectedCompositionIds.some((compositionId) => wouldCreateCompositionCycle({
        parentCompositionId: activeCompositionId,
        insertedCompositionId: compositionId,
        compositionById,
      }));
      if (wouldCycle) return null;
    }

    // --- 1. Calculate bounding box ---
    const minFrom = Math.min(...selectedItems.map((i) => i.from));
    const maxEnd = Math.max(...selectedItems.map((i) => i.from + i.durationInFrames));
    const durationInFrames = maxEnd - minFrom;

    // --- 2. Determine canvas dimensions from project settings ---
    // Compound/pre-comp timelines should inherit the current project canvas.
    const projectMetadata = useProjectStore.getState().currentProject?.metadata;
    const width = projectMetadata?.width ?? 1920;
    const height = projectMetadata?.height ?? 1080;
    const backgroundColor = projectMetadata?.backgroundColor;

    // --- 3. Collect distinct source tracks and build sub-comp tracks ---
    const selectedItemIds = new Set(selectedIds);
    const sourceTrackMap = new Map(tracks.map((t) => [t.id, t]));
    const sourceTrackIds = [...new Set(selectedItems.map((i) => i.trackId))]
      .sort((a, b) => (sourceTrackMap.get(a)?.order ?? 0) - (sourceTrackMap.get(b)?.order ?? 0));

    const subCompTracks: TimelineTrack[] = sourceTrackIds.map((trackId, index) => {
      const sourceTrack = sourceTrackMap.get(trackId);
      const trackItems = selectedItems.filter((item) => item.trackId === trackId);
      return {
        id: crypto.randomUUID(),
        name: sourceTrack?.name ?? `Track ${index + 1}`,
        kind: getTrackKindForSelectedItems(sourceTrack, trackItems),
        height: sourceTrack?.height ?? DEFAULT_TRACK_HEIGHT,
        locked: false,
        visible: sourceTrack?.visible ?? true,
        muted: sourceTrack?.muted ?? false,
        solo: sourceTrack?.solo ?? false,
        volume: sourceTrack?.volume ?? 0,
        color: sourceTrack?.color,
        order: index,
        items: [],
      };
    });

    // Map old trackId → new trackId
    const trackIdMapping = new Map<string, string>();
    sourceTrackIds.forEach((oldId, index) => {
      trackIdMapping.set(oldId, subCompTracks[index]!.id);
    });

    // --- 4. Reposition items to start at frame 0, assign to new tracks ---
    const subCompItems: TimelineItem[] = selectedItems.map((item) => ({
      ...item,
      id: crypto.randomUUID(),
      from: item.from - minFrom,
      trackId: trackIdMapping.get(item.trackId) ?? subCompTracks[0]!.id,
    }));

    // Map old item IDs to new item IDs for transition/keyframe migration
    const itemIdMapping = new Map<string, string>();
    selectedItems.forEach((original, index) => {
      itemIdMapping.set(original.id, subCompItems[index]!.id);
    });

    // --- 5. Migrate transitions that involve only selected items ---
    const subCompTransitions = transitions
      .filter(
        (t) =>
          selectedItemIds.has(t.leftClipId) && selectedItemIds.has(t.rightClipId)
      )
      .map((t) => ({
        ...t,
        id: crypto.randomUUID(),
        leftClipId: itemIdMapping.get(t.leftClipId) ?? t.leftClipId,
        rightClipId: itemIdMapping.get(t.rightClipId) ?? t.rightClipId,
        trackId: trackIdMapping.get(t.trackId) ?? t.trackId,
      }));

    // --- 6. Migrate keyframes for selected items ---
    const subCompKeyframes = keyframes
      .filter((kf) => selectedItemIds.has(kf.itemId))
      .map((kf) => ({
        ...kf,
        itemId: itemIdMapping.get(kf.itemId) ?? kf.itemId,
      }));

    // --- 7. Create SubComposition ---
    const compositionId = crypto.randomUUID();
    const compName = name ?? `Compound Clip ${useCompositionsStore.getState().compositions.length + 1}`;
    const subComp: SubComposition = {
      id: compositionId,
      name: compName,
      items: subCompItems,
      tracks: subCompTracks,
      transitions: subCompTransitions,
      keyframes: subCompKeyframes,
      fps,
      width,
      height,
      durationInFrames,
      backgroundColor,
    };

    useCompositionsStore.getState().addComposition(subComp);

    const hasVisualWrapper = hasCompositionVisualItems(subCompItems);
    const hasOwnedAudio = getCompositionOwnedAudioSources({
      items: subCompItems,
      tracks: subCompTracks,
      fps,
      compositionById,
    }).length > 0;

    const visualSourceTrackIds = sourceTrackIds.filter((trackId) => (
      selectedItems.some((selectedItem) => selectedItem.trackId === trackId && selectedItem.type !== 'audio')
    ));
    const audioSourceTrackIds = sourceTrackIds.filter((trackId) => (
      selectedItems.some((selectedItem) => selectedItem.trackId === trackId && selectedItem.type === 'audio')
    ));
    const visualTargetTrackId = hasVisualWrapper
      ? visualSourceTrackIds[visualSourceTrackIds.length - 1] ?? null
      : null;

    let nextTracks = tracks;
    let audioTargetTrackId = hasOwnedAudio
      ? audioSourceTrackIds[audioSourceTrackIds.length - 1] ?? null
      : null;

    if (hasOwnedAudio && !audioTargetTrackId) {
      const visualTargetTrack = visualTargetTrackId
        ? nextTracks.find((track) => track.id === visualTargetTrackId) ?? null
        : null;

      const nearestAudioTrack = visualTargetTrack
        ? findNearestTrackByKind({
            tracks: nextTracks,
            targetTrack: visualTargetTrack,
            kind: 'audio',
            direction: 'below',
          })
        : nextTracks
            .filter((track) => !track.isGroup)
            .filter((track) => getTrackKind(track) === 'audio')
            .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
            .at(-1)
          ?? null;

      if (nearestAudioTrack) {
        audioTargetTrackId = nearestAudioTrack.id;
      } else {
        const fallbackTrack = visualTargetTrack ?? nextTracks.at(-1) ?? null;
        const order = fallbackTrack
          ? getAdjacentTrackOrder(nextTracks, fallbackTrack, 'below')
          : 0;
        const createdAudioTrack = createClassicTrack({
          tracks: nextTracks,
          kind: 'audio',
          order,
          height: fallbackTrack?.height ?? DEFAULT_TRACK_HEIGHT,
        });
        nextTracks = [...nextTracks, createdAudioTrack];
        audioTargetTrackId = createdAudioTrack.id;
      }
    }

    // --- 8. Remove original items and their transitions/keyframes ---
    useItemsStore.getState()._removeItems(selectedIds);

    // Remove transitions that reference any selected items
    const transitionsToKeep = transitions.filter(
      (t) =>
        !selectedItemIds.has(t.leftClipId) && !selectedItemIds.has(t.rightClipId)
    );
    useTransitionsStore.getState().setTransitions(transitionsToKeep);

    // Remove keyframes for selected items
    useKeyframesStore.getState()._removeKeyframesForItems(selectedIds);

    if (nextTracks !== tracks) {
      useItemsStore.getState().setTracks(nextTracks);
    }

    const wrapperSourceFields = buildCompoundWrapperSourceFields(subComp);
    const linkedGroupId = hasVisualWrapper && hasOwnedAudio ? crypto.randomUUID() : undefined;
    let compositionItem: CompositionItem | null = null;
    let compositionAudioItem: AudioItem | null = null;

    if (hasVisualWrapper && visualTargetTrackId) {
      compositionItem = {
        id: crypto.randomUUID(),
        type: 'composition',
        trackId: visualTargetTrackId,
        from: minFrom,
        durationInFrames,
        label: compName,
        compositionId,
        linkedGroupId,
        compositionWidth: width,
        compositionHeight: height,
        transform: {
          x: 0,
          y: 0,
          rotation: 0,
          opacity: 1,
        },
        ...wrapperSourceFields,
      };
      useItemsStore.getState()._addItem(compositionItem);
    }

    if (hasOwnedAudio && audioTargetTrackId) {
      compositionAudioItem = {
        id: crypto.randomUUID(),
        type: 'audio',
        trackId: audioTargetTrackId,
        from: minFrom,
        durationInFrames,
        label: compName,
        compositionId,
        linkedGroupId,
        src: '',
        ...wrapperSourceFields,
      };
      useItemsStore.getState()._addItem(compositionAudioItem);
    }

    const nextSelectionIds = [compositionItem?.id, compositionAudioItem?.id].filter((id): id is string => !!id);
    if (nextSelectionIds.length > 0) {
      useSelectionStore.getState().selectItems(nextSelectionIds);
    }

    useTimelineSettingsStore.getState().markDirty();

    return compositionItem ?? compositionAudioItem ?? null;
  }, { name });
}

/**
 * Dissolve a CompositionItem back into individual items on the main timeline.
 * This is the inverse of createPreComp.
 */
export function dissolvePreComp(compositionItemId: string): boolean {
  return execute('DISSOLVE_PRE_COMP', () => {
    const { items } = useItemsStore.getState();
    const wrapperItem = items.find((item) => (
      item.id === compositionItemId
      && (item.type === 'composition' || isCompositionAudioItem(item))
    ));
    if (!wrapperItem) return false;

    const compositionId = wrapperItem.compositionId;
    if (!compositionId) return false;
    const isAudioWrapper = isCompositionAudioItem(wrapperItem);

    const visualWrapper = wrapperItem.type === 'composition'
      ? wrapperItem
      : isAudioWrapper
      ? getLinkedCompositionVisualCompanion(items, wrapperItem)
      : null;
    const audioWrapper = wrapperItem.type === 'composition'
      ? getLinkedCompositionAudioCompanion(items, wrapperItem)
      : isAudioWrapper
      ? wrapperItem
      : null;

    const subComp = useCompositionsStore.getState().getComposition(compositionId);
    if (!subComp) return false;

    const { tracks } = useItemsStore.getState();
    const wrapperIds = [visualWrapper?.id, audioWrapper?.id].filter((id): id is string => !!id);
    const wrapperWindowAnchor = visualWrapper ?? audioWrapper;
    if (!wrapperWindowAnchor) return false;
    const compFrom = wrapperWindowAnchor.from;
    const timelineFps = useTimelineSettingsStore.getState().fps;

    let nextTracks = tracks;

    const resolveAnchorTrackId = (
      wrapperTrackId: string | null,
      fallbackTrackId: string | null,
      kind: TrackKind,
      direction: 'above' | 'below',
    ): string | null => {
      if (wrapperTrackId) return wrapperTrackId;
      if (!fallbackTrackId) return null;

      const fallbackTrack = nextTracks.find((track) => track.id === fallbackTrackId) ?? null;
      if (!fallbackTrack) return null;

      const nearestTrack = findNearestTrackByKind({
        tracks: nextTracks,
        targetTrack: fallbackTrack,
        kind,
        direction,
      });
      if (nearestTrack) return nearestTrack.id;

      const createdTrack = createClassicTrack({
        tracks: nextTracks,
        kind,
        order: getAdjacentTrackOrder(nextTracks, fallbackTrack, direction),
        height: fallbackTrack.height ?? DEFAULT_TRACK_HEIGHT,
      });
      nextTracks = [...nextTracks, createdTrack];
      return createdTrack.id;
    };

    const sortedSubTracks = [...subComp.tracks].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
    const visualSubTracks = sortedSubTracks.filter((track) => {
      const trackItems = subComp.items.filter((item) => item.trackId === track.id);
      return getTrackKindForSelectedItems(track, trackItems) === 'video';
    });
    const audioSubTracks = sortedSubTracks.filter((track) => {
      const trackItems = subComp.items.filter((item) => item.trackId === track.id);
      return getTrackKindForSelectedItems(track, trackItems) === 'audio';
    });

    const visualAnchorTrackId = resolveAnchorTrackId(
      visualWrapper?.trackId ?? null,
      audioWrapper?.trackId ?? null,
      'video',
      'above',
    );
    const audioAnchorTrackId = resolveAnchorTrackId(
      audioWrapper?.trackId ?? null,
      visualWrapper?.trackId ?? null,
      'audio',
      'below',
    );

    const trackIdMapping = new Map<string, string>();
    const newTracks: TimelineTrack[] = [];
    const currentItems = items.filter((item) => !wrapperIds.includes(item.id));

    mapRestoredTrackGroup({
      subTracks: visualSubTracks,
      subItems: subComp.items,
      anchorTrackId: visualAnchorTrackId,
      kind: 'video',
      compFrom,
      existingTracks: nextTracks,
      currentItems,
      trackIdMapping,
      newTracks,
    });
    mapRestoredTrackGroup({
      subTracks: audioSubTracks,
      subItems: subComp.items,
      anchorTrackId: audioAnchorTrackId,
      kind: 'audio',
      compFrom,
      existingTracks: nextTracks,
      currentItems,
      trackIdMapping,
      newTracks,
    });

    // Add new tracks to the store (only if we couldn't reuse existing ones)
    if (newTracks.length > 0) {
      nextTracks = [...nextTracks, ...newTracks];
      useItemsStore.getState().setTracks(nextTracks);
    }

    // Reposition items back to absolute timeline positions with correct track mapping
    const itemIdMapping = new Map<string, string>();
    const restoredItems: TimelineItem[] = subComp.items.flatMap((item) => {
      const mappedItem = mapSubCompItemToWrapperWindow({
        subItem: item,
        wrapper: wrapperWindowAnchor,
        timelineFps,
        subCompFps: subComp.fps,
      });
      if (!mappedItem) return [];

      const newId = crypto.randomUUID();
      itemIdMapping.set(item.id, newId);
      return [{
        ...mappedItem,
        id: newId,
        trackId: trackIdMapping.get(item.trackId) ?? visualAnchorTrackId ?? audioAnchorTrackId ?? item.trackId,
      }];
    });

    // Remove the compound wrappers
    if (wrapperIds.length > 0) {
      useItemsStore.getState()._removeItems(wrapperIds);
    }

    // Add restored items
    if (restoredItems.length > 0) {
      useItemsStore.getState()._addItems(restoredItems);
    }

    // Repair any external transitions that referenced the removed wrapper clips.
    applyTransitionRepairs(wrapperIds, new Set(wrapperIds));

    // Restore transitions with remapped IDs after the restored clips exist.
    const subTransitions = subComp.transitions ?? [];
    if (subTransitions.length > 0) {
      const currentTransitions = useTransitionsStore.getState().transitions;
      const restoredTransitions = subTransitions.flatMap((t) => {
        const leftClipId = itemIdMapping.get(t.leftClipId);
        const rightClipId = itemIdMapping.get(t.rightClipId);
        if (!leftClipId || !rightClipId) return [];

        return [{
          ...t,
          id: crypto.randomUUID(),
          leftClipId,
          rightClipId,
          trackId: trackIdMapping.get(t.trackId) ?? t.trackId,
        }];
      });
      useTransitionsStore.getState().setTransitions([...currentTransitions, ...restoredTransitions]);
      if (restoredTransitions.length > 0) {
        applyTransitionRepairs(restoredItems.map((item) => item.id));
      }
    }

    // Restore keyframes with remapped item IDs
    const subKeyframes = subComp.keyframes ?? [];
    if (subKeyframes.length > 0) {
      const currentKeyframes = useKeyframesStore.getState().keyframes;
      const restoredKeyframes = subKeyframes.map((kf) => ({
        ...kf,
        itemId: itemIdMapping.get(kf.itemId) ?? kf.itemId,
      }));
      useKeyframesStore.getState().setKeyframes([...currentKeyframes, ...restoredKeyframes]);
    }

    // Only remove the compound definition when nothing else in the project references it.
    if (getCompoundClipDeletionImpact([compositionId]).totalReferenceCount === 0) {
      useCompositionsStore.getState().removeComposition(compositionId);
    }

    // Select the restored items
    useSelectionStore.getState().selectItems(restoredItems.map((i) => i.id));

    useTimelineSettingsStore.getState().markDirty();
    return true;
  }, { compositionItemId });
}

export function deleteCompoundClips(compositionIds: string[]): boolean {
  const targetIds = Array.from(new Set(compositionIds.filter(Boolean)));
  if (targetIds.length === 0) return false;

  return execute('DELETE_COMPOUND_CLIPS', () => {
    const targetIdSet = new Set(targetIds);
    const navState = useCompositionNavigationStore.getState();
    const deletesOpenComposition = navState.breadcrumbs.some((breadcrumb) => (
      breadcrumb.compositionId !== null && targetIdSet.has(breadcrumb.compositionId)
    ));

    if (deletesOpenComposition) {
      useCompositionNavigationStore.getState().resetToRoot();
    }

    const currentSnapshot = getCurrentTimelineSnapshot();
    const sanitizedCurrent = sanitizeTimelineSnapshot(currentSnapshot, targetIdSet);
    if (sanitizedCurrent.removedItemIds.length > 0) {
      useItemsStore.getState().setItems(sanitizedCurrent.items);
      useTransitionsStore.getState().setTransitions(sanitizedCurrent.transitions);
      useKeyframesStore.getState().setKeyframes(sanitizedCurrent.keyframes);
    }

    const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId;
    const nextCompositions = useCompositionsStore.getState().compositions.flatMap((composition) => {
      if (targetIdSet.has(composition.id)) {
        return [];
      }

      const baseSnapshot: TimelineSnapshotLike = composition.id === activeCompositionId
        ? {
          items: sanitizedCurrent.items,
          tracks: sanitizedCurrent.tracks,
          transitions: sanitizedCurrent.transitions,
          keyframes: sanitizedCurrent.keyframes,
        }
        : {
          items: composition.items,
          tracks: composition.tracks,
          transitions: composition.transitions,
          keyframes: composition.keyframes,
        };

      const sanitizedComposition = sanitizeTimelineSnapshot(baseSnapshot, targetIdSet);
      return [{
        ...composition,
        items: sanitizedComposition.items,
        tracks: sanitizedComposition.tracks,
        transitions: sanitizedComposition.transitions,
        keyframes: sanitizedComposition.keyframes,
        durationInFrames: computeCompositionDuration(
          sanitizedComposition.items,
          composition.durationInFrames,
        ),
      }];
    });
    useCompositionsStore.getState().setCompositions(nextCompositions);

    const latestNavState = useCompositionNavigationStore.getState();
    if (latestNavState.stashStack.length > 0) {
      useCompositionNavigationStore.setState((state) => ({
        stashStack: state.stashStack.map((stash) => {
          const sanitizedStash = sanitizeTimelineSnapshot(stash, targetIdSet);
          return {
            ...stash,
            items: sanitizedStash.items,
            transitions: sanitizedStash.transitions,
            keyframes: sanitizedStash.keyframes,
          };
        }),
      }));
    }

    useSelectionStore.getState().clearSelection();
    useTimelineSettingsStore.getState().markDirty();
    return true;
  }, { compositionIds: targetIds });
}
