import type { MediaMetadata } from '@/types/storage'
import { createLogger, createOperationId } from '@/shared/logging/logger'
import {
  adoptCopiedMediaSource,
  associateMediaWithProject,
  createMedia as createMediaDB,
  deleteMedia as deleteMediaDB,
  deleteThumbnailsByMediaId,
  saveThumbnail as saveThumbnailDB,
  writeMediaSource,
} from '@/features/media-library/deps/storage'
import { opfsService } from '@/features/media-library/services/opfs-service'

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

interface PersistGeneratedMediaOptions {
  file: File
  projectId: string
  mediaMetadata: MediaMetadata
  thumbnailBlob?: Blob
  thumbnailWidth?: number
  thumbnailHeight?: number
}

interface PersistAdoptedMediaOptions {
  stagedPath: readonly string[]
  projectId: string
  mediaMetadata: MediaMetadata
  thumbnailBlob?: Blob
  thumbnailWidth?: number
  thumbnailHeight?: number
}

export async function persistAdoptedMediaAsset({
  stagedPath,
  projectId,
  mediaMetadata,
  thumbnailBlob,
  thumbnailWidth,
  thumbnailHeight,
}: PersistAdoptedMediaOptions): Promise<MediaMetadata> {
  let sourceAdopted = false
  let thumbnailSaved = false
  try {
    await adoptCopiedMediaSource(stagedPath, mediaMetadata.id, mediaMetadata.fileName)
    sourceAdopted = true

    const rawWidth = Number(thumbnailWidth)
    const rawHeight = Number(thumbnailHeight)
    if (
      thumbnailBlob &&
      Number.isFinite(rawWidth) &&
      rawWidth > 0 &&
      Number.isFinite(rawHeight) &&
      rawHeight > 0
    ) {
      const thumbnailId = crypto.randomUUID()
      await saveThumbnailDB({
        id: thumbnailId,
        mediaId: mediaMetadata.id,
        blob: thumbnailBlob,
        timestamp: 0,
        width: Math.max(1, Math.floor(Math.abs(rawWidth))),
        height: Math.max(1, Math.floor(Math.abs(rawHeight))),
      })
      mediaMetadata.thumbnailId = thumbnailId
      thumbnailSaved = true
    }

    await createMediaDB(mediaMetadata)
    await associateMediaWithProject(projectId, mediaMetadata.id)
    return mediaMetadata
  } catch (error) {
    if (sourceAdopted) {
      await deleteMediaDB(mediaMetadata.id).catch((cleanupError) => {
        logger.warn(`Failed to roll back adopted media ${mediaMetadata.id}:`, cleanupError)
      })
    }
    if (thumbnailSaved) {
      await deleteThumbnailsByMediaId(mediaMetadata.id).catch((cleanupError) => {
        logger.warn(`Failed to roll back adopted thumbnail ${mediaMetadata.id}:`, cleanupError)
      })
    }
    throw error
  }
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

  let sourceWritten = false
  let metadataCreated = false
  let thumbnailSaved = false

  try {
    // Durable primary store: the user-picked workspace folder. It's the
    // cross-origin source of truth, so a copied/generated/remote asset must
    // land here — not OPFS, which is origin-scoped and invisible when the
    // same project is opened on another origin. Strict: a failure here means
    // the media isn't durably stored, so roll the whole import back.
    await writeMediaSource(mediaMetadata.id, file, mediaMetadata.fileName, { strict: true })
    sourceWritten = true

    // Optional OPFS copy — only when a caller still supplies an opfsPath (e.g.
    // a regenerable cache). Source imports omit it and live in the workspace
    // folder alone.
    if (mediaMetadata.opfsPath) {
      await opfsService.saveFile(mediaMetadata.opfsPath, await blobToArrayBuffer(file))
    }

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
    await associateMediaWithProject(projectId, mediaMetadata.id)
    event.success({ projectId, mediaId: mediaMetadata.id })
    return mediaMetadata
  } catch (error) {
    // deleteMediaDB removes the whole `media/{id}/` dir recursively, so it
    // cleans up the workspace source blob too — even when metadata was never
    // written (source-only orphan).
    if (metadataCreated || sourceWritten) {
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
        metadataDeleted: metadataCreated || sourceWritten ? 'attempted' : 'none',
        thumbnailDeleted: thumbnailSaved ? 'attempted' : 'none',
        opfsDeleted: mediaMetadata.opfsPath ? 'attempted' : 'none',
      },
    })
    throw error
  }
}
