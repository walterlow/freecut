export interface PlaybackTransitionWindow {
  startFrame: number;
  endFrame: number;
  cooldownFrames?: number;
}

export interface PlaybackTransitionState {
  hasActiveTransition: boolean;
  shouldHoldTransitionFrame: boolean;
  shouldPrewarm: boolean;
  nextTransitionStartFrame: number | null;
}

export function resolvePlaybackTransitionState(
  transitionWindows: PlaybackTransitionWindow[],
  frame: number,
  lookaheadFrames: number,
  cooldownFrames = 0,
): PlaybackTransitionState {
  const safeLookaheadFrames = Math.max(0, lookaheadFrames);
  const safeCooldownFrames = Math.max(0, cooldownFrames);
  let nextTransitionStartFrame: number | null = null;
  let shouldHoldTransitionFrame = false;

  for (const window of transitionWindows) {
    const windowCooldownFrames = Math.max(0, window.cooldownFrames ?? safeCooldownFrames);

    if (frame >= window.startFrame && frame < window.endFrame) {
      return {
        hasActiveTransition: true,
        shouldHoldTransitionFrame: true,
        shouldPrewarm: true,
        nextTransitionStartFrame: window.startFrame,
      };
    }

    if (frame >= window.endFrame && frame < window.endFrame + windowCooldownFrames) {
      shouldHoldTransitionFrame = true;
    }

    if (frame < window.startFrame) {
      nextTransitionStartFrame = window.startFrame;
      break;
    }
  }

  return {
    hasActiveTransition: false,
    shouldHoldTransitionFrame,
    shouldPrewarm: nextTransitionStartFrame !== null
      && (nextTransitionStartFrame - frame) <= safeLookaheadFrames,
    nextTransitionStartFrame,
  };
}
