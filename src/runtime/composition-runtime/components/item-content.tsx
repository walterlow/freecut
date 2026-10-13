import React from 'react'
import { AbsoluteFill, useClockPlaybackRate } from '@/runtime/composition-runtime/deps/player'
import { useDebugStore, useGizmoStore } from '@/runtime/composition-runtime/deps/stores'
import type { AudioItem, CompositionItem, TimelineItem, ShapeItem } from '@/types/timeline'
import type { ResolvedAudioEqSettings } from '@/types/audio'
import type { TransformProperties } from '@/types/transform'
import { DebugOverlay } from './debug-overlay'
import { CustomDecoderAudio } from './custom-decoder-audio'
import { PitchCorrectedAudio } from './pitch-corrected-audio'
import type { AudioPlaybackProps } from './audio-playback-props'
import { GifPlayer } from './gif-player'
import { LottiePlayer } from './lottie-player'
import { MediaOfflinePlaceholder } from './media-offline-placeholder'
import { ItemVisualWrapper } from './item-visual-wrapper'
import { isRenderableLottieSrc } from '@/infrastructure/lottie/lottie-frame-provider'
import { TextContent } from './text-content'
import { SubtitleSegmentContent } from './subtitle-segment-content'
import { ShapeContent } from './shape-content'
import { VideoContent } from './video-content'
import { useVideoConfig } from '../hooks/use-player-compat'
import { getSourceDimensions } from '../utils/transform-resolver'
import {
  timelineToSourceFrames,
  sourceToTimelineFrames,
  isValidSeekPosition,
  isWithinSourceBounds,
  getSafeTrimBefore,
  DEFAULT_SPEED,
} from '@/runtime/composition-runtime/deps/timeline'
import { isGifUrl, isWebpUrl } from '@/shared/utils/media-utils'
import { useMediaLibraryStore } from '@/runtime/composition-runtime/deps/stores'
import { createLogger } from '@/shared/logging/logger'
import { appendResolvedAudioEqStage, getAudioEqSettings } from '@/shared/utils/audio-eq'
import {
  isAudioPitchShiftActive,
  resolvePreviewAudioPitchShiftSemitones,
} from '@/shared/utils/audio-pitch'
import { needsCustomAudioDecoder } from '../utils/audio-codec-detection'
import { resolveReverseConformedVideoItem } from '@/shared/utils/reverse-conform-item'
import { useNestedMediaResolutionMode } from '../contexts/nested-media-resolution-context'
import { useLiveItemContentTransform } from '../contexts/live-item-transform-context'
import { shouldRenderExternalVideoAudio } from '../utils/audio-playback-routing'

function getLogger() {
  return createLogger('CompositionItem')
}

/** Mask information passed from composition to items */
export interface MaskInfo {
  shape: ShapeItem
  transform: TransformProperties
  trackOrder: number
}

/** Safety guard against corrupted circular composition graphs. */
const MAX_RENDER_DEPTH = 16

type CompositionRenderMode = 'full' | 'visual-only' | 'audio-only'
type CompositionWrapperItem = CompositionItem | (AudioItem & { compositionId: string })

export interface RenderCompositionContentProps {
  item: CompositionWrapperItem
  parentMuted: boolean
  parentVisible: boolean
  renderDepth: number
  renderMode: CompositionRenderMode
  audioGainMultiplier: number
  audioGainLiveItemIds?: string[]
  audioEqStages?: ResolvedAudioEqSettings[]
  audioPitchShiftSemitones: number
}

export interface ItemProps {
  item: TimelineItem
  muted?: boolean
  visible?: boolean
  /** Active masks that should clip this item's content */
  masks?: MaskInfo[]
  /** Current composition nesting depth (prevents infinite recursion) */
  renderDepth?: number
  compositionRenderMode?: CompositionRenderMode
  audioGainMultiplier?: number
  audioGainLiveItemIds?: string[]
  audioEqStages?: ResolvedAudioEqSettings[]
  audioPitchShiftSemitones?: number
  renderCompositionContent: (props: RenderCompositionContentProps) => React.ReactNode
}

function getItemAudioPlaybackProps({
  item,
  trimBefore,
  volume,
  playbackRate,
  isReversed,
  reverseSourceEnd,
  audioPitchShiftSemitones,
  sourceFps,
  muted,
  audioEqStages,
  liveGainItemIds,
  volumeMultiplier,
}: {
  item: TimelineItem
  trimBefore: number
  volume: number
  playbackRate: number
  isReversed: boolean
  reverseSourceEnd: number
  audioPitchShiftSemitones: number
  sourceFps: number
  muted: boolean
  audioEqStages: ResolvedAudioEqSettings[]
  liveGainItemIds?: string[]
  volumeMultiplier: number
}): AudioPlaybackProps {
  return {
    itemId: item.id,
    trimBefore,
    volume,
    playbackRate,
    isReversed,
    reverseSourceEnd,
    audioPitchSemitones: item.audioPitchSemitones,
    audioPitchCents: item.audioPitchCents,
    audioPitchShiftSemitones,
    sourceFps,
    muted,
    durationInFrames: item.durationInFrames,
    audioFadeIn: item.audioFadeIn,
    audioFadeOut: item.audioFadeOut,
    audioFadeInCurve: item.audioFadeInCurve,
    audioFadeOutCurve: item.audioFadeOutCurve,
    audioFadeInCurveX: item.audioFadeInCurveX,
    audioFadeOutCurveX: item.audioFadeOutCurveX,
    audioEqStages,
    liveGainItemIds,
    volumeMultiplier,
  }
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
export const ItemContent = React.memo<ItemProps>(
  ({
    item,
    muted = false,
    visible = true,
    masks = [],
    renderDepth = 0,
    compositionRenderMode = 'full',
    audioGainMultiplier = 1,
    audioGainLiveItemIds,
    audioEqStages,
    audioPitchShiftSemitones = 0,
    renderCompositionContent,
  }) => {
    item = useLiveItemContentTransform(item)

    // Use muted prop directly - MainComposition already passes track.muted
    // Avoiding store subscription here prevents re-render issues with @legacy-video/media Audio

    // Debug overlay toggle (always false in production via store)
    const showDebugOverlay = useDebugStore((s) => s.showVideoDebugOverlay)
    const { fps: timelineFps } = useVideoConfig()
    const isReverseShuttle = useClockPlaybackRate() < 0
    const nestedMediaResolutionMode = useNestedMediaResolutionMode()
    const mediaItem = useMediaLibraryStore((s) =>
      item.mediaId ? s.mediaById[item.mediaId] : undefined,
    )
    // Boolean selector (not the array) so this only re-renders when THIS item's
    // broken state flips — never per-frame during playback.
    const isMediaOffline = useMediaLibraryStore((s) =>
      item.mediaId ? s.brokenMediaIds.includes(item.mediaId) : false,
    )
    const mediaSourceFps = mediaItem?.fps
    const itemAudioEqStages = React.useMemo(
      () => appendResolvedAudioEqStage(audioEqStages, getAudioEqSettings(item)),
      [audioEqStages, item],
    )
    // Subscribe to this item's gizmo preview so live pitch-slider drags route the
    // video's audio through the pitch-corrected path immediately (not only after
    // commit). resolvePreviewAudioPitchShiftSemitones falls back to the committed
    // pitch fields when no preview is set.
    const itemPreviewProperties = useGizmoStore(
      React.useCallback((s) => s.preview?.[item.id]?.properties, [item.id]),
    )
    const itemLocalPitchShiftSemitones = React.useMemo(
      () =>
        resolvePreviewAudioPitchShiftSemitones({
          base: {
            audioPitchSemitones: item.audioPitchSemitones,
            audioPitchCents: item.audioPitchCents,
          },
          preview: itemPreviewProperties,
        }),
      [item.audioPitchSemitones, item.audioPitchCents, itemPreviewProperties],
    )

    // Null Objects participate in transform hierarchy and canvas gizmo
    // interactions, but intentionally contribute no pixels of their own.
    if (item.type === 'controller') {
      return null
    }

    if (item.type === 'video') {
      item = resolveReverseConformedVideoItem(item, timelineFps, {
        useProxy: nestedMediaResolutionMode === 'proxy',
      })
      const mediaSource = getSourceDimensions(item)
      // Guard against missing src (media resolution failed / media deleted)
      if (!item.src) {
        return <MediaOfflinePlaceholder offline={isMediaOffline} label={item.label} />
      }
      // Use sourceStart for trimBefore (absolute position in source)
      // Fall back to trimStart or offset for backward compatibility
      const trimBefore = item.sourceStart ?? item.trimStart ?? item.offset ?? 0
      const sourceFps = item.sourceFps ?? mediaSourceFps ?? timelineFps
      // Get playback rate from speed property (default 1x)
      const playbackRate = item.speed ?? DEFAULT_SPEED

      // Calculate source frames needed for playback using shared utility
      const sourceFramesNeeded = timelineToSourceFrames(
        item.durationInFrames,
        playbackRate,
        timelineFps,
        sourceFps,
      )
      const sourceEndPosition = trimBefore + sourceFramesNeeded
      const reverseSourceEnd = item.sourceEnd ?? sourceEndPosition
      const sourceDuration = item.sourceDuration || 0

      // Calculate the effective source segment this clip represents
      // This is more accurate than sourceDuration for rate-stretched clips
      // sourceEnd - sourceStart defines the actual source frames used
      const effectiveSourceSegment =
        item.sourceEnd !== undefined && item.sourceStart !== undefined
          ? item.sourceEnd - item.sourceStart
          : sourceDuration

      // Only validate if we have valid source duration info
      const hasValidSourceDuration = sourceDuration > 0 || effectiveSourceSegment > 0

      // Validate using shared utilities - skip if no valid duration info
      const isInvalidSeek =
        hasValidSourceDuration && !isValidSeekPosition(trimBefore, sourceDuration || undefined)
      const exceedsSource =
        hasValidSourceDuration &&
        !isWithinSourceBounds(
          trimBefore,
          item.durationInFrames,
          playbackRate,
          sourceDuration || undefined,
          2,
          timelineFps,
          sourceFps,
        )

      // Safety check: if sourceStart is unreasonably high (>1 hour) and no sourceDuration is set,
      // this indicates corrupted metadata from split/trim operations
      const MAX_REASONABLE_FRAMES = 30 * 60 * 60 // 1 hour at 30fps
      const hasCorruptedMetadata =
        sourceDuration === 0 && effectiveSourceSegment === 0 && trimBefore > MAX_REASONABLE_FRAMES

      if (hasCorruptedMetadata || isInvalidSeek) {
        getLogger().error('Invalid source position detected:', {
          itemId: item.id,
          sourceStart: item.sourceStart,
          trimBefore,
          sourceDuration,
          effectiveSourceSegment,
          hasCorruptedMetadata,
          isInvalidSeek,
        })
        return (
          <AbsoluteFill
            style={{
              backgroundColor: '#2a1a1a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <p style={{ color: '#ff6b6b', fontSize: 14 }}>Invalid source position</p>
          </AbsoluteFill>
        )
      }

      // Clamp trimBefore to valid range using shared utility
      const safeTrimBefore = getSafeTrimBefore(
        trimBefore,
        item.durationInFrames,
        playbackRate,
        sourceDuration || undefined,
        timelineFps,
        sourceFps,
      )

      // Graceful fallback for overlong clips: log and continue with clamped seek behavior.
      // We keep rendering instead of hard-failing the item.
      const effectiveDuration = sourceDuration > 0 ? sourceDuration : effectiveSourceSegment
      if (
        exceedsSource &&
        safeTrimBefore === 0 &&
        effectiveDuration > 0 &&
        sourceFramesNeeded > effectiveDuration
      ) {
        const suggestedDurationInFrames = Math.max(
          1,
          sourceToTimelineFrames(effectiveDuration, playbackRate, sourceFps, timelineFps),
        )
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
        })
      }

      const trackVolumeDb =
        'trackVolumeDb' in item && typeof item.trackVolumeDb === 'number' ? item.trackVolumeDb : 0
      const videoAudioSrc = item.audioSrc ?? item.src
      const isReversed = item.isReversed === true
      const requiresPitchShiftedVideoAudio = isAudioPitchShiftActive(
        audioPitchShiftSemitones + itemLocalPitchShiftSemitones,
      )
      const shouldUseCustomDecodedVideoAudio =
        !muted && needsCustomAudioDecoder(mediaItem?.audioCodec ?? mediaItem?.codec)
      const renderExternalVideoAudio = shouldRenderExternalVideoAudio({
        muted,
        hasAudioSource: !!videoAudioSrc,
        authoredReversed: isReversed,
        reverseShuttle: isReverseShuttle,
        requiresPitchShift: requiresPitchShiftedVideoAudio,
        requiresCustomDecoder: shouldUseCustomDecodedVideoAudio,
      })
      const videoAudioPlaybackProps = getItemAudioPlaybackProps({
        item,
        trimBefore: safeTrimBefore,
        volume: (item.volume ?? 0) + trackVolumeDb,
        playbackRate,
        isReversed,
        reverseSourceEnd,
        audioPitchShiftSemitones,
        sourceFps,
        muted,
        audioEqStages: itemAudioEqStages,
        liveGainItemIds: audioGainLiveItemIds,
        volumeMultiplier: audioGainMultiplier,
      })
      const externalVideoAudio = renderExternalVideoAudio ? (
        shouldUseCustomDecodedVideoAudio ? (
          <CustomDecoderAudio
            {...videoAudioPlaybackProps}
            src={videoAudioSrc}
            mediaId={item.mediaId ?? `legacy-src:${videoAudioSrc}`}
          />
        ) : (
          <PitchCorrectedAudio
            {...videoAudioPlaybackProps}
            src={videoAudioSrc}
            mediaId={item.mediaId}
          />
        )
      ) : null

      const videoContent = (
        <>
          <VideoContent
            item={item}
            muted={muted || renderExternalVideoAudio}
            safeTrimBefore={safeTrimBefore}
            playbackRate={playbackRate}
            sourceFps={sourceFps}
            isReversed={isReversed}
            reverseSourceEnd={reverseSourceEnd}
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
      )

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
      )
    }

    if (item.type === 'audio') {
      if (item.compositionId) {
        if (renderDepth >= MAX_RENDER_DEPTH) {
          return null
        }

        return renderCompositionContent({
          item: item as AudioItem & { compositionId: string },
          parentMuted: muted,
          parentVisible: visible,
          renderDepth: renderDepth + 1,
          renderMode: 'audio-only',
          audioGainMultiplier,
          audioGainLiveItemIds,
          audioEqStages: itemAudioEqStages,
          audioPitchShiftSemitones: audioPitchShiftSemitones + itemLocalPitchShiftSemitones,
        })
      }

      // Guard against missing src (media resolution failed)
      if (!item.src) {
        return null // Audio can fail silently
      }

      // Use sourceStart for trimBefore (absolute position in source)
      const trimBefore = item.sourceStart ?? item.trimStart ?? item.offset ?? 0
      const sourceFps = item.sourceFps ?? mediaSourceFps ?? timelineFps
      // Get playback rate from speed property
      const playbackRate = item.speed ?? DEFAULT_SPEED
      const sourceFramesNeeded = timelineToSourceFrames(
        item.durationInFrames,
        playbackRate,
        timelineFps,
        sourceFps,
      )
      const reverseSourceEnd = item.sourceEnd ?? trimBefore + sourceFramesNeeded

      const trackVolumeDb =
        'trackVolumeDb' in item && typeof item.trackVolumeDb === 'number' ? item.trackVolumeDb : 0
      const audioPlaybackProps = getItemAudioPlaybackProps({
        item,
        trimBefore,
        volume: (item.volume ?? 0) + trackVolumeDb,
        playbackRate,
        isReversed: item.isReversed === true,
        reverseSourceEnd,
        audioPitchShiftSemitones,
        sourceFps,
        muted,
        audioEqStages: itemAudioEqStages,
        liveGainItemIds: audioGainLiveItemIds,
        volumeMultiplier: audioGainMultiplier,
      })

      // Use PitchCorrectedAudio for pitch-preserved playback during preview
      // and toneFrequency correction during rendering
      return <PitchCorrectedAudio {...audioPlaybackProps} src={item.src} mediaId={item.mediaId} />
    }

    if (item.type === 'image') {
      const mediaSource = getSourceDimensions(item)
      // Guard against missing src (media resolution failed / media deleted)
      if (!item.src) {
        return <MediaOfflinePlaceholder offline={isMediaOffline} label={item.label} />
      }

      // Use GifPlayer for animated images (GIF and WebP).
      // This ensures frame-by-frame rendering synced to the timeline,
      // rather than relying on the browser's auto-animation via <img>.
      const label = item.label?.toLowerCase() ?? ''
      const isAnimatedGif = isGifUrl(item.src) || label.endsWith('.gif')
      const isAnimatedWebp = isWebpUrl(item.src) || label.endsWith('.webp')

      if ((isAnimatedGif || isAnimatedWebp) && item.mediaId) {
        const playbackRate = item.speed ?? DEFAULT_SPEED

        const animatedContent = (
          <GifPlayer
            mediaId={item.mediaId}
            src={item.src}
            fit="fill"
            playbackRate={playbackRate}
            loopBehavior="loop"
            format={isAnimatedWebp ? 'webp' : 'gif'}
          />
        )

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
        )
      }

      // Regular static images - use native img element
      const imageContent = (
        <img
          src={item.src}
          alt=""
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'fill',
          }}
        />
      )

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
      )
    }

    if (item.type === 'lottie') {
      const mediaSource = getSourceDimensions(item)
      // A stale `blob:` src (persisted or left over after the media was deleted)
      // is treated as missing so dotlottie is never handed a dead URL to fetch.
      if (!isRenderableLottieSrc(item.src)) {
        return <MediaOfflinePlaceholder offline={isMediaOffline} label={item.label} />
      }
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
          <LottiePlayer item={item} />
        </ItemVisualWrapper>
      )
    }

    if (item.type === 'text') {
      // Use new ItemVisualWrapper for consolidated state and fixed DOM structure
      return (
        <ItemVisualWrapper item={item} masks={masks}>
          <TextContent item={item} />
        </ItemVisualWrapper>
      )
    }

    if (item.type === 'shape') {
      // Use new ItemVisualWrapper for consolidated state and fixed DOM structure
      // ShapeContent renders the appropriate Composition shape based on shapeType
      return (
        <ItemVisualWrapper item={item} masks={masks}>
          <ShapeContent item={item} />
        </ItemVisualWrapper>
      )
    }

    if (item.type === 'composition') {
      // Guard against infinite recursion from circular composition references
      if (renderDepth >= MAX_RENDER_DEPTH) {
        return null
      }
      // Render sub-composition contents inline
      // Pass parent muted so muting the track silences all sub-comp audio
      return (
        <ItemVisualWrapper
          item={item}
          masks={masks}
          mediaContent={{
            fitMode: 'fill',
            sourceWidth: item.compositionWidth,
            sourceHeight: item.compositionHeight,
            crop: item.crop,
          }}
        >
          {renderCompositionContent({
            item,
            parentMuted: muted,
            parentVisible: visible,
            renderDepth: renderDepth + 1,
            renderMode: compositionRenderMode,
            audioGainMultiplier,
            audioGainLiveItemIds,
            audioEqStages: itemAudioEqStages,
            audioPitchShiftSemitones: audioPitchShiftSemitones + itemLocalPitchShiftSemitones,
          })}
        </ItemVisualWrapper>
      )
    }

    // adjustment items render nothing visually (they apply effects to other items)
    if (item.type === 'adjustment') {
      return null
    }

    if (item.type === 'subtitle') {
      return (
        <ItemVisualWrapper item={item} masks={masks}>
          <SubtitleSegmentContent item={item} />
        </ItemVisualWrapper>
      )
    }

    throw new Error(`Unknown item type: ${JSON.stringify(item)}`)
  },
)
