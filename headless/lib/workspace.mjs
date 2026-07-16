// Read a FreeCut workspace folder from disk (plain fs, no File System Access
// API). Locates a project's JSON and maps the media it references to source
// files on disk, mirroring workspace-fs's `media/{id}/{filename}` layout.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { assertSinglePathComponent, HttpError, resolveContained } from './http-security.mjs'

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

function readProject(projectJsonPath) {
  if (!fs.existsSync(projectJsonPath)) {
    throw new Error(`Project file not found: ${projectJsonPath}`)
  }
  const project = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'))
  return { project, projectJsonPath }
}

/** CLI-only direct file loader. Direct paths must never be accepted by the HTTP service. */
export function loadProjectFile(projectFile) {
  return readProject(path.resolve(projectFile))
}

/** Workspace-scoped loader for HTTP/API project ids. */
export function loadProjectById(workspaceDir, projectId) {
  assertSinglePathComponent(projectId, 'project id')
  const projectsDir = path.join(workspaceDir, 'projects')
  const projectJsonPath = resolveContained(projectsDir, path.join(projectId, 'project.json'))
  if (!fs.existsSync(projectJsonPath))
    throw new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found')
  return readProject(projectJsonPath)
}

/** Backward-compatible CLI loader: id under workspace or an explicit JSON file. */
export function loadProject(workspaceDir, projectIdOrFile) {
  return projectIdOrFile.endsWith('.json')
    ? loadProjectFile(projectIdOrFile)
    : loadProjectById(workspaceDir, projectIdOrFile)
}

/** List projects using the actionable directory name as id; projectId is the JSON's internal id. */
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
      out.push({
        id: entry.name,
        projectId: p.id ?? entry.name,
        name: p.name ?? '(unnamed)',
        updatedAt: p.updatedAt ?? 0,
      })
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
  assertSinglePathComponent(mediaId, 'media id')
  const metaPath = resolveContained(
    path.join(workspaceDir, 'media'),
    path.join(mediaId, 'metadata.json'),
  )
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
  return ids.map((mediaId) => ({
    mediaId,
    metadata: readMediaMetadata(workspaceDir, mediaId) ?? undefined,
  }))
}

/** Resolve a media id to its source file path under media/{id}/ (first non-reserved file). */
export function resolveMediaFile(workspaceDir, mediaId) {
  assertSinglePathComponent(mediaId, 'media id')
  const mediaRoot = path.join(workspaceDir, 'media')
  const mediaDir = resolveContained(mediaRoot, mediaId)
  if (!fs.existsSync(mediaDir)) return null
  for (const entry of fs.readdirSync(mediaDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    if (NON_SOURCE_NAMES.has(entry.name)) continue
    return resolveContained(mediaRoot, path.join(mediaId, entry.name))
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

/** Atomically replace a JSON file using a sibling temporary file. */
function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`)
    fs.renameSync(temporary, filePath)
  } finally {
    fs.rmSync(temporary, { force: true })
  }
}

function readJsonOr(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function collectTimelineMediaIds(project) {
  const ids = new Set()
  const collect = (items) => {
    for (const item of items ?? []) {
      if (item.mediaId && MEDIA_ITEM_TYPES.has(item.type)) ids.add(item.mediaId)
    }
  }
  collect(project.timeline?.items)
  for (const composition of project.timeline?.compositions ?? []) collect(composition.items)
  return ids
}

function mediaLinksPath(workspaceDir, projectId) {
  assertSinglePathComponent(projectId, 'project id')
  return resolveContained(
    path.join(workspaceDir, 'projects'),
    path.join(projectId, 'media-links.json'),
  )
}

/** Ensure media referenced by the timeline also appears in media-links.json. */
export function reconcileProjectMediaLinks(workspaceDir, project, projectDirectoryId = project.id) {
  const linksPath = mediaLinksPath(workspaceDir, projectDirectoryId)
  const links = readJsonOr(linksPath, { version: '1.0', mediaIds: [] })
  const existing = new Set(
    Array.isArray(links.mediaIds) ? links.mediaIds.map((entry) => entry?.id).filter(Boolean) : [],
  )
  let changed = false
  for (const mediaId of collectTimelineMediaIds(project)) {
    if (existing.has(mediaId)) continue
    links.mediaIds.push({ id: mediaId, addedAt: Date.now() })
    existing.add(mediaId)
    changed = true
  }
  if (changed || !fs.existsSync(linksPath)) writeJsonAtomic(linksPath, links)
  return [...existing]
}

/** Upsert the lightweight project entry used by FreeCut's project list. */
function upsertWorkspaceIndex(workspaceDir, project, projectDirectoryId = project.id) {
  const indexPath = path.join(workspaceDir, 'index.json')
  const index = readJsonOr(indexPath, { version: '1.0', updatedAt: 0, projects: [] })
  const entry = {
    id: projectDirectoryId,
    projectId: project.id,
    name: project.name ?? '(unnamed)',
    updatedAt: project.updatedAt,
  }
  const projects = Array.isArray(index.projects) ? index.projects : []
  const next = projects.some((candidate) => candidate?.id === projectDirectoryId)
    ? projects.map((candidate) => (candidate?.id === projectDirectoryId ? entry : candidate))
    : [...projects, entry]
  next.sort((left, right) => (right?.updatedAt ?? 0) - (left?.updatedAt ?? 0))
  writeJsonAtomic(indexPath, {
    version: typeof index.version === 'string' ? index.version : '1.0',
    updatedAt: Date.now(),
    projects: next,
  })
}

/** Persist a Headless edit and repair the derived workspace files it affects. */
export function persistEditedProject(workspaceDir, projectJsonPath, editedProject) {
  const project = { ...editedProject, updatedAt: Date.now() }
  writeJsonAtomic(projectJsonPath, project)
  const projectsRoot = path.resolve(workspaceDir, 'projects')
  const projectDirectory = path.dirname(path.resolve(projectJsonPath))
  const relativeDirectory = path.relative(projectsRoot, projectDirectory)
  const isWorkspaceProject =
    relativeDirectory !== '' &&
    !relativeDirectory.startsWith('..') &&
    !path.isAbsolute(relativeDirectory) &&
    !relativeDirectory.includes(path.sep)
  if (isWorkspaceProject) {
    reconcileProjectMediaLinks(workspaceDir, project, relativeDirectory)
    upsertWorkspaceIndex(workspaceDir, project, relativeDirectory)
  }
  return project
}

function statFingerprint(filePath) {
  try {
    const value = fs.statSync(filePath)
    return `${value.size}:${Math.trunc(value.mtimeMs)}`
  } catch {
    return 'missing'
  }
}

function readProjectMediaIds(workspaceDir, project, projectDirectoryId = project.id) {
  const links = readJsonOr(mediaLinksPath(workspaceDir, projectDirectoryId), { mediaIds: [] })
  const ids = new Set(
    Array.isArray(links.mediaIds) ? links.mediaIds.map((entry) => entry?.id).filter(Boolean) : [],
  )
  for (const mediaId of collectTimelineMediaIds(project)) ids.add(mediaId)
  return [...ids]
}

function findMediaThumbnail(workspaceDir, mediaId) {
  assertSinglePathComponent(mediaId, 'media id')
  const thumbnail = resolveContained(
    path.join(workspaceDir, 'media'),
    path.join(mediaId, 'thumbnail.jpg'),
  )
  return fs.existsSync(thumbnail) ? thumbnail : null
}

/** Build the coherent project+media snapshot consumed by a live editor. */
export function buildProjectSnapshot(workspaceDir, projectId) {
  const { project, projectJsonPath } = loadProjectById(workspaceDir, projectId)
  const mediaIds = readProjectMediaIds(workspaceDir, project, projectId)
  const media = []
  const missingMediaIds = []
  const fingerprints = []

  for (const mediaId of mediaIds) {
    const metadataPath = resolveContained(
      path.join(workspaceDir, 'media'),
      path.join(mediaId, 'metadata.json'),
    )
    const metadata = readMediaMetadata(workspaceDir, mediaId)
    if (!metadata) {
      missingMediaIds.push(mediaId)
      fingerprints.push(`${mediaId}:missing`)
      continue
    }
    const sourcePath = resolveMediaFile(workspaceDir, mediaId)
    const thumbnailPath = findMediaThumbnail(workspaceDir, mediaId)
    const metadataFingerprint = statFingerprint(metadataPath)
    const sourceFingerprint = sourcePath ? statFingerprint(sourcePath) : 'missing-source'
    const thumbnailFingerprint = thumbnailPath
      ? statFingerprint(thumbnailPath)
      : 'missing-thumbnail'
    const fingerprint = [metadataFingerprint, sourceFingerprint, thumbnailFingerprint].join('|')
    media.push({
      metadata,
      fingerprint,
      metadataFingerprint,
      sourceFingerprint,
      thumbnailFingerprint,
    })
    fingerprints.push(`${mediaId}:${fingerprint}`)
  }

  const projectText = fs.readFileSync(projectJsonPath, 'utf8')
  const linksPath = mediaLinksPath(workspaceDir, projectId)
  const linksText = fs.existsSync(linksPath) ? fs.readFileSync(linksPath, 'utf8') : ''
  const revision = `sha256:${crypto
    .createHash('sha256')
    .update(projectText)
    .update('\0')
    .update(linksText)
    .update('\0')
    .update(fingerprints.sort().join('\n'))
    .digest('hex')}`

  return { revision, project, media, missingMediaIds }
}

export function listProjectIdsUsingMedia(workspaceDir, mediaId) {
  return listProjects(workspaceDir)
    .map((project) => project.id)
    .filter((projectId) => {
      try {
        const { project } = loadProjectById(workspaceDir, projectId)
        return readProjectMediaIds(workspaceDir, project, projectId).includes(mediaId)
      } catch {
        return false
      }
    })
}
