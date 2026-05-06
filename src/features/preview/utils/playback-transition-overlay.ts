export interface PlaybackTransitionOverlayWindow {
  startFrame: number
  endFrame: number
  cooldownFrames?: number
}

export interface PlaybackTransitionOverlayState {
  hasActiveTransition: boolean
  shouldHoldOverlay: boolean
  shouldPrewarm: boolean
  nextTransitionStartFrame: number | null
}

export function resolvePlaybackTransitionOverlayState(
  transitionWindows: PlaybackTransitionOverlayWindow[],
  frame: number,
  lookaheadFrames: number,
  cooldownFrames = 0,
): PlaybackTransitionOverlayState {
  const safeLookaheadFrames = Math.max(0, lookaheadFrames)
  const safeCooldownFrames = Math.max(0, cooldownFrames)
  let nextTransitionStartFrame: number | null = null
  let shouldHoldOverlay = false

  for (const window of transitionWindows) {
    const windowCooldownFrames = Math.max(0, window.cooldownFrames ?? safeCooldownFrames)

    if (frame >= window.startFrame && frame < window.endFrame) {
      return {
        hasActiveTransition: true,
        shouldHoldOverlay: true,
        shouldPrewarm: true,
        nextTransitionStartFrame: window.startFrame,
      }
    }

    if (frame >= window.endFrame && frame < window.endFrame + windowCooldownFrames) {
      shouldHoldOverlay = true
    }

    if (frame < window.startFrame) {
      nextTransitionStartFrame = window.startFrame
      break
    }
  }

  return {
    hasActiveTransition: false,
    shouldHoldOverlay,
    shouldPrewarm:
      nextTransitionStartFrame !== null && nextTransitionStartFrame - frame <= safeLookaheadFrames,
    nextTransitionStartFrame,
  }
}
