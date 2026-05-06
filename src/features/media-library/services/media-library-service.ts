import type { MediaMetadata, ThumbnailData } from '@/types/storage'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('MediaLibraryService')

/**
 * Safe wrapper around workspace-fs readMediaSource that never throws —
 * used as a last-resort fallback in getMediaFile.
 */
async function readMediaSourceSafe(id: string): Promise<Blob | null> {
  try {
    return await readMediaSource(id)
  } catch (error) {
    logger.warn(`readMediaSource(${id}) failed:`, error)
    return null
  }
}

/**
 * Fire-and-forget mirror of a successfully-read source file into the
 * workspace folder so other origins (and coding agents) can read the
 * bytes from disk. No-op when already mirrored.
 */
function mirrorSourceToWorkspaceInBackground(
  id: string,
  blob: Blob,
  fileName: string | undefined,
): void {
  void (async () => {
    try {
      if (await hasMediaSource(id)) return
      await writeMediaSource(id, blob, fileName)
    } catch (error) {
      logger.warn(`mirrorSourceToWorkspace(${id}) failed:`, error)
    }
  })()
}
import {
  getAllMedia as getAllMediaDB,
  getMedia as getMediaDB,
  createMedia as createMediaDB,
  updateMedia as updateMediaDB,
  deleteMedia as deleteMediaDB,
  saveThumbnail as saveThumbnailDB,
  getThumbnailByMediaId,
  deleteThumbnailsByMediaId,
  // v3: Content-addressable storage
  incrementContentRef,
  decrementContentRef,
  deleteContent,
  // v3: Project-media associations
  associateMediaWithProject,
  removeMediaFromProject as removeMediaFromProjectDB,
  getProjectMediaIds,
  getProjectsUsingMedia,
  getMediaForProject as getMediaForProjectDB,
  deleteTranscript,
  readAiOutput,
} from '@/infrastructure/storage'
import { saveCaptions, deleteCaptions } from '@/infrastructure/storage/workspace-fs/captions'
import { deleteScenes } from '@/infrastructure/storage/workspace-fs/scenes'
import {
  filmstripCache,
  gifFrameCache,
  waveformCache,
} from '@/features/media-library/deps/timeline-services'
import { opfsService } from './opfs-service'
import { proxyService } from './proxy-service'
import { ensureFileHandlePermission, FileAccessError } from './file-access'
import { enqueueBackgroundMediaWork } from './background-media-work'
import {
  hasMediaSource,
  readMediaSource,
  writeMediaSource,
} from '@/infrastructure/storage/workspace-fs/media-source'
import {
  buildGeneratedMediaOpfsPath,
  getGeneratedImageDimensions,
  getThumbnailDimensions,
  persistGeneratedMediaAsset,
} from './media-asset-helpers'
import { validateMediaFile, getMimeType } from '../utils/validation'
import { getSharedProxyKey } from '../utils/proxy-key'
import { mediaProcessorService } from './media-processor-service'
import { generateThumbnail } from '../utils/thumbnail-generator'
import {
  needsCustomAudioDecoder,
  startPreviewAudioConform,
  startPreviewAudioStartupWarm,
  deletePreviewAudioConform,
} from '@/features/media-library/deps/composition-runtime'
export { FileAccessError } from './file-access'

const IMPORT_FILMSTRIP_COVER_PREWARM_SECONDS = 1
const IMPORT_FILMSTRIP_PREWARM_SECONDS = 12
const IMPORT_BACKGROUND_COVER_WARM_DELAY_MS = 0
const IMPORT_BACKGROUND_WARM_DELAY_MS = 600
const IMPORT_BACKGROUND_HEAVY_DELAY_MS = 2200
const PAGE_URL_IMPORT_HOSTS = [
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'vimeo.com',
  'www.vimeo.com',
  'dailymotion.com',
  'www.dailymotion.com',
]

const MIME_TYPE_TO_EXTENSION: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-matroska': '.mkv',
  'video/matroska': '.mkv',
  'video/x-msvideo': '.avi',
  'audio/mp3': '.mp3',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/aac': '.aac',
  'audio/x-m4a': '.m4a',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
}

function normalizeMimeType(value: string | null | undefined): string {
  return value?.split(';')[0]?.trim().toLowerCase() ?? ''
}

function isPageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('text/') || mimeType === 'application/xhtml+xml'
}

function isKnownMediaPageHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return PAGE_URL_IMPORT_HOSTS.some(
    (host) => normalized === host || normalized.endsWith(`.${host}`),
  )
}

function extractContentDispositionFileName(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null

  const utf8Match = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
  const rawUtf8Name = utf8Match?.[1]?.trim()
  if (rawUtf8Name) {
    try {
      return decodeURIComponent(rawUtf8Name.replace(/^"(.*)"$/, '$1'))
    } catch {
      return rawUtf8Name.replace(/^"(.*)"$/, '$1')
    }
  }

  const basicMatch = contentDisposition.match(/filename\s*=\s*("?)([^";]+)\1/i)
  return basicMatch?.[2]?.trim() || null
}

function extractFileNameFromUrl(input: string): string | null {
  try {
    const url = new URL(input)
    const segment = url.pathname.split('/').filter(Boolean).pop()
    if (!segment) return null
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

function inferExtensionFromMimeType(mimeType: string): string {
  return MIME_TYPE_TO_EXTENSION[mimeType] ?? ''
}

function buildImportedUrlFileName(
  requestedUrl: string,
  responseUrl: string | undefined,
  contentDisposition: string | null,
  mimeType: string,
): string {
  const fileName =
    extractContentDispositionFileName(contentDisposition) ??
    extractFileNameFromUrl(responseUrl ?? requestedUrl) ??
    extractFileNameFromUrl(requestedUrl)

  if (fileName && fileName.length > 0) {
    return fileName
  }

  const extension = inferExtensionFromMimeType(mimeType)
  return `remote-media${extension}`
}

function parseMediaImportUrl(input: string): URL {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(input)
  } catch {
    throw new Error('Enter a valid http:// or https:// media URL.')
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Only http:// and https:// media URLs are supported.')
  }

  return parsedUrl
}

/**
 * Media Library Service - Coordinates handle/OPFS media access with
 * workspace-backed metadata, thumbnails, and derived caches.
 *
 * Includes in-memory thumbnail URL cache to prevent flicker on re-renders.
 *
 * Provides atomic operations for media management while keeping origin-scoped
 * sources and the workspace folder in sync.
 */
class MediaLibraryService {
  /** In-memory cache for thumbnail blob URLs to prevent flicker on re-renders */
  private thumbnailUrlCache = new Map<string, string>()

  private async deleteTranscriptSafely(mediaId: string): Promise<void> {
    try {
      await deleteTranscript(mediaId)
    } catch (error) {
      logger.warn('Failed to delete transcript:', error)
    }
  }

  private async deleteCaptionsSafely(mediaId: string): Promise<void> {
    try {
      await deleteCaptions(mediaId)
    } catch (error) {
      logger.warn('Failed to delete captions:', error)
    }
  }

  private async deleteScenesSafely(mediaId: string): Promise<void> {
    try {
      await deleteScenes(mediaId)
    } catch (error) {
      logger.warn('Failed to delete scenes:', error)
    }
  }

  private async deleteThumbnailsSafely(mediaId: string): Promise<void> {
    this.clearThumbnailCache(mediaId)
    try {
      await deleteThumbnailsByMediaId(mediaId)
    } catch (error) {
      logger.warn('Failed to delete thumbnails:', error)
    }
  }

  private async clearGifFrameCacheSafely(mediaId: string): Promise<void> {
    try {
      await gifFrameCache.clearMedia(mediaId)
    } catch (error) {
      logger.warn('Failed to delete GIF frame cache:', error)
    }
  }

  /**
   * Clear the filmstrip cache for a fully-dereferenced media item. Removes
   * both the OPFS primary copy and the workspace-folder mirror so the
   * workspace stays tidy after the last project using this media is gone.
   */
  private async clearFilmstripCacheSafely(mediaId: string): Promise<void> {
    try {
      await filmstripCache.clearMedia(mediaId)
    } catch (error) {
      logger.warn('Failed to delete filmstrip cache:', error)
    }
  }

  /**
   * Clear waveform caches for a fully-dereferenced media item. Removes
   * the in-memory LRU entry, the persisted binned waveform cache, and the
   * OPFS + workspace-folder multi-resolution mirrors.
   */
  private async clearWaveformCacheSafely(mediaId: string): Promise<void> {
    try {
      await waveformCache.clearMedia(mediaId)
    } catch (error) {
      logger.warn('Failed to delete waveform cache:', error)
    }
  }

  private async deleteProxySafely(
    media: MediaMetadata,
    options?: { preserveSharedAliases?: boolean },
  ): Promise<void> {
    try {
      const sharedProxyKey = getSharedProxyKey(media)
      if (options?.preserveSharedAliases) {
        const allMedia = await getAllMediaDB()
        const hasSharedAlias = allMedia.some(
          (entry) => entry.id !== media.id && getSharedProxyKey(entry) === sharedProxyKey,
        )

        if (hasSharedAlias) {
          proxyService.clearProxyKey(media.id)
          return
        }
      }

      await proxyService.deleteProxy(media.id, sharedProxyKey)
    } catch (error) {
      logger.warn('Failed to delete proxy:', error)
    } finally {
      proxyService.clearProxyKey(media.id)
    }
  }

  private async deleteOpfsContentIfUnreferenced(media: MediaMetadata): Promise<void> {
    if (media.storageType !== 'opfs') {
      return
    }

    // If contentHash is missing but opfsPath exists, delete the OPFS file directly
    // to avoid orphaning files that were stored without content-addressing.
    if (!media.contentHash) {
      if (media.opfsPath) {
        try {
          await opfsService.deleteFile(media.opfsPath)
        } catch (error) {
          logger.warn('Failed to delete OPFS file (no contentHash):', error)
        }
      }
      return
    }

    const newRefCount = await decrementContentRef(media.contentHash)

    if (newRefCount !== 0 || !media.opfsPath) {
      return
    }

    try {
      await opfsService.deleteFile(media.opfsPath)
    } catch (error) {
      logger.warn('Failed to delete file from OPFS:', error)
    }

    try {
      await deleteContent(media.contentHash)
    } catch (error) {
      logger.warn('Failed to delete content record:', error)
    }
  }

  private schedulePostImportWork(
    file: File,
    mediaMetadata: MediaMetadata,
    options: {
      isVideo: boolean
      previewAudioCodec?: string
    },
  ): void {
    if (options.isVideo && mediaMetadata.duration > 0) {
      const coverWarmEndTime = Math.min(
        mediaMetadata.duration,
        IMPORT_FILMSTRIP_COVER_PREWARM_SECONDS,
      )
      enqueueBackgroundMediaWork(
        () =>
          filmstripCache.prewarmPriorityWindow(mediaMetadata.id, file, mediaMetadata.duration, {
            startTime: 0,
            endTime: coverWarmEndTime,
          }),
        {
          priority: 'warm',
          delayMs: IMPORT_BACKGROUND_COVER_WARM_DELAY_MS,
        },
      )

      const warmEndTime = Math.min(mediaMetadata.duration, IMPORT_FILMSTRIP_PREWARM_SECONDS)
      enqueueBackgroundMediaWork(
        () =>
          filmstripCache.prewarmPriorityWindow(mediaMetadata.id, file, mediaMetadata.duration, {
            startTime: 0,
            endTime: warmEndTime,
          }),
        {
          priority: 'warm',
          delayMs: IMPORT_BACKGROUND_WARM_DELAY_MS,
        },
      )
    }

    if (needsCustomAudioDecoder(options.previewAudioCodec)) {
      enqueueBackgroundMediaWork(() => startPreviewAudioStartupWarm(mediaMetadata.id, file), {
        priority: 'warm',
        delayMs: IMPORT_BACKGROUND_WARM_DELAY_MS,
      })
      enqueueBackgroundMediaWork(() => startPreviewAudioConform(mediaMetadata.id, file), {
        priority: 'heavy',
        delayMs: IMPORT_BACKGROUND_HEAVY_DELAY_MS,
      })
    }

    if (mediaMetadata.mimeType === 'image/gif') {
      enqueueBackgroundMediaWork(
        async () => {
          const blobUrl = URL.createObjectURL(file)
          try {
            await gifFrameCache.getGifFrames(mediaMetadata.id, blobUrl)
          } finally {
            URL.revokeObjectURL(blobUrl)
          }
        },
        {
          priority: 'warm',
          delayMs: IMPORT_BACKGROUND_WARM_DELAY_MS,
        },
      )
    }
  }

  private async importMediaFileToOpfs(
    file: File,
    projectId: string,
  ): Promise<MediaMetadata & { isDuplicate?: boolean; hasUnsupportedCodec?: boolean }> {
    const validationResult = validateMediaFile(file)
    if (!validationResult.valid) {
      throw new Error(validationResult.error)
    }

    const projectMedia = await getMediaForProjectDB(projectId)
    const existingMedia = projectMedia.find(
      (media) => media.fileName === file.name && media.fileSize === file.size,
    )
    if (existingMedia) {
      return { ...existingMedia, isDuplicate: true }
    }

    const resolvedMimeType = getMimeType(file)
    const { metadata, thumbnail } = await mediaProcessorService.processMedia(
      file,
      resolvedMimeType,
      { thumbnailTimestamp: 1 },
    )

    let thumbnailBlob = thumbnail
    if (!thumbnailBlob && resolvedMimeType === 'image/svg+xml') {
      try {
        thumbnailBlob = await generateThumbnail(file, { maxSize: 320, quality: 0.6 })
      } catch (error) {
        logger.warn('Failed to generate SVG thumbnail on main thread:', error)
      }
    }

    const mediaId = crypto.randomUUID()
    const createdAt = Date.now()
    const opfsPath = buildGeneratedMediaOpfsPath(mediaId)
    const codecCheck = mediaProcessorService.hasUnsupportedAudioCodec(metadata)
    const previewAudioCodec =
      metadata.type === 'audio'
        ? metadata.codec
        : metadata.type === 'video'
          ? metadata.audioCodec
          : undefined

    const thumbnailDimensions = thumbnailBlob
      ? metadata.type === 'audio'
        ? { width: 320, height: 180 }
        : getThumbnailDimensions(
            Math.max(1, 'width' in metadata ? metadata.width || 1 : 1),
            Math.max(1, 'height' in metadata ? metadata.height || 1 : 1),
            320,
          )
      : undefined

    const mediaMetadata: MediaMetadata = {
      id: mediaId,
      storageType: 'opfs',
      opfsPath,
      fileName: file.name,
      fileSize: file.size,
      mimeType: resolvedMimeType,
      duration: 'duration' in metadata ? metadata.duration : 0,
      width: 'width' in metadata ? metadata.width : 0,
      height: 'height' in metadata ? metadata.height : 0,
      fps: metadata.type === 'video' ? metadata.fps : 0,
      codec:
        metadata.type === 'video'
          ? metadata.codec
          : metadata.type === 'audio'
            ? metadata.codec || 'unknown'
            : 'unknown',
      bitrate: 'bitrate' in metadata ? (metadata.bitrate ?? 0) : 0,
      audioCodec: metadata.type === 'video' ? metadata.audioCodec : undefined,
      audioCodecSupported: metadata.type === 'video' ? metadata.audioCodecSupported : true,
      keyframeTimestamps: metadata.type === 'video' ? metadata.keyframeTimestamps : undefined,
      gopInterval: metadata.type === 'video' ? metadata.gopInterval : undefined,
      tags: [],
      createdAt,
      updatedAt: createdAt,
    }

    const persistedMedia = await persistGeneratedMediaAsset({
      file,
      projectId,
      mediaMetadata,
      thumbnailBlob,
      thumbnailWidth: thumbnailDimensions?.width,
      thumbnailHeight: thumbnailDimensions?.height,
    })

    this.schedulePostImportWork(file, persistedMedia, {
      isVideo: metadata.type === 'video',
      previewAudioCodec,
    })

    return {
      ...persistedMedia,
      hasUnsupportedCodec: codecCheck.unsupported,
    }
  }

  private async fetchMediaFromUrl(url: string): Promise<File> {
    const parsedUrl = parseMediaImportUrl(url.trim())

    let response: Response
    try {
      response = await fetch(parsedUrl.toString())
    } catch (error) {
      logger.warn(`Failed to fetch media URL "${parsedUrl.toString()}":`, error)
      throw new Error(
        'Could not download that URL. The site may block cross-origin downloads, require sign-in, or need a direct file link.',
      )
    }

    if (!response.ok) {
      throw new Error(
        `Failed to download media (${response.status}${response.statusText ? ` ${response.statusText}` : ''}).`,
      )
    }

    const responseMimeType = normalizeMimeType(response.headers.get('content-type'))
    if (isPageMimeType(responseMimeType)) {
      if (isKnownMediaPageHost(parsedUrl.hostname)) {
        throw new Error(
          'YouTube and similar page URLs are not direct media files here yet. Paste a direct MP4/MP3/image URL, or download the media first.',
        )
      }
      throw new Error(
        'That URL points to a web page, not a media file. Paste the direct file URL instead.',
      )
    }

    const blob = await response.blob()
    if (blob.size === 0) {
      throw new Error('The downloaded file was empty.')
    }

    const mimeType = normalizeMimeType(blob.type) || responseMimeType
    const fileName = buildImportedUrlFileName(
      parsedUrl.toString(),
      response.url,
      response.headers.get('content-disposition'),
      mimeType,
    )

    return new File([blob], fileName, {
      type: mimeType || blob.type,
      lastModified: Date.now(),
    })
  }

  /**
   * Get all media items from workspace storage
   */
  async getAllMedia(): Promise<MediaMetadata[]> {
    return getAllMediaDB()
  }

  /**
   * Get a single media item by ID
   */
  async getMedia(id: string): Promise<MediaMetadata | null> {
    const media = await getMediaDB(id)
    return media || null
  }

  /**
   * Import media using FileSystemFileHandle (instant, no copy)
   *
   * This is the preferred method for local-first experience. The file stays
   * on the user's disk and is read on-demand. No copying or uploading.
   *
   * Duplicate detection: If a file with the same name and size already exists
   * in the project, returns the existing media with `isDuplicate: true`.
   *
   * @param handle - FileSystemFileHandle from showOpenFilePicker
   * @param projectId - The project to associate the media with
   * @returns MediaMetadata with optional isDuplicate flag
   */
  async importMediaWithHandle(
    handle: FileSystemFileHandle,
    projectId: string,
  ): Promise<MediaMetadata & { isDuplicate?: boolean; hasUnsupportedCodec?: boolean }> {
    // Stage 1: Get file from handle (instant)
    const hasPermission = await ensureFileHandlePermission(handle)
    if (!hasPermission) {
      throw new FileAccessError('Permission denied to access file', 'permission_denied')
    }

    const file = await handle.getFile()

    // Stage 2: Validation
    const validationResult = validateMediaFile(file)
    if (!validationResult.valid) {
      throw new Error(validationResult.error)
    }

    // Stage 3a: Cross-workspace dedup by (fileName + fileSize + lastModified).
    // A File's triple-tuple is effectively unique: the same bytes re-saved
    // bumps lastModified, and two different files sharing name + exact byte
    // size + exact mtime is a practical non-occurrence. Zero file I/O — all
    // three fields come from File metadata — so unique imports pay nothing.
    // A match reuses the existing media record across projects instead of
    // re-mirroring the bytes into a fresh `media/{id}/` directory.
    //
    // `isDuplicate` is only set when the matched media is already in THIS
    // project. Cross-project reuse (new project importing the same file) is
    // a successful import from the UI's perspective — the media just happens
    // to already live in the workspace, so we associate and return it as a
    // regular import result. `getAllMedia` includes media whose only project
    // is trashed; re-associating into the new project effectively brings
    // those records forward, and the trash sweep's ref-counted delete still
    // keeps the bytes alive because the new project now references them.
    const workspaceMedia = await getAllMediaDB()
    const workspaceDuplicate = workspaceMedia.find(
      (m) =>
        m.fileName === file.name &&
        m.fileSize === file.size &&
        m.fileLastModified === file.lastModified,
    )
    if (workspaceDuplicate) {
      let resolvedDuplicate = workspaceDuplicate
      if (workspaceDuplicate.storageType === 'handle') {
        resolvedDuplicate = await updateMediaDB(workspaceDuplicate.id, {
          fileHandle: handle,
          fileName: file.name,
          fileSize: file.size,
          fileLastModified: file.lastModified,
          updatedAt: Date.now(),
        })
      }
      mirrorSourceToWorkspaceInBackground(resolvedDuplicate.id, file, file.name)
      const projectMediaIds = await getProjectMediaIds(projectId).catch(() => [] as string[])
      const alreadyInThisProject = projectMediaIds.includes(resolvedDuplicate.id)
      if (!alreadyInThisProject) {
        await associateMediaWithProject(projectId, resolvedDuplicate.id)
      }
      return { ...resolvedDuplicate, isDuplicate: alreadyInThisProject }
    }

    // Stage 3b: Project-scoped name+size fallback for legacy records missing
    // `fileLastModified` (imported before that field was persisted). Only
    // fires for records already in the current project — cross-project
    // reuse is covered by 3a.
    const projectMedia = await getMediaForProjectDB(projectId)
    const existingMedia = projectMedia.find(
      (m) =>
        m.fileName === file.name &&
        m.fileSize === file.size &&
        // Only consider legacy records that lack `fileLastModified` — current
        // records with a different mtime must not be collapsed onto the new
        // file since they describe different bytes.
        (m.fileLastModified === null || m.fileLastModified === undefined),
    )
    if (existingMedia) {
      const updates: Partial<MediaMetadata> = {
        fileName: file.name,
        fileSize: file.size,
        fileLastModified: file.lastModified,
        updatedAt: Date.now(),
      }

      if (existingMedia.storageType === 'handle' || !existingMedia.opfsPath) {
        updates.storageType = 'handle'
        updates.fileHandle = handle
      }

      const refreshedMedia = await updateMediaDB(existingMedia.id, updates)
      mirrorSourceToWorkspaceInBackground(refreshedMedia.id, file, file.name)
      return { ...refreshedMedia, isDuplicate: true }
    }

    // Stage 4: Process media in worker (metadata + thumbnail in one pass, off main thread)
    const resolvedMimeType = getMimeType(file)
    const id = crypto.randomUUID()
    let thumbnailId: string | undefined

    const { metadata, thumbnail } = await mediaProcessorService.processMedia(
      file,
      resolvedMimeType,
      { thumbnailTimestamp: 1 },
    )

    // Stage 5: Save thumbnail if generated
    // SVG thumbnails can't be generated in the worker (createImageBitmap doesn't
    // support SVGs in workers), so fall back to main-thread generation.
    let thumbnailBlob = thumbnail
    if (!thumbnailBlob && resolvedMimeType === 'image/svg+xml') {
      try {
        thumbnailBlob = await generateThumbnail(file, { maxSize: 320, quality: 0.6 })
      } catch (error) {
        logger.warn('Failed to generate SVG thumbnail on main thread:', error)
      }
    }
    if (thumbnailBlob) {
      try {
        thumbnailId = crypto.randomUUID()
        const thumbnailData: ThumbnailData = {
          id: thumbnailId,
          mediaId: id,
          blob: thumbnailBlob,
          timestamp: 1,
          width: 320,
          height: 180,
        }
        await saveThumbnailDB(thumbnailData)
      } catch (error) {
        logger.warn('Failed to save thumbnail:', error)
        thumbnailId = undefined
      }
    }

    // Check for unsupported audio codec (included in metadata from worker)
    const codecCheck = mediaProcessorService.hasUnsupportedAudioCodec(metadata)

    // Stage 6: Save metadata with the file handle-backed source reference
    const mediaMetadata: MediaMetadata = {
      id,
      storageType: 'handle',
      fileHandle: handle,
      fileName: file.name,
      fileSize: file.size,
      fileLastModified: file.lastModified,
      mimeType: resolvedMimeType,
      duration: 'duration' in metadata ? metadata.duration : 0,
      width: 'width' in metadata ? metadata.width : 0,
      height: 'height' in metadata ? metadata.height : 0,
      fps: metadata.type === 'video' ? metadata.fps : 30,
      codec:
        metadata.type === 'video'
          ? metadata.codec
          : metadata.type === 'audio'
            ? metadata.codec || 'unknown'
            : 'unknown',
      bitrate: 'bitrate' in metadata ? (metadata.bitrate ?? 0) : 0,
      audioCodec: metadata.type === 'video' ? metadata.audioCodec : undefined,
      audioCodecSupported: metadata.type === 'video' ? metadata.audioCodecSupported : true,
      keyframeTimestamps: metadata.type === 'video' ? metadata.keyframeTimestamps : undefined,
      gopInterval: metadata.type === 'video' ? metadata.gopInterval : undefined,
      thumbnailId,
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    await createMediaDB(mediaMetadata)

    // Mirror source bytes into the workspace folder so every origin (dev,
    // prod, agents reading from disk) can see the media — not just this one.
    // Runs in the background to avoid blocking the rest of the import flow;
    // the lazy fallback in getMediaFile covers the gap if this loses a race.
    mirrorSourceToWorkspaceInBackground(id, file, file.name)

    // Stage 7: Associate with project
    await associateMediaWithProject(projectId, id)

    const previewAudioCodec =
      metadata.type === 'audio'
        ? metadata.codec
        : metadata.type === 'video'
          ? metadata.audioCodec
          : undefined
    this.schedulePostImportWork(file, mediaMetadata, {
      isVideo: metadata.type === 'video',
      previewAudioCodec,
    })

    return {
      ...mediaMetadata,
      hasUnsupportedCodec: codecCheck.unsupported,
    }
  }

  /**
   * Import media from a network URL.
   *
   * The remote file is fetched, validated, processed for metadata/thumbnail,
   * and stored as an OPFS-backed media item.
   */
  async importMediaFromUrl(
    url: string,
    projectId: string
  ): Promise<MediaMetadata & { isDuplicate?: boolean; hasUnsupportedCodec?: boolean }> {
    if (!projectId) {
      throw new Error('No project selected');
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error('Invalid URL');
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Only http(s) URLs are supported');
    }

    const response = await fetch(parsedUrl.toString());
    if (!response.ok) {
      throw new Error(`Failed to download media: HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const fileNameFromPath = parsedUrl.pathname.split('/').pop() || 'remote-media';
    const fallbackExt = blob.type.startsWith('video/')
      ? 'mp4'
      : blob.type.startsWith('audio/')
        ? 'mp3'
        : blob.type.startsWith('image/')
          ? 'png'
          : 'bin';
    const normalizedFileName = fileNameFromPath.includes('.')
      ? fileNameFromPath
      : `${fileNameFromPath}.${fallbackExt}`;
    const file = new File([blob], normalizedFileName, {
      type: blob.type || 'application/octet-stream',
    });

    const validationResult = validateMediaFile(file);
    if (!validationResult.valid) {
      throw new Error(validationResult.error);
    }

    const projectMedia = await getMediaForProjectDB(projectId);
    const existingMedia = projectMedia.find(
      (m) => m.fileName === file.name && m.fileSize === file.size
    );
    if (existingMedia) {
      return { ...existingMedia, isDuplicate: true };
    }

    const resolvedMimeType = getMimeType(file);
    const { metadata, thumbnail } = await mediaProcessorService.processMedia(file, resolvedMimeType, {
      generateThumbnail: true,
      thumbnailMaxSize: 320,
      thumbnailQuality: 0.6,
    });

    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const opfsPath = buildGeneratedMediaOpfsPath(id);
    const mediaMetadata: MediaMetadata = {
      id,
      storageType: 'opfs',
      opfsPath,
      fileName: file.name,
      fileSize: file.size,
      mimeType: resolvedMimeType,
      duration: 'duration' in metadata ? metadata.duration : 0,
      width: 'width' in metadata ? metadata.width : 0,
      height: 'height' in metadata ? metadata.height : 0,
      fps: metadata.type === 'video' ? metadata.fps : 0,
      codec: metadata.type === 'video'
        ? metadata.codec
        : metadata.type === 'audio'
          ? (metadata.codec || 'unknown')
          : resolvedMimeType.split('/')[1] ?? 'unknown',
      bitrate: 'bitrate' in metadata ? (metadata.bitrate ?? 0) : 0,
      audioCodec: metadata.type === 'video' ? metadata.audioCodec : undefined,
      audioCodecSupported: metadata.type === 'video' ? metadata.audioCodecSupported : true,
      keyframeTimestamps: metadata.type === 'video' ? metadata.keyframeTimestamps : undefined,
      gopInterval: metadata.type === 'video' ? metadata.gopInterval : undefined,
      tags: [],
      createdAt,
      updatedAt: createdAt,
    };

    const thumbnailDimensions = mediaMetadata.width > 0 && mediaMetadata.height > 0
      ? getThumbnailDimensions(mediaMetadata.width, mediaMetadata.height, 320)
      : thumbnail
        ? { width: 320, height: Math.max(1, Math.round(320 * (9 / 16))) }
        : undefined;

    await persistGeneratedMediaAsset({
      file,
      projectId,
      mediaMetadata,
      thumbnailBlob: thumbnail ?? undefined,
      thumbnailWidth: thumbnailDimensions?.width,
      thumbnailHeight: thumbnailDimensions?.height,
    });

    const codecCheck = mediaProcessorService.hasUnsupportedAudioCodec(metadata);
    return {
      ...mediaMetadata,
      hasUnsupportedCodec: codecCheck.unsupported,
    };
  }

  /**
   * Import multiple files using FileSystemFileHandles (instant, no copy)
   */
  async importMediaBatchWithHandles(
    handles: FileSystemFileHandle[],
    projectId: string,
    onProgress?: (current: number, total: number, fileName: string) => void,
  ): Promise<MediaMetadata[]> {
    const results: MediaMetadata[] = []
    const errors: { file: string; error: string }[] = []

    for (let i = 0; i < handles.length; i++) {
      const handle = handles[i]
      if (!handle) continue

      const file = await handle.getFile().catch(() => null)
      const fileName = file?.name ?? handle.name
      onProgress?.(i + 1, handles.length, fileName)

      try {
        const metadata = await this.importMediaWithHandle(handle, projectId)
        results.push(metadata)
      } catch (error) {
        errors.push({
          file: fileName,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (errors.length > 0) {
      logger.warn('Some files failed to import:', errors)
    }

    return results
  }

  /**
   * Import media from a direct URL.
   *
   * Since remote URLs do not provide a durable FileSystemFileHandle, the
   * downloaded bytes are stored in OPFS and mirrored into the workspace.
   *
   * Works with direct media URLs that allow browser-side fetches. Page URLs
   * such as YouTube/Vimeo watch pages typically do not expose a fetchable
   * media file and should be handled upstream.
   */
  async importMediaFromUrl(
    url: string,
    projectId: string,
  ): Promise<MediaMetadata & { isDuplicate?: boolean; hasUnsupportedCodec?: boolean }> {
    if (!projectId) {
      throw new Error('No project selected')
    }

    const file = await this.fetchMediaFromUrl(url)
    return this.importMediaFileToOpfs(file, projectId)
  }

  /**
   * Save a generated still image into a project-backed media library entry.
   *
   * Used for editor-generated assets such as preview frame captures.
   */
  async importGeneratedImage(
    file: File,
    projectId: string,
    options?: {
      width?: number
      height?: number
      tags?: string[]
      thumbnailMaxSize?: number
      thumbnailQuality?: number
      codec?: string
    },
  ): Promise<MediaMetadata> {
    if (!projectId) {
      throw new Error('No project selected')
    }

    const resolvedMimeType = file.type || getMimeType(file)
    if (!resolvedMimeType.startsWith('image/')) {
      throw new Error(`Generated file must be an image. Received "${resolvedMimeType}".`)
    }

    const safeWidth =
      Number.isFinite(options?.width) && (options?.width ?? 0) > 0
        ? Math.round(options?.width ?? 0)
        : 0
    const safeHeight =
      Number.isFinite(options?.height) && (options?.height ?? 0) > 0
        ? Math.round(options?.height ?? 0)
        : 0
    const dimensions =
      safeWidth > 0 && safeHeight > 0
        ? { width: safeWidth, height: safeHeight }
        : await getGeneratedImageDimensions(file)

    const mediaId = crypto.randomUUID()
    const createdAt = Date.now()
    const opfsPath = buildGeneratedMediaOpfsPath(mediaId)
    const codec = options?.codec ?? resolvedMimeType.split('/')[1] ?? 'unknown'
    const thumbnailMaxSize = options?.thumbnailMaxSize ?? 320
    const thumbnailQuality = options?.thumbnailQuality ?? 0.6

    const mediaMetadata: MediaMetadata = {
      id: mediaId,
      storageType: 'opfs',
      opfsPath,
      fileName: file.name,
      fileSize: file.size,
      mimeType: resolvedMimeType,
      duration: 0,
      width: dimensions.width,
      height: dimensions.height,
      fps: 0,
      codec,
      bitrate: 0,
      tags: options?.tags ?? [],
      createdAt,
      updatedAt: createdAt,
    }

    let thumbnailBlob: Blob | undefined
    let thumbnailDimensions: { width: number; height: number } | undefined
    try {
      thumbnailBlob = await generateThumbnail(file, {
        maxSize: thumbnailMaxSize,
        quality: thumbnailQuality,
      })
      thumbnailDimensions = getThumbnailDimensions(
        dimensions.width,
        dimensions.height,
        thumbnailMaxSize,
      )
    } catch (error) {
      logger.warn(`Failed to save generated image thumbnail for ${file.name}:`, error)
    }

    return persistGeneratedMediaAsset({
      file,
      projectId,
      mediaMetadata,
      thumbnailBlob,
      thumbnailWidth: thumbnailDimensions?.width,
      thumbnailHeight: thumbnailDimensions?.height,
    })
  }

  /**
   * Save generated audio into the project media library as an OPFS-backed asset.
   */
  async importGeneratedAudio(
    file: File,
    projectId: string,
    options?: {
      tags?: string[]
      thumbnailMaxSize?: number
      thumbnailQuality?: number
      codec?: string
    },
  ): Promise<MediaMetadata> {
    if (!projectId) {
      throw new Error('No project selected')
    }

    const resolvedMimeType = file.type || getMimeType(file)
    if (!resolvedMimeType.startsWith('audio/')) {
      throw new Error(`Generated file must be audio. Received "${resolvedMimeType}".`)
    }

    const thumbnailMaxSize = options?.thumbnailMaxSize ?? 320
    const thumbnailQuality = options?.thumbnailQuality ?? 0.6
    const { metadata, thumbnail } = await mediaProcessorService.processMedia(
      file,
      resolvedMimeType,
      {
        generateThumbnail: true,
        thumbnailMaxSize,
        thumbnailQuality,
      },
    )

    if (metadata.type !== 'audio') {
      throw new Error(`Expected generated audio metadata, received "${metadata.type}".`)
    }

    const mediaId = crypto.randomUUID()
    const createdAt = Date.now()
    const opfsPath = buildGeneratedMediaOpfsPath(mediaId)
    const codec = options?.codec ?? metadata.codec ?? resolvedMimeType.split('/')[1] ?? 'unknown'
    // Nominal height — audio waveform thumbnails don't have intrinsic dimensions,
    // so we use a 16:9 placeholder ratio for the DB record.
    const thumbnailHeight = Math.max(1, Math.round(thumbnailMaxSize * (9 / 16)))
    const mediaMetadata: MediaMetadata = {
      id: mediaId,
      storageType: 'opfs',
      opfsPath,
      fileName: file.name,
      fileSize: file.size,
      mimeType: resolvedMimeType,
      duration: metadata.duration,
      width: 0,
      height: 0,
      fps: 0,
      codec,
      bitrate: metadata.bitrate ?? 0,
      tags: options?.tags ?? [],
      createdAt,
      updatedAt: createdAt,
    }

    return persistGeneratedMediaAsset({
      file,
      projectId,
      mediaMetadata,
      thumbnailBlob: thumbnail,
      thumbnailWidth: thumbnail ? thumbnailMaxSize : undefined,
      thumbnailHeight: thumbnail ? thumbnailHeight : undefined,
    })
  }

  /**
   * Delete media from a project with reference counting
   *
   * Removes the media association from the project. If no other projects
   * use this media, the metadata is deleted.
   *
   * For OPFS storage: Also deletes the file if no more references.
   * For handle storage: Just removes metadata (file stays on user's disk).
   *
   * @param projectId - The project to remove media from
   * @param mediaId - The media to remove
   */
  async deleteMediaFromProject(projectId: string, mediaId: string): Promise<void> {
    // Get media metadata
    const media = await getMediaDB(mediaId)
    if (!media) {
      throw new Error(`Media not found: ${mediaId}`)
    }

    // Remove project-media association
    await removeMediaFromProjectDB(projectId, mediaId)

    // Check if any other projects still use this media
    const remainingProjects = await getProjectsUsingMedia(mediaId)

    if (remainingProjects.length === 0) {
      // No other projects use this media - safe to fully delete metadata

      // Delete media metadata
      await deleteMediaDB(mediaId)

      await this.deleteTranscriptSafely(mediaId)
      await this.deleteCaptionsSafely(mediaId)
      await this.deleteScenesSafely(mediaId)
      await this.deleteThumbnailsSafely(mediaId)
      await this.clearGifFrameCacheSafely(mediaId)
      await this.clearFilmstripCacheSafely(mediaId)
      await this.clearWaveformCacheSafely(mediaId)
      await deletePreviewAudioConform(media, { clearMetadata: false })
      await this.deleteProxySafely(media, { preserveSharedAliases: true })
      await this.deleteOpfsContentIfUnreferenced(media)
      // For handle storage: File stays on user's disk - nothing to delete
    }
  }

  /**
   * Delete multiple media items from a project in batch.
   * Uses parallel deletion for better performance.
   */
  async deleteMediaBatchFromProject(projectId: string, mediaIds: string[]): Promise<void> {
    // Serialize deletions to avoid races on shared state (proxy aliases,
    // content ref counts, OPFS files) that concurrent deletes would cause.
    const errors: Array<{ id: string; error: unknown }> = []

    for (const mediaId of mediaIds) {
      try {
        await this.deleteMediaFromProject(projectId, mediaId)
      } catch (error) {
        logger.error(`Failed to delete media ${mediaId}:`, error)
        errors.push({ id: mediaId, error })
      }
    }

    if (errors.length === mediaIds.length) {
      throw new Error(`Failed to delete all ${mediaIds.length} items. Check console for details.`)
    }

    if (errors.length > 0) {
      logger.warn(
        `Partially deleted: ${mediaIds.length - errors.length}/${mediaIds.length} items deleted successfully.`,
      )
    }
  }

  /**
   * Delete all media associations for a project.
   * Used when deleting a project. Uses parallel deletion for better performance.
   */
  async deleteAllMediaFromProject(projectId: string): Promise<void> {
    const mediaIds = await getProjectMediaIds(projectId)

    for (const mediaId of mediaIds) {
      try {
        await this.deleteMediaFromProject(projectId, mediaId)
      } catch (error) {
        logger.error(`Failed to delete media ${mediaId} from project:`, error)
      }
    }
  }

  /**
   * Delete a media item globally — removes it from every project that uses
   * it, then deletes metadata, thumbnails, transcripts, proxies, and any
   * OPFS content when no longer referenced.
   *
   * Prefer `deleteMediaFromProject(projectId, mediaId)` when a project
   * context exists: it preserves the media for other projects via
   * reference counting. Use this variant only from the no-project view
   * (global media library), or when the user explicitly wants a
   * "delete everywhere" action.
   */
  async deleteMedia(id: string): Promise<void> {
    const media = await getMediaDB(id)
    if (!media) {
      throw new Error(`Media not found: ${id}`)
    }

    // Clean up all project-media associations for this media
    const projectIds = await getProjectsUsingMedia(id)
    for (const projectId of projectIds) {
      try {
        await removeMediaFromProjectDB(projectId, id)
      } catch (error) {
        logger.warn(`Failed to remove project association for ${projectId}:`, error)
      }
    }

    // Handle OPFS storage cleanup
    await this.deleteOpfsContentIfUnreferenced(media)
    // Handle storage: nothing to delete, file stays on disk

    await this.deleteThumbnailsSafely(id)
    await this.clearGifFrameCacheSafely(id)
    await this.clearFilmstripCacheSafely(id)
    await this.clearWaveformCacheSafely(id)
    await deletePreviewAudioConform(media, { clearMetadata: false })
    await this.deleteProxySafely(media)

    await deleteMediaDB(id)

    await this.deleteTranscriptSafely(id)
    await this.deleteCaptionsSafely(id)
    await this.deleteScenesSafely(id)
  }

  /**
   * Batch variant of `deleteMedia` — see its docs for when to use this
   * vs. `deleteMediaBatchFromProject`.
   */
  async deleteMediaBatch(ids: string[]): Promise<void> {
    const errors: Array<{ id: string; error: unknown }> = []

    for (const id of ids) {
      try {
        await this.deleteMedia(id)
      } catch (error) {
        logger.error(`Failed to delete media ${id}:`, error)
        errors.push({ id, error })
      }
    }

    if (errors.length === ids.length) {
      throw new Error(`Failed to delete all ${ids.length} items. Check console for details.`)
    }

    if (errors.length > 0) {
      logger.warn(
        `Partially deleted: ${ids.length - errors.length}/${ids.length} items deleted successfully.`,
      )
    }
  }

  /**
   * Get all media for a specific project
   */
  async getMediaForProject(projectId: string): Promise<MediaMetadata[]> {
    return getMediaForProjectDB(projectId)
  }

  /**
   * Copy media to another project (no file duplication)
   *
   * For handle-based media, the file handle is shared.
   * For OPFS-based media, the content reference is incremented.
   */
  async copyMediaToProject(mediaId: string, targetProjectId: string): Promise<void> {
    const media = await getMediaDB(mediaId)
    if (!media) {
      throw new Error(`Media not found: ${mediaId}`)
    }

    // Create project association
    await associateMediaWithProject(targetProjectId, mediaId)

    // For OPFS storage, increment content reference
    if (media.storageType === 'opfs' && media.contentHash) {
      await incrementContentRef(media.contentHash)
    }
    // For handle storage, no additional action needed - handle is shared
  }

  /**
   * Get media file as Blob object
   *
   * Supports both storage types:
   * - 'handle': Reads from user's disk via FileSystemFileHandle (instant)
   * - 'opfs': Reads from Origin Private File System (legacy/fallback)
   *
   * @throws FileAccessError if permission denied or file missing
   */
  async getMediaFile(id: string): Promise<Blob | null> {
    const media = await getMediaDB(id)

    if (!media) {
      return null
    }

    // Handle file handle storage (local-first, origin-scoped).
    if (media.storageType === 'handle' && media.fileHandle) {
      try {
        const hasPermission = await ensureFileHandlePermission(media.fileHandle)
        if (!hasPermission) {
          throw new FileAccessError(
            `Permission denied for "${media.fileName}". Please re-grant access.`,
            'permission_denied',
          )
        }

        const file = await media.fileHandle.getFile()
        mirrorSourceToWorkspaceInBackground(id, file, media.fileName)
        return file
      } catch (error) {
        if (error instanceof FileAccessError) {
          // Cross-origin recovery: if the handle exists but isn't granted here,
          // fall through to the workspace-fs copy before surfacing the error.
          const fallback = await readMediaSourceSafe(id)
          if (fallback) return fallback
          throw error
        }
        // File might have been moved/deleted.
        logger.warn('Failed to get file from handle; trying workspace fallback:', error)
        const fallback = await readMediaSourceSafe(id)
        if (fallback) return fallback
        throw new FileAccessError(
          `File "${media.fileName}" not found. It may have been moved or deleted.`,
          'file_missing',
        )
      }
    }

    // OPFS storage (origin-scoped).
    if (media.opfsPath) {
      try {
        const blob = await opfsService.getFileBlob(media.opfsPath)
        const normalized =
          blob.type === media.mimeType || !media.mimeType
            ? blob
            : new Blob([blob], { type: media.mimeType })
        mirrorSourceToWorkspaceInBackground(id, normalized, media.fileName)
        return normalized
      } catch (error) {
        logger.warn(
          'Failed to get OPFS media as file blob, falling back to ArrayBuffer read:',
          error,
        )
        try {
          const arrayBuffer = await opfsService.getFile(media.opfsPath)
          const blob = new Blob([arrayBuffer], { type: media.mimeType })
          mirrorSourceToWorkspaceInBackground(id, blob, media.fileName)
          return blob
        } catch (fallbackError) {
          logger.warn('OPFS read failed; trying workspace fallback:', fallbackError)
          const fallback = await readMediaSourceSafe(id)
          if (fallback) return fallback
          logger.error('Failed to get media file from OPFS:', fallbackError)
          return null
        }
      }
    }

    // Cross-origin path: the record was authored on a different origin, so
    // neither the handle nor OPFS is populated here — but the workspace
    // folder is shared by every origin that picked it. Try that last.
    const workspaceSource = await readMediaSourceSafe(id)
    if (workspaceSource) return workspaceSource

    logger.error('Media has no valid storage path:', id)
    return null
  }

  /**
   * Check if a file handle needs permission re-request
   * Returns true if permission is needed, false if already granted or not a handle
   */
  async needsPermission(id: string): Promise<boolean> {
    const media = await getMediaDB(id)
    if (!media || media.storageType !== 'handle' || !media.fileHandle) {
      return false
    }

    try {
      const permission = await media.fileHandle.queryPermission({ mode: 'read' })
      return permission !== 'granted'
    } catch {
      return true // Error means we likely need permission
    }
  }

  /**
   * Request permission for a file handle
   * Returns true if granted, false otherwise
   */
  async requestPermission(id: string): Promise<boolean> {
    const media = await getMediaDB(id)
    if (!media || media.storageType !== 'handle' || !media.fileHandle) {
      return true // Not a handle, no permission needed
    }

    return ensureFileHandlePermission(media.fileHandle)
  }

  /**
   * Get all media items that need permission re-request
   */
  async getMediaNeedingPermission(): Promise<MediaMetadata[]> {
    const allMedia = await getAllMediaDB()
    const needsPermission: MediaMetadata[] = []

    for (const media of allMedia) {
      if (media.storageType === 'handle' && media.fileHandle) {
        try {
          const permission = await media.fileHandle.queryPermission({ mode: 'read' })
          if (permission !== 'granted') {
            needsPermission.push(media)
          }
        } catch {
          needsPermission.push(media)
        }
      }
    }

    return needsPermission
  }

  /**
   * Relink a media item with a new file handle
   *
   * Updates the file handle for a media item that has become inaccessible
   * (file moved, renamed, or deleted). Only updates the handle and basic
   * file info - does not re-extract metadata or regenerate thumbnails.
   *
   * @param mediaId - The media ID to relink
   * @param newHandle - The new FileSystemFileHandle
   * @returns Updated MediaMetadata
   * @throws FileAccessError if permission denied or file inaccessible
   */
  async relinkMediaHandle(
    mediaId: string,
    newHandle: FileSystemFileHandle,
  ): Promise<MediaMetadata> {
    // Get existing media
    const media = await getMediaDB(mediaId)
    if (!media) {
      throw new Error(`Media not found: ${mediaId}`)
    }

    // Verify we have permission to access the new file
    const hasPermission = await ensureFileHandlePermission(newHandle)
    if (!hasPermission) {
      throw new FileAccessError('Permission denied for the selected file', 'permission_denied')
    }

    // Verify file exists and get basic info
    const file = await newHandle.getFile()

    // Update metadata with new handle and file info
    const updated = await updateMediaDB(mediaId, {
      fileHandle: newHandle,
      fileName: file.name,
      fileSize: file.size,
      fileLastModified: file.lastModified,
      updatedAt: Date.now(),
    })

    return updated
  }

  /**
   * Update AI-generated captions for a media item.
   *
   * Captions live in `cache/ai/captions.json` as the authoritative source.
   * We also mirror them onto `MediaMetadata.aiCaptions` so in-memory zustand
   * consumers and search (`media-library-store.ts`) don't need a separate
   * hydration pass — the mirror stays consistent because this is the only
   * writer.
   */
  async updateMediaCaptions(
    mediaId: string,
    captions: NonNullable<MediaMetadata['aiCaptions']>,
    options?: {
      service?: string
      model?: string
      sampleIntervalSec?: number
      embeddingModel?: string
      embeddingDim?: number
      imageEmbeddingModel?: string
      imageEmbeddingDim?: number
      /**
       * When provided, the captions envelope and heavy assets are mirrored
       * into the shared content-addressable cache so other mediaIds with the
       * same source bytes skip re-analysis.
       */
      contentHash?: string
    },
  ): Promise<MediaMetadata> {
    const existingEnvelope = await readAiOutput(mediaId, 'captions').catch(() => undefined)
    const existingSampleInterval = (() => {
      const fromData = existingEnvelope?.data.sampleIntervalSec
      if (typeof fromData === 'number') return fromData
      const fromParams = (existingEnvelope?.params as { sampleIntervalSec?: unknown } | undefined)
        ?.sampleIntervalSec
      return typeof fromParams === 'number' ? fromParams : undefined
    })()

    const resolvedOptions = {
      service: options?.service ?? existingEnvelope?.service ?? 'lfm-captioning',
      model: options?.model ?? existingEnvelope?.model ?? 'lfm-2.5-vl',
      sampleIntervalSec: options?.sampleIntervalSec ?? existingSampleInterval,
      embeddingModel: options?.embeddingModel ?? existingEnvelope?.data.embeddingModel,
      embeddingDim: options?.embeddingDim ?? existingEnvelope?.data.embeddingDim,
      imageEmbeddingModel:
        options?.imageEmbeddingModel ?? existingEnvelope?.data.imageEmbeddingModel,
      imageEmbeddingDim: options?.imageEmbeddingDim ?? existingEnvelope?.data.imageEmbeddingDim,
      contentHash: options?.contentHash ?? existingEnvelope?.data.contentHash,
    }

    try {
      await saveCaptions({
        mediaId,
        captions,
        service: resolvedOptions.service,
        model: resolvedOptions.model,
        sampleIntervalSec: resolvedOptions.sampleIntervalSec,
        embeddingModel: resolvedOptions.embeddingModel,
        embeddingDim: resolvedOptions.embeddingDim,
        imageEmbeddingModel: resolvedOptions.imageEmbeddingModel,
        imageEmbeddingDim: resolvedOptions.imageEmbeddingDim,
        contentHash: resolvedOptions.contentHash,
      })
    } catch (error) {
      logger.warn(
        `Failed to persist captions for ${mediaId}; metadata mirror will still update`,
        error,
      )
    }
    return updateMediaDB(mediaId, { aiCaptions: captions })
  }

  /**
   * Get media file as blob URL (for preview/playback)
   */
  async getMediaBlobUrl(id: string): Promise<string | null> {
    const file = await this.getMediaFile(id)

    if (!file) {
      return null
    }

    return URL.createObjectURL(file)
  }

  /**
   * Get thumbnail for a media item
   */
  async getThumbnail(mediaId: string): Promise<ThumbnailData | null> {
    const thumbnail = await getThumbnailByMediaId(mediaId)
    return thumbnail || null
  }

  /**
   * Get thumbnail as blob URL (cached in memory to prevent flicker)
   */
  async getThumbnailBlobUrl(mediaId: string): Promise<string | null> {
    // Check cache first
    const cached = this.thumbnailUrlCache.get(mediaId)
    if (cached) {
      return cached
    }

    const thumbnail = await this.getThumbnail(mediaId)

    if (!thumbnail) {
      return null
    }

    const url = URL.createObjectURL(thumbnail.blob)
    this.thumbnailUrlCache.set(mediaId, url)
    return url
  }

  /**
   * Clear thumbnail URL from cache (call when media is deleted)
   */
  clearThumbnailCache(mediaId: string): void {
    const url = this.thumbnailUrlCache.get(mediaId)
    if (url) {
      URL.revokeObjectURL(url)
      this.thumbnailUrlCache.delete(mediaId)
    }
  }

  /**
   * Validate sync between OPFS and workspace-backed metadata
   * Returns list of issues found
   *
   * Note: Only validates OPFS-based media. Handle-based media is validated
   * separately via permission checks.
   */
  async validateSync(): Promise<{
    orphanedMetadata: string[] // Metadata without OPFS file
    orphanedFiles: string[] // OPFS files without metadata
  }> {
    const allMedia = await getAllMediaDB()
    const orphanedMetadata: string[] = []
    const orphanedFiles: string[] = []

    // Check each OPFS-based metadata entry has corresponding OPFS file
    for (const media of allMedia) {
      // Only check OPFS storage type
      if (media.storageType === 'opfs' && media.opfsPath) {
        try {
          await opfsService.getFile(media.opfsPath)
        } catch {
          // File not found in OPFS
          orphanedMetadata.push(media.id)
        }
      }
      // Handle-based storage is checked via needsPermission() instead
    }

    // Note: Checking for orphaned OPFS files would require listing all
    // files in OPFS and cross-referencing with metadata, which is expensive.
    // Can be implemented if needed.

    return { orphanedMetadata, orphanedFiles }
  }

  /**
   * Repair sync issues
   */
  async repairSync(): Promise<{ cleaned: number }> {
    const { orphanedMetadata } = await this.validateSync()

    // Clean up orphaned metadata
    for (const id of orphanedMetadata) {
      try {
        const media = await getMediaDB(id)
        await this.deleteThumbnailsSafely(id)
        if (media) {
          await deletePreviewAudioConform(media, { clearMetadata: false })
        }
        await deleteMediaDB(id)
      } catch (error) {
        logger.error(`Failed to cleanup orphaned metadata ${id}:`, error)
      }
    }

    return { cleaned: orphanedMetadata.length }
  }
}

// Singleton instance
export const mediaLibraryService = new MediaLibraryService()
