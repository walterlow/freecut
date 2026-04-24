import type { TimelineItem } from '@/types/timeline';
import type { Transition } from '@/types/transition';
import type { ResolvedTransitionWindow as CoreResolvedTransitionWindow } from '@freecut/core/transition-plan';

export {
  calculateTransitionPortions,
  resolveTransitionWindows,
} from '@freecut/core/transition-plan';

export type {
  TimelineClipLike,
  TransitionLike,
  TransitionPortions,
} from '@freecut/core/transition-plan';

export type ResolvedTransitionWindow<
  TClip extends TimelineItem = TimelineItem,
  TTransition extends Transition = Transition,
> = CoreResolvedTransitionWindow<TClip, TTransition>;
