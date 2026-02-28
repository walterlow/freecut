/**
 * Timeline contract consumed by editor feature adapters.
 */

import { gifFrameCache } from '../services/gif-frame-cache';
import { filmstripCache } from '../services/filmstrip-cache';
import { waveformCache } from '../services/waveform-cache';

export type { TimelineState, TimelineActions } from '../types';
export { useTimelineStore } from '../stores/timeline-store';
export { Timeline } from '../components/timeline';
export { BentoLayoutDialog } from '../components/bento-layout-dialog';
export { useTimelineShortcuts } from '../hooks/use-timeline-shortcuts';
export { useTransitionBreakageNotifications } from '../hooks/use-transition-breakage-notifications';
export { findNearestAvailableSpace } from '../utils/collision-utils';
export { areFramesAligned } from '../utils/transition-utils';
export {
  timelineToSourceFrames,
  sourceToTimelineFrames,
} from '../utils/source-calculations';
export { initTransitionChainSubscription } from '../stores/transition-chain-store';

export const importGifFrameCache = async () => ({ gifFrameCache });
export const importFilmstripCache = async () => ({ filmstripCache });
export const importWaveformCache = async () => ({ waveformCache });
