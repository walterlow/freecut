/**
 * Timeline contract consumed by editor feature adapters.
 */

import { gifFrameCache } from '../services/gif-frame-cache';
import { filmstripCache } from '../services/filmstrip-cache';
import { waveformCache } from '../services/waveform-cache';

export type { TimelineState, TimelineActions } from '../types';
export { useTimelineStore } from '../stores/timeline-store';
export { useTimelineSettingsStore } from '../stores/timeline-settings-store';
export { useItemsStore } from '../stores/items-store';
export { useKeyframesStore } from '../stores/keyframes-store';
export { useCompositionsStore } from '../stores/compositions-store';
export { useTimelineCommandStore } from '../stores/timeline-command-store';
export { captureSnapshot } from '../stores/commands/snapshot';
export { Timeline } from '../components/timeline';
export { BentoLayoutDialog } from '../components/bento-layout-dialog';
export { KeyframeGraphPanel } from '../components/keyframe-graph-panel';
export { useTimelineShortcuts } from '../hooks/use-timeline-shortcuts';
export { useTransitionBreakageNotifications } from '../hooks/use-transition-breakage-notifications';
export { findNearestAvailableSpace } from '../utils/collision-utils';
export { areFramesAligned, getMaxTransitionDurationForHandles } from '../utils/transition-utils';
export { resolveTransitionTargetFromSelection } from '../utils/transition-targets';
export {
  createDefaultAdjustmentItem,
  createDefaultShapeItem,
  createDefaultTextItem,
  createTextTemplateItem,
  getDefaultGeneratedLayerDurationInFrames,
} from '../utils/generated-layer-items';
export { findCompatibleTrackForItemType } from '../utils/track-item-compatibility';
export { getTrackKind } from '../utils/classic-tracks';
export { resolveEffectiveTrackStates } from '../utils/group-utils';
export { linkItems } from '../stores/actions/item-actions';
export { rateStretchItemWithoutHistory } from '../stores/actions/item-edit-actions';
export {
  timelineToSourceFrames,
  sourceToTimelineFrames,
} from '../utils/source-calculations';
export { initTransitionChainSubscription } from '../stores/transition-chain-store';

export const importGifFrameCache = async () => ({ gifFrameCache });
export const importFilmstripCache = async () => ({ filmstripCache });
export const importWaveformCache = async () => ({ waveformCache });
