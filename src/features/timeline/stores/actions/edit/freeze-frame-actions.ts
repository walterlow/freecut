import type { ImageItem } from '@/types/timeline'
import type { MediaMetadata, ThumbnailData } from '@/types/storage'
import { useItemsStore } from '../../items-store'
import { useTransitionsStore } from '../../transitions-store'
import { useTimelineSettingsStore } from '../../timeline-settings-store'
import { useSelectionStore } from '@/shared/state/selection'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { mediaLibraryService, opfsService } from '@/features/timeline/deps/media-library-service'
import { writeMediaSource } from '@/infrastructure/storage/workspace-fs/media-source'
import { blobUrlManager } from '@/infrastructure/browser/blob-url-manager'
import { execute, applyTransitionRepairs, getLogger } from '../shared'
import { timelineToSourceFrames } from '../../../utils/source-calculations'
import { isInTransitionOverlap } from './shared'

/**
 * Insert a freeze frame at the playhead position.
 *
 * Extracts the video frame at the current playhead, stores it as a media entry,
 * splits the video clip at the playhead, and inserts a still image between the halves.
 *
 * This is async because frame extraction requires mediabunny. The timeline
 * mutations are batched in a single command for undo/redo atomicity.
 */
export async function insertFreezeFrame(itemId: string, playheadFrame: number): Promise<boolean> {
  const items = useItemsStore.getState().items
  const item = items.find((i) => i.id === itemId)
  if (!item || item.type !== 'video') return false

  // Validate playhead is within item bounds (exclusive of edges — need room to split)
  const itemStart = item.from
  const itemEnd = item.from + item.durationInFrames
  if (playheadFrame <= itemStart || playheadFrame >= itemEnd) return false

  // Block freeze frame insertion inside transition overlap zones
  if (isInTransitionOverlap(itemId, playheadFrame - itemStart, item.durationInFrames)) {
    return false
  }

  const fps = useTimelineSettingsStore.getState().fps
  const speed = item.speed ?? 1
  const sourceStart = item.sourceStart ?? 0
  const sourceFps = item.sourceFps ?? fps

  // Calculate source frame at playhead in source-native FPS
  const timelineOffset = playheadFrame - itemStart
  const sourceFrame = sourceStart + timelineToSourceFrames(timelineOffset, speed, fps, sourceFps)

  // Get media metadata for resolution and fps info
  const mediaItems = useMediaLibraryStore.getState().mediaItems
  const media = mediaItems.find((m) => m.id === item.mediaId)
  if (!media) {
    getLogger().error('[insertFreezeFrame] Media not found for item:', item.mediaId)
    return false
  }

  // Calculate timestamp in seconds for frame extraction
  const mediaFps = media.fps || 30
  const timestampSeconds = sourceFrame / mediaFps

  try {
    // Step 1: Get the media file blob
    const blob = await mediaLibraryService.getMediaFile(media.id)
    if (!blob) {
      getLogger().error('[insertFreezeFrame] Could not access media file')
      return false
    }

    // Step 2: Extract frame using mediabunny at native resolution
    const { Input, BlobSource, CanvasSink, ALL_FORMATS } = await import('mediabunny')
    const input = new Input({
      source: new BlobSource(blob as File),
      formats: ALL_FORMATS,
    })

    const videoTrack = await input.getPrimaryVideoTrack()
    if (!videoTrack) {
      input.dispose()
      getLogger().error('[insertFreezeFrame] No video track found')
      return false
    }

    const frameWidth = videoTrack.displayWidth
    const frameHeight = videoTrack.displayHeight

    const sink = new CanvasSink(videoTrack, {
      width: frameWidth,
      height: frameHeight,
      fit: 'fill',
    })

    const wrapped = await sink.getCanvas(timestampSeconds)
    if (!wrapped) {
      ;(sink as unknown as { dispose?: () => void }).dispose?.()
      input.dispose()
      getLogger().error('[insertFreezeFrame] Failed to extract frame')
      return false
    }

    const canvas = wrapped.canvas as OffscreenCanvas | HTMLCanvasElement
    let frameBlob: Blob
    if ('convertToBlob' in canvas) {
      frameBlob = await canvas.convertToBlob({ type: 'image/png' })
    } else {
      frameBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Failed to create blob'))),
          'image/png',
        )
      })
    }

    // Clean up mediabunny resources
    ;(sink as unknown as { dispose?: () => void }).dispose?.()
    input.dispose()

    // Step 3: Store frame as media in IndexedDB
    const { createMedia, saveThumbnail, associateMediaWithProject } =
      await import('@/infrastructure/storage')
    const currentProjectId = useMediaLibraryStore.getState().currentProjectId
    if (!currentProjectId) {
      getLogger().error('[insertFreezeFrame] No project context')
      return false
    }

    const frameMediaId = crypto.randomUUID()
    const frameBlobUrl = blobUrlManager.acquire(frameMediaId, frameBlob)
    const fileName = `freeze-frame-${item.label || 'video'}-${Math.round(timestampSeconds * 100) / 100}s.png`

    const mediaMetadata: MediaMetadata = {
      id: frameMediaId,
      storageType: 'opfs',
      fileName,
      fileSize: frameBlob.size,
      mimeType: 'image/png',
      duration: 0,
      width: frameWidth,
      height: frameHeight,
      fps: 0,
      codec: 'png',
      bitrate: 0,
      tags: ['freeze-frame'],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    // Store the frame blob in OPFS, then mirror it into the workspace folder
    // so other origins and external tooling can see it on disk.
    const opfsPath = `content/${frameMediaId.slice(0, 2)}/${frameMediaId.slice(2, 4)}/${frameMediaId}/data`
    await opfsService.saveFile(opfsPath, await frameBlob.arrayBuffer())
    mediaMetadata.opfsPath = opfsPath
    void writeMediaSource(frameMediaId, frameBlob, fileName).catch((error) => {
      getLogger().warn('[insertFreezeFrame] Failed to mirror frame to workspace', error)
    })

    await createMedia(mediaMetadata)
    await associateMediaWithProject(currentProjectId, frameMediaId)

    // Save thumbnail (reuse the frame blob)
    const thumbnailId = crypto.randomUUID()
    const thumbnailData: ThumbnailData = {
      id: thumbnailId,
      mediaId: frameMediaId,
      blob: frameBlob,
      timestamp: 0,
      width: frameWidth,
      height: frameHeight,
    }
    await saveThumbnail(thumbnailData)
    mediaMetadata.thumbnailId = thumbnailId

    // Add to media library store
    useMediaLibraryStore.setState((state) => ({
      mediaItems: [mediaMetadata, ...state.mediaItems],
    }))

    // Step 4: Perform timeline mutations atomically (split + insert + shift)
    const freezeDurationFrames = Math.round(fps * 2) // 2 seconds

    execute(
      'INSERT_FREEZE_FRAME',
      () => {
        // Split the video at playhead
        const splitResult = useItemsStore.getState()._splitItem(itemId, playheadFrame)
        if (!splitResult) {
          getLogger().error('[insertFreezeFrame] Split failed')
          return false
        }

        const { leftItem, rightItem } = splitResult

        // Update transitions pointing to split item
        const transitions = useTransitionsStore.getState().transitions
        const updatedTransitions = transitions.map((t) => {
          if (t.leftClipId === itemId) {
            return { ...t, leftClipId: rightItem.id }
          }
          return t
        })
        useTransitionsStore.getState().setTransitions(updatedTransitions)

        // Create ImageItem for the freeze frame
        const freezeFrameItem: ImageItem = {
          id: crypto.randomUUID(),
          type: 'image',
          trackId: item.trackId,
          from: playheadFrame,
          durationInFrames: freezeDurationFrames,
          label: fileName,
          mediaId: frameMediaId,
          src: frameBlobUrl,
          sourceWidth: frameWidth,
          sourceHeight: frameHeight,
          transform: item.transform ? { ...item.transform } : undefined,
        }

        useItemsStore.getState()._addItem(freezeFrameItem)

        // Shift the right half forward by freeze frame duration
        const newRightFrom = rightItem.from + freezeDurationFrames
        useItemsStore.getState()._moveItem(rightItem.id, newRightFrom)

        // Also shift all items on same track that come after the right half
        const allItems = useItemsStore.getState().items
        const itemsToShift = allItems.filter(
          (i) =>
            i.trackId === item.trackId &&
            i.id !== rightItem.id &&
            i.id !== leftItem.id &&
            i.id !== freezeFrameItem.id &&
            i.from > playheadFrame,
        )

        for (const shiftItem of itemsToShift) {
          useItemsStore.getState()._moveItem(shiftItem.id, shiftItem.from + freezeDurationFrames)
        }

        // Repair transitions
        applyTransitionRepairs([leftItem.id, rightItem.id])

        // Select the freeze frame item
        useSelectionStore.getState().selectItems([freezeFrameItem.id])

        useTimelineSettingsStore.getState().markDirty()
      },
      { itemId, playheadFrame, freezeDurationFrames },
    )

    return true
  } catch (error) {
    getLogger().error('[insertFreezeFrame] Failed:', error)
    return false
  }
}
