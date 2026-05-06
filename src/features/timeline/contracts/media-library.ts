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
export { gifFrameCache } from '../services/gif-frame-cache'
export { filmstripCache } from '../services/filmstrip-cache'
export { waveformCache } from '../services/waveform-cache'
export { schedulePreviewWork } from '../hooks/preview-work-budget'
export { resolveMediaUrl, resolveMediaUrls } from '../deps/media-library-contract'
export { renderSingleFrame } from '../deps/export-contract'
export {
  buildSubCompositionInput,
  buildSubCompositionPreviewSignature,
  collectSubCompositionMediaIds,
  getSubCompositionThumbnailFrame,
} from '../utils/sub-composition-preview'
