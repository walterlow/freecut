import { Suspense, lazy, memo, useCallback, useDeferredValue, useMemo, type ReactNode } from 'react'
import { Link2 } from 'lucide-react'
import { perfMarkRender } from '@/shared/logging/perf-marks'
import type { TimelineItem } from '@/types/timeline'
import { useSettingsStore } from '@/features/timeline/deps/settings'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { useCompositionsStore } from '../../stores/compositions-store'
import { useSequencesStore } from '../../stores/sequences-store'
import { useItemsStore } from '../../stores/items-store'
import { useClipVisibility } from '../../hooks/use-clip-visibility'
import { useZoomStore } from '../../stores/zoom-store'
import { getDemotionAwarePixelsPerSecond } from '../../utils/timeline-dom-density'
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
import { useTimelineContentPixelsPerSecond } from '../../contexts/timeline-zoom-context'

const EMPTY_COMPOSITION_LOOKUP: Record<string, never> = {}
const WAVEFORM_MIN_WIDTH_PX = 12
const FILMSTRIP_MIN_WIDTH_PX = 20
const MEDIA_LABEL_MIN_WIDTH_PX = 28
const MEDIA_LINK_ICON_MIN_WIDTH_PX = 48
const MEDIA_LINKED_LABEL_MIN_WIDTH_PX = 56
const MEDIA_LABEL_ROW_HORIZONTAL_PADDING_PX = 16
const MEDIA_LABEL_GAP_PX = 6
const MEDIA_LINK_ICON_WIDTH_PX = 16
const MEDIA_LINKED_LABEL_VISIBLE_TEXT_WIDTH_PX = 18
const MEDIA_SYNC_OFFSET_BADGE_HORIZONTAL_PADDING_PX = 12
const MEDIA_SYNC_OFFSET_CHARACTER_WIDTH_PX = 6.25
const MEDIA_LOD_VISUAL = 1 << 0
const MEDIA_LOD_LINK_ICON = 1 << 1
const MEDIA_LOD_LABEL = 1 << 2
const MEDIA_LOD_SYNC_OFFSET = 1 << 3
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
      data-filmstrip-timeline-segment
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
  isCompactWidth?: boolean
  isLinked?: boolean
  preferImmediateRendering?: boolean
  audioWaveformScale?: number
  linkedSyncOffsetFrames?: number | null
  isDetailEligible?: boolean
}

interface ClipTitleTextProps {
  label: string
  badge?: ReactNode
  isLinked: boolean
  linkedSyncOffsetLabel: string | null
  showLinkIcon?: boolean
  showLabel?: boolean
  showSyncOffset?: boolean
}

function ClipTitleText({
  label,
  badge,
  isLinked,
  linkedSyncOffsetLabel,
  showLinkIcon = true,
  showLabel = true,
  showSyncOffset = true,
}: ClipTitleTextProps) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
      {linkedSyncOffsetLabel && (
        <span
          className="shrink-0 rounded bg-destructive/90 px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-destructive-foreground"
          hidden={!showSyncOffset}
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
          hidden={!showLinkIcon}
          title={
            linkedSyncOffsetLabel
              ? `Linked audio/video pair out of sync by ${linkedSyncOffsetLabel}`
              : 'Linked audio/video pair'
          }
        >
          <Link2 className="h-3 w-3" />
        </span>
      )}
      {badge}
      <span className="min-w-0 truncate" hidden={!showLabel}>
        {label}
      </span>
    </div>
  )
}

function MediaClipLabel({
  label,
  isLinked,
  linkedSyncOffsetLabel,
  showLinkIcon,
  showLabel,
  showSyncOffset,
}: Omit<ClipTitleTextProps, 'badge'>) {
  return (
    <div
      className="px-2 text-[11px] font-medium truncate shrink-0"
      style={{
        height: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight,
        lineHeight: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight,
      }}
    >
      <ClipTitleText
        label={label}
        isLinked={isLinked}
        linkedSyncOffsetLabel={linkedSyncOffsetLabel}
        showLinkIcon={showLinkIcon}
        showLabel={showLabel}
        showSyncOffset={showSyncOffset}
      />
    </div>
  )
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
type MediaTimelineItem = Extract<TimelineItem, { type: 'video' | 'audio' | 'image' }> & {
  mediaId: string
}

interface MediaClipGeometry {
  clipWidth: number
  renderWidth: number
  pixelsPerSecond: number
  showVisualContent: boolean
  clipVisibility: ReturnType<typeof useClipVisibility>
}

function useMediaClipGeometry({
  clipLeftFrames,
  clipWidthFrames,
  fps,
  preferImmediateRendering,
  minVisualWidthPx,
}: Pick<
  ClipContentProps,
  'clipLeftFrames' | 'clipWidthFrames' | 'fps' | 'preferImmediateRendering'
> & {
  minVisualWidthPx: number
}): MediaClipGeometry {
  const pixelsPerSecond = useTimelineContentPixelsPerSecond(preferImmediateRendering)
  const clipLeftPx = useMemo(
    () => (fps > 0 ? (clipLeftFrames / fps) * pixelsPerSecond : 0),
    [clipLeftFrames, fps, pixelsPerSecond],
  )
  const clipWidth = useMemo(
    () => Math.max(0, fps > 0 ? (clipWidthFrames / fps) * pixelsPerSecond : 0),
    [clipWidthFrames, fps, pixelsPerSecond],
  )
  const clipVisibility = useClipVisibility(clipLeftPx, clipWidth, pixelsPerSecond)

  return {
    clipWidth,
    renderWidth: Math.ceil(clipWidth * RENDER_BUFFER),
    pixelsPerSecond,
    showVisualContent: clipWidth >= minVisualWidthPx,
    clipVisibility,
  }
}

interface MediaSourceTiming {
  sourceStart: number
  sourceEnd: number | undefined
  sourceDuration: number
  trimStart: number
  speed: number
  isReversed: boolean
}

function useMediaSourceTiming(item: MediaTimelineItem, fps: number): MediaSourceTiming {
  const sourceFps = useMediaLibraryStore(
    useCallback(
      (s) => {
        const media = s.mediaById[item.mediaId]
        return media?.fps || fps
      },
      [item.mediaId, fps],
    ),
  )
  const mediaDuration = useMediaLibraryStore(
    useCallback((s) => s.mediaById[item.mediaId]?.duration || 0, [item.mediaId]),
  )
  const sourceDurationFrames = Math.max(1, item.sourceDuration ?? item.durationInFrames)
  const sourceStartFrames = Math.max(0, item.sourceStart ?? 0)
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

  return {
    sourceStart,
    sourceEnd,
    sourceDuration,
    trimStart: (item.trimStart ?? 0) / fps,
    speed: item.speed ?? 1,
    isReversed: item.isReversed === true,
  }
}

const VideoClipVisualContent = memo(function VideoClipVisualContent({
  item,
  clipLeftFrames,
  clipWidthFrames,
  fps,
  preferImmediateRendering = false,
}: Omit<ClipContentProps, 'item'> & { item: MediaTimelineItem & { type: 'video' } }) {
  const showVideoFilmstrips = useSettingsStore(
    (s) => s.showFilmstrips && s.enableFilmstripExtraction,
  )
  const geometry = useMediaClipGeometry({
    clipLeftFrames,
    clipWidthFrames,
    fps,
    preferImmediateRendering,
    minVisualWidthPx: FILMSTRIP_MIN_WIDTH_PX,
  })
  const source = useMediaSourceTiming(item, fps)

  if (!geometry.showVisualContent || !showVideoFilmstrips) {
    return null
  }

  return (
    <div className="relative overflow-hidden flex-1 min-h-0">
      <Suspense fallback={null}>
        <LazyClipFilmstrip
          mediaId={item.mediaId}
          clipWidth={geometry.clipWidth}
          renderWidth={geometry.renderWidth}
          sourceStart={source.sourceStart}
          sourceEnd={source.sourceEnd}
          sourceDuration={source.sourceDuration}
          trimStart={source.trimStart}
          speed={source.speed}
          isReversed={source.isReversed}
          fps={fps}
          isVisible={geometry.clipVisibility.isVisible}
          visibleStartRatio={geometry.clipVisibility.visibleStartRatio}
          visibleEndRatio={geometry.clipVisibility.visibleEndRatio}
          pixelsPerSecond={geometry.pixelsPerSecond}
          preferImmediateRendering={preferImmediateRendering}
        />
      </Suspense>
    </div>
  )
})

const AudioClipVisualContent = memo(function AudioClipVisualContent({
  item,
  clipLeftFrames,
  clipWidthFrames,
  fps,
  preferImmediateRendering = false,
  audioWaveformScale = 1,
}: Omit<ClipContentProps, 'item'> & { item: MediaTimelineItem & { type: 'audio' } }) {
  const showWaveforms = useSettingsStore((s) => s.showWaveforms)
  const geometry = useMediaClipGeometry({
    clipLeftFrames,
    clipWidthFrames,
    fps,
    preferImmediateRendering,
    minVisualWidthPx: WAVEFORM_MIN_WIDTH_PX,
  })
  const source = useMediaSourceTiming(item, fps)

  if (!geometry.showVisualContent || !showWaveforms) {
    return null
  }

  return (
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
            clipWidth={geometry.clipWidth}
            renderWidth={geometry.renderWidth}
            sourceStart={source.sourceStart}
            sourceEnd={source.sourceEnd}
            sourceDuration={source.sourceDuration}
            trimStart={source.trimStart}
            speed={source.speed}
            isReversed={source.isReversed}
            fps={fps}
            isVisible={geometry.clipVisibility.isVisible}
            visibleStartRatio={geometry.clipVisibility.visibleStartRatio}
            visibleEndRatio={geometry.clipVisibility.visibleEndRatio}
            pixelsPerSecond={geometry.pixelsPerSecond}
            liveTimelineZoom
          />
        </Suspense>
      </div>
    </div>
  )
})

const ImageClipVisualContent = memo(function ImageClipVisualContent({
  item,
  clipLeftFrames,
  clipWidthFrames,
  fps,
  preferImmediateRendering = false,
}: Omit<ClipContentProps, 'item'> & { item: MediaTimelineItem & { type: 'image' } }) {
  const showFilmstrips = useSettingsStore((s) => s.showFilmstrips)
  const geometry = useMediaClipGeometry({
    clipLeftFrames,
    clipWidthFrames,
    fps,
    preferImmediateRendering,
    minVisualWidthPx: FILMSTRIP_MIN_WIDTH_PX,
  })
  const source = useMediaSourceTiming(item, fps)
  const mediaMimeType = useMediaLibraryStore.getState().mediaById[item.mediaId]?.mimeType
  const isAnimatedGif = mediaMimeType === 'image/gif' || isGifUrl(item.src)
  const isAnimatedWebp = mediaMimeType === 'image/webp' || isWebpUrl(item.src)

  if (!geometry.showVisualContent || !showFilmstrips) {
    return null
  }

  return (
    <div className="relative overflow-hidden flex-1 min-h-0">
      <Suspense fallback={null}>
        <LazyImageFilmstrip
          mediaId={item.mediaId}
          isAnimated={isAnimatedGif || isAnimatedWebp}
          animationFormat={isAnimatedWebp ? 'webp' : 'gif'}
          clipWidth={geometry.clipWidth}
          renderWidth={geometry.renderWidth}
          isVisible={geometry.clipVisibility.isVisible}
          src={item.src}
          sourceStart={source.sourceStart}
          sourceDuration={source.sourceDuration}
          trimStart={source.trimStart}
          speed={source.speed}
          fps={fps}
          visibleStartRatio={geometry.clipVisibility.visibleStartRatio}
          visibleEndRatio={geometry.clipVisibility.visibleEndRatio}
          pixelsPerSecond={geometry.pixelsPerSecond}
        />
      </Suspense>
    </div>
  )
})

const StaticClipContent = memo(function StaticClipContent({ item }: { item: TimelineItem }) {
  perfMarkRender('ClipContent')

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

  if (item.type === 'adjustment') {
    const enabledEffectsCount = item.effects?.filter((effect) => effect.enabled).length ?? 0
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

  return <div className="px-2 py-1 text-xs font-medium truncate">{item.label}</div>
})

const DetailedCompositionClipContent = memo(function DetailedCompositionClipContent({
  item,
  clipLeftFrames,
  clipWidthFrames,
  fps,
  isLinked = false,
  preferImmediateRendering = false,
  linkedSyncOffsetFrames = null,
}: ClipContentProps) {
  perfMarkRender('ClipContent')
  // Keep ClipContent measurements on the SETTLED zoom
  // (contentPixelsPerSecond) by default. The clip shell itself resizes smoothly
  // through the live-width percentage geometry layer without rerendering this subtree. Filmstrips
  // remain on this settled geometry and use their cached repeating cover while
  // zoom is live. Mounted waveforms independently sample the live zoom at a
  // bounded redraw cadence, so they stay sharp without putting ClipContent back
  // on the per-frame zoom hot path.
  //
  // preferImmediateRendering (active edit previews — trim/slide) opts back into
  // the live pps so the content tracks the shell frame-for-frame while the user
  // is actively dragging an edge, where the settle lag would be distracting.
  const pixelsPerSecond = useTimelineContentPixelsPerSecond(preferImmediateRendering)
  const showWaveforms = useSettingsStore((s) => s.showWaveforms)
  const showVideoFilmstrips = useSettingsStore(
    (s) => s.showFilmstrips && s.enableFilmstripExtraction,
  )

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
  const clipVisibility = useClipVisibility(clipLeftPx, clipWidth, pixelsPerSecond)
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
  // A clip that references a standalone sequence reads "Sequence", a Motion
  // composition reads "Composition", and a classic pre-comp reads "Compound".
  const isSequenceClip = useSequencesStore(
    useCallback(
      (s) => (compositionId ? s.topLevelSequenceIds.includes(compositionId) : false),
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
    (label: string, badge?: ReactNode) => (
      <ClipTitleText
        label={label}
        badge={badge}
        isLinked={isLinked}
        linkedSyncOffsetLabel={linkedSyncOffsetLabel}
      />
    ),
    [isLinked, linkedSyncOffsetLabel],
  )

  const compositionSourceDurationFrames = Math.max(
    1,
    composition?.durationInFrames ?? item.sourceDuration ?? item.durationInFrames,
  )
  const compositionSourceStartFrames = Math.max(0, item.sourceStart ?? item.trimStart ?? 0)
  const isReversed = item.isReversed === true
  const compoundClipTimelineFps = composition?.fps ?? fps
  const compoundClipSourceDuration = compositionSourceDurationFrames / compoundClipTimelineFps
  const compoundClipSourceStart = compositionSourceStartFrames / compoundClipTimelineFps
  const compositionKindLabel =
    composition?.editorKind === 'composite-2d'
      ? 'Composition'
      : isSequenceClip
        ? 'Sequence'
        : 'Compound'
  const defaultCompositionLabel =
    composition?.editorKind === 'composite-2d' ? 'Composition' : 'Compound Clip'

  const renderCompoundClipLabel = useCallback(
    (label: string) => (
      <div
        className="flex items-center gap-1.5 px-2 text-[11px] font-medium truncate shrink-0"
        style={{
          height: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight,
          lineHeight: EDITOR_LAYOUT_CSS_VALUES.timelineClipLabelRowHeight,
        }}
      >
        {/* Badge sits after the link icon so the link icon stays flush-left like
            every other clip's label row. */}
        {renderTitleText(
          label,
          <span className="shrink-0 rounded bg-violet-950/40 px-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-violet-100/90">
            {compositionKindLabel}
          </span>,
        )}
      </div>
    ),
    [compositionKindLabel, renderTitleText],
  )

  // Resolve-style visual LOD: a thumbnail needs more real pixel width to remain
  // legible, while a waveform is still useful in a much narrower clip.
  const showFilmstripContent = clipWidth >= FILMSTRIP_MIN_WIDTH_PX
  const showWaveformContent = clipWidth >= WAVEFORM_MIN_WIDTH_PX
  const showFilmstripRow = showFilmstripContent && showVideoFilmstrips
  const showWaveformRow = showWaveformContent && showCompositionWaveform && !!composition

  if (isCompositionAudioWrapper && composition) {
    return (
      <div className="absolute inset-0 flex flex-col">
        {renderCompoundClipLabel(item.label || defaultCompositionLabel)}
        {showWaveformContent && showWaveforms && (
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
              />
            </Suspense>
          </div>
        )}
      </div>
    )
  }

  // Composition item - multi-segment filmstrip from visible sub-comp videos, or label fallback
  if (item.type === 'composition') {
    if (visualSegments.length > 0) {
      return (
        <div className="absolute inset-0 flex flex-col">
          {renderCompoundClipLabel(item.label || defaultCompositionLabel)}
          {showFilmstripRow && (
            <div className="relative overflow-hidden flex-1 min-h-0">
              {visualSegments.map((segment) => (
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
          )}
          {showWaveformRow && (
            <div
              className={`relative overflow-hidden bg-waveform-gradient ${
                showFilmstripRow ? '' : 'flex-1 min-h-0'
              }`}
              style={
                showFilmstripRow
                  ? { height: EDITOR_LAYOUT_CSS_VALUES.timelineWaveformRowHeight }
                  : undefined
              }
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
                />
              </Suspense>
            </div>
          )}
        </div>
      )
    }
    if (compositionSummary.hasOwnedAudio && composition && !hasCompositionAudioCompanion) {
      return (
        <div className="absolute inset-0 flex flex-col">
          {renderCompoundClipLabel(item.label || defaultCompositionLabel)}
          {showWaveformContent && showWaveforms && (
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
                />
              </Suspense>
            </div>
          )}
        </div>
      )
    }
    return (
      <div className="absolute inset-0 flex flex-col overflow-hidden">
        {renderCompoundClipLabel(item.label || defaultCompositionLabel)}
      </div>
    )
  }

  // Missing composition data keeps the legacy simple-label fallback.
  return <div className="px-2 py-1 text-xs font-medium truncate">{item.label}</div>
})

const DetailedClipContent = memo(function DetailedClipContent(props: ClipContentProps) {
  const { item } = props

  if (item.type === 'composition' || (item.type === 'audio' && item.compositionId)) {
    return <DetailedCompositionClipContent {...props} />
  }
  return <StaticClipContent item={item} />
})

function hasBasicMediaVisuals(item: TimelineItem): boolean {
  if (item.type === 'video') {
    return !!item.mediaId
  }
  if (item.type === 'audio') {
    return !!item.mediaId && !item.compositionId
  }
  return item.type === 'image' && !!item.src && !!item.mediaId
}

function getMediaVisualMinWidthPx(item: TimelineItem): number {
  return item.type === 'audio' ? WAVEFORM_MIN_WIDTH_PX : FILMSTRIP_MIN_WIDTH_PX
}

function getSyncOffsetBadgeMinWidthPx(linkedSyncOffsetLabel: string): number {
  const badgeWidthPx =
    MEDIA_SYNC_OFFSET_BADGE_HORIZONTAL_PADDING_PX +
    linkedSyncOffsetLabel.length * MEDIA_SYNC_OFFSET_CHARACTER_WIDTH_PX
  return MEDIA_LABEL_ROW_HORIZONTAL_PADDING_PX + Math.ceil(badgeWidthPx)
}

const WidthGatedMediaClipContent = memo(function WidthGatedMediaClipContent(
  props: ClipContentProps,
) {
  const {
    item,
    clipWidthFrames,
    fps,
    isLinked = false,
    linkedSyncOffsetFrames = null,
    isDetailEligible = true,
  } = props
  const minVisualWidthPx = getMediaVisualMinWidthPx(item)
  const linkedSyncOffsetLabel =
    linkedSyncOffsetFrames === null ? null : formatSignedFrameDelta(linkedSyncOffsetFrames, fps)
  const syncOffsetBadgeMinWidthPx =
    linkedSyncOffsetLabel === null ? null : getSyncOffsetBadgeMinWidthPx(linkedSyncOffsetLabel)
  // This selector still evaluates on live zoom updates, but its integer bitmask
  // changes only when the clip crosses a real-pixel detail boundary. Expensive
  // filmstrips, waveforms, labels, and icons therefore demote across the gesture
  // instead of batching hundreds of React commits into the settle frame.
  const mediaLod = useZoomStore(
    useCallback(
      (state) => {
        if (fps <= 0 || !isDetailEligible) return 0
        const durationSeconds = clipWidthFrames / fps
        const detailPixelsPerSecond = getDemotionAwarePixelsPerSecond(
          state.contentPixelsPerSecond,
          state.pixelsPerSecond,
          state.isZoomInteracting,
        )
        const detailWidthPx = durationSeconds * detailPixelsPerSecond
        let lod = 0
        if (detailWidthPx >= minVisualWidthPx) lod |= MEDIA_LOD_VISUAL
        if (syncOffsetBadgeMinWidthPx !== null) {
          if (detailWidthPx >= syncOffsetBadgeMinWidthPx) {
            lod |= MEDIA_LOD_SYNC_OFFSET
          }
          const syncOffsetLinkIconMinWidthPx =
            syncOffsetBadgeMinWidthPx + MEDIA_LABEL_GAP_PX + MEDIA_LINK_ICON_WIDTH_PX
          if (detailWidthPx >= syncOffsetLinkIconMinWidthPx) {
            lod |= MEDIA_LOD_LINK_ICON
          }
          const syncOffsetLabelMinWidthPx =
            syncOffsetLinkIconMinWidthPx +
            MEDIA_LABEL_GAP_PX +
            MEDIA_LINKED_LABEL_VISIBLE_TEXT_WIDTH_PX
          if (detailWidthPx >= syncOffsetLabelMinWidthPx) {
            lod |= MEDIA_LOD_LABEL
          }
        } else {
          if (detailWidthPx >= MEDIA_LINK_ICON_MIN_WIDTH_PX) lod |= MEDIA_LOD_LINK_ICON
          const labelThreshold = isLinked
            ? MEDIA_LINKED_LABEL_MIN_WIDTH_PX
            : MEDIA_LABEL_MIN_WIDTH_PX
          if (detailWidthPx >= labelThreshold) lod |= MEDIA_LOD_LABEL
        }
        return lod
      },
      [
        clipWidthFrames,
        fps,
        isDetailEligible,
        isLinked,
        minVisualWidthPx,
        syncOffsetBadgeMinWidthPx,
      ],
    ),
  )
  // Intersect with the deferred mask: removed bits disappear immediately,
  // while ordinary detail promotion can use React's deferred lane.
  const deferredMediaLod = useDeferredValue(mediaLod)
  const visibleMediaLod = mediaLod & deferredMediaLod
  const showVisualDetail = (visibleMediaLod & MEDIA_LOD_VISUAL) !== 0
  const showLinkIcon = (visibleMediaLod & MEDIA_LOD_LINK_ICON) !== 0
  const showLabel = (visibleMediaLod & MEDIA_LOD_LABEL) !== 0
  const showSyncOffset = (visibleMediaLod & MEDIA_LOD_SYNC_OFFSET) !== 0
  const hasVisibleClipContent = showVisualDetail || showLinkIcon || showLabel || showSyncOffset

  perfMarkRender('ClipContent')

  return (
    <div
      className="absolute inset-0 flex flex-col"
      data-media-clip-content
      hidden={!hasVisibleClipContent}
      style={!hasVisibleClipContent ? { display: 'none' } : undefined}
    >
      <MediaClipLabel
        label={item.label}
        isLinked={isLinked}
        linkedSyncOffsetLabel={linkedSyncOffsetLabel}
        showLinkIcon={showLinkIcon}
        showLabel={showLabel}
        showSyncOffset={showSyncOffset}
      />
      {showVisualDetail && item.type === 'video' && (
        <VideoClipVisualContent {...props} item={item as MediaTimelineItem & { type: 'video' }} />
      )}
      {showVisualDetail && item.type === 'audio' && (
        <AudioClipVisualContent {...props} item={item as MediaTimelineItem & { type: 'audio' }} />
      )}
      {showVisualDetail && item.type === 'image' && (
        <ImageClipVisualContent {...props} item={item as MediaTimelineItem & { type: 'image' }} />
      )}
    </div>
  )
})

export const ClipContent = memo(function ClipContent(props: ClipContentProps) {
  // Compact clips already retain the full interactive TimelineItem root. Do
  // not also mount a label/filmstrip/waveform subtree that cannot be read at
  // this width. Besides reducing layout work, returning before the width-gated
  // media component avoids one live zoom-store subscription per compact clip.
  // Detail is restored only by real-pixel zoom, never by hover or selection.
  if (props.isCompactWidth === true) {
    return null
  }
  if (hasBasicMediaVisuals(props.item)) {
    return <WidthGatedMediaClipContent {...props} />
  }
  if (props.isDetailEligible === false) {
    return null
  }
  return <DetailedClipContent {...props} />
})
