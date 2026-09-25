import type { TimelineItem, TimelineTrack } from '@/types/timeline'

/** Coherent item/track snapshot the Motion timeline renders a frame from. */
export interface CompositingTimelineItemsSnapshot {
  items: TimelineItem[]
  tracks: TimelineTrack[]
  itemById: Record<string, TimelineItem>
}

/** The translate interaction the gizmo is presenting for a preview. */
export interface TranslatePresentation {
  interactionId: number
  itemId: string
}

interface TranslateGizmoState {
  mode: string
  interactionId: number
  itemId: string
}

/**
 * The translate interaction currently presented for the preview: the live gizmo
 * first, then the handoff that outlives it so DOM presentation can bridge to the
 * committed timeline transform.
 */
export function resolveTranslatePresentation(
  activeGizmo: TranslateGizmoState | null | undefined,
  presentationHandoff: TranslateGizmoState | null | undefined,
): TranslatePresentation | null {
  if (activeGizmo?.mode === 'translate') {
    return { interactionId: activeGizmo.interactionId, itemId: activeGizmo.itemId }
  }
  if (presentationHandoff?.mode === 'translate') {
    return {
      interactionId: presentationHandoff.interactionId,
      itemId: presentationHandoff.itemId,
    }
  }
  return null
}

const IGNORED_ITEM_KEYS: Record<string, true> = { transform: true }
const IGNORED_TRANSFORM_KEYS: Record<string, true> = { x: true, y: true }

/** Whether two records agree on every key except the ignored ones. */
function hasSameValuesExcept(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  ignoredKeys: Record<string, true>,
): boolean {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)])
  for (const key of keys) {
    if (ignoredKeys[key] === true) continue
    if (!Object.is(previous[key], next[key])) return false
  }
  return true
}

function isSameTransformExceptPosition(previous: unknown, next: unknown): boolean {
  if (previous === next) return true
  if (!previous || !next) return false
  return hasSameValuesExcept(
    previous as Record<string, unknown>,
    next as Record<string, unknown>,
    IGNORED_TRANSFORM_KEYS,
  )
}

/** Whether two versions of a layer differ only by its transform position. */
function isSameItemExceptPosition(previous: TimelineItem, next: TimelineItem): boolean {
  if (previous === next) return true
  if (previous.id !== next.id || previous.type !== next.type) return false
  if (
    !hasSameValuesExcept(
      previous as unknown as Record<string, unknown>,
      next as unknown as Record<string, unknown>,
      IGNORED_ITEM_KEYS,
    )
  ) {
    return false
  }
  return isSameTransformExceptPosition(previous.transform, next.transform)
}

/** Whether the layers differ only by the given item's transform position. */
function hasOnlyTranslateChangeForItem(
  previousItems: readonly TimelineItem[],
  nextItems: readonly TimelineItem[],
  itemId: string,
): boolean {
  let changedItemFound = false
  for (let index = 0; index < previousItems.length; index += 1) {
    const previousItem = previousItems[index]
    const nextItem = nextItems[index]
    if (!previousItem || !nextItem || previousItem.id !== nextItem.id) return false
    if (previousItem === nextItem) continue
    if (previousItem.id !== itemId || !isSameItemExceptPosition(previousItem, nextItem)) {
      return false
    }
    changedItemFound = true
  }
  return changedItemFound
}

/**
 * Whether the only difference between two snapshots is the translate of one
 * item: the single commit the Motion tree may render concurrently.
 */
export function isTranslateOnlyItemsSnapshotChange(
  previous: CompositingTimelineItemsSnapshot,
  next: CompositingTimelineItemsSnapshot,
  itemId: string,
): boolean {
  if (previous === next) return false
  if (previous.tracks !== next.tracks || previous.items.length !== next.items.length) return false
  return hasOnlyTranslateChangeForItem(previous.items, next.items, itemId)
}
