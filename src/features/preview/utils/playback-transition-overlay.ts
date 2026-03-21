export interface PlaybackTransitionOverlayWindow {
  startFrame: number;
  endFrame: number;
}

export interface PlaybackTransitionOverlayState {
  hasActiveTransition: boolean;
  shouldPrewarm: boolean;
}

export function resolvePlaybackTransitionOverlayState(
  transitionWindows: PlaybackTransitionOverlayWindow[],
  frame: number,
  lookaheadFrames: number,
): PlaybackTransitionOverlayState {
  const safeLookaheadFrames = Math.max(0, lookaheadFrames);

  for (const window of transitionWindows) {
    if (frame >= window.startFrame && frame < window.endFrame) {
      return {
        hasActiveTransition: true,
        shouldPrewarm: true,
      };
    }

    if (frame < window.startFrame) {
      return {
        hasActiveTransition: false,
        shouldPrewarm: (window.startFrame - frame) <= safeLookaheadFrames,
      };
    }
  }

  return {
    hasActiveTransition: false,
    shouldPrewarm: false,
  };
}
