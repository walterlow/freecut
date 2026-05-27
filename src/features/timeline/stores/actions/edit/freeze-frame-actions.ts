import type { ImageItem } from '@/types/timeline'
import { useItemsStore } from '../../items-store'
import { useTransitionsStore } from '../../transitions-store'
import { useTimelineSettingsStore } from '../../timeline-settings-store'
import { useSelectionStore } from '@/shared/state/selection'
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store'
import { mediaLibraryService } from '@/features/timeline/deps/media-library-service'
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
  const media = item.mediaId ? useMediaLibraryStore.getState().mediaById[item.mediaId] : undefined
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

    // Step 3: Persist the frame as a media item. Delegates to the shared
    // import path (mediaLibraryService -> persistGeneratedMediaAsset) which
    // handles OPFS write, thumbnail generation, metadata persist, project
    // association, and workspace mirroring — plus rollback of all of those
    // if any step throws. Hand-rolling this here previously skipped the
    // rollback and had to be patched repeatedly (createMedia-before-thumbnailId,
    // store-prepend-before-execute).
    const currentProjectId = useMediaLibraryStore.getState().currentProjectId
    if (!currentProjectId) {
      getLogger().error('[insertFreezeFrame] No project context')
      return false
    }

    const fileName = `freeze-frame-${item.label || 'video'}-${Math.round(timestampSeconds * 100) / 100}s.png`
    const frameFile = new File([frameBlob], fileName, {
      type: 'image/png',
      lastModified: Date.now(),
    })

    const mediaMetadata = await mediaLibraryService.importGeneratedImage(
      frameFile,
      currentProjectId,
      {
        width: frameWidth,
        height: frameHeight,
        tags: ['freeze-frame'],
        codec: 'png',
      },
    )
    const frameMediaId = mediaMetadata.id
    const frameBlobUrl = blobUrlManager.acquire(frameMediaId, frameBlob)

    // Step 4: Perform timeline mutations atomically (split + insert + shift).
    // Prepend the media item to the store only after execute() succeeds so a
    // failed _splitItem (e.g. the source clip was removed between validation
    // and execute) doesn't leave an orphaned entry in the media library UI.
    const freezeDurationFrames = Math.round(fps * 2) // 2 seconds

    const success = execute<boolean>(
      'INSERT_FREEZE_FRAME',
      (): boolean => {
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
        return true
      },
      { itemId, playheadFrame, freezeDurationFrames },
    )

    if (!success) {
      // Roll back the persisted media so a failed split (rare — only if the
      // source clip was deleted between validation and execute) doesn't leave
      // an orphan on disk or a dangling blob URL in memory.
      // deleteMediaFromProject is the right call here (not deleteMedia): the
      // frame was just associated with currentProjectId and is referenced
      // only by this project, so the reference-counted variant covers it
      // and preserves the global "delete everywhere" semantics for the
      // explicit user action.
      try {
        await mediaLibraryService.deleteMediaFromProject(currentProjectId, frameMediaId)
      } catch (cleanupError) {
        getLogger().warn(
          '[insertFreezeFrame] Failed to roll back persisted frame after split failure',
          cleanupError,
        )
      }
      // blobUrlManager.acquire above bumped the ref count for frameMediaId;
      // matched release here revokes the underlying ObjectURL and frees the
      // Blob so a failure path doesn't accumulate leaked frames over time.
      blobUrlManager.release(frameMediaId)
      return false
    }

    useMediaLibraryStore.getState().prependMediaItem(mediaMetadata)
    return true
  } catch (error) {
    getLogger().error('[insertFreezeFrame] Failed:', error)
    return false
  }
}
