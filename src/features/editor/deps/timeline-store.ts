/**
 * Adapter exports for timeline store dependencies.
 * Editor modules should import timeline store types/selectors from here.
 */

export type {
  AudiobookMusicBedPlacement,
  CinematicDepthLayerPlacement,
  InsertAudiobookMusicBedResult,
  InsertCinematicDepthLayersResult,
  MotionPresetClear,
  TimelineActions,
  TimelineState,
} from './timeline-contract'
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
  applyCinematicCameraToSelectedImages,
  applyCompoundParallaxCameraToSelectedImages,
  applyMagnates3dCameraToSelectedImages,
  applyDocumentaryCameraToSelectedImages,
  applyMotionPresetKeyframes,
  applyMotionModifierToItems,
  updateMotionModifiersLive,
  beginMotionModifierEdit,
  commitMotionModifierEdit,
  removeMotionModifierFromItems,
  applyTextMotionEffect,
  updateTextMotionLive,
  beginTextMotionEdit,
  commitTextMotionEdit,
  removeTextMotionEffect,
  setEffectAudioPulse,
  bakeMotionToKeyframes,
  captureAnimationFromItem,
  getPresetCompatibility,
  buildDroppedMediaTimelineItem,
} from './timeline-contract'
