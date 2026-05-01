import {
  DEFAULT_TRACK_HEIGHT,
  getEffectiveTrackKindForItem,
  getNextClassicTrackName,
  type TrackKind,
} from '../deps/timeline-contract'
import type { MediaTranscriptSegment } from '@/types/storage'
import type { MediaCaption } from '@/infrastructure/analysis'
import type { SubtitleCue, SubtitleFormat } from '@/shared/utils/subtitles'
import type {
  AudioItem,
  GeneratedCaptionSource,
  SubtitleSegmentItem,
  TextItem,
  TimelineItem,
  TimelineTrack,
  VideoItem,
} from '@/types/timeline'
import { timelineToSourceFrames } from '../deps/timeline-contract'

/**
 * Fallback segment duration when AI captions can't infer an `end` time from
 * the next caption (i.e. for the last caption, or when the sample interval is
 * unknown). Seconds.
 */
const AI_CAPTION_FALLBACK_DURATION_SEC = 3

interface BuildCaptionTextItemsOptions {
  mediaId: string
  trackId: string
  segments: readonly MediaTranscriptSegment[]
  clip: AudioItem | VideoItem
  timelineFps: number
  canvasWidth: number
  canvasHeight: number
  styleTemplate?: CaptionTextItemTemplate
  /**
   * Discriminator for the `captionSource.type` stamped on the generated
   * text items. Defaults to `'transcript'` (whisper flow); AI captioning
   * flows pass `'ai-captions'` so later replace/remove operations can tell
   * the two kinds apart on the same clip.
   */
  sourceType?: GeneratedCaptionSource['type']
}

interface BuildSubtitleTextItemsOptions {
  trackId: string
  cues: readonly SubtitleCue[]
  timelineFps: number
  canvasWidth: number
  canvasHeight: number
  fileName: string
  format: SubtitleFormat
  startFrame?: number
  styleTemplate?: CaptionTextItemTemplate
  sourceType?: Extract<GeneratedCaptionSource['type'], 'subtitle-import' | 'embedded-subtitles'>
}

interface BuildSubtitleTextItemsForClipOptions {
  trackId: string
  cues: readonly SubtitleCue[]
  clip: AudioItem | VideoItem
  timelineFps: number
  canvasWidth: number
  canvasHeight: number
  fileName: string
  format: SubtitleFormat
  styleTemplate?: CaptionTextItemTemplate
  sourceType?: Extract<GeneratedCaptionSource['type'], 'subtitle-import' | 'embedded-subtitles'>
}

export type CaptionTextItemTemplate = Pick<
  TextItem,
  | 'fontSize'
  | 'fontFamily'
  | 'fontWeight'
  | 'fontStyle'
  | 'underline'
  | 'color'
  | 'backgroundColor'
  | 'backgroundRadius'
  | 'textPadding'
  | 'textAlign'
  | 'verticalAlign'
  | 'lineHeight'
  | 'letterSpacing'
  | 'textShadow'
  | 'stroke'
  | 'transform'
>

export interface CaptionableClipRange {
  clip: AudioItem | VideoItem
  startFrame: number
  endFrame: number
}

export function normalizeCaptionSegments(
  segments: readonly MediaTranscriptSegment[],
): MediaTranscriptSegment[] {
  return segments
    .map((segment) => ({
      text: segment.text.trim(),
      start: Math.max(0, segment.start),
      end: Math.max(segment.start, segment.end),
    }))
    .filter((segment) => segment.text.length > 0 && segment.end > segment.start)
}

export function getCaptionFrameRange(
  segments: readonly MediaTranscriptSegment[],
  fps: number,
): { startFrame: number; endFrame: number } | null {
  const normalized = normalizeCaptionSegments(segments)
  const first = normalized[0]
  const last = normalized.at(-1)

  if (!first || !last) {
    return null
  }

  return {
    startFrame: Math.round(first.start * fps),
    endFrame: Math.max(Math.round(last.end * fps), Math.round(first.start * fps) + 1),
  }
}

function toSourceStartFrame(seconds: number, sourceFps: number): number {
  return Math.max(0, Math.floor(seconds * sourceFps))
}

function toSourceEndFrame(seconds: number, sourceFps: number): number {
  return Math.max(0, Math.ceil(seconds * sourceFps))
}

function sourceFramesToTimelineFramesFloor(
  sourceFrames: number,
  speed: number,
  sourceFps: number,
  timelineFps: number,
): number {
  if (sourceFrames <= 0) {
    return 0
  }

  const sourceSeconds = sourceFrames / sourceFps
  return Math.max(0, Math.floor((sourceSeconds * timelineFps) / speed))
}

function sourceFramesToTimelineFramesCeil(
  sourceFrames: number,
  speed: number,
  sourceFps: number,
  timelineFps: number,
): number {
  if (sourceFrames <= 0) {
    return 0
  }

  const sourceSeconds = sourceFrames / sourceFps
  return Math.max(0, Math.ceil((sourceSeconds * timelineFps) / speed))
}

function getClipSourceBounds(
  clip: AudioItem | VideoItem,
  timelineFps: number,
): {
  sourceStart: number
  sourceEnd: number
  sourceFps: number
  speed: number
} {
  const speed = clip.speed ?? 1
  const sourceStart = clip.sourceStart ?? 0
  const sourceFps = clip.sourceFps ?? timelineFps
  const derivedSourceEnd =
    sourceStart + timelineToSourceFrames(clip.durationInFrames, speed, timelineFps, sourceFps)

  return {
    sourceStart,
    sourceEnd: clip.sourceEnd ?? derivedSourceEnd,
    sourceFps,
    speed,
  }
}

export function getCaptionRangeForClip(
  clip: AudioItem | VideoItem,
  segments: readonly MediaTranscriptSegment[],
  timelineFps: number,
): { startFrame: number; endFrame: number } | null {
  const normalizedSegments = normalizeCaptionSegments(segments)
  if (normalizedSegments.length === 0) {
    return null
  }

  const { sourceStart, sourceEnd, sourceFps, speed } = getClipSourceBounds(clip, timelineFps)
  let firstFrame: number | null = null
  let lastFrame: number | null = null

  for (const segment of normalizedSegments) {
    const segmentSourceStart = toSourceStartFrame(segment.start, sourceFps)
    const segmentSourceEnd = toSourceEndFrame(segment.end, sourceFps)
    const overlapStart = Math.max(sourceStart, segmentSourceStart)
    const overlapEnd = Math.min(sourceEnd, segmentSourceEnd)

    if (overlapEnd <= overlapStart) {
      continue
    }

    const startOffset = sourceFramesToTimelineFramesFloor(
      overlapStart - sourceStart,
      speed,
      sourceFps,
      timelineFps,
    )
    const endOffset = sourceFramesToTimelineFramesCeil(
      overlapEnd - sourceStart,
      speed,
      sourceFps,
      timelineFps,
    )

    const startFrame = clip.from + Math.min(startOffset, clip.durationInFrames - 1)
    const endFrame =
      clip.from + Math.min(clip.durationInFrames, Math.max(startOffset + 1, endOffset))

    firstFrame = firstFrame === null ? startFrame : Math.min(firstFrame, startFrame)
    lastFrame = lastFrame === null ? endFrame : Math.max(lastFrame, endFrame)
  }

  if (firstFrame === null || lastFrame === null || lastFrame <= firstFrame) {
    return null
  }

  return { startFrame: firstFrame, endFrame: lastFrame }
}

export function findCompatibleCaptionTrack(
  tracks: readonly TimelineTrack[],
  items: readonly TimelineItem[],
  startFrame: number,
  endFrame: number,
): TimelineTrack | null {
  return findCompatibleGeneratedTrackForRanges(tracks, items, [{ startFrame, endFrame }], 'video')
}

export function findCompatibleCaptionTrackForRanges(
  tracks: readonly TimelineTrack[],
  items: readonly TimelineItem[],
  ranges: ReadonlyArray<{ startFrame: number; endFrame: number }>,
): TimelineTrack | null {
  return findCompatibleGeneratedTrackForRanges(tracks, items, ranges, 'video')
}

export function findCompatibleGeneratedTrackForRanges(
  tracks: readonly TimelineTrack[],
  items: readonly TimelineItem[],
  ranges: ReadonlyArray<{ startFrame: number; endFrame: number }>,
  requiredKind: TrackKind,
): TimelineTrack | null {
  const sortedTracks = [...tracks].sort((a, b) => a.order - b.order)

  for (const track of sortedTracks) {
    if (!isGeneratedContentTrackCandidate(track, items, requiredKind)) {
      continue
    }

    const hasOverlap = ranges.some((range) =>
      items.some((item) => {
        if (item.trackId !== track.id) {
          return false
        }

        const itemEnd = item.from + item.durationInFrames
        return item.from < range.endFrame && itemEnd > range.startFrame
      }),
    )

    if (!hasOverlap) {
      return track
    }
  }

  return null
}

export function isGeneratedContentTrackCandidate(
  track: TimelineTrack,
  items: readonly TimelineItem[],
  requiredKind: TrackKind,
): boolean {
  if (track.visible === false || track.locked || track.isGroup) {
    return false
  }

  const effectiveKind = getEffectiveTrackKindForItem(track, items)
  if (requiredKind === 'audio') {
    return effectiveKind === 'audio'
  }

  return effectiveKind === 'video' || effectiveKind === null
}

export function isCaptionTrackCandidate(
  track: TimelineTrack,
  items: readonly TimelineItem[],
): boolean {
  return isGeneratedContentTrackCandidate(track, items, 'video')
}

export function buildCaptionTrack(tracks: readonly TimelineTrack[]): TimelineTrack {
  const maxOrder = tracks.reduce((highest, track) => Math.max(highest, track.order), -1)
  return {
    id: `track-captions-${Date.now()}`,
    name: getNextClassicTrackName([...tracks], 'video'),
    kind: 'video',
    height: DEFAULT_TRACK_HEIGHT,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    order: maxOrder + 1,
    items: [],
  }
}

/**
 * Build a captions track positioned *above* a reference track (the clip's
 * own track in the AI-captions flow). The new track's `order` is set halfway
 * between `referenceOrder` and the next track up, so both stay unique and no
 * existing tracks need to shift.
 *
 * If nothing sits above the reference, we land a full integer lower than it.
 * Matches the fractional-order pattern used by `insertTrack` in
 * `use-timeline-tracks.ts`.
 */
export function buildCaptionTrackAbove(
  tracks: readonly TimelineTrack[],
  referenceOrder: number,
): TimelineTrack {
  const ordersStrictlyAbove = tracks.map((t) => t.order).filter((order) => order < referenceOrder)
  const previousOrder =
    ordersStrictlyAbove.length > 0 ? Math.max(...ordersStrictlyAbove) : referenceOrder - 2
  const newOrder = (previousOrder + referenceOrder) / 2

  return {
    id: `track-captions-${Date.now()}`,
    name: getNextClassicTrackName([...tracks], 'video'),
    kind: 'video',
    height: DEFAULT_TRACK_HEIGHT,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    order: newOrder,
    items: [],
  }
}

function buildCaptionSource(
  mediaId: string,
  clipId: string,
  type: GeneratedCaptionSource['type'] = 'transcript',
  metadata?: Omit<GeneratedCaptionSource, 'type' | 'clipId' | 'mediaId'>,
): GeneratedCaptionSource {
  return {
    type,
    mediaId,
    clipId,
    ...metadata,
  }
}

/**
 * Convert AI captions (point-in-time frame descriptions) into segments with
 * start/end pairs consumable by {@link buildCaptionTextItems}.
 *
 * AI captions have no intrinsic duration — the end time is derived from the
 * next caption's `timeSec`, with a fallback to the provider's sample interval
 * (or {@link AI_CAPTION_FALLBACK_DURATION_SEC}) for the final caption.
 */
export function aiCaptionsToSegments(
  captions: readonly MediaCaption[],
  sampleIntervalSec?: number,
): MediaTranscriptSegment[] {
  if (captions.length === 0) return []
  const sorted = [...captions].sort((a, b) => a.timeSec - b.timeSec)
  const fallbackEndDelta =
    sampleIntervalSec && sampleIntervalSec > 0
      ? sampleIntervalSec
      : AI_CAPTION_FALLBACK_DURATION_SEC

  return sorted.map((caption, index) => {
    const next = sorted[index + 1]
    const start = Math.max(0, caption.timeSec)
    const end = next !== undefined ? Math.max(start + 0.01, next.timeSec) : start + fallbackEndDelta
    return {
      text: caption.text,
      start,
      end,
    }
  })
}

export function isGeneratedCaptionTextItem(
  item: TimelineItem,
): item is TextItem & { captionSource: GeneratedCaptionSource } {
  return (
    item.type === 'text' &&
    (item.captionSource?.type === 'transcript' ||
      item.captionSource?.type === 'ai-captions' ||
      item.captionSource?.type === 'subtitle-import' ||
      item.captionSource?.type === 'embedded-subtitles') &&
    item.captionSource.clipId.length > 0 &&
    item.captionSource.mediaId.length > 0
  )
}

export function isGeneratedCaptionSegmentItem(item: TimelineItem): item is SubtitleSegmentItem & {
  source: Extract<import('@/types/timeline').SubtitleSegmentSource, { type: 'transcript' }>
} {
  return (
    item.type === 'subtitle' &&
    item.source.type === 'transcript' &&
    item.source.clipId.length > 0 &&
    item.source.mediaId.length > 0
  )
}

export function findGeneratedCaptionItemsForClip(
  items: readonly TimelineItem[],
  clipId: string,
  sourceType?: GeneratedCaptionSource['type'],
): Array<
  | (TextItem & { captionSource: GeneratedCaptionSource })
  | (SubtitleSegmentItem & {
      source: Extract<import('@/types/timeline').SubtitleSegmentSource, { type: 'transcript' }>
    })
> {
  return items.filter(
    (
      item,
    ): item is
      | (TextItem & { captionSource: GeneratedCaptionSource })
      | (SubtitleSegmentItem & {
          source: Extract<import('@/types/timeline').SubtitleSegmentSource, { type: 'transcript' }>
        }) => {
      if (isGeneratedCaptionTextItem(item)) {
        return (
          item.captionSource.clipId === clipId &&
          (sourceType === undefined || item.captionSource.type === sourceType)
        )
      }
      return (
        isGeneratedCaptionSegmentItem(item) &&
        item.source.clipId === clipId &&
        (sourceType === undefined || sourceType === 'transcript')
      )
    },
  )
}

function isLegacyGeneratedCaptionItemForClip(
  item: TimelineItem,
  clip: AudioItem | VideoItem,
): item is TextItem {
  if (item.type !== 'text' || item.captionSource || item.mediaId !== clip.mediaId) {
    return false
  }

  const clipEnd = clip.from + clip.durationInFrames
  const itemEnd = item.from + item.durationInFrames
  return (
    item.from >= clip.from &&
    itemEnd <= clipEnd &&
    item.text.trim().length > 0 &&
    item.label === item.text.slice(0, 48)
  )
}

export function findReplaceableCaptionItemsForClip(
  items: readonly TimelineItem[],
  clip: AudioItem | VideoItem,
  sourceType?: GeneratedCaptionSource['type'],
): Array<TextItem | SubtitleSegmentItem> {
  const generatedCaptionItems = findGeneratedCaptionItemsForClip(items, clip.id, sourceType)
  if (generatedCaptionItems.length > 0) {
    return generatedCaptionItems
  }

  // Legacy fallback only applies to transcript-generated captions (the only
  // kind that predates the `captionSource` discriminator).
  if (sourceType !== undefined && sourceType !== 'transcript') {
    return []
  }
  return items.filter((item): item is TextItem => isLegacyGeneratedCaptionItemForClip(item, clip))
}

export function getCaptionTextItemTemplate(
  item: TextItem | SubtitleSegmentItem,
): CaptionTextItemTemplate {
  return {
    fontSize: item.fontSize,
    fontFamily: item.fontFamily,
    fontWeight: item.fontWeight,
    fontStyle: item.fontStyle,
    underline: item.underline,
    color: item.color,
    backgroundColor: item.backgroundColor,
    backgroundRadius: item.backgroundRadius,
    textPadding: item.textPadding,
    textAlign: item.textAlign,
    verticalAlign: item.verticalAlign,
    lineHeight: item.lineHeight,
    letterSpacing: item.letterSpacing,
    textShadow: item.textShadow ? { ...item.textShadow } : undefined,
    stroke: item.stroke ? { ...item.stroke } : undefined,
    transform: item.transform ? { ...item.transform } : undefined,
  }
}

export function buildCaptionTextItems({
  mediaId,
  trackId,
  segments,
  clip,
  timelineFps,
  canvasWidth,
  canvasHeight,
  styleTemplate,
  sourceType = 'transcript',
}: BuildCaptionTextItemsOptions): TextItem[] {
  const normalizedSegments = normalizeCaptionSegments(segments)
  const { sourceStart, sourceEnd, sourceFps, speed } = getClipSourceBounds(clip, timelineFps)

  return normalizedSegments.flatMap((segment) => {
    const segmentSourceStart = toSourceStartFrame(segment.start, sourceFps)
    const segmentSourceEnd = toSourceEndFrame(segment.end, sourceFps)
    const overlapStart = Math.max(sourceStart, segmentSourceStart)
    const overlapEnd = Math.min(sourceEnd, segmentSourceEnd)

    if (overlapEnd <= overlapStart) {
      return []
    }

    const startOffset = sourceFramesToTimelineFramesFloor(
      overlapStart - sourceStart,
      speed,
      sourceFps,
      timelineFps,
    )
    const endOffset = sourceFramesToTimelineFramesCeil(
      overlapEnd - sourceStart,
      speed,
      sourceFps,
      timelineFps,
    )
    const from = clip.from + Math.min(startOffset, clip.durationInFrames - 1)
    const endFrame =
      clip.from + Math.min(clip.durationInFrames, Math.max(startOffset + 1, endOffset))
    const durationInFrames = Math.max(1, endFrame - from)
    const defaultCaptionItem: TextItem = {
      id: crypto.randomUUID(),
      type: 'text',
      textRole: 'caption',
      trackId,
      from,
      durationInFrames,
      mediaId,
      captionSource: buildCaptionSource(mediaId, clip.id, sourceType),
      label: segment.text.slice(0, 48),
      text: segment.text,
      fontSize: Math.max(36, Math.round(canvasHeight * 0.045)),
      fontFamily: 'Inter',
      fontWeight: 'semibold',
      fontStyle: 'normal',
      underline: false,
      color: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.15,
      letterSpacing: 0,
      textShadow: {
        offsetX: 0,
        offsetY: 3,
        blur: 10,
        color: 'rgba(0, 0, 0, 0.75)',
      },
      transform: {
        x: 0,
        y: Math.round(canvasHeight * 0.32),
        width: canvasWidth * 0.82,
        height: canvasHeight * 0.16,
        rotation: 0,
        opacity: 1,
      },
    }

    return [
      {
        ...defaultCaptionItem,
        ...styleTemplate,
      },
    ]
  })
}

export function buildSubtitleTextItems({
  trackId,
  cues,
  timelineFps,
  canvasWidth,
  canvasHeight,
  fileName,
  format,
  startFrame = 0,
  styleTemplate,
  sourceType = 'subtitle-import',
}: BuildSubtitleTextItemsOptions): TextItem[] {
  return cues.flatMap((cue) => {
    const from = startFrame + Math.max(0, Math.round(cue.startSeconds * timelineFps))
    const endFrame = Math.max(from + 1, startFrame + Math.round(cue.endSeconds * timelineFps))
    const durationInFrames = Math.max(1, endFrame - from)
    const defaultCaptionItem: TextItem = {
      id: crypto.randomUUID(),
      type: 'text',
      textRole: 'caption',
      trackId,
      from,
      durationInFrames,
      mediaId: '',
      captionSource: buildCaptionSource('', '', sourceType, {
        fileName,
        format,
        importedAt: Date.now(),
      }),
      label: cue.text.slice(0, 48),
      text: cue.text,
      fontSize: Math.max(36, Math.round(canvasHeight * 0.045)),
      fontFamily: 'Inter',
      fontWeight: 'semibold',
      fontStyle: 'normal',
      underline: false,
      color: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.15,
      letterSpacing: 0,
      textShadow: {
        offsetX: 0,
        offsetY: 3,
        blur: 10,
        color: 'rgba(0, 0, 0, 0.75)',
      },
      transform: {
        x: 0,
        y: Math.round(canvasHeight * 0.32),
        width: canvasWidth * 0.82,
        height: canvasHeight * 0.16,
        rotation: 0,
        opacity: 1,
      },
    }

    return [
      {
        ...defaultCaptionItem,
        ...styleTemplate,
      },
    ]
  })
}

/**
 * Same as {@link buildSubtitleTextItems} but anchors each cue to a specific
 * clip on the timeline. Cues whose source-time range falls entirely outside
 * the clip's `[sourceStart, sourceEnd]` window are dropped; cues that
 * straddle a boundary are clipped to fit. Honors `clip.speed` so a cue at
 * source second 30 of a 2x clip lands 15 timeline-seconds after `clip.from`.
 */
export function buildSubtitleTextItemsForClip({
  trackId,
  cues,
  clip,
  timelineFps,
  canvasWidth,
  canvasHeight,
  fileName,
  format,
  styleTemplate,
  sourceType = 'embedded-subtitles',
}: BuildSubtitleTextItemsForClipOptions): TextItem[] {
  const { sourceStart, sourceEnd, sourceFps, speed } = getClipSourceBounds(clip, timelineFps)
  const sourceStartSeconds = sourceStart / sourceFps
  const sourceEndSeconds = sourceEnd / sourceFps
  const clipEndFrame = clip.from + clip.durationInFrames

  return cues.flatMap((cue) => {
    const overlapStartSec = Math.max(cue.startSeconds, sourceStartSeconds)
    const overlapEndSec = Math.min(cue.endSeconds, sourceEndSeconds)
    if (overlapEndSec <= overlapStartSec) return []

    const fromOffsetFrames = Math.floor(
      ((overlapStartSec - sourceStartSeconds) * timelineFps) / speed,
    )
    const endOffsetFrames = Math.ceil(((overlapEndSec - sourceStartSeconds) * timelineFps) / speed)
    const from = clip.from + Math.max(0, Math.min(fromOffsetFrames, clip.durationInFrames - 1))
    const endFrame = Math.min(
      clipEndFrame,
      clip.from + Math.max(fromOffsetFrames + 1, endOffsetFrames),
    )
    const durationInFrames = Math.max(1, endFrame - from)

    const defaultCaptionItem: TextItem = {
      id: crypto.randomUUID(),
      type: 'text',
      textRole: 'caption',
      trackId,
      from,
      durationInFrames,
      mediaId: clip.mediaId ?? '',
      captionSource: buildCaptionSource(clip.mediaId ?? '', clip.id, sourceType, {
        fileName,
        format,
        importedAt: Date.now(),
      }),
      label: cue.text.slice(0, 48),
      text: cue.text,
      fontSize: Math.max(36, Math.round(canvasHeight * 0.045)),
      fontFamily: 'Inter',
      fontWeight: 'semibold',
      fontStyle: 'normal',
      underline: false,
      color: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.15,
      letterSpacing: 0,
      textShadow: {
        offsetX: 0,
        offsetY: 3,
        blur: 10,
        color: 'rgba(0, 0, 0, 0.75)',
      },
      transform: {
        x: 0,
        y: Math.round(canvasHeight * 0.32),
        width: canvasWidth * 0.82,
        height: canvasHeight * 0.16,
        rotation: 0,
        opacity: 1,
      },
    }

    return [
      {
        ...defaultCaptionItem,
        ...styleTemplate,
      },
    ]
  })
}

/**
 * Find the timeline clips that should receive subtitles for `mediaId`. Each
 * `linkedGroupId` (synced video/audio companion pair) only contributes one
 * clip — preferring the video so captions don't render twice.
 */
export function findCaptionTargetClipsForMedia(
  items: readonly TimelineItem[],
  mediaId: string,
): Array<AudioItem | VideoItem> {
  const matching = items.filter(
    (item): item is AudioItem | VideoItem =>
      (item.type === 'video' || item.type === 'audio') && item.mediaId === mediaId,
  )

  const seenLinkedGroups = new Set<string>()
  const selected: Array<AudioItem | VideoItem> = []
  const ordered = [...matching].sort((a, b) => {
    if (a.linkedGroupId === b.linkedGroupId && a.type !== b.type) {
      return a.type === 'video' ? -1 : 1
    }
    return a.from - b.from
  })

  for (const clip of ordered) {
    if (clip.linkedGroupId !== undefined) {
      if (seenLinkedGroups.has(clip.linkedGroupId)) continue
      seenLinkedGroups.add(clip.linkedGroupId)
    }
    selected.push(clip)
  }

  return selected.sort((a, b) => a.from - b.from)
}

interface BuildSubtitleSegmentForClipOptions {
  trackId: string
  cues: readonly SubtitleCue[]
  clip: AudioItem | VideoItem
  timelineFps: number
  canvasWidth: number
  canvasHeight: number
  source: import('@/types/timeline').SubtitleSegmentSource
  styleTemplate?: CaptionTextItemTemplate
  /** Label shown in the timeline-item UI; defaults to the source-track label. */
  label?: string
}

/**
 * Build ONE {@link SubtitleSegmentItem} that owns all cues overlapping
 * `clip`'s source window. Replaces the per-cue {@link buildSubtitleTextItemsForClip}
 * for callers that want a single, coherent timeline item — matches the way
 * caption tracks work in dedicated NLEs.
 *
 * Cue times are stored segment-relative (start = 0) so the segment can be
 * dragged, trimmed, or split without rewriting timestamps.
 */
export function buildSubtitleSegmentForClip(
  options: BuildSubtitleSegmentForClipOptions,
): import('@/types/timeline').SubtitleSegmentItem | null {
  const {
    clip,
    cues,
    timelineFps,
    canvasWidth,
    canvasHeight,
    trackId,
    source,
    styleTemplate,
    label,
  } = options
  const { sourceStart, sourceEnd, sourceFps, speed } = getClipSourceBounds(clip, timelineFps)
  const sourceStartSeconds = sourceStart / sourceFps
  const sourceEndSeconds = sourceEnd / sourceFps

  const overlappingCues: import('@/types/timeline').SubtitleSegmentCue[] = []
  let firstFromOffset = Number.POSITIVE_INFINITY
  let lastEndOffset = 0

  for (const cue of cues) {
    const overlapStartSec = Math.max(cue.startSeconds, sourceStartSeconds)
    const overlapEndSec = Math.min(cue.endSeconds, sourceEndSeconds)
    if (overlapEndSec <= overlapStartSec) continue

    // Convert source seconds → timeline seconds relative to clip.from / speed,
    // then keep cue times relative to the segment's eventual `from`.
    const cueStartTimeline = (overlapStartSec - sourceStartSeconds) / speed
    const cueEndTimeline = (overlapEndSec - sourceStartSeconds) / speed
    const cueStartFrames = Math.floor(cueStartTimeline * timelineFps)
    const cueEndFrames = Math.ceil(cueEndTimeline * timelineFps)
    if (cueEndFrames <= cueStartFrames) continue

    overlappingCues.push({
      id: cue.id,
      startSeconds: cueStartTimeline,
      endSeconds: cueEndTimeline,
      text: cue.text,
    })
    if (cueStartFrames < firstFromOffset) firstFromOffset = cueStartFrames
    if (cueEndFrames > lastEndOffset) lastEndOffset = cueEndFrames
  }

  if (overlappingCues.length === 0) return null

  const segmentFromOffset = Math.max(0, Math.min(firstFromOffset, clip.durationInFrames - 1))
  const segmentEndOffset = Math.min(
    clip.durationInFrames,
    Math.max(lastEndOffset, segmentFromOffset + 1),
  )
  const from = clip.from + segmentFromOffset
  const durationInFrames = Math.max(1, segmentEndOffset - segmentFromOffset)

  // Cue times are now stored segment-relative (start = 0 at the segment's `from`).
  const segmentRelativeCues = overlappingCues.map((cue) => ({
    id: cue.id,
    startSeconds: cue.startSeconds - segmentFromOffset / timelineFps,
    endSeconds: cue.endSeconds - segmentFromOffset / timelineFps,
    text: cue.text,
  }))

  const defaultStyle = {
    fontSize: Math.max(36, Math.round(canvasHeight * 0.045)),
    fontFamily: 'Inter',
    fontWeight: 'semibold' as const,
    fontStyle: 'normal' as const,
    underline: false,
    color: '#ffffff',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    textAlign: 'center' as const,
    verticalAlign: 'middle' as const,
    lineHeight: 1.15,
    letterSpacing: 0,
    textShadow: {
      offsetX: 0,
      offsetY: 3,
      blur: 10,
      color: 'rgba(0, 0, 0, 0.75)',
    },
    transform: {
      x: 0,
      y: Math.round(canvasHeight * 0.32),
      width: canvasWidth * 0.82,
      height: canvasHeight * 0.16,
      rotation: 0,
      opacity: 1,
    },
  }

  return {
    id: crypto.randomUUID(),
    type: 'subtitle',
    trackId,
    from,
    durationInFrames,
    label:
      label ??
      (source.type === 'embedded-subtitles'
        ? (source.trackName ?? source.language ?? 'Subtitles')
        : source.type === 'subtitle-import'
          ? source.fileName
          : 'Transcript'),
    mediaId: clip.mediaId,
    // Tie the segment to the clip's A/V link group so move/delete/copy on the
    // pair pulls the subtitle along (and re-extracts inherit the group too).
    linkedGroupId: clip.linkedGroupId,
    sourceLabel: label,
    source,
    cues: segmentRelativeCues,
    ...defaultStyle,
    ...styleTemplate,
  }
}

/**
 * Group caption text items by their `captionSource.clipId` and produce one
 * {@link SubtitleSegmentItem} per clip — used for the "consolidate per-cue
 * captions into a segment" migration.
 *
 * Reads each text item's `from`/`durationInFrames` (in timeline frames),
 * derives the segment's `from` from the earliest caption, and stores cue
 * times segment-relative (in seconds) so subsequent splits/trims work.
 *
 * Returns:
 *   - `segments`: one {@link SubtitleSegmentItem} per matched clip group
 *   - `consumedItemIds`: text-item ids that should be removed by the caller
 */
export function consolidateCaptionTextItemsToSegments(
  items: readonly TimelineItem[],
  timelineFps: number,
  options: { onlyClipId?: string } = {},
): {
  segments: import('@/types/timeline').SubtitleSegmentItem[]
  consumedItemIds: string[]
} {
  const captionItems = items.filter(
    (item): item is TextItem & { captionSource: GeneratedCaptionSource } =>
      item.type === 'text' &&
      (item.captionSource?.type === 'embedded-subtitles' ||
        item.captionSource?.type === 'subtitle-import') &&
      (options.onlyClipId === undefined || item.captionSource.clipId === options.onlyClipId),
  )
  if (captionItems.length === 0) return { segments: [], consumedItemIds: [] }

  const byClip = new Map<string, Array<TextItem & { captionSource: GeneratedCaptionSource }>>()
  for (const item of captionItems) {
    const clipId = item.captionSource.clipId
    if (clipId.length === 0) continue
    const list = byClip.get(clipId) ?? []
    list.push(item)
    byClip.set(clipId, list)
  }
  if (byClip.size === 0) return { segments: [], consumedItemIds: [] }

  const segments: import('@/types/timeline').SubtitleSegmentItem[] = []
  const consumedItemIds: string[] = []

  for (const [clipId, group] of byClip) {
    const sorted = [...group].sort((a, b) => a.from - b.from)
    const first = sorted[0]!
    const last = sorted[sorted.length - 1]!
    const segmentFrom = first.from
    const segmentEnd = last.from + last.durationInFrames

    // Inherit the source clip's linkedGroupId so the consolidated segment
    // tracks with the A/V pair, matching the fresh-extract path.
    const sourceClip = items.find(
      (candidate) =>
        (candidate.type === 'video' || candidate.type === 'audio') && candidate.id === clipId,
    )
    const linkedGroupId = sourceClip?.linkedGroupId

    const sampleSource = first.captionSource
    const segmentSource: import('@/types/timeline').SubtitleSegmentSource =
      sampleSource.type === 'embedded-subtitles'
        ? {
            type: 'embedded-subtitles',
            mediaId: sampleSource.mediaId,
            clipId,
            // Original text-item captionSource doesn't carry the source track
            // metadata. Mark trackNumber: 0 so consumers can tell this came
            // from a consolidation (vs a fresh extraction).
            trackNumber: 0,
            language: undefined,
            trackName: undefined,
            codecId: undefined,
            importedAt: sampleSource.importedAt ?? Date.now(),
          }
        : {
            type: 'subtitle-import',
            fileName: sampleSource.fileName ?? 'consolidated.srt',
            format: sampleSource.format ?? 'srt',
            importedAt: sampleSource.importedAt ?? Date.now(),
          }

    const cues = sorted.map((item) => ({
      id: item.id,
      startSeconds: (item.from - segmentFrom) / timelineFps,
      endSeconds: (item.from + item.durationInFrames - segmentFrom) / timelineFps,
      text: item.text,
    }))

    // Style: pick up the first item's typography so consolidation is visually
    // continuous with the per-cue version it's replacing.
    const segment: import('@/types/timeline').SubtitleSegmentItem = {
      id: crypto.randomUUID(),
      type: 'subtitle',
      trackId: first.trackId,
      from: segmentFrom,
      durationInFrames: Math.max(1, segmentEnd - segmentFrom),
      label: first.label,
      mediaId: first.mediaId,
      linkedGroupId,
      source: segmentSource,
      cues,
      fontSize: first.fontSize,
      fontFamily: first.fontFamily,
      fontWeight: first.fontWeight,
      fontStyle: first.fontStyle,
      underline: first.underline,
      color: first.color,
      backgroundColor: first.backgroundColor,
      backgroundRadius: first.backgroundRadius,
      textAlign: first.textAlign,
      verticalAlign: first.verticalAlign,
      lineHeight: first.lineHeight,
      letterSpacing: first.letterSpacing,
      textPadding: first.textPadding,
      textShadow: first.textShadow,
      stroke: first.stroke,
      transform: first.transform,
    }
    segments.push(segment)
    for (const item of sorted) consumedItemIds.push(item.id)
  }

  return { segments, consumedItemIds }
}
