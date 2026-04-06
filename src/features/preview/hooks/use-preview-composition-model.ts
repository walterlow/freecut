import { useCallback, useMemo, useRef } from 'react';
import type { CompositionInputProps } from '@/types/export';
import type { ItemEffect } from '@/types/effects';
import type { ItemKeyframes } from '@/types/keyframe';
import type { TimelineItem, TimelineTrack } from '@/types/timeline';
import type { ResolvedTransform } from '@/types/transform';
import { resolveEffectiveTrackStates } from '@/features/preview/deps/timeline-utils';
import { useCornerPinStore } from '../stores/corner-pin-store';
import { useGizmoStore } from '../stores/gizmo-store';
import { useMaskEditorStore } from '../stores/mask-editor-store';
import { resolveProxyUrl } from '../utils/media-resolver';
import {
  getMediaResolveCost,
  toTrackFingerprint,
  type FastScrubBoundarySource,
  type VideoSourceSpan,
} from '../utils/preview-constants';

interface PreviewProject {
  width: number;
  height: number;
  backgroundColor?: string;
}

interface UsePreviewCompositionModelParams {
  combinedTracks: TimelineTrack[];
  fps: number;
  items: TimelineItem[];
  keyframes: ItemKeyframes[];
  transitions: CompositionInputProps['transitions'];
  resolvedUrls: ReadonlyMap<string, string>;
  useProxy: boolean;
  proxyReadyCount: number;
  project: PreviewProject;
}

interface UsePreviewCompositionBaseModelParams {
  tracks: TimelineTrack[];
  itemsByTrackId: Record<string, TimelineItem[]>;
  mediaById: Record<string, Parameters<typeof getMediaResolveCost>[0]>;
}

export function usePreviewCompositionBaseModel({
  tracks,
  itemsByTrackId,
  mediaById,
}: UsePreviewCompositionBaseModelParams) {
  // resolveEffectiveTrackStates applies parent group gate behavior (mute/hide/lock)
  // and filters out group container tracks (which hold no items)
  const combinedTracks = useMemo(() => {
    const effectiveTracks = resolveEffectiveTrackStates(tracks).toSorted((a, b) => b.order - a.order);
    return effectiveTracks.map((track) => ({
      ...track,
      items: itemsByTrackId[track.id] ?? [],
    }));
  }, [tracks, itemsByTrackId]);

  const mediaResolveCostById = useMemo(() => {
    const costs = new Map<string, number>();
    for (const [mediaId, media] of Object.entries(mediaById)) {
      costs.set(mediaId, getMediaResolveCost(media));
    }
    return costs;
  }, [mediaById]);

  return {
    combinedTracks,
    mediaResolveCostById,
  };
}

export function usePreviewCompositionModel({
  combinedTracks,
  fps,
  items,
  keyframes,
  transitions,
  resolvedUrls,
  useProxy,
  proxyReadyCount,
  project,
}: UsePreviewCompositionModelParams) {

  const {
    resolvedTracks,
    fastScrubTracks,
    playbackVideoSourceSpans,
    scrubVideoSourceSpans,
    fastScrubBoundaryFrames,
    fastScrubBoundarySources,
    fastScrubTracksFingerprint,
  } = useMemo(() => {
    const resolvedTrackList: CompositionInputProps['tracks'] = [];
    const fastScrubTrackList: CompositionInputProps['tracks'] = [];
    const playbackSpans: VideoSourceSpan[] = [];
    const scrubSpans: VideoSourceSpan[] = [];
    const boundaryFrames = new Set<number>();
    const boundarySources = new Map<number, Set<string>>();

    for (const track of combinedTracks) {
      const resolvedItems: typeof track.items = [];
      const fastScrubItems: typeof track.items = [];

      for (const item of track.items) {
        if (!item.mediaId || (item.type !== 'video' && item.type !== 'audio' && item.type !== 'image')) {
          resolvedItems.push(item);
          fastScrubItems.push(item);
          continue;
        }

        const sourceUrl = resolvedUrls.get(item.mediaId) ?? '';
        const proxyUrl = item.type === 'video'
          ? (resolveProxyUrl(item.mediaId) || sourceUrl)
          : sourceUrl;
        const resolvedSrc = useProxy && item.type === 'video' ? proxyUrl : sourceUrl;
        const fastScrubSrc = item.type === 'video' ? proxyUrl : sourceUrl;

        const resolvedItem = ('src' in item && item.src === resolvedSrc)
          ? item
          : { ...item, src: resolvedSrc };
        const fastScrubItem = ('src' in item && item.src === fastScrubSrc)
          ? item
          : { ...item, src: fastScrubSrc };

        resolvedItems.push(resolvedItem);
        fastScrubItems.push(fastScrubItem);

        if (resolvedItem.type === 'video' && resolvedSrc) {
          playbackSpans.push({
            src: resolvedSrc,
            startFrame: resolvedItem.from,
            endFrame: resolvedItem.from + resolvedItem.durationInFrames,
          });
        }

        if (fastScrubItem.type === 'video' && fastScrubSrc) {
          scrubSpans.push({
            src: fastScrubSrc,
            startFrame: fastScrubItem.from,
            endFrame: fastScrubItem.from + fastScrubItem.durationInFrames,
          });
          if (fastScrubItem.durationInFrames > 0) {
            const startFrame = fastScrubItem.from;
            const endFrame = fastScrubItem.from + fastScrubItem.durationInFrames;
            boundaryFrames.add(startFrame);
            boundaryFrames.add(endFrame);

            let startSet = boundarySources.get(startFrame);
            if (!startSet) {
              startSet = new Set<string>();
              boundarySources.set(startFrame, startSet);
            }
            startSet.add(fastScrubSrc);

            let endSet = boundarySources.get(endFrame);
            if (!endSet) {
              endSet = new Set<string>();
              boundarySources.set(endFrame, endSet);
            }
            endSet.add(fastScrubSrc);
          }
        }
      }

      resolvedTrackList.push({ ...track, items: resolvedItems });
      fastScrubTrackList.push({ ...track, items: fastScrubItems });
    }

    const sortedBoundaryFrames = [...boundaryFrames].sort((a, b) => a - b);
    const sortedBoundarySources: FastScrubBoundarySource[] = [...boundarySources.entries()]
      .map(([frame, srcSet]) => ({ frame, srcs: [...srcSet] }))
      .sort((a, b) => a.frame - b.frame);

    return {
      resolvedTracks: resolvedTrackList,
      fastScrubTracks: fastScrubTrackList,
      playbackVideoSourceSpans: playbackSpans,
      scrubVideoSourceSpans: scrubSpans,
      fastScrubBoundaryFrames: sortedBoundaryFrames,
      fastScrubBoundarySources: sortedBoundarySources,
      fastScrubTracksFingerprint: toTrackFingerprint(fastScrubTrackList),
    };
  }, [combinedTracks, proxyReadyCount, resolvedUrls, useProxy]);

  const furthestItemEndFrame = useMemo(
    () => items.reduce((max, item) => Math.max(max, item.from + item.durationInFrames), 0),
    [items],
  );
  const totalFrames = useMemo(() => {
    if (furthestItemEndFrame === 0) return 900;
    return furthestItemEndFrame + (fps * 5);
  }, [fps, furthestItemEndFrame]);

  const inputProps: CompositionInputProps = useMemo(() => ({
    fps,
    width: project.width,
    height: project.height,
    tracks: resolvedTracks as CompositionInputProps['tracks'],
    transitions,
    backgroundColor: project.backgroundColor,
    keyframes,
  }), [
    fps,
    keyframes,
    project.backgroundColor,
    project.height,
    project.width,
    resolvedTracks,
    transitions,
  ]);

  const playerRenderSize = useMemo(() => {
    const width = Math.max(2, project.width);
    const height = Math.max(2, project.height);
    return { width, height };
  }, [project.height, project.width]);

  const renderSize = useMemo(() => {
    const projectWidth = Math.max(1, Math.round(project.width));
    const projectHeight = Math.max(1, Math.round(project.height));
    return { width: Math.max(2, projectWidth), height: Math.max(2, projectHeight) };
  }, [project.height, project.width]);

  const getPreviewTransformOverride = useCallback((itemId: string): Partial<ResolvedTransform> | undefined => {
    const gizmoState = useGizmoStore.getState();
    const unifiedPreviewTransform = gizmoState.preview?.[itemId]?.transform;
    if (unifiedPreviewTransform) return unifiedPreviewTransform;
    if (gizmoState.activeGizmo?.itemId === itemId && gizmoState.previewTransform) {
      return gizmoState.previewTransform;
    }
    return undefined;
  }, []);

  const getPreviewEffectsOverride = useCallback((itemId: string): ItemEffect[] | undefined => {
    const gizmoState = useGizmoStore.getState();
    return gizmoState.preview?.[itemId]?.effects;
  }, []);

  const getPreviewCornerPinOverride = useCallback((itemId: string) => {
    const cornerPinState = useCornerPinStore.getState();
    if (cornerPinState.editingItemId === itemId && cornerPinState.previewCornerPin) {
      return cornerPinState.previewCornerPin;
    }
    return undefined;
  }, []);

  const getPreviewPathVerticesOverride = useCallback((itemId: string) => {
    const maskState = useMaskEditorStore.getState();
    if (maskState.editingItemId === itemId && maskState.previewVertices) {
      return maskState.previewVertices;
    }
    return undefined;
  }, []);

  const fastScrubScaledTracks = useMemo(
    () => fastScrubTracks as CompositionInputProps['tracks'],
    [fastScrubTracks, fastScrubTracksFingerprint],
  );

  const fastScrubLiveItemsById = useMemo(() => {
    const map = new Map<string, TimelineItem>();
    for (const track of fastScrubScaledTracks) {
      for (const item of track.items as TimelineItem[]) {
        map.set(item.id, item);
      }
    }
    return map;
  }, [fastScrubScaledTracks]);
  const fastScrubLiveItemsByIdRef = useRef<Map<string, TimelineItem>>(fastScrubLiveItemsById);
  fastScrubLiveItemsByIdRef.current = fastScrubLiveItemsById;

  const fastScrubKeyframesByItemId = useMemo(
    () => new Map(keyframes.map((entry) => [entry.itemId, entry])),
    [keyframes],
  );
  const fastScrubKeyframesByItemIdRef = useRef<Map<string, ItemKeyframes>>(fastScrubKeyframesByItemId);
  fastScrubKeyframesByItemIdRef.current = fastScrubKeyframesByItemId;

  const getLiveItemSnapshot = useCallback((itemId: string) => {
    return fastScrubLiveItemsByIdRef.current.get(itemId);
  }, []);

  const getLiveKeyframes = useCallback((itemId: string) => {
    return fastScrubKeyframesByItemIdRef.current.get(itemId);
  }, []);

  const fastScrubScaledKeyframes = useMemo(() => keyframes, [keyframes]);
  const fastScrubInputProps: CompositionInputProps = useMemo(() => ({
    fps,
    width: project.width,
    height: project.height,
    tracks: fastScrubScaledTracks,
    transitions,
    backgroundColor: project.backgroundColor,
    keyframes: fastScrubScaledKeyframes,
  }), [
    fastScrubScaledKeyframes,
    fastScrubScaledTracks,
    fps,
    project.backgroundColor,
    project.height,
    project.width,
    transitions,
  ]);

  const fastScrubPreviewItems = useMemo(
    () => fastScrubScaledTracks.flatMap((track) => track.items as TimelineItem[]),
    [fastScrubScaledTracks],
  );

  return {
    playbackVideoSourceSpans,
    scrubVideoSourceSpans,
    fastScrubBoundaryFrames,
    fastScrubBoundarySources,
    totalFrames,
    inputProps,
    playerRenderSize,
    renderSize,
    fastScrubScaledTracks,
    fastScrubScaledKeyframes,
    fastScrubInputProps,
    fastScrubPreviewItems,
    fastScrubTracksFingerprint,
    getPreviewTransformOverride,
    getPreviewEffectsOverride,
    getPreviewCornerPinOverride,
    getPreviewPathVerticesOverride,
    getLiveItemSnapshot,
    getLiveKeyframes,
  };
}
