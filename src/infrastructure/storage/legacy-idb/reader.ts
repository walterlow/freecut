/**
 * Read-only access to the legacy `video-editor-db` IndexedDB database.
 *
 * Used exclusively by `migrate-from-idb.ts` to pull projects, media,
 * thumbnails, etc. into the workspace folder on first run. Everything
 * else in the app reads and writes through `workspace-fs` directly.
 *
 * Design notes:
 * - `openDB(DB_NAME)` is called with no version, so it opens at the
 *   database's current version without triggering a schema upgrade.
 *   Users on older DB versions still get partial data migrated (guarded
 *   by `objectStoreNames.contains` checks on each read).
 * - If the DB doesn't exist at all, idb creates it empty — `getAllProjects`
 *   returns `[]`, `hasLegacyData` returns false, and migration is a no-op.
 * - Everything here is additive-read: we never mutate the legacy DB
 *   except via the explicit `deleteLegacyDB()` path.
 */

import { openDB, type IDBPDatabase } from 'idb'
import { createLogger } from '@/shared/logging/logger'
import type { Project } from '@/types/project'
import type {
  MediaMetadata,
  ThumbnailData,
  ProjectMediaAssociation,
  WaveformRecord,
  GifFrameData,
  DecodedPreviewAudio,
  MediaTranscript,
} from '@/types/storage'

const logger = createLogger('LegacyIDBReader')

const LEGACY_DB_NAME = 'video-editor-db'

let dbPromise: Promise<IDBPDatabase> | null = null

async function getLegacyDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    // Open without a version so idb uses the existing version and skips
    // schema upgrades. Reads are guarded by `objectStoreNames.contains`.
    dbPromise = openDB(LEGACY_DB_NAME)
  }
  return dbPromise
}

async function readAll<T>(storeName: string): Promise<T[]> {
  try {
    const db = await getLegacyDB()
    if (!db.objectStoreNames.contains(storeName)) return []
    return (await db.getAll(storeName)) as T[]
  } catch (error) {
    logger.warn(`readAll(${storeName}) failed`, error)
    return []
  }
}

async function readOne<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  try {
    const db = await getLegacyDB()
    if (!db.objectStoreNames.contains(storeName)) return undefined
    return (await db.get(storeName, key)) as T | undefined
  } catch (error) {
    logger.warn(`readOne(${storeName}, ${String(key)}) failed`, error)
    return undefined
  }
}

export async function readAllProjects(): Promise<Project[]> {
  return readAll<Project>('projects')
}

export async function readAllMedia(): Promise<MediaMetadata[]> {
  return readAll<MediaMetadata>('media')
}

export async function readAllProjectMedia(): Promise<ProjectMediaAssociation[]> {
  return readAll<ProjectMediaAssociation>('projectMedia')
}

export async function readAllWaveforms(): Promise<WaveformRecord[]> {
  return readAll<WaveformRecord>('waveforms')
}

export async function readAllDecodedPreviewAudio(): Promise<DecodedPreviewAudio[]> {
  return readAll<DecodedPreviewAudio>('decodedPreviewAudio')
}

export async function readThumbnailByMediaId(mediaId: string): Promise<ThumbnailData | undefined> {
  try {
    const db = await getLegacyDB()
    if (!db.objectStoreNames.contains('thumbnails')) return undefined
    const tx = db.transaction('thumbnails', 'readonly')
    const index = tx.store.index('mediaId')
    const thumbnails = (await index.getAll(mediaId)) as ThumbnailData[]
    return thumbnails[0]
  } catch (error) {
    logger.warn(`readThumbnailByMediaId(${mediaId}) failed`, error)
    return undefined
  }
}

export async function readGifFrames(mediaId: string): Promise<GifFrameData | undefined> {
  return readOne<GifFrameData>('gifFrames', mediaId)
}

export async function readTranscript(mediaId: string): Promise<MediaTranscript | undefined> {
  return readOne<MediaTranscript>('transcripts', mediaId)
}

/**
 * Close the cached connection and permanently delete the legacy database.
 * Intended only for user-confirmed cleanup after a successful migration.
 */
export async function closeAndDeleteLegacyDB(): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise
      db.close()
    } catch {
      // Ignore close errors — delete proceeds regardless.
    }
    dbPromise = null
  }

  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(LEGACY_DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => {
      logger.warn('Legacy IDB delete blocked — close other tabs of this app.')
    }
  })
}
