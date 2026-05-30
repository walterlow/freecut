/**
 * Timeline contract consumed by media-library feature adapters.
 */

export { useTimelineSettingsStore } from '../stores/timeline-settings-store'
export { useTimelineStore } from '../stores/timeline-store'
export { useCompositionNavigationStore } from '../stores/composition-navigation-store'
export { DEFAULT_TRACK_HEIGHT } from '../constants'
export { timelineToSourceFrames, sourceToTimelineFrames } from '../utils/source-calculations'
export { getNextClassicTrackName, getTrackKind, type TrackKind } from '../utils/classic-tracks'
export { getEffectiveTrackKindForItem } from '../utils/track-item-compatibility'
export { useCompositionsStore, type SubComposition } from '../stores/compositions-store'
export { useItemsStore } from '../stores/items-store'
export { wouldCreateCompositionCycle } from '../utils/composition-graph'
export { getSynchronizedLinkedItems } from '../utils/linked-items'

export {
  deleteCompoundClips,
  getCompoundClipDeletionImpact,
  getMediaDeletionImpact,
  removeProjectItems,
  removeItems,
  renameCompoundClip,
  updateProjectItem,
  updateItem,
} from '../stores/timeline-actions'
export { removeItems as removeItemsFromItemsActions } from '../stores/actions/item-actions'

export { autoMatchOrphanedClips } from '../utils/media-validation'
export const importGifFrameCache = () => import('../services/gif-frame-cache')
export const importFilmstripCache = () => import('../services/filmstrip-cache')
export {
  IMPORT_FILMSTRIP_HUGE_FILE_BYTES,
  IMPORT_FILMSTRIP_LARGE_FILE_BYTES,
  IMPORT_FILMSTRIP_LARGE_TARGET_FRAMES,
  IMPORT_FILMSTRIP_LONG_DURATION_SEC,
  IMPORT_FILMSTRIP_MEDIUM_TARGET_FRAMES,
  IMPORT_FILMSTRIP_NORMAL_TARGET_FRAMES,
  IMPORT_FILMSTRIP_PREP_TIMEOUT_MS,
  IMPORT_FILMSTRIP_SLOW_CONTAINER_MIME_TYPES,
  IMPORT_FILMSTRIP_SLOW_PREP_TIMEOUT_MS,
  IMPORT_FILMSTRIP_TINY_TARGET_FRAMES,
  IMPORT_FILMSTRIP_VERY_LONG_DURATION_SEC,
  MAX_FILMSTRIP_TARGET_FRAMES,
} from '../services/filmstrip-cache-config'
export const importWaveformCache = () => import('../services/waveform-cache')
export { schedulePreviewWork } from '../hooks/preview-work-budget'
export { resolveMediaUrl, resolveMediaUrls } from '../deps/media-library-resolver'
export { importCanvasRenderOrchestrator } from '../deps/export-contract'
export {
  buildSubCompositionInput,
  buildSubCompositionPreviewSignature,
  collectSubCompositionMediaIds,
  getSubCompositionThumbnailFrame,
} from '../utils/sub-composition-preview'
