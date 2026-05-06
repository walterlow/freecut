/**
 * Pre-extracted GIF frames backed by the workspace folder.
 *
 *   media/{mediaId}/cache/gif-frames/meta.json      ← record minus frames
 *   media/{mediaId}/cache/gif-frames/frame-{N}.png  ← per-frame binary
 *
 * Binary frames let you inspect/replace them with normal tools. Saving
 * writes all frames in parallel; reading pulls them back as Blobs.
 */

import type { GifFrameData } from '@/types/storage'
import { createLogger } from '@/shared/logging/logger'

import { requireWorkspaceRoot } from './root'
import {
  listDirectory,
  readBlob,
  readJson,
  removeEntry,
  writeBlob,
  writeJsonAtomic,
} from './fs-primitives'
import { cacheMetaPath, gifFramePath, gifFramesDir, MEDIA_DIR, mediaDir } from './paths'
import { blobToArrayBuffer } from './blob-utils'

const logger = createLogger('WorkspaceFS:GifFrames')

type GifFramesMeta = Omit<GifFrameData, 'frames'>

export async function saveGifFrames(data: GifFrameData): Promise<void> {
  const root = requireWorkspaceRoot()
  try {
    const meta: GifFramesMeta = {
      id: data.id,
      mediaId: data.mediaId,
      durations: data.durations,
      totalDuration: data.totalDuration,
      width: data.width,
      height: data.height,
      frameCount: data.frameCount,
      createdAt: data.createdAt,
    }
    await writeJsonAtomic(root, cacheMetaPath(gifFramesDir(data.mediaId)), meta)
    await Promise.all(
      data.frames.map(async (frame, i) => {
        const bytes = new Uint8Array(await blobToArrayBuffer(frame))
        await writeBlob(root, gifFramePath(data.mediaId, i), bytes)
      }),
    )
  } catch (error) {
    logger.error('saveGifFrames failed', error)
    throw new Error('Failed to save GIF frames')
  }
}

export async function getGifFrames(id: string): Promise<GifFrameData | undefined> {
  const root = requireWorkspaceRoot()
  try {
    const meta = await readJson<GifFramesMeta>(root, cacheMetaPath(gifFramesDir(id)))
    if (!meta) return undefined
    const frames: Blob[] = []
    for (let i = 0; i < meta.frameCount; i++) {
      const blob = await readBlob(root, gifFramePath(id, i))
      if (!blob) return undefined
      frames.push(blob)
    }
    return { ...meta, frames }
  } catch (error) {
    logger.error(`getGifFrames(${id}) failed`, error)
    return undefined
  }
}

export async function deleteGifFrames(id: string): Promise<void> {
  const root = requireWorkspaceRoot()
  try {
    await removeEntry(root, gifFramesDir(id), { recursive: true })
  } catch (error) {
    logger.error(`deleteGifFrames(${id}) failed`, error)
    throw new Error(`Failed to delete GIF frames: ${id}`)
  }
}

export async function clearAllGifFrames(): Promise<void> {
  const root = requireWorkspaceRoot()
  try {
    const mediaDirs = await listDirectory(root, [MEDIA_DIR])
    for (const entry of mediaDirs) {
      if (entry.kind !== 'directory') continue
      await removeEntry(root, [...mediaDir(entry.name), 'cache', 'gif-frames'], {
        recursive: true,
      })
    }
  } catch (error) {
    logger.error('clearAllGifFrames failed', error)
    throw new Error('Failed to clear GIF frames')
  }
}
