import { useItemsStore } from '../../items-store'
import { useTransitionsStore } from '../../transitions-store'
import { useKeyframesStore } from '../../keyframes-store'
import { useTimelineSettingsStore } from '../../timeline-settings-store'
import { execute, applyTransitionRepairs } from '../shared'
import { getSynchronizedLinkedCounterpartPairForEdit } from '../linked-edit'
import { isLinkedSelectionEnabled } from './shared'

export function joinItems(itemIds: string[]): void {
  execute(
    'JOIN_ITEMS',
    () => {
      const items = useItemsStore.getState().items
      const itemsToJoin = items
        .filter((item) => itemIds.includes(item.id))
        .toSorted((left, right) => left.from - right.from)
      if (itemsToJoin.length < 2) return

      const joinGroups = [itemIds]
      if (itemsToJoin.length === 2) {
        const [leftItem, rightItem] = itemsToJoin
        if (leftItem && rightItem) {
          const counterpartPair = getSynchronizedLinkedCounterpartPairForEdit(
            items,
            leftItem.id,
            rightItem.id,
            isLinkedSelectionEnabled(),
          )
          if (counterpartPair) {
            joinGroups.push([
              counterpartPair.leftCounterpart.id,
              counterpartPair.rightCounterpart.id,
            ])
          }
        }
      }

      const groupDescriptors = joinGroups
        .map((groupItemIds) =>
          items
            .filter((item) => groupItemIds.includes(item.id))
            .toSorted((left, right) => left.from - right.from),
        )
        .filter((groupItems) => groupItems.length >= 2)
        .map((groupItems) => ({
          itemIds: groupItems.map((item) => item.id),
          primaryId: groupItems[0]!.id,
          removedIds: groupItems.slice(1).map((item) => item.id),
        }))

      for (const group of groupDescriptors) {
        useItemsStore.getState()._joinItems(group.itemIds)
      }

      const replacementByRemovedId = new Map<string, string>()
      for (const group of groupDescriptors) {
        for (const removedId of group.removedIds) {
          replacementByRemovedId.set(removedId, group.primaryId)
        }
      }

      if (replacementByRemovedId.size > 0) {
        const transitions = useTransitionsStore.getState().transitions
        const updatedTransitions = transitions.flatMap((transition) => {
          const nextTransition = {
            ...transition,
            leftClipId: replacementByRemovedId.get(transition.leftClipId) ?? transition.leftClipId,
            rightClipId:
              replacementByRemovedId.get(transition.rightClipId) ?? transition.rightClipId,
          }

          if (nextTransition.leftClipId === nextTransition.rightClipId) {
            return []
          }

          return [nextTransition]
        })

        useTransitionsStore.getState().setTransitions(updatedTransitions)
        applyTransitionRepairs(groupDescriptors.map((group) => group.primaryId))
      }

      const removedIds = groupDescriptors.flatMap((group) => group.removedIds)
      if (removedIds.length > 0) {
        useKeyframesStore.getState()._removeKeyframesForItems(removedIds)
      }

      useTimelineSettingsStore.getState().markDirty()
    },
    { itemIds },
  )
}
