/**
 * Project ↔ media associations backed by the workspace folder.
 *
 * Forward associations per project are stored as:
 *   `projects/{projectId}/media-links.json` → { version, mediaIds: [{id, addedAt}] }
 *
 * Reverse lookups (`getProjectsUsingMedia`) are computed by scanning every
 * project's media-links.json. With O(10–100) projects this is fast enough;
 * a session-level memo keyed on workspace root handle protects hot paths.
 *
 * The barrel `@/infrastructure/storage` re-exports these; consumer
 * code doesn't change. `getMediaForProject` pulls media metadata through the
 * barrel so it follows the Phase 3 swap automatically.
 */

import type { Project } from '@/types/project'
import type { MediaMetadata } from '@/types/storage'
import { createLogger } from '@/shared/logging/logger'

import { requireWorkspaceRoot } from './root'
import { readJson, writeJsonAtomic, type WorkspaceRootInput } from './fs-primitives'
import { projectMediaLinksPath, PROJECTS_DIR } from './paths'
import { listDirectory } from './fs-primitives'
import { getProject } from './projects'
import { getMedia } from './media'
import { withKeyLock } from './with-key-lock'
import { mapWithConcurrency } from '@/shared/utils/async-utils'

/**
 * Serialize mutations of `media-links.json` per project. Without this,
 * two concurrent `associateMediaWithProject` calls on the same project
 * both read the current list, each appends its own id, and the second
 * write drops the first id on the floor.
 */
function linksLockKey(projectId: string): string {
  return `project-media-links:${projectId}`
}

const logger = createLogger('WorkspaceFS:ProjectMedia')

/** Bound on parallel metadata.json reads — mirrors media.ts's global read. */
const METADATA_READ_CONCURRENCY = 8

// Editor startup asks for project media from both the media-library hydrator
// and timeline orphan validation. Share concurrent reads so a cold open only
// walks the workspace/project metadata once.
const mediaForProjectInFlight = new Map<string, Promise<MediaMetadata[]>>()

type ProjectMediaReadResult =
  | { kind: 'ok'; media: MediaMetadata }
  | { kind: 'missing'; mediaId: string }
  | { kind: 'error'; error: unknown }

const PROJECT_MEDIA_ITEM_TYPES = new Set(['video', 'audio', 'image'])

const LINKS_VERSION = '1.0'

interface LinkEntry {
  id: string
  addedAt: number
}

interface ProjectMediaLinks {
  version: string
  mediaIds: LinkEntry[]
}

async function readLinks(root: WorkspaceRootInput, projectId: string): Promise<ProjectMediaLinks> {
  const existing = await readJson<ProjectMediaLinks>(root, projectMediaLinksPath(projectId))
  if (existing && Array.isArray(existing.mediaIds)) return existing
  return { version: LINKS_VERSION, mediaIds: [] }
}

async function writeLinks(
  root: WorkspaceRootInput,
  projectId: string,
  links: ProjectMediaLinks,
): Promise<void> {
  await writeJsonAtomic(root, projectMediaLinksPath(projectId), links)
}

function collectMediaIdsFromItems(
  items: Array<{ type: string; mediaId?: string }> | undefined,
  mediaIds: Set<string>,
): void {
  if (!items) return
  for (const item of items) {
    if (item.mediaId && PROJECT_MEDIA_ITEM_TYPES.has(item.type)) {
      mediaIds.add(item.mediaId)
    }
  }
}

/**
 * Collect media IDs referenced anywhere in a project's timeline.
 * Used to backfill associations for legacy projects that reference media
 * without explicit links.
 */
function collectProjectTimelineMediaIds(
  project: Pick<Project, 'timeline'> | null | undefined,
): string[] {
  if (!project?.timeline) return []
  const mediaIds = new Set<string>()
  collectMediaIdsFromItems(project.timeline.items, mediaIds)
  for (const composition of project.timeline.compositions ?? []) {
    collectMediaIdsFromItems(composition.items, mediaIds)
  }
  return [...mediaIds]
}

/* ────────────────────────────── Public API ───────────────────────────── */

export async function associateMediaWithProject(projectId: string, mediaId: string): Promise<void> {
  const root = requireWorkspaceRoot()
  try {
    await withKeyLock(linksLockKey(projectId), async () => {
      const links = await readLinks(root, projectId)
      if (!links.mediaIds.some((entry) => entry.id === mediaId)) {
        links.mediaIds.push({ id: mediaId, addedAt: Date.now() })
        await writeLinks(root, projectId, links)
      }
    })
  } catch (error) {
    logger.error(`associateMediaWithProject(${projectId}, ${mediaId}) failed`, error)
    throw error
  }
}

export async function removeMediaFromProject(projectId: string, mediaId: string): Promise<void> {
  const root = requireWorkspaceRoot()
  try {
    await withKeyLock(linksLockKey(projectId), async () => {
      const links = await readLinks(root, projectId)
      const next = links.mediaIds.filter((entry) => entry.id !== mediaId)
      if (next.length !== links.mediaIds.length) {
        await writeLinks(root, projectId, { version: LINKS_VERSION, mediaIds: next })
      }
    })
  } catch (error) {
    logger.error(`removeMediaFromProject(${projectId}, ${mediaId}) failed`, error)
    throw error
  }
}

export async function removeMediaBatchFromProject(
  projectId: string,
  mediaIds: string[],
): Promise<void> {
  const root = requireWorkspaceRoot()
  const targetIds = new Set(mediaIds.filter(Boolean))
  if (targetIds.size === 0) {
    return
  }

  try {
    await withKeyLock(linksLockKey(projectId), async () => {
      const links = await readLinks(root, projectId)
      const next = links.mediaIds.filter((entry) => !targetIds.has(entry.id))
      if (next.length !== links.mediaIds.length) {
        await writeLinks(root, projectId, { version: LINKS_VERSION, mediaIds: next })
      }
    })
  } catch (error) {
    logger.error(`removeMediaBatchFromProject(${projectId}) failed`, error)
    throw error
  }
}

export async function getProjectMediaIds(projectId: string): Promise<string[]> {
  const root = requireWorkspaceRoot()
  try {
    const links = await readLinks(root, projectId)
    return links.mediaIds.map((entry) => entry.id)
  } catch (error) {
    logger.error(`getProjectMediaIds(${projectId}) failed`, error)
    throw new Error(`Failed to get project media: ${projectId}`)
  }
}

export async function getProjectsUsingMedia(mediaId: string): Promise<string[]> {
  const root = requireWorkspaceRoot()
  try {
    const projectDirs = await listDirectory(root, [PROJECTS_DIR])
    const result: string[] = []
    for (const entry of projectDirs) {
      if (entry.kind !== 'directory') continue
      // Trashed projects DO count as references, on purpose: a project
      // in the trash might be restored, and Restore must bring its
      // media back with it. Without this, media exclusive to a trashed
      // project would be fully cleaned up on unrelated delete-media
      // operations, and the Restore would find broken links.
      //
      // Space reclamation happens when the trash is permanently emptied
      // (`permanentlyDeleteProject` removes the project's media-links
      // first, then `deleteMediaFromProject` runs cleanup per media —
      // at that point the project no longer shows up in this scan).
      const links = await readLinks(root, entry.name)
      if (links.mediaIds.some((link) => link.id === mediaId)) {
        result.push(entry.name)
      }
    }
    return result
  } catch (error) {
    logger.error(`getProjectsUsingMedia(${mediaId}) failed`, error)
    throw new Error(`Failed to get projects for media: ${mediaId}`)
  }
}

/**
 * Return media metadata for every media associated with (or referenced
 * from) a project. Also repairs drift:
 *  - Backfills associations for media referenced in the timeline but
 *    missing from media-links.json.
 *  - Prunes associations whose underlying media metadata is missing.
 */
async function loadMediaForProject(projectId: string): Promise<MediaMetadata[]> {
  // Ensures a workspace root is set before downstream helpers run. Throws
  // consistently at this boundary rather than deep inside getMedia/getProject.
  requireWorkspaceRoot()
  try {
    const existingIds = await getProjectMediaIds(projectId)
    const project = await getProject(projectId)
    const referenced = collectProjectTimelineMediaIds(project)

    const associated = new Set(existingIds)
    const missing = referenced.filter((id) => !associated.has(id))

    for (const mediaId of missing) {
      const media = await getMedia(mediaId)
      if (!media) continue
      await associateMediaWithProject(projectId, mediaId)
      associated.add(mediaId)
    }

    if (missing.length > 0) {
      logger.info(
        `Recovered ${missing.length} missing media association(s) for project ${projectId}`,
      )
    }

    const finalIds = [...associated]
    // Read every associated media's metadata.json concurrently. Each getMedia()
    // re-walks the FSA dir tree (`media/{id}/metadata.json`), so a serial loop
    // here cost N sequential round-trips before the grid could render. Bounded
    // concurrency keeps this off the critical path for editor open.
    //
    // The mapper never throws — it returns a discriminated result so a genuine
    // read error (`error`) is distinguishable from genuinely-absent metadata
    // (`missing`). A real read failure must fail the whole load, exactly as the
    // prior serial loop did: silently dropping the item would leave its
    // media-links.json association dangling while the clip vanishes from the
    // grid, and validation would then treat the media as missing. Only a
    // confirmed-missing metadata file is cleaned up as an orphan.
    const loaded = await mapWithConcurrency(
      finalIds,
      METADATA_READ_CONCURRENCY,
      async (mediaId): Promise<ProjectMediaReadResult> => {
        try {
          const media = await getMedia(mediaId)
          return media ? { kind: 'ok', media } : { kind: 'missing', mediaId }
        } catch (error) {
          return { kind: 'error', error }
        }
      },
    )
    const media: MediaMetadata[] = []
    const orphans: string[] = []
    for (const result of loaded) {
      // The mapper never throws, so a null slot would only come from an
      // internal mapWithConcurrency failure — surface it rather than silently
      // treating the id as resolved.
      if (!result) throw new Error(`Metadata read produced no result for project ${projectId}`)
      if (result.kind === 'error') throw result.error
      if (result.kind === 'ok') media.push(result.media)
      else orphans.push(result.mediaId)
    }

    if (orphans.length > 0) {
      logger.warn(`Cleaning up ${orphans.length} orphaned associations for project ${projectId}`)
      for (const orphanId of orphans) {
        await removeMediaFromProject(projectId, orphanId)
      }
    }

    return media
  } catch (error) {
    logger.error(`getMediaForProject(${projectId}) failed`, error)
    throw new Error(`Failed to load project media: ${projectId}`)
  }
}

export function getMediaForProject(projectId: string): Promise<MediaMetadata[]> {
  const existing = mediaForProjectInFlight.get(projectId)
  if (existing) return existing

  const load = loadMediaForProject(projectId)
  mediaForProjectInFlight.set(projectId, load)
  const clear = () => {
    if (mediaForProjectInFlight.get(projectId) === load) {
      mediaForProjectInFlight.delete(projectId)
    }
  }
  void load.then(clear, clear)
  return load
}
