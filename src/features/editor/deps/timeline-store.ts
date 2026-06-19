/**
 * Adapter exports for timeline store dependencies.
 * Editor modules should import timeline store types/selectors from here.
 */

export type { TimelineState, TimelineActions } from './timeline-contract'
export {
  importWaveformCache,
  rateStretchItemWithoutHistory,
  setInOutPointsWithoutHistory,
  useTimelineStore,
  useTimelineSettingsStore,
  useItemsStore,
  useKeyframesStore,
  useCompositionsStore,
  useTimelineCommandStore,
  executeTimelineCommand,
  captureSnapshot,
  applyAnimationPreset,
  captureAnimationFromItem,
  getPresetCompatibility,
} from './timeline-contract'
