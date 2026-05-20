/**
 * Barrel re-export for item edit actions. Implementation lives in ./edit/*.
 * Kept at this path because external callers import from
 * '@/features/timeline/stores/actions/item-edit-actions'.
 */

export type { RemoveSilenceRange, RemoveSilenceResult } from './edit/range-removal-actions'
export { removeSilenceFromItems, removeFillerWordsFromItems } from './edit/range-removal-actions'
export {
  trimItemStart,
  trimItemEnd,
  trimItemBreakingTransition,
  rippleTrimItem,
  rollingTrimItems,
  slipItem,
  slideItem,
} from './edit/trim-actions'
export { splitItem, splitAllItemsAtFrame, splitItemAtFrames } from './edit/split-actions'
export { joinItems } from './edit/join-actions'
export {
  rateStretchItemWithoutHistory,
  rateStretchItem,
  resetSpeedWithRipple,
} from './edit/rate-stretch-actions'
export { insertFreezeFrame } from './edit/freeze-frame-actions'
