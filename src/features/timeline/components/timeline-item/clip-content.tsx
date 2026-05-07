import { memo, useCallback, useMemo } from 'react'
import { Link2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { TimelineItem } from '@/types/timeline'
import { ClipFilmstrip } from '../clip-filmstrip'
import { ImageFilmstrip } from '../clip-filmstrip/image-filmstrip'
import { ClipWaveform } from '../clip-waveform'
import { CompoundClipWaveform } from '../clip-waveform/compound-clip-waveform'
import { useSettingsStore } from '@/features/timeline/deps/settings'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { useCompositionsStore } from '../../stores/compositions-store'
import { useItemsStore } from '../../stores/items-store'
import { useTimelineSettingsStore } from '../../stores/timeline-settings-store'
import { useClipVisibility } from '../../hooks/use-clip-visibility'
import { useZoomStore } from '../../stores/zoom-store'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/app/editor-layout'
import { getTextItemPlainText } from '@/shared/utils/text-item-spans'
import {
  getCompositionVisualSegments,
  summarizeCompositionClipContent,
  type CompositionVisualSegment,
} from '../../utils/composition-clip-summary'
import { hasLinkedAudioCompanion } from '@/shared/utils/linked-media'
import { formatSignedFrameDelta } from '@/shared/utils/time-utils'
import { isGifUrl, isWebpUrl } from '@/shared/utils/media-utils'

const EMPTY_COMPOSITION_LOOKUP: Record<string, never> = {}
const FILMSTRIP_MIN_WIDTH_PX = 5

interface CompositionFilmstripSegmentProps {
  segment: CompositionVisualSegment
  wrapperDurationFrames: number
  wrapperClipWidthPx: number
  wrapperRenderWidthPx: number
  wrapperVisibleStartRatio: number
  wrapperVisibleEndRatio: number
  wrapperIsVisible: boolean
  fps: number
  pixelsPerSecond: number
  preferImmediateRendering: boolean
  isReversed?: boolean
}

function CompositionFilmstripSegment({
  segment,
  wrapperDurationFrames,
  wrapperClipWidthPx,
  wrapperRenderWidthPx,
  wrapperVisibleStartRatio,
  wrapperVisibleEndRatio,
  wrapperIsVisible,
  fps,
  pixelsPerSecond,
  preferImmediateRendering,
  isReversed = false,
}: CompositionFilmstripSegmentProps) {
  const mediaId = segment.mediaId
  const mediaStats = useMediaLibraryStore(
    useShallow(
      useCallback(
        (s) => {
          const media = s.mediaById[mediaId]
          return {
            fps: media?.fps || segment.sourceFps,
            duration: media?.duration || 0,
          }
        },
        [mediaId, segment.sourceFps],
      ),
    ),
  )

  const wrapperSpan = Math.max(1, wrapperDurationFrames)
  const widthFraction = Math.min(1, segment.durationInFrames / wrapperSpan)
  const leftFraction = Math.max(0, segment.from / wrapperSpan)
  const segmentClipWidth = Math.max(0, widthFraction * wrapperClipWidthPx)
  const segmentRenderWidth = Math.max(0, widthFraction * wrapperRenderWidthPx)

  const sourceDurationSeconds =
    mediaStats.duration > 0
      ? mediaStats.duration
      : segment.sourceDurationFrames / Math.max(1, mediaStats.fps)
  const sourceStartSeconds =
    mediaStats.duration > 0 && segment.sourceDurationFrames > 0
      ? (segment.sourceStart / segment.sourceDurationFrames) * mediaStats.duration
      : segment.sourceStart / Math.max(1, mediaStats.fps)
  const sourceEndSeconds =
    sourceStartSeconds + (segment.durationInFrames / Math.max(1, fps)) * segment.speed

  const segmentEndFraction = leftFraction + widthFraction
  const overlapStart = Math.max(wrapperVisibleStartRatio, leftFraction)
  const overlapEnd = Math.min(wrapperVisibleEndRatio, segmentEndFraction)
  const hasOverlap = overlapEnd > overlapStart && widthFraction > 0
  const segmentVisibleStartRatio = hasOverlap
    ? Math.max(0, Math.min(1, (overlapStart - leftFraction) / widthFraction))
    : 0
  const segmentVisibleEndRatio = hasOverlap
    ? Math.max(0, Math.min(1, (overlapEnd - leftFraction) / widthFraction))
    : 0
  const segmentIsVisible = wrapperIsVisible && hasOverlap

  if (segmentClipWidth < FILMSTRIP_MIN_WIDTH_PX) return null

  return (
    <div
      className="absolute inset-y-0 overflow-hidden"
      style={{
        left: `${leftFraction * 100}%`,
        width: `${widthFraction * 100}%`,
      }}
    >
      <ClipFilmstrip
        mediaId={mediaId}
        clipWidth={segmentClipWidth}
        renderWidth={segmentRenderWidth}
        sourceStart={sourceStartSeconds}
        sourceEnd={sourceEndSeconds}
        sourceDuration={sourceDurationSeconds}
        trimStart={0}
        speed={segment.speed}
        isReversed={isReversed}
        fps={fps}
        isVisible={segmentIsVisible}
        visibleStartRatio={segmentVisibleStartRatio}
        visibleEndRatio={segmentVisibleEndRatio}
        pixelsPerSecond={pixelsPerSecond}
        preferImmediateRendering={preferImmediateRendering}
      />
    </div>
  )
}

/**
 * Small render buffer: filmstrip/waveform are rendered slightly wider than the
 * clip width.  The parent's overflow:hidden clips the excess invisibly.
 * Protects against sub-frame timing where the CSS variable has updated but
 * React hasn't committed the filmstrip width yet.
 */
const RENDER_BUFFER = 1.03

interface ClipContentProps {
  item: TimelineItem
  clipLeftFrames: number
  clipWidthFrames: number
  fps: number
  isLinked?: boolean
  preferImmediateRendering?: boolean
  audioWaveformScale?: number
  linkedSyncOffsetFrames?: number | null
}

/**
 * Renders the visual content of a timeline clip based on its type.
 * - Video: 2-row layout — label | filmstrip
 * - Audio: Label row + waveform
 * - Composition (with video): Label | filmstrip | waveform
 * - Text: Text content preview
 * - Adjustment: Effects summary
 * - Image/Shape: Simple label
 */
export const ClipContent = memo(function ClipContent({
  item,
  clipLeftFrames,
  clipWidthFrames,
  fps,
  isLinked = false,
  preferImmediateRendering = false,
  audioWaveformScale = 1,
  linkedSyncOffsetFrames = null,
}: ClipContentProps) {
  // Subscribe to live pixelsPerSecond so filmstrip/waveform content stays in sync
  // with the CSS-variable-driven clip shell during zoom — avoids a visible catchup
  // jump at settle. Per-item render cost is kept low by the filmstrip skip (<5px)
  // and compact clip shell optimizations in the parent.
  const pixelsPerSecond = useZoomStore((s) => s.pixelsPerSecond)
  const showWaveforms = useSettingsStore((s) => s.showWaveforms)
  const showFilmstrips = useSettingsStore((s) => s.showFilmstrips)
  const timelineVisualsSettled = useTimelineSettingsStore(
    useCallback((s) => !s.isTimelineLoading, []),
  )
  const mediaVisualsSettled = useMediaLibraryStore(useCallback((s) => !s.isLoading, []))
  const shouldRenderHeavyVisuals = timelineVisualsSettled && mediaVisualsSettled
  const clipLeftPx = useMemo(
    () => (fps > 0 ? (clipLeftFrames / fps) * pixelsPerSecond : 0),
    [clipLeftFrames, fps, pixelsPerSecond],
  )
  const clipWidth = useMemo(
    () => Math.max(0, fps > 0 ? (clipWidthFrames / fps) * pixelsPerSecond : 0),
    [clipWidthFrames, fps, pixelsPerSecond],
  )
  // Small safety buffer - clips the excess via overflow:hidden.
  const renderWidth = Math.ceil(clipWidth * RENDER_BUFFER)
  const clipVisibility = useClipVisibility(clipLeftPx, clipWidth)
  const isCompositionAudioWrapper = item.type === 'audio' && !!item.compositionId

  // For composition items: find the topmost video in the sub-comp for filmstrip.
  const compositionId =
    item.type === 'composition' || isCompositionAudioWrapper ? item.compositionId : undefined
  const composition = useCompositionsStore(
    useCallback(
      (s) => (compositionId ? (s.compositionById[compositionId] ?? null) : null),
      [compositionId],
    ),
  )
  const compositionById = useCompositionsStore(
    useCallback(
      (s) => (compositionId ? s.compositionById : EMPTY_COMPOSITION_LOOKUP),
      [compositionId],
    ),
  )
  const hasCompositionAudioCompanion = useItemsStore(
    useCallback(
      (s) => item.type === 'composition' && hasLinkedAudioCompanion(s.items, item),
      [item],
    ),
  )
  const compositionSummary = useMemo(() => {
    if (!composition) {
      return {
        visualMediaId: null,
        audioMediaId: null,
        hasOwnedAudio: false,
        hasMultipleOwnedAudioSources: false,
        visualSource: null,
      }
    }

    return summarizeCompositionClipContent({
      items: composition.items,
      tracks: composition.tracks,
      fps: composition.fps,
      compositionById,
    })
  }, [composition, compositionById])
  const compositionVisualMediaId = compositionSummary.visualSource?.mediaId ?? null
  const visualSegments = useMemo<CompositionVisualSegment[]>(() => {
    if (item.type !== 'composition' || !composition) return []
    return getCompositionVisualSegments({
      wrapper: item,
      parentFps: fps,
      compositionById,
    })
  }, [item, fps, composition, compositionById])
  const showCompositionWaveform =
    showWaveforms && compositionSummary.hasOwnedAudio && !hasCompositionAudioCompanion
  const linkedSyncOffsetLabel =
    linkedSyncOffsetFrames === null ? null : formatSignedFrameDelta(linkedSyncOffsetFrames, fps)

  const renderTitleText = useCallback(
    (label: string) => (
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        {linkedSyncOffsetLabel && (
          <span
            className="shrink-0 rounded bg-destructive/90 px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-destructive-foreground"
            title={`Linked clips out of sync by ${linkedSyncOffsetLabel}`}
          >
            {linkedSyncOffsetLabel}
          </span>
        )}
        {isLinked && (
          <span
            className={`inline-flex shrink-0 items-center justify-center rounded p-0.5 ${
              linkedSyncOffsetLabel
                ? 'bg-destructive/85 text-destructive-foreground'
                : 'bg-black/55 text-white/90'
            }`}
            title={
              linkedSyncOffsetLabel
                ? `Linked audio/video pair out of sync by ${linkedSyncOffsetLabel}`
                : 'Linked audio/video pair'
            }
          >
            <Link2 className="h-3 w-3" />
          </span>
        )}
        <span className="min-w-0 truncate">{label}</span>
      </div>
    ),
    [isLinked, linkedSyncOffsetLabel],
  )

  // Use the relevant mediaId so source mapping remains stable for each clip type.
  const effectiveMediaId = item.mediaId ?? compositionVisualMediaId

  // sourceStart/sourceDuration are stored in source-frame units. Prefer duration-ratio
  // mapping so rendering remains stable even if media FPS metadata changes after drop.
  const mediaStats = useMediaLibraryStore(
    useShallow(
      useCallback(
        (s) => {
          if (!effectiveMediaId) {
            return { fps, duration: 0 }
          }
          const media = s.mediaById[effectiveMediaId]
          return {
            fps: media?.fps || fps,
            duration: media?.duration || 0,
          }
        },
        [effectiveMediaId, fps],
      ),
    ),
  )

  const sourceDurationFrames = Math.max(1, item.sourceDuration ?? item.durationInFrames)
  const sourceStartFrames = Math.max(0, item.sourceStart ?? 0)
  const compositionSourceDurationFrames = Math.max(
    1,
    item.type === 'composition' || isCompositionAudioWrapper
      ? (composition?.durationInFrames ?? item.sourceDuration ?? item.durationInFrames)
      : sourceDurationFrames,
  )
  const compositionSourceStartFrames = Math.max(
    0,
    item.type === 'composition' || isCompositionAudioWrapper
      ? (item.sourceStart ?? item.trimStart ?? 0)
      : sourceStartFrames,
  )

  const sourceDuration =
    mediaStats.duration > 0 ? mediaStats.duration : sourceDurationFrames / mediaStats.fps
  const sourceStart =
    mediaStats.duration > 0
      ? (sourceStartFrames / sourceDurationFrames) * mediaStats.duration
      : sourceStartFrames / mediaStats.fps
  const sourceEndFrames = item.sourceEnd
  const sourceEnd =
    sourceEndFrames === undefined
      ? undefined
      : mediaStats.duration > 0
        ? (sourceEndFrames / sourceDurationFrames) * mediaStats.duration
        : sourceEndFrames / mediaStats.fps

  const trimStart = (item.trimStart ?? 0) / fps
  const speed = item.speed ?? 1
  const isReversed = item.isReversed === true
  const compoundClipTimelineFps = composition?.fps ?? fps
  const compoundClipSourceDuration = compositionSourceDurationFrames / compoundClipTimelineFps
  const compoundClipSourceStart = compositionSourceStartFrames / compoundClipTimelineFps

  const renderCompoundClipLabel = useCallback(
    (label: string) => (
      <div
        className="flex items-center gap-1.5 px-2 text-[11px] font-medium truncate shrink-0"
        style={{
          height: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight,
          lineHeight: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight,
        }}
      >
        <span className="rounded bg-violet-950/40 px-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-violet-100/90">
          Compound
        </span>
        <div className="min-w-0 flex-1">{renderTitleText(label)}</div>
      </div>
    ),
    [renderTitleText],
  )

  const showVisualContent = clipWidth >= FILMSTRIP_MIN_WIDTH_PX

  // Video clip 2-row layout: label | filmstrip
  if (item.type === 'video' && item.mediaId) {
    return (
      <div className="absolute inset-0 flex flex-col">
        {/* Row 1: Label - fixed height */}
        <div
          className="px-2 text-[11px] font-medium truncate shrink-0"
          style={{
            height: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight,
            lineHeight: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight,
          }}
        >
          {renderTitleText(item.label)}
        </div>
        {/* Row 2: Filmstrip - flex-1 to fill remaining space */}
        {showVisualContent && (
          <div className="relative overflow-hidden flex-1 min-h-0">
            {shouldRenderHeavyVisuals && showFilmstrips && (
              <ClipFilmstrip
                mediaId={item.mediaId}
                clipWidth={clipWidth}
                renderWidth={renderWidth}
                sourceStart={sourceStart}
                sourceEnd={sourceEnd}
                sourceDuration={sourceDuration}
                trimStart={trimStart}
                speed={speed}
                isReversed={isReversed}
                fps={fps}
                isVisible={clipVisibility.isVisible}
                visibleStartRatio={clipVisibility.visibleStartRatio}
                visibleEndRatio={clipVisibility.visibleEndRatio}
                pixelsPerSecond={pixelsPerSecond}
                preferImmediateRendering={preferImmediateRendering}
              />
            )}
          </div>
        )}
      </div>
    )
  }

  // Audio clip - label row + waveform fills remaining space
  if (item.type === 'audio' && item.mediaId) {
    return (
      <div className="absolute inset-0 flex flex-col">
        {/* Row 1: Label - fixed height */}
        <div
          className="px-2 text-[11px] font-medium truncate shrink-0"
          style={{
            height: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight,
            lineHeight: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight,
          }}
        >
          {renderTitleText(item.label)}
        </div>
        {/* Row 2: Waveform - fills remaining space */}
        {showVisualContent && shouldRenderHeavyVisuals && showWaveforms && (
          <div className="relative overflow-hidden bg-waveform-gradient flex-1 min-h-0">
            <div
              className="absolute inset-0"
              style={{
                transform: `scaleY(var(--timeline-audio-waveform-scale, ${audioWaveformScale}))`,
                transformOrigin: '50% 50%',
              }}
            >
              <ClipWaveform
                mediaId={item.mediaId}
                clipWidth={clipWidth}
                renderWidth={renderWidth}
                sourceStart={sourceStart}
                sourceEnd={sourceEnd}
                sourceDuration={sourceDuration}
                trimStart={trimStart}
                speed={speed}
                isReversed={isReversed}
                fps={fps}
                isVisible={clipVisibility.isVisible}
                visibleStartRatio={clipVisibility.visibleStartRatio}
                visibleEndRatio={clipVisibility.visibleEndRatio}
                pixelsPerSecond={pixelsPerSecond}
              />
            </div>
          </div>
        )}
      </div>
    )
  }

  if (isCompositionAudioWrapper && composition) {
    return (
      <div className="absolute inset-0 flex flex-col">
        {renderCompoundClipLabel(item.label || 'Compound Clip')}
        {showVisualContent && shouldRenderHeavyVisuals && showWaveforms && (
          <div className="relative overflow-hidden bg-waveform-gradient flex-1 min-h-0">
            <CompoundClipWaveform
              composition={composition}
              clipWidth={clipWidth}
              renderWidth={renderWidth}
              sourceStart={compoundClipSourceStart}
              sourceDuration={compoundClipSourceDuration}
              isVisible={clipVisibility.isVisible}
              visibleStartRatio={clipVisibility.visibleStartRatio}
              visibleEndRatio={clipVisibility.visibleEndRatio}
              pixelsPerSecond={pixelsPerSecond}
            />
          </div>
        )}
      </div>
    )
  }

  // Text item - show text content preview
  if (item.type === 'text') {
    return (
      <div className="absolute inset-0 flex flex-col px-2 py-1 overflow-hidden">
        <div className="text-[10px] text-muted-foreground truncate">Text</div>
        <div className="text-xs font-medium truncate flex-1">
          {getTextItemPlainText(item) || 'Empty text'}
        </div>
      </div>
    )
  }

  // Composition item - multi-segment filmstrip from visible sub-comp videos, or label fallback
  if (item.type === 'composition') {
    if (visualSegments.length > 0) {
      return (
        <div className="absolute inset-0 flex flex-col">
          {renderCompoundClipLabel(item.label || 'Compound Clip')}
          {showVisualContent && (
            <>
              {/* Row 2: Filmstrip stack - flex-1 */}
              <div className="relative overflow-hidden flex-1 min-h-0">
                {shouldRenderHeavyVisuals &&
                  showFilmstrips &&
                  visualSegments.map((segment) => (
                    <CompositionFilmstripSegment
                      key={segment.itemId}
                      segment={segment}
                      wrapperDurationFrames={item.durationInFrames}
                      wrapperClipWidthPx={clipWidth}
                      wrapperRenderWidthPx={renderWidth}
                      wrapperVisibleStartRatio={clipVisibility.visibleStartRatio}
                      wrapperVisibleEndRatio={clipVisibility.visibleEndRatio}
                      wrapperIsVisible={clipVisibility.isVisible}
                      fps={fps}
                      pixelsPerSecond={pixelsPerSecond}
                      preferImmediateRendering={preferImmediateRendering}
                      isReversed={isReversed}
                    />
                  ))}
              </div>
              {/* Row 3: Waveform */}
              {shouldRenderHeavyVisuals && showCompositionWaveform && composition && (
                <div
                  className="relative overflow-hidden bg-waveform-gradient"
                  style={{ height: EDITOR_LAYOUT_CSS_VALUES.timelineWaveformRowHeight }}
                >
                  <CompoundClipWaveform
                    composition={composition}
                    clipWidth={clipWidth}
                    renderWidth={renderWidth}
                    sourceStart={compoundClipSourceStart}
                    sourceDuration={compoundClipSourceDuration}
                    isVisible={clipVisibility.isVisible}
                    visibleStartRatio={clipVisibility.visibleStartRatio}
                    visibleEndRatio={clipVisibility.visibleEndRatio}
                    pixelsPerSecond={pixelsPerSecond}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )
    }
    if (compositionSummary.hasOwnedAudio && composition && !hasCompositionAudioCompanion) {
      return (
        <div className="absolute inset-0 flex flex-col">
          {renderCompoundClipLabel(item.label || 'Compound Clip')}
          {showVisualContent && shouldRenderHeavyVisuals && showWaveforms && (
            <div className="relative overflow-hidden bg-waveform-gradient flex-1 min-h-0">
              <CompoundClipWaveform
                composition={composition}
                clipWidth={clipWidth}
                renderWidth={renderWidth}
                sourceStart={compoundClipSourceStart}
                sourceDuration={compoundClipSourceDuration}
                isVisible={clipVisibility.isVisible}
                visibleStartRatio={clipVisibility.visibleStartRatio}
                visibleEndRatio={clipVisibility.visibleEndRatio}
                pixelsPerSecond={pixelsPerSecond}
              />
            </div>
          )}
        </div>
      )
    }
    return (
      <div className="absolute inset-0 flex flex-col overflow-hidden">
        {renderCompoundClipLabel(item.label || 'Compound Clip')}
      </div>
    )
  }

  // Subtitle segment - label + cue count + first-cue snippet so the strip is
  // skimmable without expanding into a full-text preview that won't fit.
  if (item.type === 'subtitle') {
    const cueCount = item.cues.length
    const firstCueText = item.cues[0]?.text ?? ''
    return (
      <div className="absolute inset-0 flex flex-col px-2 py-1 overflow-hidden">
        <div className="text-[10px] text-muted-foreground truncate">
          {`Subtitles · ${cueCount} cue${cueCount === 1 ? '' : 's'}`}
        </div>
        <div className="text-xs font-medium truncate flex-1">
          {firstCueText || item.label || 'Subtitles'}
        </div>
      </div>
    )
  }

  // Adjustment layer - show effects summary
  if (item.type === 'adjustment') {
    const enabledEffectsCount = item.effects?.filter((e) => e.enabled).length ?? 0
    return (
      <div className="absolute inset-0 flex flex-col px-2 py-1 overflow-hidden">
        <div className="text-[10px] text-muted-foreground truncate">Adjustment Layer</div>
        <div className="text-xs font-medium truncate flex-1">
          {enabledEffectsCount > 0
            ? `${enabledEffectsCount} effect${enabledEffectsCount > 1 ? 's' : ''}`
            : 'No effects'}
        </div>
      </div>
    )
  }

  // Image items - label + filmstrip
  if (item.type === 'image' && item.src && item.mediaId) {
    // Detect animation from media metadata (reliable), falling back to URL heuristics
    const mediaMimeType = useMediaLibraryStore.getState().mediaById[item.mediaId]?.mimeType
    const isAnimatedGif = mediaMimeType === 'image/gif' || isGifUrl(item.src)
    const isAnimatedWebp = mediaMimeType === 'image/webp' || isWebpUrl(item.src)
    const isAnimated = isAnimatedGif || isAnimatedWebp

    return (
      <div className="absolute inset-0 flex flex-col">
        <div
          className="px-2 text-[11px] font-medium truncate shrink-0"
          style={{
            height: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight,
            lineHeight: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight,
          }}
        >
          {renderTitleText(item.label)}
        </div>
        {showVisualContent && (
          <div className="relative overflow-hidden flex-1 min-h-0">
            {shouldRenderHeavyVisuals && showFilmstrips && (
              <ImageFilmstrip
                mediaId={item.mediaId}
                isAnimated={isAnimated}
                animationFormat={isAnimatedWebp ? 'webp' : 'gif'}
                clipWidth={clipWidth}
                renderWidth={renderWidth}
                isVisible={clipVisibility.isVisible}
                src={item.src}
                sourceStart={sourceStart}
                sourceDuration={sourceDuration}
                trimStart={trimStart}
                speed={speed}
                fps={fps}
                visibleStartRatio={clipVisibility.visibleStartRatio}
                visibleEndRatio={clipVisibility.visibleEndRatio}
                pixelsPerSecond={pixelsPerSecond}
              />
            )}
          </div>
        )}
      </div>
    )
  }

  // Default for shape items - simple label
  return <div className="px-2 py-1 text-xs font-medium truncate">{item.label}</div>
})
