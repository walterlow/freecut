import React, { useMemo, useCallback } from 'react';
import { AbsoluteFill, Sequence, useSequenceContext } from '@/features/composition-runtime/deps/player';
import type { AudioItem, CompositionItem as CompositionItemType, TimelineItem, ShapeItem } from '@/types/timeline';
import type { ResolvedAudioEqSettings } from '@/types/audio';
import type { ResolvedTransform } from '@/types/transform';
import { useCompositionsStore } from '@/features/composition-runtime/deps/stores';
import { blobUrlManager, useBlobUrlVersion } from '@/infrastructure/browser/blob-url-manager';
import { VideoConfigProvider } from '@/features/composition-runtime/deps/player';
import { useVideoConfig } from '../hooks/use-player-compat';
import { useGizmoStore } from '@/features/composition-runtime/deps/stores';
import { useTimelineStore } from '@/features/composition-runtime/deps/stores';
import { sourceToTimelineFrames, timelineToSourceFrames } from '@/features/composition-runtime/deps/timeline';
import { resolveTransform, getSourceDimensions } from '../utils/transform-resolver';
import { resolveAnimatedTransform, hasKeyframeAnimation } from '@/features/composition-runtime/deps/keyframes';
import { useItemKeyframesFromContext } from '../contexts/keyframes-context';
import { KeyframesProvider } from '../contexts/keyframes-context';
import { CompositionSpaceProvider, useCompositionSpace } from '../contexts/composition-space-context';
import { useNestedMediaResolutionMode } from '../contexts/nested-media-resolution-context';
import { clearMixerLiveGain } from '@/shared/state/mixer-live-gain';
import { appendResolvedAudioEqSources } from '@/shared/utils/audio-eq';
import { Item } from './item';
import type { MaskInfo } from './item';
import { StableVideoSequence, type StableVideoSequenceItem } from './stable-video-sequence';
import { resolveActiveShapeMasksAtFrame } from '../utils/frame-scene';
import {
  EMPTY_MASK_INFOS,
  getMasksForTrackOrder,
  materializeMaskInfos,
  reuseStableMaskInfos,
} from '../utils/mask-info';
import {
  resolveTrackRenderState,
} from '../utils/scene-assembly';
import { getLinkedVideoIdsWithAudio, hasLinkedAudioCompanion } from '@/shared/utils/linked-media';
import { resolveProxyUrl } from '@/features/composition-runtime/deps/media-library';

const EMPTY_AUDIO_EQ_STAGES: ResolvedAudioEqSettings[] = [];

type CompositionWrapperItem = CompositionItemType | (AudioItem & { compositionId: string });

interface CompositionWindow {
  durationInFrames: number;
  speed?: number;
  sourceFps?: number;
  sourceStart?: number;
  sourceEnd?: number;
  trimStart?: number;
}

interface CompositionContentProps {
  item: CompositionWrapperItem;
  parentMuted?: boolean;
  parentVisible?: boolean;
  renderDepth?: number;
  renderMode?: 'full' | 'visual-only' | 'audio-only';
  audioGainMultiplier?: number;
  audioGainLiveItemIds?: string[];
  audioEqStages?: ResolvedAudioEqSettings[];
  audioPitchShiftSemitones?: number;
  crossfadeFadeInFrames?: number;
  crossfadeFadeOutFrames?: number;
}

/**
 * Resolve media URLs on sub-comp items using the centralized blob URL manager.
 * The parent preview has already acquired blob URLs for all mediaIds —
 * we just need to look them up and set `src`.
 */
function resolveSubCompItem(
  subItem: TimelineItem,
  nestedMediaResolutionMode: 'source' | 'proxy',
): TimelineItem {
  if (
    subItem.mediaId &&
    (subItem.type === 'video' || subItem.type === 'audio' || subItem.type === 'image')
  ) {
    const sourceSrc = blobUrlManager.get(subItem.mediaId) ?? '';

    if (subItem.type === 'video') {
      const proxySrc = nestedMediaResolutionMode === 'proxy'
        ? resolveProxyUrl(subItem.mediaId)
        : null;
      const resolvedSrc = proxySrc || sourceSrc;
      const resolvedAudioSrc = sourceSrc || undefined;
      if (resolvedSrc !== subItem.src || subItem.audioSrc !== resolvedAudioSrc) {
        return { ...subItem, src: resolvedSrc, audioSrc: resolvedAudioSrc };
      }
      return subItem;
    }

    if (sourceSrc !== subItem.src) {
      return { ...subItem, src: sourceSrc } as TimelineItem;
    }
  }
  return subItem;
}

function mapSubCompItemToWrapperWindow(params: {
  subItem: TimelineItem;
  wrapper: CompositionWindow;
  parentFps: number;
  subCompFps: number;
}): TimelineItem | null {
  const { subItem, wrapper, parentFps, subCompFps } = params;
  const wrapperSpeed = wrapper.speed ?? 1;
  const wrapperSourceFps = wrapper.sourceFps ?? subCompFps;
  const wrapperSourceStart = wrapper.sourceStart ?? wrapper.trimStart ?? 0;
  const wrapperSourceEnd = wrapper.sourceEnd
    ?? (wrapperSourceStart + timelineToSourceFrames(wrapper.durationInFrames, wrapperSpeed, parentFps, wrapperSourceFps));
  const subItemStart = subItem.from;
  const subItemEnd = subItem.from + subItem.durationInFrames;
  const overlapStart = Math.max(subItemStart, wrapperSourceStart);
  const overlapEnd = Math.min(subItemEnd, wrapperSourceEnd);

  if (overlapEnd <= overlapStart) {
    return null;
  }

  const mappedFrom = sourceToTimelineFrames(overlapStart - wrapperSourceStart, wrapperSpeed, wrapperSourceFps, parentFps);
  const mappedEnd = sourceToTimelineFrames(overlapEnd - wrapperSourceStart, wrapperSpeed, wrapperSourceFps, parentFps);
  const mappedDuration = Math.max(1, mappedEnd - mappedFrom);
  const effectiveSpeed = (subItem.speed ?? 1) * wrapperSpeed;
  const clippedStartFrames = overlapStart - subItemStart;
  const clippedEndFrames = subItemEnd - overlapEnd;

  const mappedItem: TimelineItem = {
    ...subItem,
    from: mappedFrom,
    durationInFrames: mappedDuration,
    speed: effectiveSpeed,
  };

  if (subItem.type === 'video' || subItem.type === 'audio' || subItem.type === 'composition') {
    const childSourceFps = subItem.sourceFps ?? subCompFps;
    const childSpeed = subItem.speed ?? 1;
    const sourceStartDelta = timelineToSourceFrames(clippedStartFrames, childSpeed, subCompFps, childSourceFps);
    const sourceEndDelta = timelineToSourceFrames(clippedEndFrames, childSpeed, subCompFps, childSourceFps);
    const nextSourceStart = (subItem.sourceStart ?? 0) + sourceStartDelta;

    mappedItem.sourceStart = nextSourceStart;
    if (subItem.sourceEnd !== undefined) {
      mappedItem.sourceEnd = Math.max(nextSourceStart + 1, subItem.sourceEnd - sourceEndDelta);
    }
  }

  return mappedItem;
}

/**
 * Renders the contents of a sub-composition inline within the main preview.
 *
 * Each sub-composition item is rendered via a Sequence at its local `from`,
 * offset so that frame 0 of the sub-comp maps to the CompositionItem's
 * `from` on the parent timeline.
 *
 * The sub-comp is rendered at its own native resolution inside a VideoConfigProvider,
 * then CSS-scaled to fit the parent container dimensions. This ensures sub-items
 * use the correct coordinate space (sub-comp dimensions, not main canvas).
 */
export const CompositionContent = React.memo<CompositionContentProps>(({ item, parentMuted = false, parentVisible = true, renderDepth = 0, renderMode = 'full', audioGainMultiplier = 1, audioGainLiveItemIds, audioEqStages = EMPTY_AUDIO_EQ_STAGES, audioPitchShiftSemitones = 0, crossfadeFadeInFrames, crossfadeFadeOutFrames }) => {
  const subComp = useCompositionsStore((s) => s.compositions.find((c) => c.id === item.compositionId));
  const { width: renderWidth, height: renderHeight, fps: mainFps } = useVideoConfig();
  const nestedMediaResolutionMode = useNestedMediaResolutionMode();
  const compositionSpace = useCompositionSpace();
  const projectWidth = compositionSpace?.projectWidth ?? renderWidth;
  const projectHeight = compositionSpace?.projectHeight ?? renderHeight;
  const renderScaleX = compositionSpace?.scaleX ?? 1;
  const renderScaleY = compositionSpace?.scaleY ?? 1;
  const wrapperWindow = useMemo<CompositionWindow>(() => ({
    durationInFrames: item.durationInFrames,
    speed: item.speed,
    sourceFps: item.sourceFps,
    sourceStart: item.sourceStart,
    sourceEnd: item.sourceEnd,
    trimStart: item.trimStart,
  }), [
    item.durationInFrames,
    item.sourceEnd,
    item.sourceFps,
    item.sourceStart,
    item.speed,
    item.trimStart,
  ]);

  // Re-render when blob URLs are acquired (fixes media not loading on project load)
  const blobUrlVersion = useBlobUrlVersion();

  // Resolve media URLs for sub-comp items so they can render in preview
  const resolvedItems = useMemo(() => {
    if (!subComp) return [];
    return subComp.items
      .map((subItem) => resolveSubCompItem(subItem, nestedMediaResolutionMode))
      .flatMap((subItem) => {
        const mapped = mapSubCompItemToWrapperWindow({
          subItem,
          wrapper: wrapperWindow,
          parentFps: mainFps,
          subCompFps: subComp.fps,
        });
        return mapped ? [mapped] : [];
      });
  }, [blobUrlVersion, mainFps, nestedMediaResolutionMode, subComp, wrapperWindow]);

  // === Compute parent container dimensions ===
  // Replicates the same priority chain as useItemVisualState:
  // unified preview > gizmo preview > keyframes > base
  //
  // Granular selectors: extract only the values we need to avoid
  // re-renders when unrelated gizmo store fields change reference.
  const isGizmoTarget = useGizmoStore(
    useCallback((s) => s.activeGizmo?.itemId === item.id, [item.id])
  );
  const previewTransform = useGizmoStore(
    useCallback(
      (s) => (s.activeGizmo?.itemId === item.id ? s.previewTransform : null),
      [item.id]
    )
  );
  const itemPreview = useGizmoStore(
    useCallback((s) => s.preview?.[item.id], [item.id])
  );

  const contextKeyframes = useItemKeyframesFromContext(item.id);
  const storeKeyframes = useTimelineStore(
    useCallback(
      (s) => s.keyframes.find((k) => k.itemId === item.id),
      [item.id]
    )
  );
  const itemKeyframes = contextKeyframes ?? storeKeyframes;
  const hasAnimatedKeyframes = !!(itemKeyframes && hasKeyframeAnimation(itemKeyframes));

  const sequenceContext = useSequenceContext();
  const frame = sequenceContext?.localFrame ?? 0;
  const relativeFrame = frame - ((item as TimelineItem & { _sequenceFrameOffset?: number })._sequenceFrameOffset ?? 0);
  const sourceOffset = item.sourceStart ?? item.trimStart ?? 0;
  const subCompFrame = sourceOffset + timelineToSourceFrames(
    relativeFrame,
    item.speed ?? 1,
    mainFps,
    item.sourceFps ?? subComp?.fps ?? mainFps,
  );

  // Only include relativeFrame as a dependency when keyframes are actually animated.
  // This prevents per-frame recomputation during playback for non-animated sub-comps.
  const keyframeFrame = hasAnimatedKeyframes ? relativeFrame : 0;

  const containerDims = useMemo(() => {
    const canvas = { width: projectWidth, height: projectHeight, fps: mainFps };
    const sourceDims = getSourceDimensions(item);
    const baseResolved = resolveTransform(item, canvas, sourceDims);

    // Apply keyframe animation if present
    let animatedResolved = baseResolved;
    if (hasAnimatedKeyframes) {
      animatedResolved = resolveAnimatedTransform(baseResolved, itemKeyframes!, keyframeFrame);
    }

    // Priority: unified preview > gizmo preview > keyframes > base
    let resolved = animatedResolved;
    const unifiedPreviewTransform = itemPreview?.transform;
    if (unifiedPreviewTransform !== undefined) {
      resolved = {
        ...animatedResolved,
        ...unifiedPreviewTransform,
        anchorX: unifiedPreviewTransform.anchorX ?? animatedResolved.anchorX,
        anchorY: unifiedPreviewTransform.anchorY ?? animatedResolved.anchorY,
        cornerRadius: unifiedPreviewTransform.cornerRadius ?? animatedResolved.cornerRadius,
      } as ResolvedTransform;
    } else if (isGizmoTarget && previewTransform !== null) {
      resolved = {
        ...previewTransform,
        anchorX: previewTransform.anchorX ?? (previewTransform.width / 2),
        anchorY: previewTransform.anchorY ?? (previewTransform.height / 2),
        cornerRadius: previewTransform.cornerRadius ?? animatedResolved.cornerRadius,
      };
    }

    return {
      width: resolved.width * renderScaleX,
      height: resolved.height * renderScaleY,
    };
  }, [
    projectWidth,
    projectHeight,
    mainFps,
    item,
    itemKeyframes,
    hasAnimatedKeyframes,
    keyframeFrame,
    itemPreview,
    isGizmoTarget,
    previewTransform,
    renderScaleX,
    renderScaleY,
  ]);

  const trackRenderState = useMemo(
    () => subComp ? resolveTrackRenderState(subComp.tracks) : null,
    [subComp]
  );
  const sortedTracks = trackRenderState?.visibleTracksByOrderDesc ?? [];
  const maxTrackOrder = useMemo(
    () => sortedTracks.reduce((max, track) => Math.max(max, track.order ?? 0), 0),
    [sortedTracks]
  );
  const linkedVideoIdsWithOwnedAudio = useMemo(
    () => getLinkedVideoIdsWithAudio(resolvedItems),
    [resolvedItems]
  );
  const videoItems = useMemo<StableVideoSequenceItem[]>(() => {
    if (renderMode === 'audio-only') {
      return [];
    }

    return sortedTracks.flatMap((track) => {
      const trackOrder = track.order ?? 0;

      return resolvedItems
        .filter((subItem): subItem is TimelineItem & { type: 'video' } => (
          subItem.trackId === track.id
          && subItem.type === 'video'
        ))
        .map((subItem) => ({
          ...subItem,
          zIndex: (maxTrackOrder - trackOrder) * 1000,
          muted: parentMuted || track.muted || linkedVideoIdsWithOwnedAudio.has(subItem.id),
          trackAudioEq: track.audioEq,
          trackOrder,
          trackVisible: parentVisible,
        }));
    });
  }, [linkedVideoIdsWithOwnedAudio, maxTrackOrder, parentMuted, parentVisible, renderMode, resolvedItems, sortedTracks]);
  const nonVideoTrackItems = useMemo(() => (
    sortedTracks
      .map((track) => {
        const trackOrder = track.order ?? 0;

        return {
          trackId: track.id,
          trackAudioEq: track.audioEq,
          trackOrder,
          trackVisible: parentVisible,
          muted: parentMuted || track.muted,
          items: resolvedItems.filter((subItem) => (
            subItem.trackId === track.id
            && subItem.type !== 'video'
            // Mask shapes are control items and should not render visually.
            && !(subItem.type === 'shape' && subItem.isMask)
            && (renderMode !== 'visual-only' || subItem.type !== 'audio')
            && (renderMode !== 'audio-only' || subItem.type === 'audio')
          )),
        };
      })
      .filter((track) => track.items.length > 0)
  ), [parentMuted, parentVisible, renderMode, resolvedItems, sortedTracks]);

  const trackMergedEqStages = useMemo(() => {
    const map = new Map<string, ResolvedAudioEqSettings[]>();
    for (const track of sortedTracks) {
      map.set(track.id, appendResolvedAudioEqSources(audioEqStages, track.audioEq));
    }
    return map;
  }, [audioEqStages, sortedTracks]);

  let wrapperFadeMultiplier = 1;
  const hasCrossfadeIn = (crossfadeFadeInFrames ?? 0) > 0;
  const hasCrossfadeOut = (crossfadeFadeOutFrames ?? 0) > 0;
  if (hasCrossfadeIn && frame < (crossfadeFadeInFrames ?? 0)) {
    const progress = frame / Math.max(1, crossfadeFadeInFrames ?? 1);
    wrapperFadeMultiplier = Math.sin(progress * Math.PI / 2);
  } else if (hasCrossfadeOut && frame >= item.durationInFrames - (crossfadeFadeOutFrames ?? 0)) {
    const fadeOutStart = item.durationInFrames - (crossfadeFadeOutFrames ?? 0);
    const progress = (frame - fadeOutStart) / Math.max(1, crossfadeFadeOutFrames ?? 1);
    wrapperFadeMultiplier = Math.cos(progress * Math.PI / 2);
  }
  const effectiveAudioGainMultiplier = audioGainMultiplier * Math.max(0, wrapperFadeMultiplier);
  const effectiveAudioGainLiveItemIds = useMemo(
    () => [...(audioGainLiveItemIds ?? []), item.id],
    [audioGainLiveItemIds, item.id],
  );
  const previousMaskInfosRef = React.useRef<MaskInfo[]>(EMPTY_MASK_INFOS);

  React.useEffect(() => {
    if (renderMode !== 'audio-only') return;
    clearMixerLiveGain(item.id);
  }, [audioGainMultiplier, item.id, renderMode]);

  // Resolve active sub-comp masks for the current local frame.
  // This allows masks authored inside a pre-comp to clip items when viewed
  // from the parent timeline.
  const activeMaskInfos = useMemo<MaskInfo[]>(() => {
    if (!subComp) {
      previousMaskInfosRef.current = EMPTY_MASK_INFOS;
      return EMPTY_MASK_INFOS;
    }
    const canvas = { width: subComp.width, height: subComp.height, fps: subComp.fps };
    const keyframesById = new Map((subComp.keyframes ?? []).map((kf) => [kf.itemId, kf]));
    const activeMasks = (trackRenderState?.visibleTracks ?? []).flatMap((track) => (
      resolvedItems
        .filter((subItem): subItem is ShapeItem => (
          subItem.trackId === track.id
          && subItem.type === 'shape'
          && subItem.isMask === true
        ))
        .map((mask) => ({
          mask,
          trackOrder: track.order ?? 0,
        }))
    ));

    const nextMaskInfos = materializeMaskInfos(resolveActiveShapeMasksAtFrame(
      activeMasks,
      {
        canvas,
        frame: subCompFrame,
        getKeyframes: (itemId) => keyframesById.get(itemId),
      }
    ));
    const stableMaskInfos = reuseStableMaskInfos(previousMaskInfosRef.current, nextMaskInfos);
    previousMaskInfosRef.current = stableMaskInfos;
    return stableMaskInfos;
  }, [resolvedItems, trackRenderState?.visibleTracks, subComp?.width, subComp?.height, subComp?.fps, subComp?.keyframes, subCompFrame]);

  if (!subComp) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: '#2a1a2a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <p style={{ color: '#a855f7', fontSize: 14 }}>Composition not found</p>
      </AbsoluteFill>
    );
  }

  // CSS scale from sub-comp native resolution to parent container dimensions
  const scaleX = subComp.width > 0 ? containerDims.width / subComp.width : 1;
  const scaleY = subComp.height > 0 ? containerDims.height / subComp.height : 1;
  const renderVideoItem = useCallback((videoItem: StableVideoSequenceItem) => (
    <AbsoluteFill
      style={{
        zIndex: videoItem.zIndex,
        visibility: videoItem.trackVisible ? 'visible' : 'hidden',
      }}
    >
        <Item
          item={videoItem}
          muted={videoItem.muted}
          visible={videoItem.trackVisible}
          masks={getMasksForTrackOrder(activeMaskInfos, videoItem.trackOrder)}
          renderDepth={renderDepth}
          audioGainMultiplier={effectiveAudioGainMultiplier}
          audioGainLiveItemIds={effectiveAudioGainLiveItemIds}
          audioEqStages={trackMergedEqStages.get(videoItem.trackId) ?? audioEqStages}
          audioPitchShiftSemitones={audioPitchShiftSemitones}
        />
    </AbsoluteFill>
  ), [
    activeMaskInfos,
    trackMergedEqStages,
    audioEqStages,
    audioPitchShiftSemitones,
    effectiveAudioGainLiveItemIds,
    effectiveAudioGainMultiplier,
    renderDepth,
  ]);

  return (
    <div style={{
      width: subComp.width,
      height: subComp.height,
      transform: `scale(${scaleX}, ${scaleY})`,
      transformOrigin: '0 0',
      overflow: 'hidden',
      position: 'relative',
      visibility: parentVisible ? 'visible' : 'hidden',
    }}>
      <CompositionSpaceProvider
        projectWidth={subComp.width}
        projectHeight={subComp.height}
        renderWidth={subComp.width}
        renderHeight={subComp.height}
      >
        <VideoConfigProvider
          width={subComp.width}
          height={subComp.height}
          fps={subComp.fps}
          durationInFrames={subComp.durationInFrames}
        >
          <KeyframesProvider keyframes={subComp.keyframes}>
            <AbsoluteFill>
              <StableVideoSequence
                items={videoItems}
                renderItem={renderVideoItem}
                premountFor={Math.round(subComp.fps)}
              />

              {nonVideoTrackItems.map((track) => (
                <AbsoluteFill
                  key={track.trackId}
                  style={{
                    zIndex: (maxTrackOrder - track.trackOrder) * 1000 + 100,
                    visibility: track.trackVisible ? 'visible' : 'hidden',
                  }}
                >
                  {track.items.map((subItem) => (
                    <Sequence
                      key={subItem.id}
                      from={subItem.from}
                      durationInFrames={subItem.durationInFrames}
                    >
                      <Item
                        item={subItem}
                        muted={track.muted || linkedVideoIdsWithOwnedAudio.has(subItem.id)}
                        visible={track.trackVisible}
                        masks={getMasksForTrackOrder(activeMaskInfos, track.trackOrder)}
                        renderDepth={renderDepth}
                        compositionRenderMode={subItem.type === 'composition' && hasLinkedAudioCompanion(resolvedItems, subItem) ? 'visual-only' : 'full'}
                        audioGainMultiplier={effectiveAudioGainMultiplier}
                        audioGainLiveItemIds={effectiveAudioGainLiveItemIds}
                        audioEqStages={trackMergedEqStages.get(track.trackId) ?? audioEqStages}
                        audioPitchShiftSemitones={audioPitchShiftSemitones}
                      />
                    </Sequence>
                  ))}
                </AbsoluteFill>
              ))}
            </AbsoluteFill>
          </KeyframesProvider>
        </VideoConfigProvider>
      </CompositionSpaceProvider>
    </div>
  );
});
