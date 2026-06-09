import { usePlaybackStore } from './playback'
import { usePreviewBridgeStore } from './preview-bridge'

export function resetPlaybackPreviewState(currentFrame = 0) {
  usePlaybackStore.setState({
    currentFrame,
    currentFrameEpoch: 0,
    isPlaying: false,
    playbackRate: 1,
    loop: false,
    volume: 1,
    muted: false,
    zoom: -1,
    previewFrame: null,
    previewFrameEpoch: 0,
    frameUpdateEpoch: 0,
    previewItemId: null,
    useProxy: true,
    previewQuality: 1,
  })
  usePreviewBridgeStore.setState({
    displayedFrame: null,
    captureFrame: null,
    captureFrameImageData: null,
    captureCanvasSource: null,
  })
}
