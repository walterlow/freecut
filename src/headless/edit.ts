/**
 * Headless programmatic editing.
 *
 * Hydrates the real timeline domain stores from a Project, applies a list of
 * edit ops by driving the REAL timeline action modules (so transition repair,
 * track ordering, split-id rebinding, undo bookkeeping etc. all behave exactly
 * like the editor), then serializes the stores back to a Project. No workspace
 * storage layer is required.
 */
import type { Project } from '@/types/project'
import type { MediaMetadata } from '@/types/storage'

import { createLogger } from '@/shared/logging/logger'
import { migrateProject } from '@/shared/projects/migrations'
import {
  hydrateTimelineStoresFromProject,
  buildTimelineFromStores,
} from '@/features/timeline/stores/timeline-persistence'
import { useEditorStore } from '@/shared/state/editor'
import { seedMediaLibrary } from './seed-media'
import { applyOp } from './edit-ops'
import { type EditOp, type EditOperationName, asString, setEditCanvas } from './edit-op-support'

const log = createLogger('HeadlessEdit')

export interface HeadlessEditInput {
  project: Project
  ops: EditOp[]
  /** MediaMetadata for any media referenced by ops (e.g. addClip), keyed for codec/fps/duration lookups. */
  media?: Array<{ mediaId: string; metadata?: MediaMetadata }>
}

export interface HeadlessEditResult {
  ok: true
  /** The edited project (timeline rebuilt from stores). The driver writes this to disk. */
  project: Project
  applied: number
  results: Array<{ callerId?: string; op: string; ok: boolean; detail?: unknown; error?: string }>
}

function resolvePointer(value: unknown, pointer: string): unknown {
  if (!pointer.startsWith('/')) throw new Error(`Invalid result JSON pointer "${pointer}"`)
  let current = value
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (current === null || typeof current !== 'object' || !(key in current)) {
      throw new Error(`Result reference pointer not found: ${pointer}`)
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

const REFERENCE_ID_FIELDS = new Set([
  'id',
  'itemId',
  'trackId',
  'leftClipId',
  'rightClipId',
  'effectId',
  'mediaId',
])

function resolveOperationRefs(
  op: EditOp,
  prior: Map<string, HeadlessEditResult['results'][number]>,
): EditOp {
  const visit = (value: unknown, field?: string): unknown => {
    if (value && typeof value === 'object' && !Array.isArray(value) && '$ref' in value) {
      if (!field || !REFERENCE_ID_FIELDS.has(field))
        throw new Error(`$ref is not allowed in field "${field ?? '$'}"`)
      const ref = (value as { $ref?: unknown }).$ref
      if (typeof ref !== 'string') throw new Error('$ref must be a string')
      const match = /^([A-Za-z][A-Za-z0-9_-]{0,63})#(\/.*)$/.exec(ref)
      if (!match) throw new Error(`Invalid result reference: ${ref}`)
      const result = prior.get(match[1]!)
      if (!result?.ok)
        throw new Error(`Result reference is not a prior successful operation: ${match[1]}`)
      const resolved = resolvePointer(result, match[2]!)
      if (typeof resolved !== 'string')
        throw new Error(`Result reference must resolve to an id string: ${ref}`)
      return resolved
    }
    if (Array.isArray(value))
      return value.map((entry) => visit(entry, field === 'ids' ? 'id' : field))
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, visit(entry, key)]),
      )
    }
    return value
  }
  return visit(op) as EditOp
}

const LINKED_SENSITIVE_OPERATIONS = new Set<EditOperationName>([
  'removeItems',
  'split',
  'trimStart',
  'trimEnd',
])

function applyOpWithLinkedOverride(op: EditOp): unknown {
  if (!LINKED_SENSITIVE_OPERATIONS.has(op.op) || typeof op.linked !== 'boolean') {
    return applyOp(op)
  }

  const previous = useEditorStore.getState().linkedSelectionEnabled
  useEditorStore.getState().setLinkedSelectionEnabled(op.linked)
  try {
    return applyOp(op)
  } finally {
    useEditorStore.getState().setLinkedSelectionEnabled(previous)
  }
}

/** Apply one op, record its result (success or failure), and rethrow on failure. */
function applyOpTracked(
  rawOp: EditOp,
  prior: Map<string, HeadlessEditResult['results'][number]>,
  results: HeadlessEditResult['results'],
): void {
  const callerId = asString(rawOp.callerId)
  const op = resolveOperationRefs(rawOp, prior)
  try {
    const detail = applyOpWithLinkedOverride(op)
    const result = { ...(callerId ? { callerId } : {}), op: op.op, ok: true as const, detail }
    results.push(result)
    if (callerId) prior.set(callerId, result)
  } catch (error) {
    results.push({
      ...(callerId ? { callerId } : {}),
      op: op.op,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
    throw new Error(
      `Edit op "${op.op}" failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export async function editProject(input: HeadlessEditInput): Promise<HeadlessEditResult> {
  const { project: migrated } = migrateProject(input.project)
  setEditCanvas({
    width: migrated.metadata?.width ?? 1920,
    height: migrated.metadata?.height ?? 1080,
    fps: migrated.metadata?.fps ?? 30,
  })
  await hydrateTimelineStoresFromProject(migrated)
  seedMediaLibrary(input.media)

  log.info('Headless edit starting', { ops: input.ops.length })

  const results: HeadlessEditResult['results'] = []
  const prior = new Map<string, HeadlessEditResult['results'][number]>()
  const callerIds = input.ops.map((op) => asString(op.callerId)).filter(Boolean) as string[]
  if (new Set(callerIds).size !== callerIds.length) throw new Error('Duplicate edit callerId')
  for (const rawOp of input.ops) applyOpTracked(rawOp, prior, results)

  const timeline = buildTimelineFromStores()
  log.info('Headless edit complete', { applied: results.length })

  return {
    ok: true,
    project: { ...migrated, timeline },
    applied: results.length,
    results,
  }
}
