/**
 * Adapter exports for timeline store dependencies.
 * Editor modules should import timeline store types/selectors from here.
 */

export type { TimelineState, TimelineActions } from '@/features/timeline/types'
export type { MotionPresetClear } from '@/features/timeline/stores/actions/keyframe-actions'
export { useTimelineStore } from '@/features/timeline/stores/timeline-store'
export { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
export { useItemsStore } from '@/features/timeline/stores/items-store'
export { useKeyframesStore } from '@/features/timeline/stores/keyframes-store'
export { useCompositionsStore } from '@/features/timeline/stores/compositions-store'
export { useMarkersStore } from '@/features/timeline/stores/markers-store'
export { useTransitionsStore } from '@/features/timeline/stores/transitions-store'
export { useZoomStore } from '@/features/timeline/stores/zoom-store'
export {
  getActiveTabId,
  useCompositionNavigationStore,
} from '@/features/timeline/stores/composition-navigation-store'
export { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
export { execute as executeTimelineCommand } from '@/features/timeline/stores/actions/shared'
export { captureSnapshot } from '@/features/timeline/stores/commands/snapshot'
export {
  buildTimelineFromStores,
  hydrateTimelineStoresFromProject,
} from '@/features/timeline/stores/timeline-persistence'
export { rateStretchItemWithoutHistory } from '@/features/timeline/stores/actions/item-edit-actions'
export { repairCompositeCompositionEditorialLeak } from '@/features/timeline/stores/actions/composition-actions'
export { setInOutPointsWithoutHistory } from '@/features/timeline/stores/actions/marker-actions'
export { applyAnimationPreset } from '@/features/timeline/stores/actions/preset-actions'
export { applyMotionPresetKeyframes } from '@/features/timeline/stores/actions/keyframe-actions'
export {
  applyMotionModifierToItems,
  updateMotionModifiersLive,
  beginMotionModifierEdit,
  commitMotionModifierEdit,
  removeMotionModifierFromItems,
  bakeMotionToKeyframes,
} from '@/features/timeline/stores/actions/motion-modifier-actions'
export {
  applyTextMotionEffect,
  updateTextMotionLive,
  beginTextMotionEdit,
  commitTextMotionEdit,
  removeTextMotionEffect,
} from '@/features/timeline/stores/actions/text-motion-actions'
export {
  captureAnimationFromItem,
  getPresetCompatibility,
} from '@/features/timeline/deps/keyframe-editors'
