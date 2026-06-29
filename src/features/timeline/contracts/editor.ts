/**
 * Timeline contract consumed by editor feature adapters.
 */

export type { TimelineState, TimelineActions } from '../types'
export { useTimelineStore } from '../stores/timeline-store'
export { useTimelineSettingsStore } from '../stores/timeline-settings-store'
export { useItemsStore } from '../stores/items-store'
export { useKeyframesStore } from '../stores/keyframes-store'
export { useCompositionsStore } from '../stores/compositions-store'
export { useTimelineCommandStore } from '../stores/timeline-command-store'
export { useBentoLayoutDialogStore } from '../components/bento-layout-dialog-store'
export { useReverseConformDialogStore } from '../stores/reverse-conform-dialog-store'
export { useSilenceRemovalDialogStore } from '../stores/silence-removal-dialog-store'
export { useFillerRemovalDialogStore } from '../stores/filler-removal-dialog-store'
export { captureSnapshot } from '../stores/commands/snapshot'
export { execute as executeTimelineCommand } from '../stores/actions/shared'
export { Timeline } from '../components/timeline'
export { KeyframeGraphPanel } from '../components/keyframe-graph-panel'
export { TranscriptEditorPanel } from '../components/transcript-editor/transcript-editor-panel'
export { useTimelineShortcuts } from '../hooks/use-timeline-shortcuts'
export { useTransitionBreakageNotifications } from '../hooks/use-transition-breakage-notifications'
export { useFilmstrip } from '../hooks/use-filmstrip'
export type { FilmstripFrame } from '../hooks/use-filmstrip'
export { findNearestAvailableSpace } from '../utils/collision-utils'
export { getMaxTransitionDurationForHandles } from '../utils/transition-utils'
export { resolveTransitionTargetFromSelection } from '../utils/transition-targets'
export {
  createDefaultAdjustmentItem,
  createDefaultShapeItem,
  createTextTemplateItem,
  getDefaultGeneratedLayerDurationInFrames,
} from '../utils/generated-layer-items'
export { findCompatibleTrackForItemType } from '../utils/track-item-compatibility'
export { createClassicTrack, getTrackKind } from '../utils/classic-tracks'
export { getDefaultActiveTrackId } from '../utils/default-active-track'
export { resolveEffectiveTrackStates } from '../utils/group-utils'
export { linkItems } from '../stores/actions/item-actions'
export { applyAnimationPreset } from '../stores/actions/preset-actions'
export { applyMotionPresetKeyframes } from '../stores/actions/keyframe-actions'
export {
  applyMotionModifierToItems,
  removeMotionModifierFromItems,
  setEffectAudioPulse,
  bakeMotionToKeyframes,
} from '../stores/actions/motion-modifier-actions'
export { captureAnimationFromItem, getPresetCompatibility } from '../deps/keyframe-editors'
export { rateStretchItemWithoutHistory } from '../stores/actions/item-edit-actions'
export { setInOutPointsWithoutHistory } from '../stores/actions/marker-actions'
export { timelineToSourceFrames, sourceToTimelineFrames } from '../utils/source-calculations'
export { searchTimelineTranscript } from '../utils/transcript-search'
export type { TranscriptSearchMatch } from '../utils/transcript-search'
export { createScrubThrottleState, shouldCommitScrubFrame } from '../utils/scrub-throttle'
export { initTransitionChainSubscription } from '../stores/transition-chain-store'

export const importGifFrameCache = () => import('../services/gif-frame-cache')
export const importFilmstripCache = () => import('../services/filmstrip-cache')
export const importWaveformCache = () => import('../services/waveform-cache')
export const importBentoLayoutDialog = () => import('../components/bento-layout-dialog')
export const importReverseConformDialog = () => import('../components/reverse-conform-dialog')
export const importSilenceRemovalDialog = () => import('../components/silence-removal-dialog')
export const importFillerRemovalDialog = () => import('../components/filler-removal-dialog')
