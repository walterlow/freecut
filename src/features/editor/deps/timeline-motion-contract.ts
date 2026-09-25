/** Focused editor seam for the Motion workspace timeline. */

export {
  CompactNavigator,
  getKeyframeNavigatorThumbMetrics,
  getNiceTickStep,
  useRafCoalescedValue,
  DopesheetEditor,
  PickWhipIcon,
  PropertyLinkPickWhipOverlay,
  GROUP_HEADER_HEIGHT,
  KEYFRAME_EDGE_INSET,
  KEYFRAME_DIAMOND_RENDERED_WIDTH_PX,
  ROW_HEIGHT,
  getAnimatablePropertiesForItem,
  getProceduralBands,
  getPropertyAccordionGroups,
  getPropertyDisplayGroups,
  buildVectorPromotionPlan,
  resolveAnimatedTransform,
  getShapeAnimatableBaseValue,
  resolveAnimatedShapeItem,
  resolveExpressionReferenceValue,
} from '@/features/timeline/deps/keyframe-editors'
export { usePropertyLinkPickWhip } from '@/features/timeline/hooks/use-property-link-pick-whip'
export { interpolatePropertyValue } from '@/features/timeline/deps/keyframes'
export { captureSnapshot } from '@/features/timeline/stores/commands/snapshot'
export { useItemsStore } from '@/features/timeline/stores/items-store'
export { useKeyframesStore } from '@/features/timeline/stores/keyframes-store'
export { useKeyframeSelectionStore } from '@/features/timeline/stores/keyframe-selection-store'
export { useCompositionsStore } from '@/features/timeline/stores/compositions-store'
export { useCompositionNavigationStore } from '@/features/timeline/stores/composition-navigation-store'
export { useTimelineCommandStore } from '@/features/timeline/stores/timeline-command-store'
export { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
export {
  addItemOnNewTrack,
  addItemsOnNewTracks,
  duplicateItemsWithTrackChanges,
  moveItems,
  removeItems,
  setTransformParents,
  trimItemEnd,
  trimItemStart,
  updateItem,
} from '@/features/timeline/stores/actions/item-actions'
export {
  addKeyframe,
  promoteTransformToVector,
  setVectorDimensionsSeparated,
  removeVectorKeyframe,
  removePropertyExpression,
  removeKeyframes,
  setPropertyExpression,
  updateKeyframe,
  updateKeyframes,
  updateVectorKeyframe,
  upsertVectorKeyframe,
} from '@/features/timeline/stores/actions/keyframe-actions'
export { setTracks } from '@/features/timeline/stores/actions/track-actions'
export {
  createCompositeComposition,
  openComposition,
} from '@/features/timeline/stores/actions/composition-actions'
export type { CreateCompositeCompositionOptions } from '@/features/timeline/stores/actions/composition-actions'
export { buildDroppedCompositionTimelineItems } from '@/features/timeline/utils/dropped-composition'
export {
  buildDroppedMediaTimelineItems,
  getDroppedMediaDurationInFrames,
} from '@/features/timeline/utils/dropped-media'
export { resolveDroppedMediaEntriesFromPayload } from '@/features/timeline/utils/drop-execution'
export type { DroppedMediaEntry } from '@/features/timeline/utils/drop-execution'
export {
  createDefaultControllerItem,
  createDefaultGradientItem,
  createDefaultShapeItem,
  createDefaultSolidColorItem,
  createTimelineTemplateItem,
  createTextTemplateItem,
  isTimelineTemplateDragData,
} from '@/features/timeline/utils/generated-layer-items'
export { wouldCreateCompositionCycle } from '@/features/timeline/utils/composition-graph'
