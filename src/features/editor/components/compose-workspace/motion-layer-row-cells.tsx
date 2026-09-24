import {
  memo,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from 'react'
import type { TFunction } from 'i18next'
import type { LucideIcon } from 'lucide-react'
import {
  ChevronDown,
  ChevronRight,
  EllipsisVertical,
  Eye,
  EyeOff,
  Lock,
  Unlock,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/shared/ui/cn'
import { usePlaybackStore } from '@/shared/state/playback'
import type { BlendMode } from '@/types/blend-modes'
import { BLEND_MODE_GROUPS, BLEND_MODE_LABELS } from '@/types/blend-modes'
import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import type { CanvasSettings } from '@/types/transform'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PickWhipIcon, setTransformParents } from '@/features/editor/deps/timeline-motion'
import {
  getTransformParentRejection,
  getTransformParentRejectionMessage,
} from './transform-parent-validation'
import type { LayerEntry, LayerParentCandidate } from './motion-layer-row-model'
import type { MotionLayerSelectionCommands } from './motion-layer-selection'
import type { MotionRowReorderCommands } from './motion-row-reorder'
import {
  LAYER_MODE_COLUMN_WIDTH,
  LAYER_PARENT_COLUMN_WIDTH,
  LAYER_TIMING_COLUMN_WIDTH,
  NO_TRANSFORM_PARENT,
  type RenameTarget,
} from './motion-timeline-primitives'

const ALL_BLEND_MODES = BLEND_MODE_GROUPS.flatMap((group) => group.modes)

interface LayerFrameInputProps {
  label: string
  ariaLabel: string
  value: number
  min: number
  max: number
  onCommit: (value: number) => void
  disabled?: boolean
}

const LayerFrameInput = memo(function LayerFrameInput({
  label,
  ariaLabel,
  value,
  min,
  max,
  onCommit,
  disabled = false,
}: LayerFrameInputProps) {
  return (
    <label className="flex items-center gap-0.5 text-[8px] text-muted-foreground" title={ariaLabel}>
      <span className="sr-only">{label}</span>
      <input
        key={value}
        type="number"
        autoComplete="off"
        data-bwignore="true"
        defaultValue={value}
        min={min}
        max={max}
        disabled={disabled}
        onBlur={(event) => {
          const parsed = Number(event.currentTarget.value)
          if (!Number.isFinite(parsed)) return
          const next = Math.max(min, Math.min(max, Math.round(parsed)))
          event.currentTarget.value = String(next)
          if (next !== value) onCommit(next)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        className="h-5 w-14 rounded border border-input bg-background px-1.5 text-[9px] tabular-nums text-muted-foreground outline-none focus:border-primary/60"
        aria-label={ariaLabel}
      />
    </label>
  )
})

interface LayerRenameInputProps {
  value: string
  ariaLabel: string
  bold?: boolean
  onDraftChange: Dispatch<SetStateAction<string>>
  onCommit: () => void
  onCancel: () => void
}

/** The one inline rename field, shared by layer rows and layer-group headers. */
export function LayerRenameInput({
  value,
  ariaLabel,
  bold = false,
  onDraftChange,
  onCommit,
  onCancel,
}: LayerRenameInputProps) {
  return (
    <input
      autoFocus
      value={value}
      onChange={(event) => onDraftChange(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={onCommit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') onCancel()
      }}
      aria-label={ariaLabel}
      className={cn(
        'h-5 min-w-24 flex-1 rounded border border-primary/50 bg-background px-1.5 text-[11px] outline-none',
        bold ? 'font-semibold' : 'font-medium',
      )}
    />
  )
}

interface TransformParentMenuSelection {
  value: string
  currentParentItemId: string | undefined
  childItemId: string
  itemById: Record<string, TimelineItem>
  keyframesByItemId: Record<string, ItemKeyframes>
  canvas: CanvasSettings
  t: TFunction
}

function applyTransformParentMenuSelection({
  value,
  currentParentItemId,
  childItemId,
  itemById,
  keyframesByItemId,
  canvas,
  t,
}: TransformParentMenuSelection): void {
  const nextParentItemId = value === NO_TRANSFORM_PARENT ? undefined : value
  if (nextParentItemId === currentParentItemId) return
  const rejection = nextParentItemId
    ? getTransformParentRejection({
        childItemId,
        parentItemId: nextParentItemId,
        itemById,
        keyframesByItemId,
      })
    : null
  if (rejection) {
    toast.error(getTransformParentRejectionMessage(t, rejection))
    return
  }
  const playback = usePlaybackStore.getState()
  setTransformParents({
    childItemIds: [childItemId],
    parentItemId: nextParentItemId,
    frame: playback.previewFrame ?? playback.currentFrame,
    canvas,
  })
}

interface MotionLayerVisibilityToggleProps {
  item: TimelineItem
  track: TimelineTrack | undefined
  t: TFunction
  updateLayerTrack: (trackId: string, updates: Partial<TimelineTrack>) => void
}

/** Eye toggle, or the null-object placeholder that keeps controller rows aligned. */
function MotionLayerVisibilityToggle({
  item,
  track,
  t,
  updateLayerTrack,
}: MotionLayerVisibilityToggleProps) {
  if (item.type === 'controller') {
    return (
      <span
        className="h-[18px] w-[18px] shrink-0"
        data-testid={`motion-null-object-icon-slot-${item.id}`}
        aria-hidden="true"
      />
    )
  }
  return (
    <button
      type="button"
      onClick={() => track && updateLayerTrack(track.id, { visible: !track.visible })}
      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      aria-label={
        track?.visible === false ? t('editor.compose.showLayer') : t('editor.compose.hideLayer')
      }
    >
      {track?.visible === false ? (
        <EyeOff className="h-3.5 w-3.5" />
      ) : (
        <Eye className="h-3.5 w-3.5" />
      )}
    </button>
  )
}

interface MotionLayerLockToggleProps {
  track: TimelineTrack | undefined
  isLayerLocked: boolean
  isParentLayerGroupLocked: boolean
  t: TFunction
  updateLayerTrack: (trackId: string, updates: Partial<TimelineTrack>) => void
  setAllTracksLocked: (locked: boolean) => void
}

function getLockToggleLabels(
  t: TFunction,
  isParentLayerGroupLocked: boolean,
  isLayerLocked: boolean,
): { label: string; title: string } {
  if (isParentLayerGroupLocked) {
    const label = t('editor.compose.lockedByLayerGroup')
    return { label, title: label }
  }
  const action = t(isLayerLocked ? 'editor.compose.unlockLayer' : 'editor.compose.lockLayer')
  return { label: action, title: `${action} — ${t('editor.compose.lockAllLayersHint')}` }
}

/** Lock toggle; shift-click applies the row's next state to every track. */
function MotionLayerLockToggle({
  track,
  isLayerLocked,
  isParentLayerGroupLocked,
  t,
  updateLayerTrack,
  setAllTracksLocked,
}: MotionLayerLockToggleProps) {
  const { label, title } = getLockToggleLabels(t, isParentLayerGroupLocked, isLayerLocked)
  return (
    <button
      type="button"
      onClick={(event) => {
        if (!track || isParentLayerGroupLocked) return
        if (event.shiftKey) {
          setAllTracksLocked(!track.locked)
          return
        }
        updateLayerTrack(track.id, { locked: !track.locked })
      }}
      disabled={isParentLayerGroupLocked}
      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-55"
      aria-label={label}
      title={title}
    >
      {isLayerLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
    </button>
  )
}

interface MotionLayerSoloToggleProps {
  item: TimelineItem
  track: TimelineTrack | undefined
  t: TFunction
  updateLayerTrack: (trackId: string, updates: Partial<TimelineTrack>) => void
}

/** Solo toggle, or the placeholder that keeps controller rows aligned. */
function MotionLayerSoloToggle({ item, track, t, updateLayerTrack }: MotionLayerSoloToggleProps) {
  if (item.type === 'controller') {
    return <span className="h-5 w-5 shrink-0" aria-hidden="true" />
  }
  return (
    <button
      type="button"
      onClick={() => track && updateLayerTrack(track.id, { solo: !track.solo })}
      className={cn(
        'h-5 w-5 rounded text-[9px] font-bold',
        track?.solo
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
      aria-label={track?.solo ? t('editor.compose.disableSolo') : t('editor.compose.soloLayer')}
    >
      S
    </button>
  )
}

interface LayerNameLabelProps {
  item: TimelineItem
  index: number
  LayerTypeIcon: LucideIcon
  nullObjectNonRenderingLabel: string | undefined
  renameTarget: RenameTarget | null
  renameDraft: string
  selectLayer: MotionLayerSelectionCommands['selectLayer']
  beginRename: (target: RenameTarget, name: string) => void
  commitRename: () => void
  setRenameDraft: Dispatch<SetStateAction<string>>
  setRenameTarget: Dispatch<SetStateAction<RenameTarget | null>>
}

/** The layer name: an inline rename input while renaming, a select button otherwise. */
function LayerNameLabel({
  item,
  index,
  LayerTypeIcon,
  nullObjectNonRenderingLabel,
  renameTarget,
  renameDraft,
  selectLayer,
  beginRename,
  commitRename,
  setRenameDraft,
  setRenameTarget,
}: LayerNameLabelProps) {
  if (renameTarget?.kind === 'layer' && renameTarget.id === item.id) {
    return (
      <LayerRenameInput
        value={renameDraft}
        ariaLabel="Layer name"
        onDraftChange={setRenameDraft}
        onCommit={commitRename}
        onCancel={() => setRenameTarget(null)}
      />
    )
  }
  return (
    <button
      type="button"
      onClick={(event) =>
        selectLayer(item.id, {
          toggle: event.metaKey || event.ctrlKey,
          range: event.shiftKey,
        })
      }
      onDoubleClick={() => beginRename({ kind: 'layer', id: item.id }, item.label || item.type)}
      className="min-w-0 flex-1 truncate px-0 text-left text-[11px] font-medium text-foreground"
      title={nullObjectNonRenderingLabel ?? (item.label || item.type)}
      aria-label={
        nullObjectNonRenderingLabel ? `${index + 1}. ${nullObjectNonRenderingLabel}` : undefined
      }
    >
      <span className="mr-0.5 inline-block w-3 shrink-0 text-right text-[9px] tabular-nums text-muted-foreground/70">
        {index + 1}
      </span>
      <LayerTypeIcon
        className="mr-1 inline-block h-3 w-3 shrink-0 align-[-2px] text-muted-foreground"
        data-testid={`motion-layer-type-icon-${item.id}`}
        data-motion-layer-type-icon={item.type}
        aria-hidden="true"
      />
      {item.label || item.type}
    </button>
  )
}

export interface MotionLayerNameCellProps {
  item: TimelineItem
  index: number
  depth: number
  track: TimelineTrack | undefined
  LayerTypeIcon: LucideIcon
  activeCompositionId: string
  layerEntries: readonly LayerEntry[]
  expanded: boolean
  hasVisibleChildProperties: boolean
  isLayerLocked: boolean
  isParentLayerGroupLocked: boolean
  nullObjectNonRenderingLabel: string | undefined
  renameTarget: RenameTarget | null
  renameDraft: string
  t: TFunction
  rowReorder: MotionRowReorderCommands
  layerSelection: MotionLayerSelectionCommands
  updateLayerTrack: (trackId: string, updates: Partial<TimelineTrack>) => void
  setAllTracksLocked: (locked: boolean) => void
  toggleLayerExpanded: (compositionId: string, itemId: string) => void
  setAllLayersExpanded: (
    compositionId: string,
    itemIds: Iterable<string>,
    expanded: boolean,
  ) => void
  beginRename: (target: RenameTarget, name: string) => void
  commitRename: () => void
  setRenameDraft: Dispatch<SetStateAction<string>>
  setRenameTarget: Dispatch<SetStateAction<RenameTarget | null>>
}

/** Reorder handle, expand toggle, per-track toggles and the layer name. */
export function MotionLayerNameCell({
  item,
  index,
  depth,
  track,
  LayerTypeIcon,
  activeCompositionId,
  layerEntries,
  expanded,
  hasVisibleChildProperties,
  isLayerLocked,
  isParentLayerGroupLocked,
  nullObjectNonRenderingLabel,
  renameTarget,
  renameDraft,
  t,
  rowReorder,
  layerSelection,
  updateLayerTrack,
  setAllTracksLocked,
  toggleLayerExpanded,
  setAllLayersExpanded,
  beginRename,
  commitRename,
  setRenameDraft,
  setRenameTarget,
}: MotionLayerNameCellProps) {
  return (
    <div
      data-testid={`motion-layer-name-cell-${item.id}`}
      className="flex min-w-0 flex-1 items-center gap-1 px-1.5"
      style={{ paddingLeft: 6 + depth * 16 }}
    >
      {track && (
        <button
          type="button"
          data-testid={`motion-reorder-handle-${track.id}`}
          disabled={isLayerLocked}
          onPointerDown={(event) => !isLayerLocked && rowReorder.begin(event, track)}
          onPointerMove={rowReorder.move}
          onPointerUp={rowReorder.end}
          onPointerCancel={rowReorder.cancel}
          className="flex h-6 w-3.5 shrink-0 touch-none items-center justify-center rounded-sm text-muted-foreground/65 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary active:text-primary"
          title={t('editor.compose.reorderLayer')}
          aria-label={t('editor.compose.reorderLayer')}
        >
          <EllipsisVertical className="h-4 w-4" />
        </button>
      )}
      {hasVisibleChildProperties ? (
        <button
          type="button"
          onClick={(event) => {
            if (event.shiftKey) {
              setAllLayersExpanded(
                activeCompositionId,
                layerEntries.map((entry) => entry.item.id),
                !expanded,
              )
              return
            }
            toggleLayerExpanded(activeCompositionId, item.id)
          }}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title={t('editor.compose.shiftToggleAllLayers', {
            defaultValue: 'Shift-click to expand or collapse all layers',
          })}
          aria-label={
            expanded
              ? t('editor.compose.collapseLayerProperties')
              : t('editor.compose.expandLayerProperties')
          }
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
      ) : (
        <span className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      )}
      <MotionLayerVisibilityToggle
        item={item}
        track={track}
        t={t}
        updateLayerTrack={updateLayerTrack}
      />
      <MotionLayerLockToggle
        track={track}
        isLayerLocked={isLayerLocked}
        isParentLayerGroupLocked={isParentLayerGroupLocked}
        t={t}
        updateLayerTrack={updateLayerTrack}
        setAllTracksLocked={setAllTracksLocked}
      />
      <MotionLayerSoloToggle item={item} track={track} t={t} updateLayerTrack={updateLayerTrack} />
      <LayerNameLabel
        item={item}
        index={index}
        LayerTypeIcon={LayerTypeIcon}
        nullObjectNonRenderingLabel={nullObjectNonRenderingLabel}
        renameTarget={renameTarget}
        renameDraft={renameDraft}
        selectLayer={layerSelection.selectLayer}
        beginRename={beginRename}
        commitRename={commitRename}
        setRenameDraft={setRenameDraft}
        setRenameTarget={setRenameTarget}
      />
    </div>
  )
}

export interface MotionLayerParentCellProps {
  item: TimelineItem
  parentItemId: string | undefined
  parentCandidates: readonly LayerParentCandidate[]
  isLayerLocked: boolean
  itemById: Record<string, TimelineItem>
  keyframesByItemId: Record<string, ItemKeyframes>
  canvas: CanvasSettings
  t: TFunction
  beginTransformParentDrag: (
    event: ReactPointerEvent<HTMLButtonElement>,
    itemId: string,
    parentItemId: string | undefined,
  ) => void
}

function getParentCandidateLabel(candidate: TimelineItem, t: TFunction): string {
  if (candidate.type !== 'controller') return candidate.label || candidate.type
  return t('editor.transformHierarchy.controllerOption', {
    defaultValue: 'Null: {{name}}',
    name: candidate.label,
  })
}

/** Pick-whip plus the parent select for one layer. */
export function MotionLayerParentCell({
  item,
  parentItemId,
  parentCandidates,
  isLayerLocked,
  itemById,
  keyframesByItemId,
  canvas,
  t,
  beginTransformParentDrag,
}: MotionLayerParentCellProps) {
  return (
    <div
      data-testid={`motion-parent-cell-${item.id}`}
      className="flex shrink-0 items-center gap-1 border-l border-border px-1"
      style={{ width: LAYER_PARENT_COLUMN_WIDTH }}
    >
      <button
        type="button"
        data-testid={`motion-parent-pick-whip-${item.id}`}
        disabled={isLayerLocked}
        onPointerDown={(event) =>
          !isLayerLocked && beginTransformParentDrag(event, item.id, parentItemId)
        }
        aria-label={t('editor.compose.parentPickWhipForLayer', {
          defaultValue: 'Parent pick whip for {{name}}',
          name: item.label || item.type,
        })}
        title={t('editor.compose.parentPickWhipHelp', {
          defaultValue:
            'Drag to a parent layer. Shift: snap position. Alt: use local pose. Ctrl/Cmd-click: detach.',
        })}
        className={cn(
          'flex h-6 w-6 shrink-0 touch-none items-center justify-center rounded-sm outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-primary',
          parentItemId ? 'text-orange-400' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <PickWhipIcon className="h-3.5 w-3.5" />
      </button>
      <Select
        disabled={isLayerLocked}
        value={parentItemId ?? NO_TRANSFORM_PARENT}
        onValueChange={(value) =>
          applyTransformParentMenuSelection({
            value,
            currentParentItemId: parentItemId,
            childItemId: item.id,
            itemById,
            keyframesByItemId,
            canvas,
            t,
          })
        }
      >
        <SelectTrigger
          aria-label={t('editor.compose.parentForLayer', {
            defaultValue: 'Parent for {{name}}',
            name: item.label || item.type,
          })}
          className="h-6 min-w-0 flex-1 gap-1 border-transparent bg-transparent px-1.5 py-0 text-[9px] shadow-none hover:border-input hover:bg-background data-[state=open]:border-primary/50 data-[state=open]:bg-background [&>svg]:h-3 [&>svg]:w-3"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_TRANSFORM_PARENT} className="text-[10px]">
            {t('editor.transformHierarchy.none', { defaultValue: 'None' })}
          </SelectItem>
          {parentCandidates.map(({ item: candidate, layerNumber }) => (
            <SelectItem key={candidate.id} value={candidate.id} className="text-[10px]">
              <span className="mr-1 text-muted-foreground">{layerNumber}.</span>
              {getParentCandidateLabel(candidate, t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export interface MotionLayerTimingCellProps {
  item: TimelineItem
  isLayerLocked: boolean
  durationInFrames: number
  t: TFunction
  updateItem: (itemId: string, updates: Partial<TimelineItem>) => void
}

/** In/out frame inputs for one layer. */
export function MotionLayerTimingCell({
  item,
  isLayerLocked,
  durationInFrames,
  t,
  updateItem,
}: MotionLayerTimingCellProps) {
  return (
    <div
      data-testid={`motion-timing-cell-${item.id}`}
      className="flex shrink-0 items-center gap-1 border-l border-border px-1"
      style={{ width: LAYER_TIMING_COLUMN_WIDTH }}
    >
      <LayerFrameInput
        label="I"
        ariaLabel={t('editor.compose.inFrame')}
        value={item.from}
        min={0}
        max={Math.max(0, item.from + item.durationInFrames - 1)}
        disabled={isLayerLocked}
        onCommit={(nextFrom) =>
          updateItem(item.id, {
            from: nextFrom,
            durationInFrames: Math.max(1, item.from + item.durationInFrames - nextFrom),
          })
        }
      />
      <LayerFrameInput
        label="O"
        ariaLabel={t('editor.compose.outFrame')}
        value={item.from + item.durationInFrames}
        min={item.from + 1}
        max={durationInFrames}
        disabled={isLayerLocked}
        onCommit={(nextOut) =>
          updateItem(item.id, {
            durationInFrames: Math.max(1, nextOut - item.from),
          })
        }
      />
    </div>
  )
}

export interface MotionLayerModeCellProps {
  item: TimelineItem
  isLayerLocked: boolean
  t: TFunction
  updateItem: (itemId: string, updates: Partial<TimelineItem>) => void
}

/** Blend-mode select for one layer. */
export function MotionLayerModeCell({
  item,
  isLayerLocked,
  t,
  updateItem,
}: MotionLayerModeCellProps) {
  return (
    <div
      className="flex shrink-0 items-center border-l border-border px-1"
      style={{ width: LAYER_MODE_COLUMN_WIDTH }}
    >
      <Select
        disabled={isLayerLocked}
        value={item.blendMode ?? 'normal'}
        onValueChange={(value) => updateItem(item.id, { blendMode: value as BlendMode })}
      >
        <SelectTrigger
          className="h-5 w-full gap-1 bg-background px-2 text-[9px] text-muted-foreground"
          aria-label={t('editor.compose.blendMode')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {ALL_BLEND_MODES.map((mode) => (
            <SelectItem key={mode} value={mode} className="text-[10px]">
              {BLEND_MODE_LABELS[mode]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
