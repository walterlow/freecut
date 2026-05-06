import type { MediaMetadata } from '@/types/storage'
import { createLogger, createOperationId } from '@/shared/logging/logger'
import {
  associateMediaWithProject,
  createMedia as createMediaDB,
  deleteMedia as deleteMediaDB,
  deleteThumbnailsByMediaId,
  saveThumbnail as saveThumbnailDB,
} from '@/infrastructure/storage'
import { opfsService } from '@/features/media-library/services/opfs-service'
import { writeMediaSource } from '@/infrastructure/storage/workspace-fs/media-source'

const logger = createLogger('MediaAssetHelpers')

function getImageDimensionsFromBitmap(bitmap: ImageBitmap): { width: number; height: number } {
  return {
    width: bitmap.width,
    height: bitmap.height,
  }
}

export function getThumbnailDimensions(
  width: number,
  height: number,
  maxSize: number,
): { width: number; height: number } {
  let w = Number(width)
  if (!Number.isFinite(w)) w = 1
  let h = Number(height)
  if (!Number.isFinite(h)) h = 1
  let m = Number(maxSize)
  if (!Number.isFinite(m)) m = 1

  const safeWidth = Math.max(1, Math.round(w))
  const safeHeight = Math.max(1, Math.round(h))
  const safeMax = Math.max(1, Math.round(m))

  if (safeWidth >= safeHeight) {
    return {
      width: safeMax,
      height: Math.max(1, Math.floor((safeMax * safeHeight) / safeWidth)),
    }
  }

  return {
    width: Math.max(1, Math.floor((safeMax * safeWidth) / safeHeight)),
    height: safeMax,
  }
}

export async function getGeneratedImageDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | undefined
    try {
      bitmap = await createImageBitmap(file)
      const dimensions = getImageDimensionsFromBitmap(bitmap)
      return dimensions
    } catch {
      // Fall through to Image-based fallback
    } finally {
      bitmap?.close()
    }
  }

  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(file)

    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      })
    }

    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load generated image'))
    }

    image.src = url
  })
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer()
  }

  return new Response(blob).arrayBuffer()
}

export function buildGeneratedMediaOpfsPath(mediaId: string): string {
  return `content/${mediaId.slice(0, 2)}/${mediaId.slice(2, 4)}/${mediaId}/data`
}

interface PersistGeneratedMediaOptions {
  file: File
  projectId: string
  mediaMetadata: MediaMetadata
  thumbnailBlob?: Blob
  thumbnailWidth?: number
  thumbnailHeight?: number
}

export async function persistGeneratedMediaAsset({
  file,
  projectId,
  mediaMetadata,
  thumbnailBlob,
  thumbnailWidth,
  thumbnailHeight,
}: PersistGeneratedMediaOptions): Promise<MediaMetadata> {
  const opId = createOperationId()
  const event = logger.startEvent('persistGeneratedMediaAsset', opId)
  event.merge({ projectId, mediaId: mediaMetadata.id })

  let metadataCreated = false
  let thumbnailSaved = false

  try {
    if (!mediaMetadata.opfsPath) {
      throw new Error('Generated media is missing an OPFS path.')
    }

    await opfsService.saveFile(mediaMetadata.opfsPath, await blobToArrayBuffer(file))

    const rawWidth = Number(thumbnailWidth)
    const rawHeight = Number(thumbnailHeight)
    const hasDimensions =
      Number.isFinite(rawWidth) && rawWidth > 0 && Number.isFinite(rawHeight) && rawHeight > 0

    if (thumbnailBlob && hasDimensions) {
      const sanitizedWidth = Math.max(1, Math.floor(Math.abs(rawWidth)))
      const sanitizedHeight = Math.max(1, Math.floor(Math.abs(rawHeight)))
      const thumbnailId = crypto.randomUUID()

      await saveThumbnailDB({
        id: thumbnailId,
        mediaId: mediaMetadata.id,
        blob: thumbnailBlob,
        timestamp: 0,
        width: sanitizedWidth,
        height: sanitizedHeight,
      })

      mediaMetadata.thumbnailId = thumbnailId
      thumbnailSaved = true
    }

    await createMediaDB(mediaMetadata)
    metadataCreated = true
    // Mirror source into the workspace folder so the bytes are visible to
    // other origins (cross-origin debug) and external agents reading from
    // disk. Fire-and-forget; errors logged, not propagated.
    void writeMediaSource(mediaMetadata.id, file, mediaMetadata.fileName).catch((error) =>
      logger.warn(`writeMediaSource(${mediaMetadata.id}) failed`, error),
    )
    await associateMediaWithProject(projectId, mediaMetadata.id)
    event.success({ projectId, mediaId: mediaMetadata.id })
    return mediaMetadata
  } catch (error) {
    if (metadataCreated) {
      try {
        await deleteMediaDB(mediaMetadata.id)
      } catch (cleanupError) {
        logger.warn(
          `Failed to roll back generated media metadata ${mediaMetadata.id}:`,
          cleanupError,
        )
      }
    }

    if (thumbnailSaved) {
      try {
        await deleteThumbnailsByMediaId(mediaMetadata.id)
      } catch (cleanupError) {
        logger.warn(`Failed to roll back generated thumbnail ${mediaMetadata.id}:`, cleanupError)
      }
    }

    if (mediaMetadata.opfsPath) {
      try {
        await opfsService.deleteFile(mediaMetadata.opfsPath)
      } catch (cleanupError) {
        logger.warn(
          `Failed to roll back generated OPFS file ${mediaMetadata.opfsPath}:`,
          cleanupError,
        )
      }
    }

    event.failure(error, {
      rollback: {
        metadataDeleted: metadataCreated ? 'attempted' : 'none',
        thumbnailDeleted: thumbnailSaved ? 'attempted' : 'none',
        opfsDeleted: mediaMetadata.opfsPath ? 'attempted' : 'none',
      },
    })
    throw error
  }
}
