/**
 * Memoized timeline (keyframe-grid) cells for the dopesheet.
 *
 * These render the heavy, *frame-independent* part of each row — ticks,
 * keyframe diamonds, transition-blocked regions and drag-preview ghosts. They
 * are split out of the main editor so that moving the playhead (which only
 * changes the property-column controls and the playhead line) does not force a
 * full re-render of every keyframe button. All props are referentially stable
 * across scrubs, so `React.memo` skips these subtrees entirely while scrubbing.
 */
import { memo } from 'react'
import type { MutableRefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/ui/cn'
import type { AnimatableProperty, Keyframe, KeyframeRef } from '@/types/keyframe'
import type { BlockedFrameRange } from '../../utils/transition-region'
import type { ProceduralBand } from '@/features/keyframes/utils/procedural-preview'
import { getKeyframeGroupLabel } from '@/features/keyframes/utils/property-i18n'
import { getDisplayedGroupFrameGroups } from './sheet-preview-frame-groups'
import type { DopesheetPropertyGroupStructure } from './dopesheet-helpers'
import type { KeyframeMeta } from './dopesheet-types'
import { SegmentEasingPopover, type SegmentEasingChange } from './segment-easing-popover'

/**
 * A clickable span between two consecutive keyframes, carrying the "from" datum
 * whose outgoing easing governs the interpolation across it.
 */
interface SegmentSpan<T> {
  from: T
  left: number
  width: number
}

/** Build clickable spans between consecutive plotted points, sorted by frame. */
export function buildSegmentSpans<T>(
  entries: Array<{ from: T; frame: number; x: number }>,
): SegmentSpan<T>[] {
  const sorted = [...entries].sort((a, b) => a.frame - b.frame)
  const spans: SegmentSpan<T>[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!
    const b = sorted[i + 1]!
    const left = Math.min(a.x, b.x)
    const width = Math.abs(b.x - a.x)
    if (width > 0) {
      spans.push({ from: a.from, left, width })
    }
  }
  return spans
}

type FrameGroup = DopesheetPropertyGroupStructure['frameGroups'][number]
type StructureRow = { property: AnimatableProperty; keyframes: Keyframe[] }

interface ConnectorSegment {
  key: string
  left: number
  width: number
  /** True when the value is held across the span (no interpolation). */
  held: boolean
}

/**
 * Build the horizontal segments drawn between consecutive keyframes. A segment
 * communicates that a property is *animating* across that span; a `held`
 * segment (the `from` keyframe uses `hold` easing) is dashed to show the value
 * is parked until the next keyframe.
 */
function buildConnectorSegments(
  points: Array<{ id: string; frame: number; x: number; held: boolean }>,
): ConnectorSegment[] {
  const sorted = [...points].sort((a, b) => a.frame - b.frame)
  return sorted.flatMap((point, index) => {
    const next = sorted[index + 1]
    if (!next) return []
    const left = Math.min(point.x, next.x)
    const width = Math.abs(next.x - point.x)
    if (width <= 0) return []
    return [{ key: point.id, left, width, held: point.held }]
  })
}

function KeyframeConnectors({ segments }: { segments: ConnectorSegment[] }) {
  return segments.map((segment) => (
    <div
      key={segment.key}
      className={cn(
        'pointer-events-none absolute z-0 -translate-y-1/2',
        segment.held
          ? 'border-t border-dashed border-neutral-500/50'
          : 'h-px bg-neutral-400/50',
      )}
      style={{ left: segment.left, width: segment.width, top: '50%' }}
    />
  ))
}

// Hatched fill marks a span as generated/procedural (distinct from solid
// connector lines and diamonds).
const PROCEDURAL_HATCH =
  'repeating-linear-gradient(45deg, rgba(56,189,248,0.25) 0 2px, transparent 2px 5px)'

/**
 * A non-keyframe band marking that a property is driven by a procedural motion
 * generator over a frame range. Sky-tinted to match the timeline Waves cue.
 */
function ProceduralBandView({
  band,
  frameToX,
  title,
}: {
  band: ProceduralBand
  frameToX: (frame: number) => number
  title: string
}) {
  const left = frameToX(band.fromFrame)
  const width = Math.max(3, frameToX(band.toFrame) - left)
  return (
    <div
      className="pointer-events-none absolute top-1/2 z-0 h-2 -translate-y-1/2 overflow-hidden rounded-sm border border-sky-400/40 bg-sky-400/10"
      style={{ left, width, backgroundImage: PROCEDURAL_HATCH }}
      title={title}
    />
  )
}

interface GroupTimelineCellProps {
  itemId: string
  groupId: string
  groupLabel: string
  /** Stable, frame-independent grouped keyframes. */
  frameGroups: FrameGroup[]
  /** Stable structural rows (used for drag-preview frame remapping). */
  rows: StructureRow[]
  ticks: number[]
  frameToX: (frame: number) => number
  getRenderedKeyframeX: (frame: number) => number | null
  selectedKeyframeIds: Set<string>
  disabled: boolean
  isPropertyLocked: (property: AnimatableProperty) => boolean
  onGroupKeyframePointerDown: (
    frameGroup: FrameGroup,
    event: React.PointerEvent<HTMLButtonElement>,
  ) => void
  onBackgroundPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  onSegmentEasingChange?: SegmentEasingChange
  onSegmentDragStart?: () => void
  onSegmentDragEnd?: () => void
  sheetPreviewFrames: Record<string, number> | null
  sheetPreviewDuplicateKeyframeIds: string[] | null
}

export const GroupTimelineCell = memo(function GroupTimelineCell({
  itemId,
  groupId,
  groupLabel,
  frameGroups,
  rows,
  ticks,
  frameToX,
  getRenderedKeyframeX,
  selectedKeyframeIds,
  disabled,
  isPropertyLocked,
  onGroupKeyframePointerDown,
  onBackgroundPointerDown,
  onSegmentEasingChange,
  onSegmentDragStart,
  onSegmentDragEnd,
  sheetPreviewFrames,
  sheetPreviewDuplicateKeyframeIds,
}: GroupTimelineCellProps) {
  const { t } = useTranslation()
  const displayedFrameGroups = getDisplayedGroupFrameGroups({
    group: { rows, frameGroups },
    sheetPreviewFrames,
    sheetPreviewDuplicateKeyframeIds,
  })
  const renderedFrameGroups = sheetPreviewDuplicateKeyframeIds ? frameGroups : displayedFrameGroups
  const connectorSegments = buildConnectorSegments(
    renderedFrameGroups.flatMap((frameGroup) => {
      const x = getRenderedKeyframeX(frameGroup.frame)
      if (x === null) return []
      return [
        {
          id: `${groupId}-${frameGroup.frame}`,
          frame: frameGroup.frame,
          x,
          // A group span only "holds" if every property parks across it.
          held: frameGroup.keyframes.every(({ keyframe }) => keyframe.easing === 'hold'),
        },
      ]
    }),
  )

  // Clickable easing spans between consecutive group keyframes. Suppressed while
  // a drag preview is active so it doesn't fight the ghost markers.
  const segmentSpans =
    onSegmentEasingChange && !disabled && !sheetPreviewDuplicateKeyframeIds
      ? buildSegmentSpans(
          renderedFrameGroups.flatMap((frameGroup) => {
            const x = getRenderedKeyframeX(frameGroup.frame)
            if (x === null) return []
            return [{ from: frameGroup, frame: frameGroup.frame, x }]
          }),
        )
      : []

  return (
    <div
      className="relative border-l border-border/60 bg-muted/20 overflow-hidden"
      onPointerDown={onBackgroundPointerDown}
    >
      {ticks.map((frame) => (
        <div
          key={`${groupId}-tick-${frame}`}
          className="absolute inset-y-0 border-l border-border/30 pointer-events-none"
          style={{ left: Math.round(frameToX(frame)) }}
        />
      ))}

      <KeyframeConnectors segments={connectorSegments} />

      {onSegmentEasingChange &&
        segmentSpans.map((span) => {
          const editable = span.from.keyframes.filter(
            ({ property }) => !isPropertyLocked(property),
          )
          if (editable.length === 0) return null
          const first = editable[0]!
          const mixed = editable.some(
            ({ keyframe }) => keyframe.easing !== first.keyframe.easing,
          )
          const refs: KeyframeRef[] = editable.map(({ property, keyframe }) => ({
            itemId,
            property,
            keyframeId: keyframe.id,
          }))
          return (
            <SegmentEasingPopover
              key={`group-seg-${groupId}-${first.keyframe.id}`}
              left={span.left}
              width={span.width}
              refs={refs}
              easing={first.keyframe.easing}
              easingConfig={first.keyframe.easingConfig}
              mixed={mixed}
              held={editable.every(({ keyframe }) => keyframe.easing === 'hold')}
              onChange={onSegmentEasingChange}
              onDragStart={onSegmentDragStart}
              onDragEnd={onSegmentDragEnd}
            />
          )
        })}

      {renderedFrameGroups.map((frameGroup) => {
        const renderedX = getRenderedKeyframeX(frameGroup.frame)
        if (renderedX === null) {
          return null
        }

        const movableEntries = frameGroup.keyframes.filter(
          ({ property }) => !isPropertyLocked(property),
        )
        const isSelected = movableEntries.some(({ keyframe }) =>
          selectedKeyframeIds.has(keyframe.id),
        )

        return (
          <button
            key={`${groupId}-${frameGroup.frame}`}
            type="button"
            data-testid={`group-keyframe-${groupId}-${frameGroup.frame}`}
            className={cn(
              'group absolute z-10 flex h-3 w-3 -ml-1.5 -mt-1.5 items-center justify-center',
              movableEntries.length > 0 && 'cursor-grab active:cursor-grabbing',
              movableEntries.length === 0 && 'cursor-not-allowed opacity-50',
            )}
            style={{
              left: renderedX,
              top: '50%',
            }}
            disabled={movableEntries.length === 0 || disabled}
            onPointerDown={(event) => onGroupKeyframePointerDown(frameGroup, event)}
            onClick={(event) => event.stopPropagation()}
            title={t('timeline.keyframeEditor.keyframeMarker.groupLabel', {
              group: getKeyframeGroupLabel(t, groupId, groupLabel),
              frame: frameGroup.frame,
            })}
            aria-label={t('timeline.keyframeEditor.keyframeMarker.groupLabel', {
              group: getKeyframeGroupLabel(t, groupId, groupLabel),
              frame: frameGroup.frame,
            })}
          >
            <span
              className={cn(
                'pointer-events-none block h-2 w-2 rotate-45 border transition-colors',
                isSelected
                  ? 'border-blue-100 bg-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.45)]'
                  : 'border-transparent bg-neutral-200 group-hover:bg-white',
              )}
            />
          </button>
        )
      })}
      {sheetPreviewDuplicateKeyframeIds &&
        displayedFrameGroups.map((frameGroup) => {
          const renderedX = getRenderedKeyframeX(frameGroup.frame)
          if (renderedX === null) {
            return null
          }

          return (
            <div
              key={`preview-${groupId}-${frameGroup.frame}`}
              className="absolute z-20 flex h-3 w-3 -ml-1.5 -mt-1.5 items-center justify-center pointer-events-none"
              style={{ left: renderedX, top: '50%' }}
            >
              <span className="block h-2 w-2 rotate-45 border border-primary/70 bg-primary/70 shadow-[0_0_0_1px_rgba(59,130,246,0.35)]" />
            </div>
          )
        })}
    </div>
  )
})

interface PropertyTimelineCellProps {
  itemId: string
  property: AnimatableProperty
  /** Stable, frame-independent sorted keyframes for this property. */
  keyframes: Keyframe[]
  locked: boolean
  ticks: number[]
  frameToX: (frame: number) => number
  getRenderedKeyframeX: (frame: number) => number | null
  renderedKeyframeXById: Map<string, number>
  transitionBlockedRanges: BlockedFrameRange[]
  /** Procedural generator band for this property (when not keyframed). */
  proceduralBand?: ProceduralBand
  selectedKeyframeIds: Set<string>
  disabled: boolean
  onRowPointerDown: (
    property: AnimatableProperty,
    event: React.PointerEvent<HTMLDivElement>,
  ) => void
  onKeyframePointerDown: (
    property: AnimatableProperty,
    keyframeId: string,
    event: React.PointerEvent<HTMLButtonElement>,
  ) => void
  onSegmentEasingChange?: SegmentEasingChange
  onSegmentDragStart?: () => void
  onSegmentDragEnd?: () => void
  setKeyframeButtonRef: (keyframeId: string, node: HTMLButtonElement | null) => void
  keyframeMetaByIdRef: MutableRefObject<Map<string, KeyframeMeta>>
  sheetPreviewFrames: Record<string, number> | null
  sheetPreviewDuplicateKeyframeIds: string[] | null
}

export const PropertyTimelineCell = memo(function PropertyTimelineCell({
  itemId,
  property,
  keyframes,
  locked,
  ticks,
  frameToX,
  getRenderedKeyframeX,
  renderedKeyframeXById,
  transitionBlockedRanges,
  proceduralBand,
  selectedKeyframeIds,
  disabled,
  onRowPointerDown,
  onKeyframePointerDown,
  onSegmentEasingChange,
  onSegmentDragStart,
  onSegmentDragEnd,
  setKeyframeButtonRef,
  keyframeMetaByIdRef,
  sheetPreviewFrames,
  sheetPreviewDuplicateKeyframeIds,
}: PropertyTimelineCellProps) {
  const { t } = useTranslation()

  const connectorSegments = buildConnectorSegments(
    keyframes.flatMap((keyframe) => {
      const x = renderedKeyframeXById.get(keyframe.id)
      if (x === undefined) return []
      return [{ id: keyframe.id, frame: keyframe.frame, x, held: keyframe.easing === 'hold' }]
    }),
  )

  // Clickable easing spans between consecutive keyframes (skipped while locked or
  // during a drag preview, which owns pointer interaction on this row).
  const segmentSpans =
    onSegmentEasingChange && !locked && !disabled && !sheetPreviewDuplicateKeyframeIds
      ? buildSegmentSpans(
          keyframes.flatMap((keyframe) => {
            const x = renderedKeyframeXById.get(keyframe.id)
            if (x === undefined) return []
            return [{ from: keyframe, frame: keyframe.frame, x }]
          }),
        )
      : []

  return (
    <div
      className="relative border-l border-border/60 overflow-hidden"
      onPointerDown={(event) => onRowPointerDown(property, event)}
    >
      {ticks.map((frame) => (
        <div
          key={frame}
          className="absolute inset-y-0 border-l border-border/30 pointer-events-none"
          style={{ left: Math.round(frameToX(frame)) }}
        />
      ))}

      {transitionBlockedRanges.map((range, index) => (
        <div
          key={`${property}-${index}-${range.start}-${range.end}`}
          className="absolute inset-y-0 bg-destructive/10 border-x border-destructive/20 pointer-events-none"
          style={{
            left: frameToX(range.start),
            width: frameToX(range.end) - frameToX(range.start),
          }}
        />
      ))}

      {proceduralBand && (
        <ProceduralBandView
          band={proceduralBand}
          frameToX={frameToX}
          title={t('timeline.keyframeEditor.proceduralBand')}
        />
      )}

      <KeyframeConnectors segments={connectorSegments} />

      {onSegmentEasingChange &&
        segmentSpans.map((span) => (
          <SegmentEasingPopover
            key={`seg-${span.from.id}`}
            left={span.left}
            width={span.width}
            refs={[{ itemId, property, keyframeId: span.from.id }]}
            easing={span.from.easing}
            easingConfig={span.from.easingConfig}
            held={span.from.easing === 'hold'}
            onChange={onSegmentEasingChange}
            onDragStart={onSegmentDragStart}
            onDragEnd={onSegmentDragEnd}
          />
        ))}

      {keyframes.map((keyframe) => {
        const renderedX = renderedKeyframeXById.get(keyframe.id)
        if (renderedX === undefined) return null
        const selected = selectedKeyframeIds.has(keyframe.id)
        return (
          <button
            key={keyframe.id}
            ref={(node) => setKeyframeButtonRef(keyframe.id, node)}
            type="button"
            data-testid={`row-keyframe-${property}-${keyframe.id}`}
            className={cn(
              'group absolute z-10 flex h-3 w-3 -ml-1.5 -mt-1.5 items-center justify-center',
              !locked && 'cursor-grab active:cursor-grabbing',
              locked && 'cursor-not-allowed opacity-50',
            )}
            style={{
              left: renderedX,
              top: '50%',
            }}
            disabled={locked || disabled}
            onPointerDown={(event) => onKeyframePointerDown(property, keyframe.id, event)}
            onClick={(event) => event.stopPropagation()}
            title={
              locked
                ? t('timeline.keyframeEditor.keyframeMarker.locked', {
                    frame: keyframe.frame,
                  })
                : t('timeline.keyframeEditor.keyframeMarker.rowLabel', {
                    frame: keyframe.frame,
                  })
            }
            aria-label={
              locked
                ? t('timeline.keyframeEditor.keyframeMarker.locked', {
                    frame: keyframe.frame,
                  })
                : t('timeline.keyframeEditor.keyframeMarker.rowLabel', {
                    frame: keyframe.frame,
                  })
            }
          >
            <span
              className={cn(
                'pointer-events-none block h-2 w-2 rotate-45 border transition-colors',
                selected
                  ? 'border-blue-100 bg-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.45)]'
                  : 'border-transparent bg-neutral-200 group-hover:bg-white',
              )}
            />
          </button>
        )
      })}
      {sheetPreviewDuplicateKeyframeIds?.flatMap((keyframeId) => {
        const meta = keyframeMetaByIdRef.current.get(keyframeId)
        if (!meta || meta.property !== property) {
          return []
        }

        const previewFrame = sheetPreviewFrames?.[keyframeId]
        if (previewFrame === undefined) {
          return []
        }

        const renderedX = getRenderedKeyframeX(previewFrame)
        if (renderedX === null) {
          return []
        }

        return [
          <div
            key={`preview-${property}-${keyframeId}`}
            className="absolute z-20 flex h-3 w-3 -ml-1.5 -mt-1.5 items-center justify-center pointer-events-none"
            style={{ left: renderedX, top: '50%' }}
          >
            <span className="block h-2 w-2 rotate-45 border border-primary/70 bg-primary/70 shadow-[0_0_0_1px_rgba(59,130,246,0.35)]" />
          </div>,
        ]
      })}
    </div>
  )
})
