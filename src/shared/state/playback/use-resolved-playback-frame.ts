import { useSyncExternalStore } from 'react'
import { usePlaybackStore } from '@/shared/state/playback'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import { getResolvedPlaybackFrame } from './frame-resolution'

function subscribeResolvedPlaybackFrame(onStoreChange: () => void): () => void {
  const unsubscribePlayback = usePlaybackStore.subscribe(onStoreChange)
  const unsubscribePreviewBridge = usePreviewBridgeStore.subscribe(onStoreChange)
  return () => {
    unsubscribePlayback()
    unsubscribePreviewBridge()
  }
}

function getResolvedPlaybackFrameSnapshot(): number {
  const playback = usePlaybackStore.getState()
  if (playback.compositionVisualFrozen) return playback.currentFrame
  return getResolvedPlaybackFrame({
    currentFrame: playback.currentFrame,
    previewFrame: playback.previewFrame,
    displayedFrame: usePreviewBridgeStore.getState().displayedFrame,
    isPlaying: playback.isPlaying,
    currentFrameEpoch: playback.currentFrameEpoch,
    previewFrameEpoch: playback.previewFrameEpoch,
  })
}

function getDisabledPlaybackFrameSnapshot(): number {
  return 0
}

/**
 * Subscribe to the resolved visible frame as one scalar snapshot. Requested
 * scrub frames do not re-render gizmos while the fast overlay is still
 * presenting an older `displayedFrame`.
 */
export function useResolvedPlaybackFrame(enabled = true): number {
  const getSnapshot = enabled ? getResolvedPlaybackFrameSnapshot : getDisabledPlaybackFrameSnapshot
  return useSyncExternalStore(subscribeResolvedPlaybackFrame, getSnapshot, getSnapshot)
}
