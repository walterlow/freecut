import type { TimelineItem } from '@/types/timeline';
import type { ResolvedTransitionWindow } from '@/domain/timeline/transitions/transition-planner';
import { springEasing, easeIn, easeOut, easeInOut, cubicBezier } from '@/domain/animation/easing';

export interface ActiveTransition<TItem extends TimelineItem = TimelineItem> {
  transition: ResolvedTransitionWindow<TItem>['transition'];
  leftClip: TItem;
  rightClip: TItem;
  progress: number;
  transitionStart: number;
  transitionEnd: number;
  durationInFrames: number;
  leftPortion: number;
  rightPortion: number;
  cutPoint: number;
}

export interface TransitionFrameState<TItem extends TimelineItem = TimelineItem> {
  activeTransitions: ActiveTransition<TItem>[];
  transitionClipIds: Set<string>;
}

export function collectTransitionParticipantClipIds<TItem extends TimelineItem>({
  transitionWindows,
  frame,
  lookaheadFrames,
  lookbehindFrames = 0,
}: {
  transitionWindows: ResolvedTransitionWindow<TItem>[];
  frame: number;
  lookaheadFrames: number;
  lookbehindFrames?: number;
}): Set<string> {
  const transitionClipIds = new Set<string>();

  for (const window of transitionWindows) {
    if (frame >= window.endFrame + Math.max(0, lookbehindFrames)) continue;
    if (frame + lookaheadFrames < window.startFrame) continue;
    transitionClipIds.add(window.transition.leftClipId);
    transitionClipIds.add(window.transition.rightClipId);
  }

  return transitionClipIds;
}

export function calculateTransitionProgress(
  localFrame: number,
  duration: number,
  timing: string,
  bezierPoints?: { x1: number; y1: number; x2: number; y2: number },
): number {
  const maxFrame = Math.max(1, duration - 1);
  const linearProgress = Math.max(0, Math.min(1, localFrame / maxFrame));

  switch (timing) {
    case 'spring':
      return springEasing(linearProgress, { tension: 180, friction: 12, mass: 1 });
    case 'ease-in':
      return easeIn(linearProgress);
    case 'ease-out':
      return easeOut(linearProgress);
    case 'ease-in-out':
      return easeInOut(linearProgress);
    case 'cubic-bezier':
      return bezierPoints ? cubicBezier(linearProgress, bezierPoints) : linearProgress;
    default:
      return linearProgress;
  }
}

export function resolveTransitionFrameState<TItem extends TimelineItem>({
  transitionWindows,
  frame,
}: {
  transitionWindows: ResolvedTransitionWindow<TItem>[];
  frame: number;
}): TransitionFrameState<TItem> {
  const activeTransitions: ActiveTransition<TItem>[] = [];
  const transitionClipIds = new Set<string>();

  for (const window of transitionWindows) {
    if (frame < window.startFrame || frame >= window.endFrame) continue;

    const localFrame = frame - window.startFrame;
    activeTransitions.push({
      transition: window.transition,
      leftClip: window.leftClip,
      rightClip: window.rightClip,
      progress: calculateTransitionProgress(
        localFrame,
        window.durationInFrames,
        window.transition.timing,
        window.transition.bezierPoints,
      ),
      transitionStart: window.startFrame,
      transitionEnd: window.endFrame,
      durationInFrames: window.durationInFrames,
      leftPortion: window.leftPortion,
      rightPortion: window.rightPortion,
      cutPoint: window.cutPoint,
    });

    transitionClipIds.add(window.transition.leftClipId);
    transitionClipIds.add(window.transition.rightClipId);
  }

  return { activeTransitions, transitionClipIds };
}
