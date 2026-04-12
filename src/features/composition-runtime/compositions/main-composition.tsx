import React, { useEffect, useMemo, useCallback } from 'react';
import { AbsoluteFill, Sequence, useClock } from '@/features/composition-runtime/deps/player';
import { timelineToSourceFrames } from '@/features/composition-runtime/deps/timeline';
import { useCurrentFrame, useVideoConfig } from '../hooks/use-player-compat';
import type { CompositionInputProps } from '@/types/export';
import type { TimelineItem } from '@/types/timeline';
import { Item, type MaskInfo } from '../components/item';
import { CompositionContent } from '../components/composition-content';
import { PitchCorrectedAudio } from '../components/pitch-corrected-audio';
import { CustomDecoderAudio } from '../components/custom-decoder-audio';
import { getSharedPreviewAudioContext } from '../utils/preview-audio-graph';
import { useMediaLibraryStore } from '@/features/composition-runtime/deps/stores';
import { needsCustomAudioDecoder } from '../utils/audio-codec-detection';
import { StableVideoSequence, type StableVideoSequenceItem } from '../components/stable-video-sequence';
import { loadFonts } from '../utils/fonts';
import { useGizmoStore } from '@/features/composition-runtime/deps/stores';
import { ItemEffectWrapper, type AdjustmentLayerWithTrackOrder } from '../components/item-effect-wrapper';
import { KeyframesProvider } from '../contexts/keyframes-context';
import { CompositionSpaceProvider } from '../contexts/composition-space-context';
import { NestedMediaResolutionProvider } from '../contexts/nested-media-resolution-context';
import {
  buildCompoundAudioTransitionSegments,
  buildStandaloneAudioSegments,
  buildTransitionVideoAudioSegments,
  type AudioSegment,
  type CompoundAudioSegment,
  type VideoAudioSegment,
} from '../utils/audio-scene';
import {
  resolveCompositionRenderPlan,
  type AudioTrackItem,
  type ShapeMaskWithTrackOrder,
} from '../utils/scene-assembly';
import { resolveActiveShapeMasksAtFrame } from '../utils/frame-scene';
import { KeyframesContext } from '../contexts/keyframes-context-core';
import {
  EMPTY_MASK_INFOS,
  getMasksForTrackOrder,
  materializeMaskInfos,
  reuseStableMaskInfos,
} from '../utils/mask-info';
import {
  getManagedLinkedAudioTransitions,
  hasLinkedAudioCompanion,
  isCompositionAudioItem,
} from '@/shared/utils/linked-media';
import { appendResolvedAudioEqStage, getAudioEqSettings } from '@/shared/utils/audio-eq';

const TRANSITION_AUDIO_PREMOUNT_SECONDS = 0.5;
const STANDALONE_AUDIO_PREMOUNT_SECONDS = 2;

const ActiveMasksContext = React.createContext<MaskInfo[]>(EMPTY_MASK_INFOS);

const FrameActiveMasksProvider: React.FC<{
  masks: ShapeMaskWithTrackOrder[];
  canvasWidth: number;
  canvasHeight: number;
  children: React.ReactNode;
}> = ({ masks, canvasWidth, canvasHeight, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const keyframesCtx = React.useContext(KeyframesContext);
  const previousMasksRef = React.useRef<MaskInfo[]>(EMPTY_MASK_INFOS);

  const activeMasks = useMemo<MaskInfo[]>(() => {
    if (masks.length === 0) {
      previousMasksRef.current = EMPTY_MASK_INFOS;
      return EMPTY_MASK_INFOS;
    }

    const nextMasks = materializeMaskInfos(resolveActiveShapeMasksAtFrame(masks, {
      canvas: { width: canvasWidth, height: canvasHeight, fps },
      frame,
      getKeyframes: keyframesCtx?.getItemKeyframes,
    }));
    const stableMasks = reuseStableMaskInfos(previousMasksRef.current, nextMasks);
    previousMasksRef.current = stableMasks;
    return stableMasks;
  }, [masks, canvasWidth, canvasHeight, fps, frame, keyframesCtx]);

  return (
    <ActiveMasksContext.Provider value={activeMasks}>
      {children}
    </ActiveMasksContext.Provider>
  );
};

/**
 * Enriched audio item with track rendering metadata (parallel to EnrichedVideoItem)
 */
type EnrichedAudioItem = AudioTrackItem;

// ClearingLayer removed - was causing flicker at clip boundaries
// Background layer at z-index -1 is sufficient for showing background color

/** Item wrapper that resolves shape masks per-frame inside a <Sequence> */
const MaskedItem: React.FC<{
  item: TimelineItem;
  muted: boolean;
  visible?: boolean;
  itemTrackOrder: number;
  compositionRenderMode?: 'full' | 'visual-only' | 'audio-only';
}> = ({ item, muted, visible = true, itemTrackOrder, compositionRenderMode = 'full' }) => {
  const masks = React.useContext(ActiveMasksContext);
  return <Item item={item} muted={muted} visible={visible} masks={getMasksForTrackOrder(masks, itemTrackOrder)} compositionRenderMode={compositionRenderMode} />;
};


/**
 * Main Composition Composition
 *
 * ARCHITECTURE FOR STABLE DOM (prevents re-renders on item/adjustment layer add/delete):
 *
 * MASKING:
 * 1. ALL content rendered through single StableMaskedGroup wrapper
 * 2. MaskDefinitions: SVG mask defs with OPACITY-CONTROLLED activation
 * 3. Mask effect toggled via SVG internal opacity, not DOM structure changes
 * 4. Deleting/adding masks doesn't move items between DOM parents â†’ no remount
 *
 * ADJUSTMENT LAYER EFFECTS:
 * 1. ALL effects (CSS filter, glitch, halftone) applied PER-ITEM via ItemEffectWrapper
 * 2. Each item checks if it should have effects based on track order
 * 3. Only items BELOW adjustment layer (higher track order) receive effects
 * 4. Adding/removing adjustment layers doesn't change DOM structure
 */
type MainCompositionProps = CompositionInputProps & {
  useProxyMedia?: boolean;
};

export const MainComposition: React.FC<MainCompositionProps> = ({
  tracks,
  transitions = [],
  backgroundColor = '#000000',
  keyframes,
  width: compositionWidth,
  height: compositionHeight,
  useProxyMedia = false,
}) => {
  const { fps, width: renderWidth, height: renderHeight } = useVideoConfig();

  // Wire AudioContext as the Clock's timing ground truth.
  // When running, the Clock derives time from the hardware audio clock
  // instead of performance.now(), eliminating audio-video drift.
  const clock = useClock();
  useEffect(() => {
    const ctx = getSharedPreviewAudioContext();
    clock.setAudioContext(ctx);
    return () => clock.setAudioContext(null);
  }, [clock]);

  const projectWidth = compositionWidth ?? renderWidth;
  const projectHeight = compositionHeight ?? renderHeight;
  const canvasWidth = renderWidth;
  const canvasHeight = renderHeight;
  // NOTE: useCurrentFrame() removed from here to prevent per-frame re-renders.
  // Frame-dependent logic is now isolated in FrameAwareMaskDefinitions and ClearingLayer.

  // Read preview color directly from store to avoid inputProps changes during color picker drag
  // This prevents Player from seeking/refreshing when user scrubs the color picker
  const canvasBackgroundPreview = useGizmoStore((s) => s.canvasBackgroundPreview);
  const effectiveBackgroundColor = canvasBackgroundPreview ?? backgroundColor;

  const renderPlan = useMemo(
    () => resolveCompositionRenderPlan({ tracks, transitions }),
    [tracks, transitions],
  );
  const { trackRenderState } = renderPlan;
  const { maxOrder } = trackRenderState;

  const videoItems: StableVideoSequenceItem[] = renderPlan.videoItems;

  // Audio items are memoized separately and rendered outside mask groups
  // This prevents audio from being affected by visual layer changes (mask add/delete, item moves)
  // Use ALL tracks for stable DOM structure, with trackVisible for conditional playback
  const audioItems: EnrichedAudioItem[] = renderPlan.audioItems;
  const compoundAudioItems = useMemo(
    () => audioItems.filter((item): item is EnrichedAudioItem & { compositionId: string } => isCompositionAudioItem(item)),
    [audioItems],
  );
  const directSourceAudioItems = useMemo(
    () => audioItems.filter((item) => !isCompositionAudioItem(item)),
    [audioItems],
  );

  const managedLinkedAudioTransitions = useMemo(
    () => getManagedLinkedAudioTransitions(tracks.flatMap((track) => track.items), transitions),
    [tracks, transitions],
  );
  const managedLinkedAudioIds = useMemo(() => {
    const ids = new Set<string>();
    for (const managed of managedLinkedAudioTransitions) {
      ids.add(managed.leftAudio.id);
      ids.add(managed.rightAudio.id);
    }
    return ids;
  }, [managedLinkedAudioTransitions]);
  const managedLinkedAudioItems = useMemo(
    () => directSourceAudioItems.filter((item) => managedLinkedAudioIds.has(item.id)),
    [directSourceAudioItems, managedLinkedAudioIds],
  );
  const standaloneAudioItems = useMemo(
    () => directSourceAudioItems.filter((item) => !managedLinkedAudioIds.has(item.id)),
    [directSourceAudioItems, managedLinkedAudioIds],
  );
  const managedCompoundAudioItems = useMemo(
    () => compoundAudioItems.filter((item) => managedLinkedAudioIds.has(item.id)),
    [compoundAudioItems, managedLinkedAudioIds],
  );
  const standaloneCompoundAudioItems = useMemo(
    () => compoundAudioItems.filter((item) => !managedLinkedAudioIds.has(item.id)),
    [compoundAudioItems, managedLinkedAudioIds],
  );
  const managedLinkedAudioItemsById = useMemo(
    () => new Map(managedLinkedAudioItems.map((item) => [item.id, item])),
    [managedLinkedAudioItems],
  );
  const managedLinkedAudioTransitionDefs = useMemo(
    () => managedLinkedAudioTransitions.flatMap(({ transition, leftAudio, rightAudio }) => {
      const left = managedLinkedAudioItemsById.get(leftAudio.id);
      const right = managedLinkedAudioItemsById.get(rightAudio.id);
      if (!left || !right) return [];

      return [{
        ...transition,
        leftClipId: left.id,
        rightClipId: right.id,
        trackId: left.trackId,
      }];
    }),
    [managedLinkedAudioItemsById, managedLinkedAudioTransitions],
  );
  const managedCompoundAudioItemsById = useMemo(
    () => new Map(managedCompoundAudioItems.map((item) => [item.id, item])),
    [managedCompoundAudioItems],
  );
  const managedCompoundAudioTransitionDefs = useMemo(
    () => managedLinkedAudioTransitions.flatMap(({ transition, leftAudio, rightAudio }) => {
      const left = managedCompoundAudioItemsById.get(leftAudio.id);
      const right = managedCompoundAudioItemsById.get(rightAudio.id);
      if (!left || !right) return [];

      return [{
        ...transition,
        leftClipId: left.id,
        rightClipId: right.id,
        trackId: left.trackId,
      }];
    }),
    [managedCompoundAudioItemsById, managedLinkedAudioTransitions],
  );

  // Merge continuous split audio clips into single segments to prevent
  // audio element remount (click/gap) at split boundaries.
  // Mirrors the videoAudioSegments merging pattern.
  const audioSegments = useMemo(
    () => buildStandaloneAudioSegments(standaloneAudioItems, fps),
    [standaloneAudioItems, fps]
  );

  // Video audio is rendered in a dedicated audio layer to decouple audio
  // from transition visual overlays and pooled video element state.
  const videoAudioItems = useMemo(
    () => renderPlan.videoItems.filter((item) => !item.embeddedAudioMuted && !hasLinkedAudioCompanion(audioItems, item)),
    [audioItems, renderPlan.videoItems]
  );

  // Build explicit audio playback segments for transition overlaps:
  // - One continuous segment per clip (decoupled from visual transitions)
  // - Segments are expanded into transition handles so both clips overlap chronologically
  const videoAudioSegments = useMemo(
    () => buildTransitionVideoAudioSegments(videoAudioItems, transitions, fps),
    [videoAudioItems, transitions, fps]
  );
  const linkedAudioTransitionSegments = useMemo(
    () => buildTransitionVideoAudioSegments(managedLinkedAudioItems, managedLinkedAudioTransitionDefs, fps),
    [managedLinkedAudioItems, managedLinkedAudioTransitionDefs, fps],
  );
  const managedCompoundAudioSegments = useMemo<CompoundAudioSegment[]>(
    () => buildCompoundAudioTransitionSegments(managedCompoundAudioItems, managedCompoundAudioTransitionDefs, fps),
    [fps, managedCompoundAudioItems, managedCompoundAudioTransitionDefs],
  );
  const transitionAudioSegments = useMemo(
    () => [...videoAudioSegments, ...linkedAudioTransitionSegments],
    [videoAudioSegments, linkedAudioTransitionSegments],
  );

  // Look up which video audio segments need custom decoding (AC-3/E-AC-3)
  const mediaItems = useMediaLibraryStore((s) => s.mediaItems);
  const mediaById = useMemo(() => {
    const map = new Map<string, (typeof mediaItems)[number]>();
    for (const media of mediaItems) {
      map.set(media.id, media);
    }
    return map;
  }, [mediaItems]);

  const shouldUseCustomDecoder = useCallback((segment: VideoAudioSegment | AudioSegment): boolean => {
    if (!segment.mediaId) {
      // Legacy clips without media linkage: safest fallback is custom decode.
      return true;
    }

    const media = mediaById.get(segment.mediaId);
    if (!media) {
      // Orphaned media metadata; native audio path can be silent for AC-3/E-AC-3.
      return true;
    }

    // Video assets usually expose audio codec in media.audioCodec.
    // Audio-only assets persist their codec in media.codec.
    return needsCustomAudioDecoder(media.audioCodec ?? media.codec);
  }, [mediaById]);

  // Collect adjustment layers from VISIBLE tracks (for effect application)
  // Effects from hidden tracks should not be applied
  const visibleAdjustmentLayers = renderPlan.visibleAdjustmentLayers as AdjustmentLayerWithTrackOrder[];

  // Use ALL tracks for stable DOM structure, with visibility flag for CSS-based hiding
  const nonMediaByTrack = renderPlan.stableDomTracks;
  const visibleShapeMasks = useMemo(
    () => renderPlan.visibleShapeMasks,
    [renderPlan.visibleShapeMasks]
  );

  // NOTE: DOM structure is now fully stable regardless of adjustment layer changes.
  // Previously, items would split between above/below adjustment groups â†’ remounts.
  // Now ALL items stay in the same DOM location with per-item effect application
  // via ItemEffectWrapper. This prevents remounts when adjustment layers are added/removed.

  React.useEffect(() => {
    const fontFamilies = renderPlan.visibleTextFontFamilies;
    if (fontFamilies.length > 0) loadFonts(fontFamilies);
  }, [renderPlan.visibleTextFontFamilies]);


  // Stable render function for video items - prevents re-renders on every frame
  // useCallback ensures the function reference stays stable between renders
  // Uses CSS visibility for hidden tracks to avoid DOM changes
  // Now uses ItemEffectWrapper for per-item adjustment effects (no DOM restructuring)
  const renderVideoItem = useCallback((item: StableVideoSequenceItem) => {
    // Calculate the parent Sequence's `from` value for local-to-global frame conversion
    // For shared Sequences (split clips), _sequenceFrameOffset is the offset from group.minFrom to item.from
    // sequenceFrom = item.from - offset = group.minFrom
    const sequenceFrom = item.from - (item._sequenceFrameOffset ?? 0);
    return (
      <AbsoluteFill
        style={{
          zIndex: item.zIndex,
          // Use visibility: hidden for invisible tracks - keeps DOM stable, no re-render
          visibility: item.trackVisible ? 'visible' : 'hidden',
          // GPU layer hints to prevent compositing flicker during transitions
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
        }}
      >
        <ItemEffectWrapper
          itemTrackOrder={item.trackOrder}
          adjustmentLayers={visibleAdjustmentLayers}
          sequenceFrom={sequenceFrom}
        >
          <MaskedItem item={item} muted={true} itemTrackOrder={item.trackOrder} />
        </ItemEffectWrapper>
      </AbsoluteFill>
    );
  }, [visibleAdjustmentLayers]);

  return (
    <NestedMediaResolutionProvider value={useProxyMedia ? 'proxy' : 'source'}>
      <KeyframesProvider keyframes={keyframes}>
        <CompositionSpaceProvider
          projectWidth={projectWidth}
          projectHeight={projectHeight}
          renderWidth={renderWidth}
          renderHeight={renderHeight}
        >
          <AbsoluteFill>
          {/* SVG MASK DEFINITIONS - kept for backward compat with feather/invert that need SVG mask */}
          {/* Shape mask animation is now handled per-item via ActiveMasksProvider + MaskedItem */}

          {/* BACKGROUND LAYER */}
          <AbsoluteFill style={{ backgroundColor: effectiveBackgroundColor, zIndex: -1 }} />

          {/* AUDIO LAYER - rendered outside visual layers to prevent re-renders from mask/visual changes */}
          {/* Video audio is decoupled from visual video elements for transition stability */}
          {/* Custom-decoded segments (AC-3/E-AC-3, Vorbis, PCM endian variants) use mediabunny instead of native <audio>. */}
          {transitionAudioSegments.map((segment) => {
            const useCustomDecoder = shouldUseCustomDecoder(segment);
            const decodeMediaId = segment.mediaId ?? `legacy-src:${segment.src}`;
            return (
              <Sequence
                key={segment.key}
                from={segment.from}
                durationInFrames={segment.durationInFrames}
                premountFor={Math.round(fps * TRANSITION_AUDIO_PREMOUNT_SECONDS)}
              >
                {useCustomDecoder ? (
                  <CustomDecoderAudio
                    src={segment.src}
                    mediaId={decodeMediaId}
                    itemId={segment.itemId}
                    trimBefore={segment.trimBefore}
                    sourceFps={segment.sourceFps}
                    volume={segment.volumeDb}
                    playbackRate={segment.playbackRate}
                    muted={segment.muted}
                    durationInFrames={segment.durationInFrames}
                    audioFadeIn={segment.audioFadeIn}
                    audioFadeOut={segment.audioFadeOut}
                     audioFadeInCurve={segment.audioFadeInCurve}
                     audioFadeOutCurve={segment.audioFadeOutCurve}
                     audioFadeInCurveX={segment.audioFadeInCurveX}
                     audioFadeOutCurveX={segment.audioFadeOutCurveX}
                     audioEqStages={segment.audioEqStages}
                     clipFadeSpans={segment.clipFadeSpans}
                     contentStartOffsetFrames={segment.contentStartOffsetFrames}
                     contentEndOffsetFrames={segment.contentEndOffsetFrames}
                     fadeInDelayFrames={segment.fadeInDelayFrames}
                     fadeOutLeadFrames={segment.fadeOutLeadFrames}
                     crossfadeFadeIn={segment.crossfadeFadeIn}
                     crossfadeFadeOut={segment.crossfadeFadeOut}
                  />
                ) : (
                  <PitchCorrectedAudio
                    src={segment.src}
                    mediaId={decodeMediaId}
                    itemId={segment.itemId}
                    trimBefore={segment.trimBefore}
                    sourceFps={segment.sourceFps}
                    volume={segment.volumeDb}
                    playbackRate={segment.playbackRate}
                    muted={segment.muted}
                    durationInFrames={segment.durationInFrames}
                    audioFadeIn={segment.audioFadeIn}
                    audioFadeOut={segment.audioFadeOut}
                     audioFadeInCurve={segment.audioFadeInCurve}
                     audioFadeOutCurve={segment.audioFadeOutCurve}
                     audioFadeInCurveX={segment.audioFadeInCurveX}
                     audioFadeOutCurveX={segment.audioFadeOutCurveX}
                     audioEqStages={segment.audioEqStages}
                     clipFadeSpans={segment.clipFadeSpans}
                     contentStartOffsetFrames={segment.contentStartOffsetFrames}
                     contentEndOffsetFrames={segment.contentEndOffsetFrames}
                     fadeInDelayFrames={segment.fadeInDelayFrames}
                     fadeOutLeadFrames={segment.fadeOutLeadFrames}
                     crossfadeFadeIn={segment.crossfadeFadeIn}
                     crossfadeFadeOut={segment.crossfadeFadeOut}
                  />
                )}
              </Sequence>
            );
          })}

          {/* Standalone audio items - merged across split boundaries for stable playback */}
          {audioSegments.map((segment) => {
            const useCustomDecoder = shouldUseCustomDecoder(segment);
            const decodeMediaId = segment.mediaId ?? `legacy-src:${segment.src}`;
            return (
              <Sequence
                key={segment.key}
                from={segment.from}
                durationInFrames={segment.durationInFrames}
                premountFor={Math.round(fps * STANDALONE_AUDIO_PREMOUNT_SECONDS)}
              >
                {useCustomDecoder ? (
                  <CustomDecoderAudio
                    src={segment.src}
                    mediaId={decodeMediaId}
                    itemId={segment.itemId}
                    trimBefore={segment.trimBefore}
                    sourceFps={segment.sourceFps}
                    volume={segment.volumeDb}
                    playbackRate={segment.playbackRate}
                    muted={segment.muted}
                    durationInFrames={segment.durationInFrames}
                    audioFadeIn={segment.audioFadeIn}
                    audioFadeOut={segment.audioFadeOut}
                    audioFadeInCurve={segment.audioFadeInCurve}
                    audioFadeOutCurve={segment.audioFadeOutCurve}
                    audioFadeInCurveX={segment.audioFadeInCurveX}
                    audioFadeOutCurveX={segment.audioFadeOutCurveX}
                    audioEqStages={segment.audioEqStages}
                    clipFadeSpans={segment.clipFadeSpans}
                  />
                ) : (
                  <PitchCorrectedAudio
                    src={segment.src}
                    mediaId={decodeMediaId}
                    itemId={segment.itemId}
                    trimBefore={segment.trimBefore}
                    sourceFps={segment.sourceFps}
                    volume={segment.volumeDb}
                    playbackRate={segment.playbackRate}
                    muted={segment.muted}
                    durationInFrames={segment.durationInFrames}
                    audioFadeIn={segment.audioFadeIn}
                    audioFadeOut={segment.audioFadeOut}
                    audioFadeInCurve={segment.audioFadeInCurve}
                    audioFadeOutCurve={segment.audioFadeOutCurve}
                    audioFadeInCurveX={segment.audioFadeInCurveX}
                    audioFadeOutCurveX={segment.audioFadeOutCurveX}
                    audioEqStages={segment.audioEqStages}
                    clipFadeSpans={segment.clipFadeSpans}
                  />
                )}
              </Sequence>
            );
          })}

          {managedCompoundAudioSegments.map((segment) => {
            const compoundItem = managedCompoundAudioItemsById.get(segment.itemId);
            if (!compoundItem) return null;

            const segmentItem = {
              ...compoundItem,
              from: segment.from,
              durationInFrames: segment.durationInFrames,
              sourceStart: segment.trimBefore,
              sourceEnd: segment.trimBefore + timelineToSourceFrames(
                segment.durationInFrames,
                segment.playbackRate ?? 1,
                fps,
                segment.sourceFps ?? fps,
              ),
              speed: segment.playbackRate,
            };

            return (
              <Sequence
                key={segment.key}
                from={segment.from}
                durationInFrames={segment.durationInFrames}
                premountFor={Math.round(fps * TRANSITION_AUDIO_PREMOUNT_SECONDS)}
              >
                <CompositionContent
                  item={segmentItem}
                  parentMuted={segment.muted}
                  renderMode="audio-only"
                  audioGainMultiplier={Math.pow(10, segment.volumeDb / 20)}
                  audioEqStages={appendResolvedAudioEqStage(undefined, getAudioEqSettings(compoundItem))}
                  crossfadeFadeInFrames={segment.crossfadeFadeIn}
                  crossfadeFadeOutFrames={segment.crossfadeFadeOut}
                />
              </Sequence>
            );
          })}

          {standaloneCompoundAudioItems.map((item) => (
            <Sequence
              key={`compound-audio-${item.id}`}
              from={item.from}
              durationInFrames={item.durationInFrames}
              premountFor={Math.round(fps * STANDALONE_AUDIO_PREMOUNT_SECONDS)}
            >
              <CompositionContent
                item={item}
                parentMuted={item.muted || !item.trackVisible}
                renderMode="audio-only"
                audioGainMultiplier={Math.pow(10, ((item.volume ?? 0) + (item.trackVolumeDb ?? 0)) / 20)}
                audioEqStages={appendResolvedAudioEqStage(undefined, getAudioEqSettings(item))}
              />
            </Sequence>
          ))}

          {/* ALL VISUAL LAYERS - videos and non-media in SINGLE wrapper for proper z-index stacking */}
          {/* This ensures items from different tracks respect z-index across all types */}
          <FrameActiveMasksProvider
            masks={visibleShapeMasks}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
          >
            <AbsoluteFill>
              {/* VIDEO LAYER - all videos rendered via StableVideoSequence */}
              {/* ALL effects (CSS, glitch, halftone) applied per-item via ItemEffectWrapper */}
              <StableVideoSequence
                items={videoItems}
                transitionWindows={renderPlan.transitionWindows}
                premountFor={Math.round(fps * 1)}
                renderItem={renderVideoItem}
              />

              {/* NON-MEDIA LAYERS - text, shapes, etc. with per-item effects via ItemEffectWrapper */}
              {/* No more above/below split - items never move between DOM parents */}
              {nonMediaByTrack
                .filter((track) => track.items.length > 0)
                .map((track) => {
                  const trackOrder = track.order ?? 0;
                  return (
                    <AbsoluteFill
                      key={track.id}
                      style={{
                        // Non-media z-index: base + 100 (videos use base, transitions use base + 200)
                        zIndex: (maxOrder - trackOrder) * 1000 + 100,
                        visibility: track.trackVisible ? 'visible' : 'hidden',
                      }}
                    >
                      {track.items.map((item) => (
                        <Sequence key={item.id} from={item.from} durationInFrames={item.durationInFrames}>
                          <ItemEffectWrapper
                            itemTrackOrder={trackOrder}
                            adjustmentLayers={visibleAdjustmentLayers}
                            sequenceFrom={item.from}
                          >
                            <MaskedItem
                              item={item}
                              muted={track.muted || !track.trackVisible || (item.type === 'composition' && hasLinkedAudioCompanion(audioItems, item))}
                              visible={track.trackVisible}
                              itemTrackOrder={trackOrder}
                              compositionRenderMode={item.type === 'composition' && hasLinkedAudioCompanion(audioItems, item) ? 'visual-only' : 'full'}
                            />
                          </ItemEffectWrapper>
                        </Sequence>
                      ))}
                    </AbsoluteFill>
                  );
                })}
            </AbsoluteFill>
          </FrameActiveMasksProvider>
          </AbsoluteFill>
        </CompositionSpaceProvider>
      </KeyframesProvider>
    </NestedMediaResolutionProvider>
  );
};
