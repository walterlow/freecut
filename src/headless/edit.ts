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
import type {
  TimelineItem,
  TimelineTrack,
  TextItem,
  VideoItem,
  AudioItem,
  ImageItem,
} from '@/types/timeline'
import type { MediaMetadata } from '@/types/storage'
import type { AnimatableProperty, EasingType } from '@/types/keyframe'
import type { VisualEffect } from '@/types/effects'
import type { TransformProperties } from '@/types/transform'

import { createLogger } from '@/shared/logging/logger'
import { migrateProject } from '@/shared/projects/migrations'
import {
  hydrateTimelineStoresFromProject,
  buildTimelineFromStores,
} from '@/features/timeline/stores/timeline-persistence'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { createClassicTrack } from '@/features/timeline/utils/classic-tracks'
import { seedMediaLibrary } from './seed-media'
import {
  addItem,
  updateItem,
  moveItem,
  removeItems,
  splitItem,
  trimItemStart,
  trimItemEnd,
  addTransition,
  setTracks,
  addKeyframe,
  removeKeyframesForProperty,
  addEffect,
  removeEffect,
  updateItemTransform,
} from '@/features/timeline/stores/timeline-actions'

const log = createLogger('HeadlessEdit')

/** A single edit operation. `op` selects the action; other keys are op-specific. */
export type EditOp = Record<string, unknown> & { op: string }

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
  results: Array<{ op: string; ok: boolean; detail?: unknown; error?: string }>
}

const asString = (value: unknown, fallback?: string): string | undefined =>
  typeof value === 'string' ? value : fallback
const asNumber = (value: unknown, fallback?: number): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

function tracks(): TimelineTrack[] {
  return useItemsStore.getState().tracks
}

/** Resolve a usable trackId: the requested one if it exists, else the first non-group video track. */
function resolveTrackId(preferred: unknown, kind: 'video' | 'audio' = 'video'): string {
  const all = tracks()
  const requested = asString(preferred)
  if (requested && all.some((t) => t.id === requested)) return requested
  const match = all.find((t) => !t.isGroup && (t.kind ?? 'video') === kind)
  const fallback = match ?? all.find((t) => !t.isGroup)
  if (!fallback) throw new Error('No track available to place item on (add a track first)')
  return fallback.id
}

function newId(): string {
  return crypto.randomUUID()
}

/** Find a non-group track of the given kind, or create one (video on top, audio at bottom). */
function getOrCreateTrack(kind: 'video' | 'audio'): string {
  const all = tracks()
  const existing = all.find((t) => !t.isGroup && (t.kind ?? 'video') === kind)
  if (existing) return existing.id
  const orders = all.map((t) => t.order)
  const order = kind === 'video' ? Math.min(0, ...orders) - 1 : Math.max(0, ...orders) + 1
  const track = createClassicTrack({ tracks: all, kind, order })
  setTracks([...all, track])
  return track.id
}

/** The requested track if it exists, else find-or-create one of the given kind. */
function resolveOrCreateTrack(preferred: unknown, kind: 'video' | 'audio'): string {
  const requested = asString(preferred)
  if (requested && tracks().some((t) => t.id === requested)) return requested
  return getOrCreateTrack(kind)
}

/** Source-frame fields for a media clip (source* are in source-native fps). */
function sourceFieldsFor(media: MediaMetadata, projectFps: number) {
  const sourceFps = media.fps && media.fps > 0 ? media.fps : projectFps
  const durationSec = media.duration ?? 0
  const sourceEnd = Math.max(1, Math.round(durationSec * sourceFps))
  return { sourceFps, sourceStart: 0, sourceEnd, sourceDuration: sourceEnd, speed: 1 }
}

function buildTextItem(op: EditOp): TextItem {
  return {
    id: asString(op.id) ?? newId(),
    type: 'text',
    trackId: resolveTrackId(op.trackId, 'video'),
    from: asNumber(op.from, 0)!,
    durationInFrames: asNumber(op.durationInFrames, 90)!,
    label: asString(op.label) ?? 'Text',
    text: asString(op.text) ?? 'Text',
    color: asString(op.color) ?? '#ffffff',
    fontSize: asNumber(op.fontSize, 80)!,
    ...(asString(op.fontFamily) && { fontFamily: asString(op.fontFamily) }),
    ...(op.fontWeight === 'bold' || op.fontWeight === 'semibold' || op.fontWeight === 'medium'
      ? { fontWeight: op.fontWeight }
      : {}),
    ...(op.textAlign === 'left' || op.textAlign === 'center' || op.textAlign === 'right'
      ? { textAlign: op.textAlign }
      : {}),
    ...(op.verticalAlign === 'top' || op.verticalAlign === 'middle' || op.verticalAlign === 'bottom'
      ? { verticalAlign: op.verticalAlign }
      : {}),
  }
}

/** Apply a single op by driving the real timeline action modules. Throws on bad input. */
function applyOp(op: EditOp): unknown {
  switch (op.op) {
    case 'addText': {
      const item = buildTextItem(op)
      addItem(item)
      return { id: item.id }
    }
    case 'addItem': {
      const item = op.item as TimelineItem | undefined
      if (!item || typeof item !== 'object') throw new Error('addItem requires `item`')
      const withId: TimelineItem = { ...item, id: item.id || newId() }
      addItem(withId)
      return { id: withId.id }
    }
    case 'updateItem': {
      const id = asString(op.id)
      if (!id) throw new Error('updateItem requires `id`')
      updateItem(id, (op.updates ?? {}) as Partial<TimelineItem>)
      return { id }
    }
    case 'moveItem': {
      const id = asString(op.id)
      const from = asNumber(op.from)
      if (!id || from === undefined) throw new Error('moveItem requires `id` and `from`')
      moveItem(id, from, asString(op.trackId))
      return { id, from }
    }
    case 'removeItems': {
      const ids = Array.isArray(op.ids)
        ? (op.ids.filter((x) => typeof x === 'string') as string[])
        : []
      if (ids.length === 0) throw new Error('removeItems requires non-empty `ids`')
      removeItems(ids)
      return { removed: ids }
    }
    case 'split': {
      const id = asString(op.id)
      const frame = asNumber(op.frame)
      if (!id || frame === undefined) throw new Error('split requires `id` and `frame`')
      const result = splitItem(id, frame)
      if (!result) throw new Error(`split failed for item ${id} at frame ${frame}`)
      return { leftId: result.leftItem.id, rightId: result.rightItem.id }
    }
    case 'trimStart': {
      const id = asString(op.id)
      const amount = asNumber(op.amount)
      if (!id || amount === undefined) throw new Error('trimStart requires `id` and `amount`')
      trimItemStart(id, amount)
      return { id }
    }
    case 'trimEnd': {
      const id = asString(op.id)
      const amount = asNumber(op.amount)
      if (!id || amount === undefined) throw new Error('trimEnd requires `id` and `amount`')
      trimItemEnd(id, amount)
      return { id }
    }
    case 'addTransition': {
      const left = asString(op.leftClipId)
      const right = asString(op.rightClipId)
      if (!left || !right) throw new Error('addTransition requires `leftClipId` and `rightClipId`')
      const added = addTransition(
        left,
        right,
        asString(op.type) as Parameters<typeof addTransition>[2],
        asNumber(op.durationInFrames),
      )
      return { added }
    }
    case 'addTrack': {
      const kind = op.kind === 'audio' ? 'audio' : 'video'
      const all = tracks()
      const orders = all.map((t) => t.order)
      const order =
        asNumber(op.order) ??
        (kind === 'video' ? Math.min(0, ...orders) - 1 : Math.max(0, ...orders) + 1)
      const track = createClassicTrack({ tracks: all, kind, order })
      setTracks([...all, track])
      return { trackId: track.id, name: track.name }
    }
    case 'addClip': {
      const mediaId = asString(op.mediaId)
      if (!mediaId) throw new Error('addClip requires `mediaId`')
      const media = useMediaLibraryStore.getState().mediaById[mediaId]
      if (!media) {
        throw new Error(
          `addClip: no metadata for media ${mediaId} (pass it via the CLI's media list)`,
        )
      }
      const from = asNumber(op.from, 0)!
      const projectFps = useTimelineSettingsStore.getState().fps || 30
      const created: Array<{ id: string; type: string }> = []
      const label = media.fileName ?? mediaId

      if (media.mimeType.startsWith('image/')) {
        const item: ImageItem = {
          id: newId(),
          type: 'image',
          trackId: resolveOrCreateTrack(op.trackId, 'video'),
          from,
          durationInFrames: asNumber(op.durationInFrames, 150)!,
          label,
          mediaId,
          src: '',
          ...(media.width ? { sourceWidth: media.width } : {}),
          ...(media.height ? { sourceHeight: media.height } : {}),
        }
        addItem(item)
        created.push({ id: item.id, type: 'image' })
      } else if (media.mimeType.startsWith('audio/')) {
        const sf = sourceFieldsFor(media, projectFps)
        const item: AudioItem = {
          id: newId(),
          type: 'audio',
          trackId: resolveOrCreateTrack(op.trackId, 'audio'),
          from,
          durationInFrames:
            asNumber(op.durationInFrames) ??
            Math.max(1, Math.round((media.duration ?? 0) * projectFps)),
          label,
          mediaId,
          src: '',
          volume: 0,
          ...sf,
        }
        addItem(item)
        created.push({ id: item.id, type: 'audio' })
      } else if (media.mimeType.startsWith('video/')) {
        const sf = sourceFieldsFor(media, projectFps)
        const durationInFrames =
          asNumber(op.durationInFrames) ??
          Math.max(1, Math.round((media.duration ?? 0) * projectFps))
        const linkedGroupId = crypto.randomUUID()
        const video: VideoItem = {
          id: newId(),
          type: 'video',
          trackId: resolveOrCreateTrack(op.trackId, 'video'),
          from,
          durationInFrames,
          label,
          mediaId,
          src: '',
          volume: 0,
          linkedGroupId,
          ...(media.width ? { sourceWidth: media.width } : {}),
          ...(media.height ? { sourceHeight: media.height } : {}),
          ...sf,
        }
        addItem(video)
        created.push({ id: video.id, type: 'video' })
        // Linked audio companion (as the app creates on import) so audio renders.
        if (media.audioCodec) {
          const audio: AudioItem = {
            id: newId(),
            type: 'audio',
            trackId: getOrCreateTrack('audio'),
            from,
            durationInFrames,
            label: `${label} audio`,
            mediaId,
            src: '',
            volume: 0,
            linkedGroupId,
            ...sf,
          }
          addItem(audio)
          created.push({ id: audio.id, type: 'audio' })
        }
      } else {
        throw new Error(`addClip: unsupported media mimeType ${media.mimeType}`)
      }
      return { created }
    }
    case 'addKeyframe': {
      const itemId = asString(op.itemId)
      const property = asString(op.property)
      const frame = asNumber(op.frame)
      const value = asNumber(op.value)
      if (!itemId || !property || frame === undefined || value === undefined) {
        throw new Error('addKeyframe requires `itemId`, `property`, `frame`, `value`')
      }
      const keyframeId = addKeyframe(
        itemId,
        property as AnimatableProperty,
        frame,
        value,
        asString(op.easing) as EasingType | undefined,
      )
      if (!keyframeId) throw new Error(`addKeyframe failed (item ${itemId} @ frame ${frame})`)
      return { keyframeId }
    }
    case 'removeKeyframes': {
      const itemId = asString(op.itemId)
      const property = asString(op.property)
      if (!itemId || !property) throw new Error('removeKeyframes requires `itemId` and `property`')
      removeKeyframesForProperty(itemId, property as AnimatableProperty)
      return { itemId, property }
    }
    case 'addEffect': {
      const itemId = asString(op.itemId)
      if (!itemId) throw new Error('addEffect requires `itemId`')
      const effect =
        op.effect && typeof op.effect === 'object'
          ? op.effect
          : op.gpuEffectType
            ? { type: 'gpu-effect', gpuEffectType: op.gpuEffectType, params: op.params ?? {} }
            : null
      if (!effect) throw new Error('addEffect requires `effect` or `gpuEffectType`')
      addEffect(itemId, effect as VisualEffect)
      return { itemId }
    }
    case 'removeEffect': {
      const itemId = asString(op.itemId)
      const effectId = asString(op.effectId)
      if (!itemId || !effectId) throw new Error('removeEffect requires `itemId` and `effectId`')
      removeEffect(itemId, effectId)
      return { itemId, effectId }
    }
    case 'setTransform': {
      const id = asString(op.id)
      if (!id || !op.transform || typeof op.transform !== 'object') {
        throw new Error('setTransform requires `id` and `transform`')
      }
      updateItemTransform(id, op.transform as Partial<TransformProperties>)
      return { id }
    }
    default:
      throw new Error(`Unknown edit op: ${String(op.op)}`)
  }
}

export async function editProject(input: HeadlessEditInput): Promise<HeadlessEditResult> {
  const { project: migrated } = migrateProject(input.project)
  await hydrateTimelineStoresFromProject(migrated)
  seedMediaLibrary(input.media)

  log.info('Headless edit starting', { ops: input.ops.length })

  const results: HeadlessEditResult['results'] = []
  for (const op of input.ops) {
    try {
      const detail = applyOp(op)
      results.push({ op: op.op, ok: true, detail })
    } catch (error) {
      results.push({
        op: op.op,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
      throw new Error(
        `Edit op "${op.op}" failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const timeline = buildTimelineFromStores()
  log.info('Headless edit complete', { applied: results.length })

  return {
    ok: true,
    project: { ...migrated, timeline },
    applied: results.length,
    results,
  }
}
