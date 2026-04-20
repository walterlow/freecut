import React from 'react';
import { AbsoluteFill } from '@/features/composition-runtime/deps/player';
import { useDebugStore } from '@/features/composition-runtime/deps/stores';
import type { AudioItem, TimelineItem, ShapeItem } from '@/types/timeline';
import type { ResolvedAudioEqSettings } from '@/types/audio';
import type { TransformProperties } from '@/types/transform';
import { DebugOverlay } from './debug-overlay';
import { CustomDecoderAudio } from './custom-decoder-audio';
import { PitchCorrectedAudio } from './pitch-corrected-audio';
import { GifPlayer } from './gif-player';
import { ItemVisualWrapper } from './item-visual-wrapper';
import { TextContent } from './text-content';
import { ShapeContent } from './shape-content';
import { VideoContent } from './video-content';
import { CompositionContent } from './composition-content';
import { useVideoConfig } from '../hooks/use-player-compat';
import { getSourceDimensions } from '../utils/transform-resolver';
import {
  timelineToSourceFrames,
  sourceToTimelineFrames,
  isValidSeekPosition,
  isWithinSourceBounds,
  getSafeTrimBefore,
  DEFAULT_SPEED,
} from '@/features/composition-runtime/deps/timeline';
import { isGifUrl, isWebpUrl } from '@/shared/utils/media-utils';
import { useMediaLibraryStore } from '@/features/composition-runtime/deps/stores';
import { createLogger } from '@/shared/logging/logger';
import { appendResolvedAudioEqStage, getAudioEqSettings } from '@/shared/utils/audio-eq';
import { getAudioPitchShiftSemitones, isAudioPitchShiftActive } from '@/shared/utils/audio-pitch';
import { needsCustomAudioDecoder } from '../utils/audio-codec-detection';

function getLogger() { return createLogger('CompositionItem'); }

/** Mask information passed from composition to items */
export interface MaskInfo {
  shape: ShapeItem;
  transform: TransformProperties;
  trackOrder: number;
}

/** Safety guard against corrupted circular composition graphs. */
const MAX_RENDER_DEPTH = 16;

interface ItemProps {
  item: TimelineItem;
  muted?: boolean;
  visible?: boolean;
  /** Active masks that should clip this item's content */
  masks?: MaskInfo[];
  /** Current composition nesting depth (prevents infinite recursion) */
  renderDepth?: number;
  compositionRenderMode?: 'full' | 'visual-only' | 'audio-only';
  audioGainMultiplier?: number;
  audioGainLiveItemIds?: string[];
  audioEqStages?: ResolvedAudioEqSettings[];
  audioPitchShiftSemitones?: number;
}

/**
 * Composition Item Component
 *
 * Renders different item types following Composition best practices:
 * - Video: OffthreadVideo for preview (resilient to UI), @legacy-video/media Video for rendering
 * - Audio: Uses Audio component with trim support
 * - Image: Uses img tag
 * - Text: Renders text with styling
 * - Shape: Renders solid colors or shapes
 * - Respects mute state for audio/video items (reads directly from store for reactivity)
 * - Supports trimStart/trimEnd for media trimming (uses trimStart as trimBefore)
 *
 * Memoized to prevent unnecessary re-renders when parent (MainComposition) updates.
 */
export const Item = React.memo<ItemProps>(({ item, muted = false, visible = true, masks = [], renderDepth = 0, compositionRenderMode = 'full', audioGainMultiplier = 1, audioGainLiveItemIds, audioEqStages, audioPitchShiftSemitones = 0 }) => {
  // Use muted prop directly - MainComposition already passes track.muted
  // Avoiding store subscription here prevents re-render issues with @legacy-video/media Audio

  // Debug overlay toggle (always false in production via store)
  const showDebugOverlay = useDebugStore((s) => s.showVideoDebugOverlay);
  const { fps: timelineFps } = useVideoConfig();
  const mediaItem = useMediaLibraryStore((s) =>
    item.mediaId ? s.mediaItems.find((media) => media.id === item.mediaId) : undefined
  );
  const mediaSourceFps = mediaItem?.fps;
  const itemAudioEqStages = React.useMemo(
    () => appendResolvedAudioEqStage(audioEqStages, getAudioEqSettings(item)),
    [audioEqStages, item],
  );
  const itemLocalPitchShiftSemitones = React.useMemo(
    () => getAudioPitchShiftSemitones(item),
    [item],
  );

  if (item.type === 'video') {
    const mediaSource = getSourceDimensions(item);
    // Guard against missing src (media resolution failed)
    if (!item.src) {
      return (
        <AbsoluteFill style={{ backgroundColor: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: '#666', fontSize: 14 }}>Media not loaded</p>
        </AbsoluteFill>
      );
    }
    // Use sourceStart for trimBefore (absolute position in source)
    // Fall back to trimStart or offset for backward compatibility
    const trimBefore = item.sourceStart ?? item.trimStart ?? item.offset ?? 0;
    const sourceFps = item.sourceFps ?? mediaSourceFps ?? timelineFps;
    // Get playback rate from speed property (default 1x)
    const playbackRate = item.speed ?? DEFAULT_SPEED;

    // Calculate source frames needed for playback using shared utility
    const sourceFramesNeeded = timelineToSourceFrames(item.durationInFrames, playbackRate, timelineFps, sourceFps);
    const sourceEndPosition = trimBefore + sourceFramesNeeded;
    const sourceDuration = item.sourceDuration || 0;

    // Calculate the effective source segment this clip represents
    // This is more accurate than sourceDuration for rate-stretched clips
    // sourceEnd - sourceStart defines the actual source frames used
    const effectiveSourceSegment = item.sourceEnd !== undefined && item.sourceStart !== undefined
      ? item.sourceEnd - item.sourceStart
      : sourceDuration;

    // Only validate if we have valid source duration info
    const hasValidSourceDuration = sourceDuration > 0 || effectiveSourceSegment > 0;

    // Validate using shared utilities - skip if no valid duration info
    const isInvalidSeek = hasValidSourceDuration && !isValidSeekPosition(trimBefore, sourceDuration || undefined);
    const exceedsSource = hasValidSourceDuration && !isWithinSourceBounds(
      trimBefore,
      item.durationInFrames,
      playbackRate,
      sourceDuration || undefined,
      2,
      timelineFps,
      sourceFps
    );

    // Safety check: if sourceStart is unreasonably high (>1 hour) and no sourceDuration is set,
    // this indicates corrupted metadata from split/trim operations
    const MAX_REASONABLE_FRAMES = 30 * 60 * 60; // 1 hour at 30fps
    const hasCorruptedMetadata = sourceDuration === 0 && effectiveSourceSegment === 0 && trimBefore > MAX_REASONABLE_FRAMES;

    if (hasCorruptedMetadata || isInvalidSeek) {
      getLogger().error('Invalid source position detected:', {
        itemId: item.id,
        sourceStart: item.sourceStart,
        trimBefore,
        sourceDuration,
        effectiveSourceSegment,
        hasCorruptedMetadata,
        isInvalidSeek,
      });
      return (
        <AbsoluteFill style={{ backgroundColor: '#2a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: '#ff6b6b', fontSize: 14 }}>Invalid source position</p>
        </AbsoluteFill>
      );
    }

    // Clamp trimBefore to valid range using shared utility
    const safeTrimBefore = getSafeTrimBefore(
      trimBefore,
      item.durationInFrames,
      playbackRate,
      sourceDuration || undefined,
      timelineFps,
      sourceFps
    );

    // Graceful fallback for overlong clips: log and continue with clamped seek behavior.
    // We keep rendering instead of hard-failing the item.
    const effectiveDuration = sourceDuration > 0 ? sourceDuration : effectiveSourceSegment;
    if (exceedsSource && safeTrimBefore === 0 && effectiveDuration > 0 && sourceFramesNeeded > effectiveDuration) {
      const suggestedDurationInFrames = Math.max(
        1,
        sourceToTimelineFrames(effectiveDuration, playbackRate, sourceFps, timelineFps)
      );
      getLogger().warn('Clip duration exceeds source duration (graceful clamp):', {
        itemId: item.id,
        sourceFramesNeeded,
        sourceDuration,
        effectiveSourceSegment,
        effectiveDuration,
        durationInFrames: item.durationInFrames,
        playbackRate,
        sourceFps,
        timelineFps,
        suggestedDurationInFrames,
      });
    }

    const trackVolumeDb = ('trackVolumeDb' in item && typeof item.trackVolumeDb === 'number')
      ? item.trackVolumeDb
      : 0;
    const videoAudioSrc = item.audioSrc ?? item.src;
    const requiresPitchShiftedVideoAudio = isAudioPitchShiftActive(
      audioPitchShiftSemitones + itemLocalPitchShiftSemitones,
    );
    const shouldUseCustomDecodedVideoAudio = !muted
      && needsCustomAudioDecoder(mediaItem?.audioCodec ?? mediaItem?.codec);
    const shouldRenderExternalVideoAudio = !muted
      && !!videoAudioSrc
      && (requiresPitchShiftedVideoAudio || shouldUseCustomDecodedVideoAudio);
    const externalVideoAudio = shouldRenderExternalVideoAudio ? (
      shouldUseCustomDecodedVideoAudio ? (
        <CustomDecoderAudio
          src={videoAudioSrc}
          mediaId={item.mediaId ?? `legacy-src:${videoAudioSrc}`}
          itemId={item.id}
          trimBefore={safeTrimBefore}
          volume={(item.volume ?? 0) + trackVolumeDb}
          playbackRate={playbackRate}
          audioPitchSemitones={item.audioPitchSemitones}
          audioPitchCents={item.audioPitchCents}
          audioPitchShiftSemitones={audioPitchShiftSemitones}
          sourceFps={sourceFps}
          muted={muted}
          durationInFrames={item.durationInFrames}
          audioFadeIn={item.audioFadeIn}
          audioFadeOut={item.audioFadeOut}
          audioFadeInCurve={item.audioFadeInCurve}
          audioFadeOutCurve={item.audioFadeOutCurve}
          audioFadeInCurveX={item.audioFadeInCurveX}
          audioFadeOutCurveX={item.audioFadeOutCurveX}
          audioEqStages={itemAudioEqStages}
          liveGainItemIds={audioGainLiveItemIds}
          volumeMultiplier={audioGainMultiplier}
        />
      ) : (
        <PitchCorrectedAudio
          src={videoAudioSrc}
          mediaId={item.mediaId}
          itemId={item.id}
          trimBefore={safeTrimBefore}
          volume={(item.volume ?? 0) + trackVolumeDb}
          playbackRate={playbackRate}
          audioPitchSemitones={item.audioPitchSemitones}
          audioPitchCents={item.audioPitchCents}
          audioPitchShiftSemitones={audioPitchShiftSemitones}
          sourceFps={sourceFps}
          muted={muted}
          durationInFrames={item.durationInFrames}
          audioFadeIn={item.audioFadeIn}
          audioFadeOut={item.audioFadeOut}
          audioFadeInCurve={item.audioFadeInCurve}
          audioFadeOutCurve={item.audioFadeOutCurve}
          audioFadeInCurveX={item.audioFadeInCurveX}
          audioFadeOutCurveX={item.audioFadeOutCurveX}
          audioEqStages={itemAudioEqStages}
          liveGainItemIds={audioGainLiveItemIds}
          volumeMultiplier={audioGainMultiplier}
        />
      )
    ) : null;

    const videoContent = (
      <>
        <VideoContent
          item={item}
          muted={muted || shouldRenderExternalVideoAudio}
          safeTrimBefore={safeTrimBefore}
          playbackRate={playbackRate}
          sourceFps={sourceFps}
          audioEqStages={itemAudioEqStages}
          forceCssComposite={masks.length > 0}
        />
        {externalVideoAudio}
        {showDebugOverlay && (
          <DebugOverlay
            id={item.id}
            speed={playbackRate}
            trimBefore={trimBefore}
            safeTrimBefore={safeTrimBefore}
            sourceStart={item.sourceStart}
            sourceDuration={sourceDuration}
            durationInFrames={item.durationInFrames}
            sourceFramesNeeded={sourceFramesNeeded}
            sourceEndPosition={sourceEndPosition}
            isInvalidSeek={isInvalidSeek}
            exceedsSource={exceedsSource}
            sourceFps={sourceFps}
          />
        )}
      </>
    );

    // Use new ItemVisualWrapper for consolidated state and fixed DOM structure
    // resolveTransform handles defaults (fit-to-canvas) when no explicit transform is set
    return (
      <ItemVisualWrapper
        item={item}
        masks={masks}
        mediaContent={{
          fitMode: 'contain',
          sourceWidth: mediaSource?.width,
          sourceHeight: mediaSource?.height,
          crop: item.crop,
        }}
      >
        {videoContent}
      </ItemVisualWrapper>
    );
  }

  if (item.type === 'audio') {
    if (item.compositionId) {
      if (renderDepth >= MAX_RENDER_DEPTH) {
        return null;
      }

      return (
        <CompositionContent
          item={item as AudioItem & { compositionId: string }}
          parentMuted={muted}
          parentVisible={visible}
          renderDepth={renderDepth + 1}
          renderMode="audio-only"
          audioGainMultiplier={audioGainMultiplier}
          audioGainLiveItemIds={audioGainLiveItemIds}
          audioEqStages={itemAudioEqStages}
          audioPitchShiftSemitones={audioPitchShiftSemitones + itemLocalPitchShiftSemitones}
        />
      );
    }

    // Guard against missing src (media resolution failed)
    if (!item.src) {
      return null; // Audio can fail silently
    }

    // Use sourceStart for trimBefore (absolute position in source)
    const trimBefore = item.sourceStart ?? item.trimStart ?? item.offset ?? 0;
    const sourceFps = item.sourceFps ?? mediaSourceFps ?? timelineFps;
    // Get playback rate from speed property
    const playbackRate = item.speed ?? DEFAULT_SPEED;

    const trackVolumeDb = ('trackVolumeDb' in item && typeof item.trackVolumeDb === 'number')
      ? item.trackVolumeDb
      : 0;

    // Use PitchCorrectedAudio for pitch-preserved playback during preview
    // and toneFrequency correction during rendering
    return (
      <PitchCorrectedAudio
        src={item.src}
        mediaId={item.mediaId}
        itemId={item.id}
        trimBefore={trimBefore}
        volume={(item.volume ?? 0) + trackVolumeDb}
        playbackRate={playbackRate}
        audioPitchSemitones={item.audioPitchSemitones}
        audioPitchCents={item.audioPitchCents}
        audioPitchShiftSemitones={audioPitchShiftSemitones}
        sourceFps={sourceFps}
        muted={muted}
        durationInFrames={item.durationInFrames}
        audioFadeIn={item.audioFadeIn}
        audioFadeOut={item.audioFadeOut}
        audioFadeInCurve={item.audioFadeInCurve}
        audioFadeOutCurve={item.audioFadeOutCurve}
        audioFadeInCurveX={item.audioFadeInCurveX}
        audioFadeOutCurveX={item.audioFadeOutCurveX}
        audioEqStages={itemAudioEqStages}
        liveGainItemIds={audioGainLiveItemIds}
        volumeMultiplier={audioGainMultiplier}
      />
    );
  }

  if (item.type === 'image') {
    const mediaSource = getSourceDimensions(item);
    // Guard against missing src (media resolution failed)
    if (!item.src) {
      return (
        <AbsoluteFill style={{ backgroundColor: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: '#666', fontSize: 14 }}>Image not loaded</p>
        </AbsoluteFill>
      );
    }

    // Use GifPlayer for animated images (GIF and WebP).
    // This ensures frame-by-frame rendering synced to the timeline,
    // rather than relying on the browser's auto-animation via <img>.
    const label = item.label?.toLowerCase() ?? '';
    const isAnimatedGif = isGifUrl(item.src) || label.endsWith('.gif');
    const isAnimatedWebp = isWebpUrl(item.src) || label.endsWith('.webp');

    if ((isAnimatedGif || isAnimatedWebp) && item.mediaId) {
      const playbackRate = item.speed ?? DEFAULT_SPEED;

      const animatedContent = (
        <GifPlayer
          mediaId={item.mediaId}
          src={item.src}
          fit="fill"
          playbackRate={playbackRate}
          loopBehavior="loop"
          format={isAnimatedWebp ? 'webp' : 'gif'}
        />
      );

      return (
        <ItemVisualWrapper
          item={item}
          masks={masks}
          mediaContent={{
            fitMode: 'contain',
            sourceWidth: mediaSource?.width,
            sourceHeight: mediaSource?.height,
            crop: item.crop,
          }}
        >
          {animatedContent}
        </ItemVisualWrapper>
      );
    }

    // Regular static images - use native img element
    const imageContent = (
      <img
        src={item.src}
        alt=""
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'fill'
        }}
      />
    );

    // Use new ItemVisualWrapper for consolidated state and fixed DOM structure
    return (
      <ItemVisualWrapper
        item={item}
        masks={masks}
        mediaContent={{
          fitMode: 'contain',
          sourceWidth: mediaSource?.width,
          sourceHeight: mediaSource?.height,
          crop: item.crop,
        }}
      >
        {imageContent}
      </ItemVisualWrapper>
    );
  }

  if (item.type === 'text') {
    // Use new ItemVisualWrapper for consolidated state and fixed DOM structure
    return (
      <ItemVisualWrapper item={item} masks={masks}>
        <TextContent item={item} />
      </ItemVisualWrapper>
    );
  }

  if (item.type === 'shape') {
    // Use new ItemVisualWrapper for consolidated state and fixed DOM structure
    // ShapeContent renders the appropriate Composition shape based on shapeType
    return (
      <ItemVisualWrapper item={item} masks={masks}>
        <ShapeContent item={item} />
      </ItemVisualWrapper>
    );
  }

  if (item.type === 'composition') {
    // Guard against infinite recursion from circular composition references
    if (renderDepth >= MAX_RENDER_DEPTH) {
      return null;
    }
    // Render sub-composition contents inline
    // Pass parent muted so muting the track silences all sub-comp audio
    return (
      <ItemVisualWrapper item={item} masks={masks}>
        <CompositionContent
          item={item}
          parentMuted={muted}
          parentVisible={visible}
          renderDepth={renderDepth + 1}
          renderMode={compositionRenderMode}
          audioGainMultiplier={audioGainMultiplier}
          audioGainLiveItemIds={audioGainLiveItemIds}
          audioEqStages={itemAudioEqStages}
          audioPitchShiftSemitones={audioPitchShiftSemitones + itemLocalPitchShiftSemitones}
        />
      </ItemVisualWrapper>
    );
  }

  // adjustment items render nothing visually (they apply effects to other items)
  if (item.type === 'adjustment') {
    return null;
  }

  throw new Error(`Unknown item type: ${JSON.stringify(item)}`);
});
