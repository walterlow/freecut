/**
 * Timeline contract consumed by media-library feature adapters.
 */

export { useTimelineSettingsStore } from '../stores/timeline-settings-store';
export { useTimelineStore } from '../stores/timeline-store';
export { useCompositionNavigationStore } from '../stores/composition-navigation-store';
export { DEFAULT_TRACK_HEIGHT } from '../constants';
export { timelineToSourceFrames, sourceToTimelineFrames } from '../utils/source-calculations';
export {
  useCompositionsStore,
  type SubComposition,
} from '../stores/compositions-store';
export { useItemsStore } from '../stores/items-store';
export { wouldCreateCompositionCycle } from '../utils/composition-graph';

export {
  deleteCompoundClips,
  getCompoundClipDeletionImpact,
  getMediaDeletionImpact,
  removeProjectItems,
  removeItems,
  renameCompoundClip,
  updateProjectItem,
  updateItem,
} from '../stores/timeline-actions';
export {
  removeItems as removeItemsFromItemsActions,
} from '../stores/actions/item-actions';

export { autoMatchOrphanedClips } from '../utils/media-validation';
export { gifFrameCache } from '../services/gif-frame-cache';
export { resolveMediaUrl, resolveMediaUrls } from '../deps/media-library-contract';
export { renderSingleFrame } from '../deps/export-contract';
export {
  buildSubCompositionInput,
  buildSubCompositionPreviewSignature,
  collectSubCompositionMediaIds,
  getSubCompositionThumbnailFrame,
} from '../utils/sub-composition-preview';
