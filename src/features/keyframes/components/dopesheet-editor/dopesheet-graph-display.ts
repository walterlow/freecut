/**
 * Pure graph-pane display decisions.
 * Which curve the graph draws, and which keys the focused pane claims. Both
 * are branch-heavy enough to be worth reading on their own, and both are the
 * kind of thing that must not drift: the resolver's priority order decides
 * whether the pane looks blank, and the key handler decides whether the browser
 * also acts on the key.
 */

import type { AnimatableProperty, KeyframeRef } from '@/types/keyframe'

/**
 * The key fields the focused-pane handler reads. Both a DOM KeyboardEvent and
 * React's synthetic keyboard event satisfy it.
 */
export interface PaneKeyEvent {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  preventDefault: () => void
  stopPropagation: () => void
}

type GraphPaneKeyCommand = { kind: 'remove' } | { kind: 'nudge'; deltaFrames: number }

const GRAPH_PANE_REMOVE_KEYS: Record<string, true> = { Delete: true, Backspace: true }
const GRAPH_PANE_NUDGE_DIRECTION: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 }
const GRAPH_PANE_SHIFT_STEP = 10

/**
 * The property the graph draws. The selection wins while it has a drawable
 * curve, otherwise the first visible property that does; a selection without a
 * full curve is still better than nothing, and no visible property means no
 * curve at all.
 */
export function resolveGraphDisplayProperty(
  graphVisibleProperties: Set<AnimatableProperty>,
  graphableProperties: AnimatableProperty[],
  activeSelectedProperty: AnimatableProperty | null,
): AnimatableProperty | null {
  if (graphVisibleProperties.size === 0) return null

  const isVisibleSelection =
    activeSelectedProperty !== null && graphVisibleProperties.has(activeSelectedProperty)

  if (isVisibleSelection && graphableProperties.includes(activeSelectedProperty)) {
    return activeSelectedProperty
  }

  const graphableVisible = [...graphVisibleProperties].find((property) =>
    graphableProperties.includes(property),
  )
  if (graphableVisible) return graphableVisible

  return isVisibleSelection ? activeSelectedProperty : null
}

/**
 * Maps a key press on the focused graph pane to the command it runs. Only the
 * unmodified keys are claimed, so pane shortcuts never shadow a modifier chord;
 * removal is only offered when the editor can actually remove keyframes.
 */
function resolveGraphPaneKeyCommand(
  event: PaneKeyEvent,
  canRemove: boolean,
): GraphPaneKeyCommand | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (GRAPH_PANE_REMOVE_KEYS[event.key] === true) return canRemove ? { kind: 'remove' } : null

  const direction = GRAPH_PANE_NUDGE_DIRECTION[event.key]
  if (direction === undefined) return null

  return { kind: 'nudge', deltaFrames: direction * (event.shiftKey ? GRAPH_PANE_SHIFT_STEP : 1) }
}

/**
 * Delete/Backspace removes the selection, the arrows nudge it. The key is only
 * swallowed once a command is actually available, so an unusable key still
 * reaches the browser and the surrounding app.
 */
export function handleGraphPaneKeyDown(
  event: PaneKeyEvent,
  options: {
    disabled: boolean
    propertyLocked: boolean
    selectedRefs: KeyframeRef[]
    onRemoveKeyframes?: (refs: KeyframeRef[]) => void
    onNudge: (deltaFrames: number) => void
  },
): void {
  const { disabled, propertyLocked, selectedRefs, onRemoveKeyframes, onNudge } = options
  if (disabled || propertyLocked || selectedRefs.length === 0) return

  const command = resolveGraphPaneKeyCommand(event, Boolean(onRemoveKeyframes))
  if (!command) return

  event.preventDefault()
  event.stopPropagation()

  if (command.kind === 'nudge') {
    onNudge(command.deltaFrames)
    return
  }
  onRemoveKeyframes?.(selectedRefs)
}
