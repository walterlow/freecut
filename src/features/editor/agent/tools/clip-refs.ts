/**
 * Stable, model-facing clip handles ("c1", "c2", …).
 *
 * A 4B local model can't reason about opaque UUIDs, and acting on "the
 * selection" is brittle when nothing is selected. Instead we expose a small,
 * deterministic inventory of clips with short refs. The same builder feeds both
 * the prompt context (so the model sees the refs) and tool resolution (so a tool
 * call referencing `c3` maps back to the real item) — keeping the two in sync.
 */

import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { useSelectionStore } from '@/shared/state/selection'
import type { TimelineItem } from '@/types/timeline'

/** Most clips we ground; keeps the prompt small on huge timelines. */
const MAX_REFS = 40

export interface ClipRefEntry {
  ref: string
  itemId: string
  type: TimelineItem['type']
  label: string
  startSeconds: number
  endSeconds: number
  selected: boolean
}

/** ref → itemId for the most recently built inventory. */
let refToItemId = new Map<string, string>()
/** itemId → ref, for labeling search results back to clips the model knows. */
let itemIdToRef = new Map<string, string>()

function deterministicOrder(a: TimelineItem, b: TimelineItem): number {
  if (a.from !== b.from) return a.from - b.from
  return a.trackId.localeCompare(b.trackId)
}

/**
 * Build the current clip inventory and refresh the ref→id map. Called when
 * assembling the prompt context so refs the model receives resolve at run time.
 */
export function buildClipRefs(): ClipRefEntry[] {
  const { items, fps } = useTimelineStore.getState()
  const selected = new Set(useSelectionStore.getState().selectedItemIds)
  const safeFps = Math.max(1, fps)

  const ordered = [...items].sort(deterministicOrder).slice(0, MAX_REFS)
  const entries: ClipRefEntry[] = ordered.map((item, index) => ({
    ref: `c${index + 1}`,
    itemId: item.id,
    type: item.type,
    label: item.label?.trim() || item.type,
    startSeconds: item.from / safeFps,
    endSeconds: (item.from + item.durationInFrames) / safeFps,
    selected: selected.has(item.id),
  }))

  refToItemId = new Map(entries.map((entry) => [entry.ref, entry.itemId]))
  itemIdToRef = new Map(entries.map((entry) => [entry.itemId, entry.ref]))
  return entries
}

/** Resolve one ref ("c3") to its itemId, or undefined if unknown/stale. */
export function resolveClipRef(ref: string): string | undefined {
  return refToItemId.get(ref.trim())
}

/** Resolve an itemId back to its ref ("c3"), or undefined if not in the inventory. */
export function resolveItemRef(itemId: string): string | undefined {
  return itemIdToRef.get(itemId)
}

/** Resolve a list of refs to itemIds, dropping unknown ones. */
export function resolveClipRefs(refs: readonly string[]): string[] {
  return refs.map((ref) => resolveClipRef(ref)).filter((id): id is string => Boolean(id))
}

/**
 * Resolve a tool's optional `clips` arg to live timeline items. Falls back to the
 * current selection when no refs are supplied — so "make this faster" with a clip
 * selected still works.
 */
export function resolveTargetItems(refs: readonly string[] | undefined): TimelineItem[] {
  const ids =
    refs && refs.length > 0 ? resolveClipRefs(refs) : useSelectionStore.getState().selectedItemIds
  const byId = new Map(useTimelineStore.getState().items.map((item) => [item.id, item]))
  return ids.map((id) => byId.get(id)).filter((item): item is TimelineItem => Boolean(item))
}
