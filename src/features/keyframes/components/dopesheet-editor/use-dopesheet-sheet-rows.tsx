/**
 * Sheet row assembly.
 * Owns the props the owner rows and group headers are rendered from, and the
 * React nodes the sheet body and the property column reuse. The editor keeps
 * the viewport-sensitive inputs; caching the heavier row controls next to the
 * elements they build keeps a pan/zoom from re-running their 60-prop pass.
 */

import {
  useMemo,
  type ComponentProps,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import type { AnimatableProperty, Keyframe } from '@/types/keyframe'
import type { TextMotionTimelineBand } from '@/shared/timeline/text-motion-timeline'
import type { BlockedFrameRange } from '../../utils/transition-region'
import { getProceduralBands } from '@/features/keyframes/utils/procedural-preview'
import { GROUP_HEADER_HEIGHT, ROW_HEIGHT } from './dopesheet-constants'
import { buildGroupedPropertyStructure } from './dopesheet-helpers'
import {
  DopesheetGroupHeader,
  DopesheetPropertyRowContent,
  type DopesheetGroupHeaderProps,
  type DopesheetPropertyRowContentProps,
} from './dopesheet-row-renderers'
import { GroupTimelineCell, PropertyTimelineCell } from './dopesheet-timeline-cells'
import { TextMotionTimelineRows } from './text-motion-timeline-rows'
import { TimelineViewportCuller } from './timeline-viewport-culler'
import type { DopesheetPropertyGroup, KeyframeMeta, RenderedSheetEntry } from './dopesheet-types'
import type { SegmentEasingChange } from './segment-easing-popover'
import type { UseSheetPreviewDomReturn } from './sheet-preview-dom'
import type { KeyframeDrag } from './use-keyframe-drag'

/** Frame-independent group entry the memoized timeline cells remap previews from. */
type GroupStructureEntry = ReturnType<typeof buildGroupedPropertyStructure>[number]

/** Band-row handlers the classic presentation forwards to the text-motion rows. */
type TextMotionBandHandlers = Pick<
  ComponentProps<typeof TextMotionTimelineRows>,
  | 'onDurationDragStart'
  | 'onDurationCommit'
  | 'onDurationCancel'
  | 'onOffsetDragStart'
  | 'onOffsetCommit'
  | 'onOffsetCancel'
  | 'onBandClick'
>

// Stable empty fallbacks so memoized timeline cells don't see fresh `[]` refs.
const EMPTY_KEYFRAMES: Keyframe[] = []
const EMPTY_STRUCTURE_ROWS: GroupStructureEntry['rows'] = []
const EMPTY_FRAME_GROUPS: GroupStructureEntry['frameGroups'] = []

export interface UseDopesheetSheetRowsOptions {
  /** Row content props shared by the sheet rows and the property column. */
  rowContentProps: Omit<DopesheetPropertyRowContentProps, 'row' | 'options'>
  /** Group header props shared by the sheet rows and the property column. */
  groupHeaderProps: Omit<DopesheetGroupHeaderProps, 'group'>
  /** Rendered sheet entries (groups and rows) with their vertical offsets. */
  renderedSheetEntries: { entries: RenderedSheetEntry[]; contentHeight: number }
  /** Stable, frame-independent group structure keyed by group id. */
  groupTimelineById: Map<string, GroupStructureEntry>
  groupedPropertyRows: DopesheetPropertyGroup[]
  expandedGroups: Record<string, boolean>
  inlinePropertyGroupIdSet: Set<string>
  rowKeyframesByProperty: Map<AnimatableProperty, Keyframe[]>
  renderedKeyframeXById: Map<string, number>
  proceduralBandByProperty: ReturnType<typeof getProceduralBands>
  selectedKeyframeIds: Set<string>
  transitionBlockedRanges: BlockedFrameRange[]
  ticks: number[]
  frameToX: (frame: number) => number
  sharedGridFrameToX: (frame: number) => number
  getRenderedKeyframeX: (frame: number) => number | null
  effectiveTimelineWidth: number
  timelineGridDivisions?: number
  propertyGridStyle: CSSProperties
  presentation: 'editor' | 'classic' | 'lanes'
  disabled: boolean
  isPropertyLocked: (property: AnimatableProperty) => boolean
  itemId: string
  textMotionBands: readonly TextMotionTimelineBand[]
  getLiveDragPixelsPerFrame: () => number
  sheetPreviewFrames: Record<string, number> | null
  sheetPreviewDuplicateKeyframeIds: string[] | null
  keyframeMetaByIdRef: RefObject<Map<string, KeyframeMeta>>
  setKeyframeButtonRef: UseSheetPreviewDomReturn['setKeyframeButtonRef']
  handleRowPointerDown: (
    property: AnimatableProperty,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void
  handleTimelineBackgroundPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  handleKeyframePointerDown: KeyframeDrag['handleKeyframePointerDown']
  handleGroupKeyframePointerDown: KeyframeDrag['handleGroupKeyframePointerDown']
  onSegmentEasingChange?: SegmentEasingChange
  onDragStart?: () => void
  onDragEnd?: () => void
  /** Edit text-motion band handlers, forwarded straight to the band rows. */
  textMotionHandlers: TextMotionBandHandlers
}

export interface UseDopesheetSheetRowsReturn {
  rowElements: React.ReactNode[]
  propertyColumnElements: React.ReactNode[]
}

/**
 * Everything a sheet row element needs besides the entry it renders. Grouped so
 * the two row shapes stay single-purpose builders instead of one branchy inline
 * arrow that grows with every row control.
 */
interface SheetRowElementContext {
  groupTimelineRowStyle: CSSProperties
  propertyTimelineRowStyle: CSSProperties
  expandedGroups: Record<string, boolean>
  groupTimelineById: Map<string, GroupStructureEntry>
  sheetGroupContentById: Map<string, React.ReactNode>
  sheetPropertyContentByProperty: Map<AnimatableProperty, React.ReactNode>
  rowKeyframesByProperty: Map<AnimatableProperty, Keyframe[]>
  renderedKeyframeXById: Map<string, number>
  proceduralBandByProperty: ReturnType<typeof getProceduralBands>
  selectedKeyframeIds: Set<string>
  transitionBlockedRanges: BlockedFrameRange[]
  ticks: number[]
  frameToX: (frame: number) => number
  sharedGridFrameToX: (frame: number) => number
  getRenderedKeyframeX: (frame: number) => number | null
  effectiveTimelineWidth: number
  timelineGridDivisions?: number
  disabled: boolean
  isPropertyLocked: (property: AnimatableProperty) => boolean
  itemId: string
  sheetPreviewFrames: Record<string, number> | null
  sheetPreviewDuplicateKeyframeIds: string[] | null
  keyframeMetaByIdRef: RefObject<Map<string, KeyframeMeta>>
  setKeyframeButtonRef: UseSheetPreviewDomReturn['setKeyframeButtonRef']
  handleRowPointerDown: (
    property: AnimatableProperty,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void
  handleTimelineBackgroundPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  handleKeyframePointerDown: KeyframeDrag['handleKeyframePointerDown']
  handleGroupKeyframePointerDown: KeyframeDrag['handleGroupKeyframePointerDown']
  onSegmentEasingChange?: SegmentEasingChange
  onDragStart?: () => void
  onDragEnd?: () => void
  presentation: 'editor' | 'classic' | 'lanes'
  textMotionBands: readonly TextMotionTimelineBand[]
  getLiveDragPixelsPerFrame: () => number
  textMotionHandlers: TextMotionBandHandlers
}

/** Classic Edit lists the text-motion bands above the property rows; other presentations do not. */
function buildTextMotionRowsElement(ctx: SheetRowElementContext): React.ReactNode {
  if (ctx.presentation !== 'classic' || ctx.textMotionBands.length === 0) return null

  return (
    <TextMotionTimelineRows
      key="text-motion"
      bands={ctx.textMotionBands}
      gridStyle={ctx.propertyTimelineRowStyle}
      ticks={ctx.ticks}
      axisWidth={ctx.effectiveTimelineWidth}
      frameToX={ctx.frameToX}
      getPixelsPerFrame={ctx.getLiveDragPixelsPerFrame}
      disabled={ctx.disabled}
      onBackgroundPointerDown={ctx.handleTimelineBackgroundPointerDown}
      {...ctx.textMotionHandlers}
    />
  )
}

function buildGroupRowElement(
  entry: Extract<RenderedSheetEntry, { type: 'group' }>,
  ctx: SheetRowElementContext,
): React.ReactNode {
  return (
    <div
      key={entry.group.id}
      className="grid w-full border-b border-border/60"
      style={ctx.groupTimelineRowStyle}
    >
      {ctx.sheetGroupContentById.get(entry.group.id)}
      <TimelineViewportCuller>
        <GroupTimelineCell
          groupId={entry.group.id}
          groupLabel={entry.group.label}
          expanded={ctx.expandedGroups[entry.group.id] ?? true}
          frameGroups={ctx.groupTimelineById.get(entry.group.id)?.frameGroups ?? EMPTY_FRAME_GROUPS}
          rows={ctx.groupTimelineById.get(entry.group.id)?.rows ?? EMPTY_STRUCTURE_ROWS}
          ticks={ctx.ticks}
          axisWidth={ctx.effectiveTimelineWidth}
          frameToX={ctx.frameToX}
          gridFrameToX={ctx.timelineGridDivisions ? ctx.sharedGridFrameToX : undefined}
          getRenderedKeyframeX={ctx.getRenderedKeyframeX}
          selectedKeyframeIds={ctx.selectedKeyframeIds}
          disabled={ctx.disabled}
          isPropertyLocked={ctx.isPropertyLocked}
          onGroupKeyframePointerDown={ctx.handleGroupKeyframePointerDown}
          onBackgroundPointerDown={ctx.handleTimelineBackgroundPointerDown}
          sheetPreviewFrames={ctx.sheetPreviewFrames}
          sheetPreviewDuplicateKeyframeIds={ctx.sheetPreviewDuplicateKeyframeIds}
        />
      </TimelineViewportCuller>
    </div>
  )
}

function buildPropertyRowElement(
  entry: Extract<RenderedSheetEntry, { type: 'row' }>,
  ctx: SheetRowElementContext,
): React.ReactNode {
  const { row } = entry
  return (
    <div
      key={row.property}
      className="grid border-b border-border/60"
      style={ctx.propertyTimelineRowStyle}
    >
      {ctx.sheetPropertyContentByProperty.get(row.property)}
      <TimelineViewportCuller>
        <PropertyTimelineCell
          itemId={ctx.itemId}
          property={row.property}
          keyframes={ctx.rowKeyframesByProperty.get(row.property) ?? EMPTY_KEYFRAMES}
          locked={ctx.isPropertyLocked(row.property)}
          ticks={ctx.ticks}
          axisWidth={ctx.effectiveTimelineWidth}
          frameToX={ctx.frameToX}
          gridFrameToX={ctx.timelineGridDivisions ? ctx.sharedGridFrameToX : undefined}
          getRenderedKeyframeX={ctx.getRenderedKeyframeX}
          renderedKeyframeXById={ctx.renderedKeyframeXById}
          transitionBlockedRanges={ctx.transitionBlockedRanges}
          proceduralBand={ctx.proceduralBandByProperty.get(row.property)}
          selectedKeyframeIds={ctx.selectedKeyframeIds}
          disabled={ctx.disabled}
          onRowPointerDown={ctx.handleRowPointerDown}
          onKeyframePointerDown={ctx.handleKeyframePointerDown}
          onSegmentEasingChange={ctx.onSegmentEasingChange}
          onSegmentDragStart={ctx.onDragStart}
          onSegmentDragEnd={ctx.onDragEnd}
          setKeyframeButtonRef={ctx.setKeyframeButtonRef}
          keyframeMetaByIdRef={ctx.keyframeMetaByIdRef}
          sheetPreviewFrames={ctx.sheetPreviewFrames}
          sheetPreviewDuplicateKeyframeIds={ctx.sheetPreviewDuplicateKeyframeIds}
        />
      </TimelineViewportCuller>
    </div>
  )
}

function buildSheetRowElement(
  entry: RenderedSheetEntry,
  ctx: SheetRowElementContext,
): React.ReactNode {
  return entry.type === 'group'
    ? buildGroupRowElement(entry, ctx)
    : buildPropertyRowElement(entry, ctx)
}

export function useDopesheetSheetRows({
  rowContentProps,
  groupHeaderProps,
  renderedSheetEntries,
  groupTimelineById,
  groupedPropertyRows,
  expandedGroups,
  inlinePropertyGroupIdSet,
  rowKeyframesByProperty,
  renderedKeyframeXById,
  proceduralBandByProperty,
  selectedKeyframeIds,
  transitionBlockedRanges,
  ticks,
  frameToX,
  sharedGridFrameToX,
  getRenderedKeyframeX,
  effectiveTimelineWidth,
  timelineGridDivisions,
  propertyGridStyle,
  presentation,
  disabled,
  isPropertyLocked,
  itemId,
  textMotionBands,
  getLiveDragPixelsPerFrame,
  sheetPreviewFrames,
  sheetPreviewDuplicateKeyframeIds,
  keyframeMetaByIdRef,
  setKeyframeButtonRef,
  handleRowPointerDown,
  handleTimelineBackgroundPointerDown,
  handleKeyframePointerDown,
  handleGroupKeyframePointerDown,
  onSegmentEasingChange,
  onDragStart,
  onDragEnd,
  textMotionHandlers,
}: UseDopesheetSheetRowsOptions): UseDopesheetSheetRowsReturn {
  const {
    onDurationDragStart,
    onDurationCommit,
    onDurationCancel,
    onOffsetDragStart,
    onOffsetCommit,
    onOffsetCancel,
    onBandClick,
  } = textMotionHandlers

  // The property controls are substantially heavier than the timeline cells,
  // but their output does not depend on the time viewport. Cache those React
  // nodes separately so zooming only reconciles keyframe/tick geometry.
  const sheetPropertyContentByProperty = useMemo(() => {
    const content = new Map<AnimatableProperty, React.ReactNode>()
    for (const entry of renderedSheetEntries.entries) {
      if (entry.type !== 'row') continue
      content.set(
        entry.row.property,
        <DopesheetPropertyRowContent
          row={entry.row}
          options={{ classic: presentation === 'classic', indented: entry.indented }}
          {...rowContentProps}
        />,
      )
    }
    return content
  }, [presentation, renderedSheetEntries.entries, rowContentProps])
  const sheetGroupContentById = useMemo(() => {
    const content = new Map<string, React.ReactNode>()
    for (const entry of renderedSheetEntries.entries) {
      if (entry.type !== 'group') continue
      content.set(entry.group.id, <DopesheetGroupHeader group={entry.group} {...groupHeaderProps} />)
    }
    return content
  }, [groupHeaderProps, renderedSheetEntries.entries])
  const groupTimelineRowStyle = useMemo(
    () => ({
      ...propertyGridStyle,
      height: GROUP_HEADER_HEIGHT,
      contentVisibility: presentation === 'lanes' ? ('auto' as const) : undefined,
      containIntrinsicSize: presentation === 'lanes' ? `auto ${GROUP_HEADER_HEIGHT}px` : undefined,
    }),
    [presentation, propertyGridStyle],
  )
  const propertyTimelineRowStyle = useMemo(
    () => ({
      ...propertyGridStyle,
      height: ROW_HEIGHT,
      contentVisibility: presentation === 'lanes' ? ('auto' as const) : undefined,
      containIntrinsicSize: presentation === 'lanes' ? `auto ${ROW_HEIGHT}px` : undefined,
    }),
    [presentation, propertyGridStyle],
  )
  const rowElements = useMemo(() => {
    const rowContext: SheetRowElementContext = {
      groupTimelineRowStyle,
      propertyTimelineRowStyle,
      expandedGroups,
      groupTimelineById,
      sheetGroupContentById,
      sheetPropertyContentByProperty,
      rowKeyframesByProperty,
      renderedKeyframeXById,
      proceduralBandByProperty,
      selectedKeyframeIds,
      transitionBlockedRanges,
      ticks,
      frameToX,
      sharedGridFrameToX,
      getRenderedKeyframeX,
      effectiveTimelineWidth,
      timelineGridDivisions,
      disabled,
      isPropertyLocked,
      itemId,
      sheetPreviewFrames,
      sheetPreviewDuplicateKeyframeIds,
      keyframeMetaByIdRef,
      setKeyframeButtonRef,
      handleRowPointerDown,
      handleTimelineBackgroundPointerDown,
      handleKeyframePointerDown,
      handleGroupKeyframePointerDown,
      onSegmentEasingChange,
      onDragStart,
      onDragEnd,
      presentation,
      textMotionBands,
      getLiveDragPixelsPerFrame,
      textMotionHandlers: {
        onDurationDragStart,
        onDurationCommit,
        onDurationCancel,
        onOffsetDragStart,
        onOffsetCommit,
        onOffsetCancel,
        onBandClick,
      },
    }
    const textMotionRows = buildTextMotionRowsElement(rowContext)
    const rows = renderedSheetEntries.entries.map((entry) => buildSheetRowElement(entry, rowContext))
    return textMotionRows ? [textMotionRows, ...rows] : rows
  }, [
      renderedSheetEntries.entries,
      expandedGroups,
      groupTimelineRowStyle,
      propertyTimelineRowStyle,
      groupTimelineById,
      rowKeyframesByProperty,
      handleRowPointerDown,
      handleTimelineBackgroundPointerDown,
      handleGroupKeyframePointerDown,
      sheetGroupContentById,
      sheetPropertyContentByProperty,
      getRenderedKeyframeX,
      isPropertyLocked,
      disabled,
      ticks,
      effectiveTimelineWidth,
      frameToX,
      sharedGridFrameToX,
      timelineGridDivisions,
      transitionBlockedRanges,
      proceduralBandByProperty,
      renderedKeyframeXById,
      selectedKeyframeIds,
      sheetPreviewDuplicateKeyframeIds,
      sheetPreviewFrames,
      handleKeyframePointerDown,
      setKeyframeButtonRef,
      keyframeMetaByIdRef,
      itemId,
      onSegmentEasingChange,
      onDragStart,
      onDragEnd,
      presentation,
      textMotionBands,
      getLiveDragPixelsPerFrame,
      onDurationDragStart,
      onDurationCommit,
      onDurationCancel,
      onOffsetDragStart,
      onOffsetCommit,
      onOffsetCancel,
      onBandClick,
    ],
  )
  const propertyColumnElements = useMemo(
    () =>
      groupedPropertyRows.flatMap<React.ReactNode>((group): React.ReactNode[] => {
        const inline = inlinePropertyGroupIdSet.has(group.id)
        const propertyElements = group.rows.map((row) => (
          <div
            key={row.property}
            className="border-b border-border/60"
            style={{ height: ROW_HEIGHT }}
          >
            <DopesheetPropertyRowContent
              row={row}
              options={{ indented: !inline }}
              {...rowContentProps}
            />
          </div>
        ))
        if (inline) {
          return propertyElements
        }

        const groupOpen = expandedGroups[group.id] ?? true
        const elements: React.ReactNode[] = [
          <div
            key={group.id}
            className="border-b border-border/60"
            style={{ height: GROUP_HEADER_HEIGHT }}
          >
            <DopesheetGroupHeader group={group} {...groupHeaderProps} />
          </div>,
        ]

        if (!groupOpen) {
          return elements
        }

        return elements.concat(propertyElements)
      }),
    [
      expandedGroups,
      groupedPropertyRows,
      groupHeaderProps,
      inlinePropertyGroupIdSet,
      rowContentProps,
    ],
  )
  return { rowElements, propertyColumnElements }
}
