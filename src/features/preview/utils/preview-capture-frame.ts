export interface ResolvePreviewCaptureFrameParams {
  currentFrame: number
  previewFrame: number | null
  isPlaying: boolean
  livePlaybackFrame?: number | null
}

const MAX_LIVE_PLAYBACK_CAPTURE_DRIFT_FRAMES = 2

function normalizeFrame(frame: number): number {
  if (!Number.isFinite(frame)) return 0
  return Math.max(0, Math.round(frame))
}

export function resolvePreviewCaptureFrame({
  currentFrame,
  previewFrame,
  isPlaying,
  livePlaybackFrame,
}: ResolvePreviewCaptureFrameParams): number {
  if (
    isPlaying &&
    livePlaybackFrame !== null &&
    livePlaybackFrame !== undefined &&
    Number.isFinite(livePlaybackFrame)
  ) {
    const normalizedCurrentFrame = normalizeFrame(currentFrame)
    const normalizedLiveFrame = normalizeFrame(livePlaybackFrame)
    if (
      Math.abs(normalizedLiveFrame - normalizedCurrentFrame) <=
      MAX_LIVE_PLAYBACK_CAPTURE_DRIFT_FRAMES
    ) {
      return normalizedLiveFrame
    }
    return normalizedCurrentFrame
  }

  if (isPlaying) {
    return normalizeFrame(currentFrame)
  }

  if (previewFrame !== null) {
    return normalizeFrame(previewFrame)
  }

  return normalizeFrame(currentFrame)
}
