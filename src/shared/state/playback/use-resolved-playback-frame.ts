import { usePlaybackStore } from '@/shared/state/playback'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import { getResolvedPlaybackFrame } from './frame-resolution'

export function useResolvedPlaybackFrame(): number {
  const currentFrame = usePlaybackStore((s) => s.currentFrame)
  const previewFrame = usePlaybackStore((s) => s.previewFrame)
  const displayedFrame = usePreviewBridgeStore((s) => s.displayedFrame)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const currentFrameEpoch = usePlaybackStore((s) => s.currentFrameEpoch)
  const previewFrameEpoch = usePlaybackStore((s) => s.previewFrameEpoch)

  return getResolvedPlaybackFrame({
    currentFrame,
    previewFrame,
    displayedFrame,
    isPlaying,
    currentFrameEpoch,
    previewFrameEpoch,
  })
}
