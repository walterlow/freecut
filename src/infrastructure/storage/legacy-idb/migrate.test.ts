/**
 * End-to-end migration test: seeds a fake legacy `video-editor-db`,
 * runs `migrateFromLegacyIDB()`, and asserts the workspace folder
 * contains the migrated records.
 *
 * This exercises every reader → writer mapping at once, locking in the
 * migration contract. Uses hand-rolled fakes for both `idb.openDB` and the
 * workspace FileSystem handle so nothing touches real IDB/OPFS.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { Project } from '@/types/project'
import type {
  MediaMetadata,
  MediaTranscript,
  ProjectMediaAssociation,
  ThumbnailData,
  GifFrameData,
} from '@/types/storage'

/* ───────────────────────── idb mock ─────────────────────────
 * Hand-rolled openDB fake that satisfies the narrow surface the
 * reader uses: objectStoreNames.contains, getAll, get, transaction
 * + index.getAll, and close. Also stubs the global `indexedDB`
 * delete path so deleteLegacyIDB resolves cleanly. */

type Store = Map<unknown, unknown>

const legacyStores: Record<string, Store> = vi.hoisted(() => ({}))

function resetStores() {
  for (const key of Object.keys(legacyStores)) {
    delete legacyStores[key]
  }
}

function seedStore<T = unknown>(name: string): Map<unknown, T> {
  const store = new Map<unknown, T>()
  legacyStores[name] = store as Store
  return store
}

vi.mock('idb', () => {
  const openDB = vi.fn(async () => {
    const getStore = (name: string) => legacyStores[name]
    return {
      objectStoreNames: {
        contains: (name: string) => name in legacyStores,
      },
      getAll: async (storeName: string) => {
        const s = getStore(storeName)
        return s ? [...s.values()] : []
      },
      get: async (storeName: string, key: unknown) => {
        const s = getStore(storeName)
        return s ? s.get(key) : undefined
      },
      transaction: (storeName: string) => {
        const s = getStore(storeName) ?? new Map()
        return {
          store: {
            index: (indexKey: string) => ({
              getAll: async (value: unknown) =>
                [...s.values()].filter(
                  (record) => (record as Record<string, unknown>)[indexKey] === value,
                ),
            }),
          },
        }
      },
      close: () => undefined,
    }
  })
  return { openDB }
})

// indexedDB.deleteDatabase is used only by closeAndDeleteLegacyDB.
type IDBRequestLike = {
  onsuccess: ((ev: Event) => void) | null
  onerror: ((ev: Event) => void) | null
}
const deleteDatabase = vi.fn(() => {
  const req: IDBRequestLike = { onsuccess: null, onerror: null }
  queueMicrotask(() => {
    req.onsuccess?.(new Event('success'))
  })
  return req as unknown as IDBOpenDBRequest
})

/* ───────────────────────── workspace-fs mocks ───────────────── */

const handlesMocks = vi.hoisted(() => ({
  getHandle: vi.fn().mockResolvedValue(null),
  saveHandle: vi.fn().mockResolvedValue(undefined),
  deleteHandle: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/infrastructure/storage/handles-db', () => handlesMocks)

vi.mock('@/shared/logging/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    event: vi.fn(),
    startEvent: () => ({
      set: vi.fn(),
      merge: vi.fn(),
      success: vi.fn(),
      failure: vi.fn(),
    }),
    child: vi.fn(),
    setLevel: vi.fn(),
  }),
  createOperationId: () => 'op-test',
}))

import { deleteLegacyIDB, getMigrationStatus, hasLegacyData, migrateFromLegacyIDB } from './migrate'
import { getProject } from '@/infrastructure/storage/workspace-fs/projects'
import { getMedia } from '@/infrastructure/storage/workspace-fs/media'
import { getThumbnailByMediaId } from '@/infrastructure/storage/workspace-fs/thumbnails'
import { getTranscript } from '@/infrastructure/storage/workspace-fs/transcripts'
import { getProjectMediaIds } from '@/infrastructure/storage/workspace-fs/project-media'
import { getGifFrames } from '@/infrastructure/storage/workspace-fs/gif-frames'
import { setWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import {
  asHandle,
  createRoot,
  readFileText,
  type MemDir,
} from '@/infrastructure/storage/workspace-fs/__tests__/in-memory-handle'

/* ───────────────────────── fixtures ─────────────────────────── */

function makeProject(id: string): Project {
  return {
    id,
    name: `Project ${id}`,
    description: '',
    duration: 0,
    metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000' },
    createdAt: 1000,
    updatedAt: 2000,
  } as Project
}

function makeMedia(id: string): MediaMetadata {
  return {
    id,
    storageType: 'opfs',
    fileName: `${id}.mp4`,
    fileSize: 1024,
    mimeType: 'video/mp4',
    duration: 10,
    width: 1920,
    height: 1080,
    createdAt: 1000,
  } as unknown as MediaMetadata
}

function makeThumbnail(mediaId: string): ThumbnailData {
  return {
    id: `thumb-${mediaId}`,
    mediaId,
    blob: new Blob(['thumb-bytes'], { type: 'image/jpeg' }),
    timestamp: 1,
    width: 320,
    height: 180,
  }
}

function makeTranscript(mediaId: string): MediaTranscript {
  return {
    id: mediaId,
    mediaId,
    model: 'whisper-base',
    language: 'en',
    quantization: 'q8',
    text: 'hello world',
    segments: [{ text: 'hello world', start: 0, end: 1 }],
    createdAt: 1000,
    updatedAt: 2000,
  }
}

function makeGifFrames(mediaId: string): GifFrameData {
  return {
    id: mediaId,
    mediaId,
    frames: [new Blob(['f0'], { type: 'image/png' })],
    durations: [40],
    totalDuration: 40,
    width: 100,
    height: 100,
    frameCount: 1,
    createdAt: 1000,
  }
}

function makeAssociation(projectId: string, mediaId: string): ProjectMediaAssociation {
  return { projectId, mediaId, addedAt: 1000 }
}

/* ───────────────────────── test harness ─────────────────────── */

let root: MemDir
const originalIndexedDB = (globalThis as { indexedDB?: IDBFactory }).indexedDB

beforeEach(() => {
  resetStores()
  handlesMocks.getHandle.mockReset().mockResolvedValue(null)
  handlesMocks.saveHandle.mockReset().mockResolvedValue(undefined)
  handlesMocks.deleteHandle.mockReset().mockResolvedValue(undefined)
  deleteDatabase.mockClear()
  root = createRoot()
  setWorkspaceRoot(asHandle(root))
  ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = {
    deleteDatabase,
  } as unknown as IDBFactory
})

afterEach(() => {
  setWorkspaceRoot(null)
  ;(globalThis as { indexedDB?: IDBFactory | undefined }).indexedDB = originalIndexedDB
})

/* ───────────────────────── tests ────────────────────────────── */

describe('legacy-idb migration round trip', () => {
  it('hasLegacyData returns false when the legacy projects store is empty', async () => {
    seedStore('projects')
    await expect(hasLegacyData()).resolves.toBe(false)
  })

  it('hasLegacyData returns true when projects exist', async () => {
    seedStore('projects').set('p1', makeProject('p1'))
    await expect(hasLegacyData()).resolves.toBe(true)
  })

  it('migrates projects, media, thumbnails, transcripts, gif frames, and associations', async () => {
    seedStore('projects').set('p1', makeProject('p1'))
    seedStore('media').set('m1', makeMedia('m1'))
    seedStore('thumbnails').set('thumb-m1', makeThumbnail('m1'))
    seedStore('transcripts').set('m1', makeTranscript('m1'))
    seedStore('gifFrames').set('m1', makeGifFrames('m1'))
    seedStore('projectMedia').set(['p1', 'm1'], makeAssociation('p1', 'm1'))

    const report = await migrateFromLegacyIDB()

    expect(report.projects).toBe(1)
    expect(report.media).toBe(1)
    expect(report.thumbnails).toBe(1)
    expect(report.transcripts).toBe(1)
    expect(report.gifFrames).toBe(1)
    expect(report.associations).toBe(1)
    expect(report.errors).toEqual([])

    // Project lands in workspace and is retrievable via the workspace-fs API.
    const migratedProject = await getProject('p1')
    expect(migratedProject?.id).toBe('p1')
    expect(migratedProject?.name).toBe('Project p1')

    const migratedMedia = await getMedia('m1')
    expect(migratedMedia?.id).toBe('m1')
    expect(migratedMedia?.fileName).toBe('m1.mp4')

    const migratedThumb = await getThumbnailByMediaId('m1')
    expect(migratedThumb?.mediaId).toBe('m1')

    const migratedTranscript = await getTranscript('m1')
    expect(migratedTranscript?.text).toBe('hello world')

    const migratedGifFrames = await getGifFrames('m1')
    expect(migratedGifFrames?.frameCount).toBe(1)

    const mediaForProject = await getProjectMediaIds('p1')
    expect(mediaForProject).toEqual(['m1'])
  })

  it('writes a migration marker that getMigrationStatus can read', async () => {
    seedStore('projects').set('p1', makeProject('p1'))

    await migrateFromLegacyIDB()
    const status = await getMigrationStatus()
    expect(status.migrated).toBe(true)
    expect(typeof status.at).toBe('number')

    // Marker is stored in the workspace root at .freecut-workspace.json.
    const markerText = await readFileText(root, '.freecut-workspace.json')
    expect(markerText).not.toBeNull()
    const marker = JSON.parse(markerText!)
    expect(marker.migratedFromLegacyAt).toBe(status.at)
  })

  it('skips stores that do not exist in the legacy DB', async () => {
    // Only seed projects; everything else is absent.
    seedStore('projects').set('p1', makeProject('p1'))

    const report = await migrateFromLegacyIDB()
    expect(report.projects).toBe(1)
    expect(report.media).toBe(0)
    expect(report.thumbnails).toBe(0)
    expect(report.transcripts).toBe(0)
    expect(report.associations).toBe(0)
    expect(report.errors).toEqual([])
  })

  it('re-running the migration collects duplicate-id errors without crashing', async () => {
    seedStore('projects').set('p1', makeProject('p1'))
    await migrateFromLegacyIDB()

    const second = await migrateFromLegacyIDB()
    // Project already exists in workspace; the second attempt surfaces as
    // a recorded error rather than a thrown failure.
    expect(second.projects).toBe(0)
    expect(second.errors.length).toBeGreaterThan(0)
    expect(second.errors[0]?.store).toBe('projects')
  })

  it('deleteLegacyIDB invokes indexedDB.deleteDatabase', async () => {
    await deleteLegacyIDB()
    expect(deleteDatabase).toHaveBeenCalledWith('video-editor-db')
  })

  it('reports progress monotonically and ends at processed === total', async () => {
    seedStore('projects').set('p1', makeProject('p1'))
    seedStore('projects').set('p2', makeProject('p2'))
    seedStore('media').set('m1', makeMedia('m1'))
    seedStore('thumbnails').set('thumb-m1', makeThumbnail('m1'))
    seedStore('projectMedia').set(['p1', 'm1'], makeAssociation('p1', 'm1'))

    const events: Array<{ phase: string; processed: number; total: number }> = []
    await migrateFromLegacyIDB({
      onProgress: (p) => {
        events.push({
          phase: p.phase,
          processed: p.processed,
          total: p.total,
        })
      },
    })

    // Non-empty + monotonic (processed never decreases, total is constant).
    expect(events.length).toBeGreaterThan(0)
    const total = events[0]!.total
    expect(total).toBeGreaterThan(0)
    let lastProcessed = -1
    for (const event of events) {
      expect(event.total).toBe(total)
      expect(event.processed).toBeGreaterThanOrEqual(lastProcessed)
      lastProcessed = event.processed
    }

    // The last per-work-unit tick should land at processed === total. A
    // trailing 'finalizing' event may come after at the same processed
    // value.
    const lastWorkTick = [...events].reverse().find((e) => e.phase !== 'finalizing')
    expect(lastWorkTick?.processed).toBe(total)
  })

  it('emits a finalizing phase event after all writes complete', async () => {
    seedStore('projects').set('p1', makeProject('p1'))

    const phases: string[] = []
    await migrateFromLegacyIDB({
      onProgress: (p) => phases.push(p.phase),
    })

    expect(phases[phases.length - 1]).toBe('finalizing')
  })

  it('runs to completion when no legacy data is present (total === 0)', async () => {
    const events: Array<{ processed: number; total: number }> = []
    const report = await migrateFromLegacyIDB({
      onProgress: (p) => events.push({ processed: p.processed, total: p.total }),
    })

    expect(report.projects).toBe(0)
    expect(events.every((e) => e.total === 0)).toBe(true)
  })

  it('continues the migration when the progress callback throws', async () => {
    seedStore('projects').set('p1', makeProject('p1'))

    const report = await migrateFromLegacyIDB({
      onProgress: () => {
        throw new Error('UI blew up')
      },
    })

    expect(report.projects).toBe(1)
    expect(report.errors).toEqual([])
  })
})
