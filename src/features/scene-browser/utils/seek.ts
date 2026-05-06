/**
 * Seek a scene in the Source Monitor. Mirrors media-card's handleSeekToCaption
 * so Scene Browser rows open the source preview the same way a caption
 * timestamp click does — setting the source player state alone isn't enough,
 * the editor store's sourcePreviewMediaId is what actually mounts the panel.
 */

import { useEditorStore, useMediaLibraryStore, useSourcePlayerStore } from '../deps/media-library'

export const SCENE_SELECTION_DURATION_SEC = 3

export function seekToScene(mediaId: string, timeSec: number): void {
  const media = useMediaLibraryStore.getState().mediaById[mediaId]
  if (!media) return
  const fps = media.fps || 30
  const sourceDurationFrames = Math.max(1, Math.round(media.duration * fps))
  const frame = Math.max(0, Math.min(sourceDurationFrames - 1, Math.round(timeSec * fps)))
  const outFrame = Math.min(
    sourceDurationFrames,
    frame + Math.max(1, Math.round(SCENE_SELECTION_DURATION_SEC * fps)),
  )

  const source = useSourcePlayerStore.getState()
  // Pause the current scene synchronously — waiting for the seek-consume
  // effect leaves the video element decoding the old frame, which is
  // what the user sees as "flash of the old scene" when switching.
  source.playerMethods?.pause()
  source.setCurrentMediaId(mediaId)
  source.clearInOutPoints()
  source.setInPoint(frame)
  source.setOutPoint(outFrame)
  source.setPendingSeekFrame(frame)
  useEditorStore.getState().setSourcePreviewMediaId(mediaId)
}
