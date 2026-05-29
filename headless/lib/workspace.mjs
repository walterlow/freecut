// Read a FreeCut workspace folder from disk (plain fs, no File System Access
// API). Locates a project's JSON and maps the media it references to source
// files on disk, mirroring workspace-fs's `media/{id}/{filename}` layout.
import fs from 'node:fs'
import path from 'node:path'

// Files in media/{id}/ that are NOT the source blob (mirrors
// NON_SOURCE_NAMES in workspace-fs/media-source.ts).
const NON_SOURCE_NAMES = new Set([
  'metadata.json',
  'thumbnail.jpg',
  'thumbnail.meta.json',
  'source.link.json',
  'cache',
])

const MEDIA_ITEM_TYPES = new Set(['video', 'audio', 'image'])

/** Load + parse a project. Accepts a project id (under the workspace) or a direct project.json path. */
export function loadProject(workspaceDir, projectIdOrFile) {
  let projectJsonPath
  if (projectIdOrFile.endsWith('.json')) {
    projectJsonPath = path.resolve(projectIdOrFile)
  } else {
    projectJsonPath = path.join(workspaceDir, 'projects', projectIdOrFile, 'project.json')
  }
  if (!fs.existsSync(projectJsonPath)) {
    throw new Error(`Project file not found: ${projectJsonPath}`)
  }
  const project = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'))
  return { project, projectJsonPath }
}

/** List all projects in a workspace as { id, name, updatedAt }. */
export function listProjects(workspaceDir) {
  const projectsDir = path.join(workspaceDir, 'projects')
  if (!fs.existsSync(projectsDir)) return []
  const out = []
  for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const jsonPath = path.join(projectsDir, entry.name, 'project.json')
    if (!fs.existsSync(jsonPath)) continue
    try {
      const p = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
      out.push({ id: p.id ?? entry.name, name: p.name ?? '(unnamed)', updatedAt: p.updatedAt ?? 0 })
    } catch {
      // skip unreadable project
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * Collect media ids referenced by the project's timeline.
 *
 * When `range` ({ inFrame, outFrame } in project frames) is given, only media
 * for top-level items overlapping the range is collected — and for a
 * composition (compound clip) item that overlaps, all media inside its
 * sub-composition. This avoids fetching media that a sliced render never
 * touches (e.g. a multi-hour clip far outside the range).
 */
export function collectMediaIds(project, range = null) {
  const timeline = project.timeline
  if (!timeline) return []

  const ids = new Set()
  const compsById = new Map((timeline.compositions ?? []).map((c) => [c.id, c]))

  const overlaps = (item) => {
    if (!range) return true
    const start = item.from ?? 0
    const end = start + (item.durationInFrames ?? 0)
    const lo = range.inFrame ?? 0
    const hi = range.outFrame ?? Number.POSITIVE_INFINITY
    return end > lo && start < hi
  }

  // Recurse into a sub-composition, collecting its media and following nested
  // composition items (compound clips can reference other compound clips).
  const expandComp = (compId, visited) => {
    if (!compId || visited.has(compId)) return
    visited.add(compId)
    const comp = compsById.get(compId)
    for (const sub of comp?.items ?? []) {
      if (sub.mediaId && MEDIA_ITEM_TYPES.has(sub.type)) ids.add(sub.mediaId)
      if (sub.type === 'composition' && sub.compositionId) expandComp(sub.compositionId, visited)
    }
  }

  for (const item of timeline.items ?? []) {
    if (!overlaps(item)) continue
    if (item.mediaId && MEDIA_ITEM_TYPES.has(item.type)) ids.add(item.mediaId)
    if (item.type === 'composition' && item.compositionId) {
      expandComp(item.compositionId, new Set())
    }
  }
  return [...ids]
}

/** Read a media's MediaMetadata (media/{id}/metadata.json), or null if absent/unreadable. */
export function readMediaMetadata(workspaceDir, mediaId) {
  const metaPath = path.join(workspaceDir, 'media', mediaId, 'metadata.json')
  if (!fs.existsSync(metaPath)) return null
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  } catch {
    return null
  }
}

/** Collect `{ mediaId, metadata }` for media referenced by addClip ops (deduped). */
export function collectAddClipMedia(workspaceDir, ops) {
  const ids = [...new Set(ops.filter((o) => o.op === 'addClip' && o.mediaId).map((o) => o.mediaId))]
  return ids.map((mediaId) => ({ mediaId, metadata: readMediaMetadata(workspaceDir, mediaId) ?? undefined }))
}

/** Resolve a media id to its source file path under media/{id}/ (first non-reserved file). */
export function resolveMediaFile(workspaceDir, mediaId) {
  const mediaDir = path.join(workspaceDir, 'media', mediaId)
  if (!fs.existsSync(mediaDir)) return null
  for (const entry of fs.readdirSync(mediaDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    if (NON_SOURCE_NAMES.has(entry.name)) continue
    return path.join(mediaDir, entry.name)
  }
  return null
}

/**
 * Resolve media ids to absolute source-file paths.
 * @returns {{ files: Map<string,string>, missing: string[] }}
 */
export function resolveMediaFiles(workspaceDir, mediaIds) {
  const files = new Map()
  const missing = []
  for (const mediaId of mediaIds) {
    const filePath = resolveMediaFile(workspaceDir, mediaId)
    if (filePath) files.set(mediaId, filePath)
    else missing.push(mediaId)
  }
  return { files, missing }
}
