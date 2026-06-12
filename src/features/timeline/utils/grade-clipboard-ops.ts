/**
 * Copy/paste a clip's color grade (its color-category GPU effects).
 *
 * "Copy grade" snapshots the source clip's color effects into the grade
 * clipboard; "paste grade" replaces the target clips' color effects with the
 * copied ones (non-color effects are untouched) as a single undo step.
 */
import type { ItemEffect, VisualEffect } from '@/types/effects'
import type { TimelineItem } from '@/types/timeline'
import { isColorGradeEffectType } from '@/infrastructure/gpu-effects'
import { useGradeClipboardStore } from '@/shared/state/grade-clipboard'
import { useItemsStore } from '../stores/items-store'
import { setItemEffects } from '../stores/actions/effect-actions'

function isColorGradeEntry(entry: ItemEffect): boolean {
  return entry.effect.type === 'gpu-effect' && isColorGradeEffectType(entry.effect.gpuEffectType)
}

export function itemHasColorGrade(item: TimelineItem | undefined): boolean {
  if (!item || item.type === 'audio') return false
  return (item.effects ?? []).some(isColorGradeEntry)
}

function cloneVisualEffect(effect: VisualEffect): VisualEffect {
  return { ...effect, params: { ...effect.params } }
}

/** Snapshot the item's color effects into the grade clipboard. Returns false when there is nothing to copy. */
export function copyGradeFromItem(itemId: string): boolean {
  const item = useItemsStore.getState().itemById[itemId]
  if (!item || item.type === 'audio') return false

  const grade = (item.effects ?? [])
    .filter(isColorGradeEntry)
    .map((entry) => cloneVisualEffect(entry.effect))
  if (grade.length === 0) return false

  useGradeClipboardStore.getState().setGrade(grade)
  return true
}

/**
 * Replace the color effects on the given items with the copied grade
 * (one undo step). Returns false when the clipboard is empty.
 */
export function pasteGradeToItems(itemIds: string[]): boolean {
  const grade = useGradeClipboardStore.getState().grade
  if (!grade || grade.length === 0) return false

  const { itemById } = useItemsStore.getState()
  const updates: Array<{ itemId: string; effects: ItemEffect[] }> = []

  for (const itemId of itemIds) {
    const item = itemById[itemId]
    if (!item || item.type === 'audio') continue

    const keptEffects = (item.effects ?? []).filter((entry) => !isColorGradeEntry(entry))
    const pastedEffects: ItemEffect[] = grade.map((effect) => ({
      id: crypto.randomUUID(),
      effect: cloneVisualEffect(effect),
      enabled: true,
    }))
    updates.push({ itemId, effects: [...keptEffects, ...pastedEffects] })
  }

  if (updates.length === 0) return false
  setItemEffects(updates)
  return true
}
