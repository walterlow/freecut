export interface SourcePlayerMethods {
  toggle: () => void
  /**
   * Unconditional pause — no-ops when already paused. Exposed so callers
   * outside the source monitor (e.g. scene browser clicks) can stop the
   * current scene synchronously before queueing a seek, instead of
   * waiting for the seek-consume effect and racing with the video
   * element still decoding the old frame.
   */
  pause: () => void
  seek: (frame: number) => void
  frameBack: (frames: number) => void
  frameForward: (frames: number) => void
  getDurationInFrames: () => number
}

export interface SourcePlayerState {
  hoveredPanel: 'source' | null
  playerMethods: SourcePlayerMethods | null
  currentMediaId: string | null
  currentSourceFrame: number
  previewSourceFrame: number | null
  inPoint: number | null
  outPoint: number | null
  pendingSeekFrame: number | null
  /**
   * When true, the source monitor starts playback after consuming the
   * next `pendingSeekFrame`. The monitor always pauses before seeking,
   * so scene-browser single-click just queues a seek (leaves paused)
   * while double-click queues `pendingPlay: true` to play from the new
   * scene.
   */
  pendingPlay: boolean
  setHoveredPanel: (panel: 'source' | null) => void
  setPlayerMethods: (methods: SourcePlayerMethods | null) => void
  setCurrentMediaId: (id: string | null) => void
  releaseCurrentMediaId: (id: string) => void
  setCurrentSourceFrame: (frame: number) => void
  setPreviewSourceFrame: (frame: number | null) => void
  setInPoint: (frame: number | null) => void
  setOutPoint: (frame: number | null) => void
  clearInOutPoints: () => void
  setPendingSeekFrame: (frame: number | null) => void
  setPendingPlay: (play: boolean) => void
}
