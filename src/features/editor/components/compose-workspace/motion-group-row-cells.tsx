import { type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react'
import type { TFunction } from 'i18next'
import {
  ChevronDown,
  ChevronRight,
  EllipsisVertical,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Ungroup,
} from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import type { TimelineTrack } from '@/types/timeline'
import { LayerRenameInput } from './motion-layer-row-cells'
import type { MotionRowReorderCommands } from './motion-row-reorder'
import type { MotionSpanDragCommands } from './motion-span-interactions'
import {
  LAYER_COLUMN_WIDTH,
  RULER_DIVISIONS,
  type InlineCurveState,
  type RenameTarget,
} from './motion-timeline-primitives'

/**
 * The cells of a layer-group row.
 *
 * A group row looks like a layer row but acts on the tracks under it, so it has
 * its own toggles: the labels and the shift-click scope differ from a layer's
 * even though the markup matches. Each control is its own component for the same
 * reason a layer row's are — a group header carries six of them.
 */

interface MotionGroupCollapseToggleProps {
  track: TimelineTrack
  t: TFunction
  updateLayerTrack: (trackId: string, updates: Partial<TimelineTrack>) => void
}

/** Collapses the group's child rows without touching the group's own row. */
function MotionGroupCollapseToggle({
  track,
  t,
  updateLayerTrack,
}: MotionGroupCollapseToggleProps) {
  return (
    <button
      type="button"
      onClick={() => updateLayerTrack(track.id, { isCollapsed: !track.isCollapsed })}
      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      aria-label={
        track.isCollapsed ? t('editor.compose.expandGroup') : t('editor.compose.collapseGroup')
      }
    >
      {track.isCollapsed ? (
        <ChevronRight className="h-3.5 w-3.5" />
      ) : (
        <ChevronDown className="h-3.5 w-3.5" />
      )}
    </button>
  )
}

interface MotionGroupVisibilityToggleProps {
  track: TimelineTrack
  t: TFunction
  updateLayerTrack: (trackId: string, updates: Partial<TimelineTrack>) => void
}

/** Eye toggle for the whole group. */
function MotionGroupVisibilityToggle({
  track,
  t,
  updateLayerTrack,
}: MotionGroupVisibilityToggleProps) {
  return (
    <button
      type="button"
      onClick={() => updateLayerTrack(track.id, { visible: !track.visible })}
      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      aria-label={track.visible === false ? t('editor.compose.showGroup') : t('editor.compose.hideGroup')}
    >
      {track.visible === false ? (
        <EyeOff className="h-3.5 w-3.5" />
      ) : (
        <Eye className="h-3.5 w-3.5" />
      )}
    </button>
  )
}

interface MotionGroupLockToggleProps {
  track: TimelineTrack
  t: TFunction
  updateLayerTrack: (trackId: string, updates: Partial<TimelineTrack>) => void
  setAllTracksLocked: (locked: boolean) => void
}

/** Lock toggle; shift-click applies the group's next lock state to every track. */
function MotionGroupLockToggle({
  track,
  t,
  updateLayerTrack,
  setAllTracksLocked,
}: MotionGroupLockToggleProps) {
  const label = track.locked ? t('editor.compose.unlockGroup') : t('editor.compose.lockGroup')
  return (
    <button
      type="button"
      onClick={(event) => {
        if (event.shiftKey) {
          setAllTracksLocked(!track.locked)
          return
        }
        updateLayerTrack(track.id, { locked: !track.locked })
      }}
      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      aria-label={label}
      title={`${label} — ${t('editor.compose.lockAllLayersHint')}`}
    >
      {track.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
    </button>
  )
}

interface MotionGroupSoloToggleProps {
  track: TimelineTrack
  t: TFunction
  updateLayerTrack: (trackId: string, updates: Partial<TimelineTrack>) => void
}

/** Solo toggle for the whole group. */
function MotionGroupSoloToggle({ track, t, updateLayerTrack }: MotionGroupSoloToggleProps) {
  return (
    <button
      type="button"
      onClick={() => updateLayerTrack(track.id, { solo: !track.solo })}
      className={cn(
        'h-5 w-5 rounded text-[9px] font-bold',
        track.solo
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
      aria-label={track.solo ? t('editor.compose.disableSolo') : t('editor.compose.soloGroup')}
    >
      S
    </button>
  )
}

export interface MotionGroupNameCellProps {
  track: TimelineTrack
  layerCount: number
  groupItemIds: string[]
  renameTarget: RenameTarget | null
  renameDraft: string
  t: TFunction
  rowReorder: MotionRowReorderCommands
  updateLayerTrack: (trackId: string, updates: Partial<TimelineTrack>) => void
  setAllTracksLocked: (locked: boolean) => void
  selectGroupItems: (itemIds: string[]) => void
  ungroup: (trackId: string) => void
  beginRename: (target: RenameTarget, name: string) => void
  commitRename: () => void
  setRenameDraft: Dispatch<SetStateAction<string>>
  setRenameTarget: Dispatch<SetStateAction<RenameTarget | null>>
}

/** Reorder handle, group toggles, inline rename and ungroup for one layer group. */
export function MotionGroupNameCell({
  track,
  layerCount,
  groupItemIds,
  renameTarget,
  renameDraft,
  t,
  rowReorder,
  updateLayerTrack,
  setAllTracksLocked,
  selectGroupItems,
  ungroup,
  beginRename,
  commitRename,
  setRenameDraft,
  setRenameTarget,
}: MotionGroupNameCellProps) {
  return (
    <div
      className="flex shrink-0 items-center gap-1 border-r border-border px-1.5"
      style={{ width: LAYER_COLUMN_WIDTH }}
    >
      <button
        type="button"
        data-testid={`motion-reorder-handle-${track.id}`}
        onPointerDown={(event) => rowReorder.begin(event, track)}
        onPointerMove={rowReorder.move}
        onPointerUp={rowReorder.end}
        onPointerCancel={rowReorder.cancel}
        className="flex h-6 w-3.5 shrink-0 touch-none items-center justify-center rounded-sm text-muted-foreground/65 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary active:text-primary"
        title={t('editor.compose.reorderGroup')}
        aria-label={t('editor.compose.reorderGroup')}
      >
        <EllipsisVertical className="h-4 w-4" />
      </button>
      <MotionGroupCollapseToggle track={track} t={t} updateLayerTrack={updateLayerTrack} />
      <MotionGroupVisibilityToggle track={track} t={t} updateLayerTrack={updateLayerTrack} />
      <MotionGroupLockToggle
        track={track}
        t={t}
        updateLayerTrack={updateLayerTrack}
        setAllTracksLocked={setAllTracksLocked}
      />
      <MotionGroupSoloToggle track={track} t={t} updateLayerTrack={updateLayerTrack} />
      {renameTarget?.kind === 'group' && renameTarget.id === track.id ? (
        <LayerRenameInput
          value={renameDraft}
          ariaLabel={t('editor.compose.layerGroupName')}
          bold
          onDraftChange={setRenameDraft}
          onCommit={commitRename}
          onCancel={() => setRenameTarget(null)}
        />
      ) : (
        <button
          type="button"
          onClick={() => selectGroupItems(groupItemIds)}
          onDoubleClick={() => beginRename({ kind: 'group', id: track.id }, track.name)}
          className="min-w-0 flex-1 truncate px-1 text-left text-[11px] font-semibold text-foreground"
          title={track.name}
        >
          {track.name}
          <span className="ml-1.5 text-[9px] font-normal text-muted-foreground">
            {t('editor.compose.groupLayerCount', { count: layerCount })}
          </span>
        </button>
      )}
      <button
        type="button"
        onClick={() => ungroup(track.id)}
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        title={t('editor.compose.ungroup')}
        aria-label={t('editor.compose.ungroup')}
      >
        <Ungroup className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export interface MotionGroupLaneCellProps {
  track: TimelineTrack
  groupItemIds: string[]
  groupFrom: number
  groupEnd: number
  activeInlineCurve: InlineCurveState | null
  frameToMotionPercent: (frame: number) => number
  visibleFrameRange: number
  spanDrag: MotionSpanDragCommands
  beginPlayheadScrub: (event: ReactPointerEvent<HTMLDivElement>) => void
  movePlayheadScrub: (event: ReactPointerEvent<HTMLDivElement>) => void
  endPlayheadScrub: (event: ReactPointerEvent<HTMLDivElement>) => void
}

/**
 * The group's slice of the motion timeline: the scrub surface, the static
 * divisions and — while no inline curve pane is open — the group span.
 */
export function MotionGroupLaneCell({
  track,
  groupItemIds,
  groupFrom,
  groupEnd,
  activeInlineCurve,
  frameToMotionPercent,
  visibleFrameRange,
  spanDrag,
  beginPlayheadScrub,
  movePlayheadScrub,
  endPlayheadScrub,
}: MotionGroupLaneCellProps) {
  return (
    <div
      className="relative min-w-0 flex-1 touch-none overflow-hidden"
      onPointerDown={beginPlayheadScrub}
      onPointerMove={movePlayheadScrub}
      onPointerUp={endPlayheadScrub}
      onPointerCancel={endPlayheadScrub}
    >
      <div data-motion-viewport-surface className="absolute inset-0 overflow-hidden">
        {Array.from({ length: RULER_DIVISIONS + 1 }, (_, tick) => (
          <div
            key={tick}
            data-motion-static-x
            className="pointer-events-none absolute inset-y-0 border-l border-border/45"
            style={{ left: `${(tick / RULER_DIVISIONS) * 100}%` }}
          />
        ))}
        {!activeInlineCurve && groupItemIds.length > 0 && (
          <button
            type="button"
            data-testid={`motion-group-span-${track.id}`}
            data-from-frame={groupFrom}
            data-to-frame={groupEnd}
            disabled={track.locked}
            onPointerDown={(event) => !track.locked && spanDrag.begin(event, groupItemIds)}
            onPointerMove={spanDrag.move}
            onPointerUp={spanDrag.end}
            onPointerCancel={spanDrag.cancel}
            className={cn(
              'absolute top-1/2 h-6 -translate-y-1/2 touch-none rounded-sm border border-timeline-motion-segment/80 bg-timeline-motion-segment/70 px-1 text-left text-[9px] text-foreground',
              track.locked
                ? 'cursor-not-allowed opacity-55'
                : 'cursor-grab active:cursor-grabbing',
            )}
            style={{
              left: `${frameToMotionPercent(groupFrom)}%`,
              width: `${Math.max(0.6, ((groupEnd - groupFrom) / visibleFrameRange) * 100)}%`,
            }}
          >
            <span className="block truncate">{track.name}</span>
          </button>
        )}
      </div>
    </div>
  )
}
