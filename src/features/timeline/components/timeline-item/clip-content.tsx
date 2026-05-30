import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Link2 } from 'lucide-react'
import { perfMarkRender } from '@/shared/logging/perf-marks'
import type { TimelineItem } from '@/types/timeline'
import { useSettingsStore } from '@/features/timeline/deps/settings'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { useCompositionsStore } from '../../stores/compositions-store'
import { useItemsStore } from '../../stores/items-store'
import { useClipVisibility } from '../../hooks/use-clip-visibility'
import { useZoomStore } from '../../stores/zoom-store'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/config/editor-layout'
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
const LazyClipFilmstrip = lazy(() =>
  import('../clip-filmstrip').then((module) => ({
    default: module.ClipFilmstrip,
  })),
)
const LazyImageFilmstrip = lazy(() =>
  import('../clip-filmstrip/image-filmstrip').then((module) => ({
    default: module.ImageFilmstrip,
  })),
)
const LazyClipWaveform = lazy(() =>
  import('../clip-waveform').then((module) => ({
    default: module.ClipWaveform,
  })),
)
const LazyCompoundClipWaveform = lazy(() =>
  import('../clip-waveform/compound-clip-waveform').then((module) => ({
    default: module.CompoundClipWaveform,
  })),
)

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
  const mediaFps = useMediaLibraryStore(
    useCallback(
      (s) => s.mediaById[mediaId]?.fps || segment.sourceFps,
      [mediaId, segment.sourceFps],
    ),
  )
  const mediaDuration = useMediaLibraryStore(
    useCallback((s) => s.mediaById[mediaId]?.duration || 0, [mediaId]),
  )

  const wrapperSpan = Math.max(1, wrapperDurationFrames)
  const widthFraction = Math.min(1, segment.durationInFrames / wrapperSpan)
  const leftFraction = Math.max(0, segment.from / wrapperSpan)
  const segmentClipWidth = Math.max(0, widthFraction * wrapperClipWidthPx)
  const segmentRenderWidth = Math.max(0, widthFraction * wrapperRenderWidthPx)

  const sourceDurationSeconds =
    mediaDuration > 0 ? mediaDuration : segment.sourceDurationFrames / Math.max(1, mediaFps)
  const sourceStartSeconds =
    mediaDuration > 0 && segment.sourceDurationFrames > 0
      ? (segment.sourceStart / segment.sourceDurationFrames) * mediaDuration
      : segment.sourceStart / Math.max(1, mediaFps)
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
      <Suspense fallback={null}>
        <LazyClipFilmstrip
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
      </Suspense>
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
  perfMarkRender('ClipContent')
  // Drive filmstrip/waveform width from the SETTLED zoom (contentPixelsPerSecond)
  // by default, not the live per-frame pps. The clip shell itself resizes
  // smoothly during a zoom gesture via the --timeline-px-per-frame CSS variable
  // (no React), while contentPixelsPerSecond only updates ~100ms after the gesture
  // settles. This stops ClipContent (and the expensive filmstrip tile grid /
  // waveform render) from re-rendering on every wheel/momentum frame — previously
  // ~73% of zoom cost. During the gesture the filmstrip is briefly at the pre-zoom
  // scale, covered by the repeating cover-frame background (zoom-in) or clipped by
  // overflow:hidden (zoom-out); it snaps sharp on settle.
  //
  // preferImmediateRendering (active edit previews — trim/slide) opts back into
  // the live pps so the content tracks the shell frame-for-frame while the user
  // is actively dragging an edge, where the settle lag would be distracting.
  const pixelsPerSecond = useZoomStore((s) =>
    preferImmediateRendering ? s.pixelsPerSecond : s.contentPixelsPerSecond,
  )
  const showWaveforms = useSettingsStore((s) => s.showWaveforms)
  const showFilmstrips = useSettingsStore((s) => s.showFilmstrips)
  const enableFilmstripExtraction = useSettingsStore((s) => s.enableFilmstripExtraction)
  const showVideoFilmstrips = showFilmstrips && enableFilmstripExtraction

  // Defer the heavy filmstrip/waveform mount for clips that first appear DURING
  // an active zoom gesture. Zooming out brings many clips into the viewport at
  // once, and mounting each one's tile grid + canvas draws is ~90% of zoom-out
  // cost. A clip that mounts mid-gesture shows just its colored shell until the
  // zoom settles, then reveals the thumbnails. This is read once at mount via
  // getState() (NOT a reactive subscription) so already-mounted clips never
  // re-render — only clips born mid-gesture defer, and only they subscribe (to
  // flip themselves on once interaction ends).
  const [deferVisual, setDeferVisual] = useState(() => useZoomStore.getState().isZoomInteracting)
  useEffect(() => {
    if (!deferVisual) return
    // The gesture may have settled between the mount-time getState() read and
    // this effect attaching. The subscription only fires on *future* changes, so
    // without this re-check the clip would stay shell-only until the next zoom.
    if (!useZoomStore.getState().isZoomInteracting) {
      setDeferVisual(false)
      return
    }
    return useZoomStore.subscribe((state) => {
      if (!state.isZoomInteracting) setDeferVisual(false)
    })
  }, [deferVisual])

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
  const sourceFps = useMediaLibraryStore(
    useCallback(
      (s) => {
        if (!effectiveMediaId) return fps
        const media = s.mediaById[effectiveMediaId]
        return media?.fps || fps
      },
      [effectiveMediaId, fps],
    ),
  )
  const mediaDuration = useMediaLibraryStore(
    useCallback(
      (s) => {
        if (!effectiveMediaId) return 0
        const media = s.mediaById[effectiveMediaId]
        return media?.duration || 0
      },
      [effectiveMediaId],
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

  const sourceDuration = mediaDuration > 0 ? mediaDuration : sourceDurationFrames / sourceFps
  const sourceStart =
    mediaDuration > 0
      ? (sourceStartFrames / sourceDurationFrames) * mediaDuration
      : sourceStartFrames / sourceFps
  const sourceEndFrames = item.sourceEnd
  const sourceEnd =
    sourceEndFrames === undefined
      ? undefined
      : mediaDuration > 0
        ? (sourceEndFrames / sourceDurationFrames) * mediaDuration
        : sourceEndFrames / sourceFps

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

  const showVisualContent = clipWidth >= FILMSTRIP_MIN_WIDTH_PX && !deferVisual

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
            {showVideoFilmstrips && (
              <Suspense fallback={null}>
                <LazyClipFilmstrip
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
              </Suspense>
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
        {showVisualContent && showWaveforms && (
          <div className="relative overflow-hidden bg-waveform-gradient flex-1 min-h-0">
            <div
              className="absolute inset-0"
              style={{
                transform: `scaleY(var(--timeline-audio-waveform-scale, ${audioWaveformScale}))`,
                transformOrigin: '50% 50%',
              }}
            >
              <Suspense fallback={null}>
                <LazyClipWaveform
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
              </Suspense>
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
        {showVisualContent && showWaveforms && (
          <div className="relative overflow-hidden bg-waveform-gradient flex-1 min-h-0">
            <Suspense fallback={null}>
              <LazyCompoundClipWaveform
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
            </Suspense>
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
                {showVideoFilmstrips &&
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
              {showCompositionWaveform && composition && (
                <div
                  className="relative overflow-hidden bg-waveform-gradient"
                  style={{ height: EDITOR_LAYOUT_CSS_VALUES.timelineWaveformRowHeight }}
                >
                  <Suspense fallback={null}>
                    <LazyCompoundClipWaveform
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
                  </Suspense>
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
          {showVisualContent && showWaveforms && (
            <div className="relative overflow-hidden bg-waveform-gradient flex-1 min-h-0">
              <Suspense fallback={null}>
                <LazyCompoundClipWaveform
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
              </Suspense>
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
            {showFilmstrips && (
              <Suspense fallback={null}>
                <LazyImageFilmstrip
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
              </Suspense>
            )}
          </div>
        )}
      </div>
    )
  }

  // Default for shape items - simple label
  return <div className="px-2 py-1 text-xs font-medium truncate">{item.label}</div>
})
