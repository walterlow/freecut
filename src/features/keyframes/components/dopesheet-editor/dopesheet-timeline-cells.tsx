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
import type { AnimatableProperty, Keyframe } from '@/types/keyframe'
import type { BlockedFrameRange } from '../../utils/transition-region'
import { getKeyframeGroupLabel } from '@/features/keyframes/utils/property-i18n'
import { getDisplayedGroupFrameGroups } from './sheet-preview-frame-groups'
import type { DopesheetPropertyGroupStructure } from './dopesheet-helpers'
import type { KeyframeMeta } from './dopesheet-types'

type FrameGroup = DopesheetPropertyGroupStructure['frameGroups'][number]
type StructureRow = { property: AnimatableProperty; keyframes: Keyframe[] }

interface GroupTimelineCellProps {
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
  sheetPreviewFrames: Record<string, number> | null
  sheetPreviewDuplicateKeyframeIds: string[] | null
}

export const GroupTimelineCell = memo(function GroupTimelineCell({
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
  sheetPreviewFrames,
  sheetPreviewDuplicateKeyframeIds,
}: GroupTimelineCellProps) {
  const { t } = useTranslation()
  const displayedFrameGroups = getDisplayedGroupFrameGroups({
    group: { rows, frameGroups },
    sheetPreviewFrames,
    sheetPreviewDuplicateKeyframeIds,
  })

  return (
    <div
      className="relative border-l border-border/60 bg-muted/20 overflow-hidden"
      onPointerDown={onBackgroundPointerDown}
    >
      {ticks.map((frame) => (
        <div
          key={`${groupId}-tick-${frame}`}
          className="absolute inset-y-0 border-l border-border/30 pointer-events-none"
          style={{ left: frameToX(frame) }}
        />
      ))}

      {(sheetPreviewDuplicateKeyframeIds ? frameGroups : displayedFrameGroups).map((frameGroup) => {
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
  property: AnimatableProperty
  /** Stable, frame-independent sorted keyframes for this property. */
  keyframes: Keyframe[]
  locked: boolean
  ticks: number[]
  frameToX: (frame: number) => number
  getRenderedKeyframeX: (frame: number) => number | null
  renderedKeyframeXById: Map<string, number>
  transitionBlockedRanges: BlockedFrameRange[]
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
  setKeyframeButtonRef: (keyframeId: string, node: HTMLButtonElement | null) => void
  keyframeMetaByIdRef: MutableRefObject<Map<string, KeyframeMeta>>
  sheetPreviewFrames: Record<string, number> | null
  sheetPreviewDuplicateKeyframeIds: string[] | null
}

export const PropertyTimelineCell = memo(function PropertyTimelineCell({
  property,
  keyframes,
  locked,
  ticks,
  frameToX,
  getRenderedKeyframeX,
  renderedKeyframeXById,
  transitionBlockedRanges,
  selectedKeyframeIds,
  disabled,
  onRowPointerDown,
  onKeyframePointerDown,
  setKeyframeButtonRef,
  keyframeMetaByIdRef,
  sheetPreviewFrames,
  sheetPreviewDuplicateKeyframeIds,
}: PropertyTimelineCellProps) {
  const { t } = useTranslation()

  return (
    <div
      className="relative border-l border-border/60 overflow-hidden"
      onPointerDown={(event) => onRowPointerDown(property, event)}
    >
      {ticks.map((frame) => (
        <div
          key={frame}
          className="absolute inset-y-0 border-l border-border/30 pointer-events-none"
          style={{ left: frameToX(frame) }}
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
