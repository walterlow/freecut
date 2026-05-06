import { usePlaybackStore } from './store'

/**
 * Promote an active transient skim/preview frame into the authoritative
 * current frame before clearing preview state. This prevents edit gestures
 * from briefly snapping back to the stale pre-skim playhead frame.
 */
export function commitPreviewFrameToCurrentFrame(): void {
  const playback = usePlaybackStore.getState()
  if (playback.previewFrame === null) {
    return
  }

  playback.setScrubFrame(playback.previewFrame, playback.previewItemId)
  playback.setPreviewFrame(null)
}
