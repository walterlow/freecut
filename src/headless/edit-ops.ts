/**
 * Headless edit op handlers.
 *
 * One handler per op kind, dispatched by name from applyOp below. Each body is
 * the previous applyOp switch case, unchanged: the handler validates its op
 * fields, resolves or creates the target through the real timeline stores, and
 * calls the real timeline action. The dispatch table is what keeps applyOp a
 * lookup instead of a 111-branch chain.
 */
import type { MediaMetadata } from '@/types/storage'
import type { TimelineItem, VideoItem, AudioItem, ImageItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import type { AnimatableProperty, EasingType } from '@/types/keyframe'
import type { VisualEffect } from '@/types/effects'
import type { TransformProperties } from '@/types/transform'

import { useTransitionsStore } from '@/features/timeline/stores/transitions-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { createClassicTrack } from '@/features/timeline/utils/classic-tracks'
import { getGpuEffect } from '@/infrastructure/gpu-effects'
import {
  addItem,
  updateItem,
  moveItem,
  removeItems,
  splitItem,
  trimItemStart,
  trimItemEnd,
  addTransition,
  updateTransition,
  removeTransition,
  setTransformParent,
  addKeyframes,
  setTracks,
  addKeyframe,
  removeKeyframesForProperty,
  addEffect,
  removeEffect,
  updateItemTransform,
} from '@/features/timeline/stores/timeline-actions'
import {
  type EditOp,
  type EditOperationName,
  asNumber,
  asString,
  assertTransitionUpdateApplied,
  buildTextItem,
  getEditCanvas,
  getOrCreateTrack,
  newId,
  resolveOrCreateTrack,
  requireItem,
  requireTrack,
  requireTransition,
  sourceFieldsFor,
  tracks,
} from './edit-op-support'

function applyAddText(op: EditOp): unknown {
  const item = buildTextItem(op)
  addItem(item)
  return { id: item.id }
}

function applyAddItem(op: EditOp): unknown {
  const item = op.item as TimelineItem | undefined
  if (!item || typeof item !== 'object') throw new Error('addItem requires `item`')
  const withId: TimelineItem = { ...item, id: item.id || newId() }
  requireTrack(withId.trackId, 'item.trackId')
  addItem(withId)
  return { id: withId.id }
}

function applyUpdateItem(op: EditOp): unknown {
  const id = asString(op.id)
  if (!id) throw new Error('updateItem requires `id`')
  requireItem(id)
  const updates = (op.updates ?? {}) as Partial<TimelineItem>
  if (updates.trackId) requireTrack(updates.trackId, 'updates.trackId')
  updateItem(id, updates)
  return { id }
}

function applyMoveItem(op: EditOp): unknown {
  const id = asString(op.id)
  const from = asNumber(op.from)
  if (!id || from === undefined) throw new Error('moveItem requires `id` and `from`')
  requireItem(id)
  const destination = asString(op.trackId)
  if (destination) requireTrack(destination)
  moveItem(id, from, destination)
  return { id, from }
}

function applyRemoveItems(op: EditOp): unknown {
  const ids = Array.isArray(op.ids) ? (op.ids.filter((x) => typeof x === 'string') as string[]) : []
  if (ids.length === 0) throw new Error('removeItems requires non-empty `ids`')
  for (const id of ids) requireItem(id, 'ids')
  removeItems(ids)
  return { removed: ids }
}

function applySplit(op: EditOp): unknown {
  const id = asString(op.id)
  const frame = asNumber(op.frame)
  if (!id || frame === undefined) throw new Error('split requires `id` and `frame`')
  requireItem(id)
  const result = splitItem(id, frame)
  if (!result) throw new Error(`split failed for item ${id} at frame ${frame}`)
  return { leftId: result.leftItem.id, rightId: result.rightItem.id }
}

function applyTrimStart(op: EditOp): unknown {
  const id = asString(op.id)
  const amount = asNumber(op.amount)
  if (!id || amount === undefined) throw new Error('trimStart requires `id` and `amount`')
  requireItem(id)
  trimItemStart(id, amount)
  return { id }
}

function applyTrimEnd(op: EditOp): unknown {
  const id = asString(op.id)
  const amount = asNumber(op.amount)
  if (!id || amount === undefined) throw new Error('trimEnd requires `id` and `amount`')
  requireItem(id)
  trimItemEnd(id, amount)
  return { id }
}

/** Apply addTransition's optional `timing` / `properties` overrides to the new transition. */
function applyTransitionOverrides(transitionId: string, op: EditOp): void {
  if (op.timing === undefined && op.properties === undefined) return
  updateTransition(transitionId, {
    ...(op.timing !== undefined ? { timing: asString(op.timing) as Transition['timing'] } : {}),
    ...(op.properties !== undefined
      ? { properties: op.properties as Transition['properties'] }
      : {}),
  })
}

function applyAddTransition(op: EditOp): unknown {
  const left = asString(op.leftClipId)
  const right = asString(op.rightClipId)
  if (!left || !right) throw new Error('addTransition requires `leftClipId` and `rightClipId`')
  requireItem(left, 'leftClipId')
  requireItem(right, 'rightClipId')
  const added = addTransition(
    left,
    right,
    asString(op.type) as Parameters<typeof addTransition>[2],
    asNumber(op.durationInFrames),
    asString(op.presentation) as Parameters<typeof addTransition>[4],
    asString(op.direction) as Parameters<typeof addTransition>[5],
    asNumber(op.alignment) ?? 0.5,
  )
  if (!added) throw new Error(`addTransition failed for clips "${left}" and "${right}"`)
  const created = useTransitionsStore
    .getState()
    .transitions.filter((t) => t.leftClipId === left && t.rightClipId === right)
    .at(-1)
  if (created) applyTransitionOverrides(created.id, op)
  return { added, id: created?.id, presentation: created?.presentation }
}

function applyUpdateTransition(op: EditOp): unknown {
  const id = asString(op.id)
  if (!id) throw new Error('updateTransition requires `id`')
  requireTransition(id)
  const updates: Parameters<typeof updateTransition>[1] = {
    ...(op.durationInFrames !== undefined
      ? { durationInFrames: asNumber(op.durationInFrames) }
      : {}),
    ...(op.presentation !== undefined
      ? { presentation: asString(op.presentation) as Transition['presentation'] }
      : {}),
    ...(op.direction !== undefined
      ? { direction: asString(op.direction) as Transition['direction'] }
      : {}),
    ...(op.timing !== undefined ? { timing: asString(op.timing) as Transition['timing'] } : {}),
    ...(op.alignment !== undefined ? { alignment: asNumber(op.alignment) } : {}),
    ...(op.properties !== undefined
      ? { properties: op.properties as Transition['properties'] }
      : {}),
  }
  if (Object.keys(updates).length === 0)
    throw new Error('updateTransition requires at least one field to change')
  updateTransition(id, updates)
  // The store action validates handles for duration/alignment and, when the
  // requested value doesn't fit, logs a warning and leaves the transition
  // untouched — it returns void, so the rejection is invisible from here.
  // Verify against the resulting state so a rejected edit fails loudly
  // instead of reporting ok with the old value still in place.
  assertTransitionUpdateApplied(id, updates)
  return { id }
}

function applyRemoveTransition(op: EditOp): unknown {
  const id = asString(op.id)
  if (!id) throw new Error('removeTransition requires `id`')
  requireTransition(id)
  removeTransition(id)
  return { id }
}

function applyAddTrack(op: EditOp): unknown {
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

/** One entry of addClip's `created` detail. */
type CreatedClip = { id: string; type: string }

/** Everything an addClip placement needs, resolved once by applyAddClip. */
interface ClipPlacement {
  mediaId: string
  media: MediaMetadata
  from: number
  projectFps: number
}

/** Place an `image/` clip: a still on a video track. */
function placeImageClip(op: EditOp, { mediaId, media, from }: ClipPlacement): CreatedClip[] {
  const item: ImageItem = {
    id: newId(),
    type: 'image',
    trackId: resolveOrCreateTrack(op.trackId, 'video'),
    from,
    durationInFrames: asNumber(op.durationInFrames, 150)!,
    label: media.fileName ?? mediaId,
    mediaId,
    src: '',
    ...(media.width ? { sourceWidth: media.width } : {}),
    ...(media.height ? { sourceHeight: media.height } : {}),
  }
  addItem(item)
  return [{ id: item.id, type: 'image' }]
}

/** Place an `audio/` clip on an audio track. */
function placeAudioClip(
  op: EditOp,
  { mediaId, media, from, projectFps }: ClipPlacement,
): CreatedClip[] {
  const sf = sourceFieldsFor(media, projectFps)
  const item: AudioItem = {
    id: newId(),
    type: 'audio',
    trackId: resolveOrCreateTrack(op.trackId, 'audio'),
    from,
    durationInFrames:
      asNumber(op.durationInFrames) ?? Math.max(1, Math.round((media.duration ?? 0) * projectFps)),
    label: media.fileName ?? mediaId,
    mediaId,
    src: '',
    volume: 0,
    ...sf,
  }
  addItem(item)
  return [{ id: item.id, type: 'audio' }]
}

/** Place a `video/` clip plus the linked audio companion the app creates on import. */
function placeVideoClip(
  op: EditOp,
  { mediaId, media, from, projectFps }: ClipPlacement,
): CreatedClip[] {
  const sf = sourceFieldsFor(media, projectFps)
  const durationInFrames =
    asNumber(op.durationInFrames) ?? Math.max(1, Math.round((media.duration ?? 0) * projectFps))
  const label = media.fileName ?? mediaId
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
  const created: CreatedClip[] = [{ id: video.id, type: 'video' }]
  // Linked audio companion (as the app creates on import) so audio renders.
  if (!media.audioCodec) return created
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
  return created
}

function applyAddClip(op: EditOp): unknown {
  const mediaId = asString(op.mediaId)
  if (!mediaId) throw new Error('addClip requires `mediaId`')
  const media = useMediaLibraryStore.getState().mediaById[mediaId]
  if (!media) {
    throw new Error(`addClip: no metadata for media ${mediaId} (pass it via the CLI's media list)`)
  }
  const placement: ClipPlacement = {
    mediaId,
    media,
    from: asNumber(op.from, 0)!,
    projectFps: useTimelineSettingsStore.getState().fps || 30,
  }
  if (media.mimeType.startsWith('image/')) return { created: placeImageClip(op, placement) }
  if (media.mimeType.startsWith('audio/')) return { created: placeAudioClip(op, placement) }
  if (media.mimeType.startsWith('video/')) return { created: placeVideoClip(op, placement) }
  throw new Error(`addClip: unsupported media mimeType ${media.mimeType}`)
}

function applyAddKeyframe(op: EditOp): unknown {
  const itemId = asString(op.itemId)
  const property = asString(op.property)
  const frame = asNumber(op.frame)
  const value = asNumber(op.value)
  if (!itemId || !property || frame === undefined || value === undefined) {
    throw new Error('addKeyframe requires `itemId`, `property`, `frame`, `value`')
  }
  requireItem(itemId, 'itemId')
  const easing = asString(op.easing) as EasingType | undefined
  // easingConfig (e.g. custom spring tension/friction/mass) goes through the
  // batch action — the scalar addKeyframe action does not accept it.
  const keyframeId = op.easingConfig
    ? (addKeyframes([
        {
          itemId,
          property: property as AnimatableProperty,
          frame,
          value,
          easing,
          easingConfig: op.easingConfig as Parameters<
            typeof addKeyframes
          >[0][number]['easingConfig'],
        },
      ])[0] ?? '')
    : addKeyframe(itemId, property as AnimatableProperty, frame, value, easing)
  if (!keyframeId) throw new Error(`addKeyframe failed (item ${itemId} @ frame ${frame})`)
  return { keyframeId }
}

/** Resolve setTransformParent's target: `undefined` detaches, a string attaches to that item. */
function resolveTransformParent(op: EditOp): string | undefined {
  if (op.parentItemId === null) return undefined
  const parentItemId = asString(op.parentItemId)
  if (!parentItemId) {
    throw new Error(
      'setTransformParent requires `parentItemId` (item id to attach, null to detach)',
    )
  }
  requireItem(parentItemId, 'parentItemId')
  return parentItemId
}

function applySetTransformParent(op: EditOp): unknown {
  const id = asString(op.id)
  if (!id) throw new Error('setTransformParent requires `id`')
  const child = requireItem(id)
  const parentItemId = resolveTransformParent(op)
  const ok = setTransformParent({
    childItemId: id,
    ...(parentItemId ? { parentItemId } : {}),
    behavior: asString(op.behavior) as Parameters<typeof setTransformParent>[0]['behavior'],
    frame: asNumber(op.frame) ?? child.from,
    canvas: getEditCanvas(),
  })
  if (!ok) {
    throw new Error(
      `setTransformParent failed for "${id}"${parentItemId ? ` -> "${parentItemId}"` : ' (detach)'}`,
    )
  }
  return { id, parentItemId: parentItemId ?? null }
}

function applyRemoveKeyframes(op: EditOp): unknown {
  const itemId = asString(op.itemId)
  const property = asString(op.property)
  if (!itemId || !property) throw new Error('removeKeyframes requires `itemId` and `property`')
  requireItem(itemId, 'itemId')
  removeKeyframesForProperty(itemId, property as AnimatableProperty)
  return { itemId, property }
}

function applyAddEffect(op: EditOp): unknown {
  const itemId = asString(op.itemId)
  if (!itemId) throw new Error('addEffect requires `itemId`')
  requireItem(itemId, 'itemId')
  const effect =
    op.effect && typeof op.effect === 'object'
      ? op.effect
      : op.gpuEffectType
        ? { type: 'gpu-effect', gpuEffectType: op.gpuEffectType, params: op.params ?? {} }
        : null
  if (!effect) throw new Error('addEffect requires `effect` or `gpuEffectType`')
  const gpuEffectType = (effect as { gpuEffectType?: unknown }).gpuEffectType
  if (typeof gpuEffectType !== 'string' || !getGpuEffect(gpuEffectType)) {
    throw new Error(`gpuEffectType: unknown GPU effect "${String(gpuEffectType)}"`)
  }
  addEffect(itemId, effect as VisualEffect)
  return { itemId }
}

function applyRemoveEffect(op: EditOp): unknown {
  const itemId = asString(op.itemId)
  const effectId = asString(op.effectId)
  if (!itemId || !effectId) throw new Error('removeEffect requires `itemId` and `effectId`')
  const item = requireItem(itemId, 'itemId')
  if (!item.effects?.some((candidate) => candidate.id === effectId)) {
    throw new Error(`effectId: effect "${effectId}" does not exist on item "${itemId}"`)
  }
  removeEffect(itemId, effectId)
  return { itemId, effectId }
}

function applySetTransform(op: EditOp): unknown {
  const id = asString(op.id)
  if (!id || !op.transform || typeof op.transform !== 'object') {
    throw new Error('setTransform requires `id` and `transform`')
  }
  requireItem(id)
  updateItemTransform(id, op.transform as Partial<TransformProperties>)
  return { id }
}

const OP_HANDLERS: Record<EditOperationName, (op: EditOp) => unknown> = {
  addText: applyAddText,
  addItem: applyAddItem,
  updateItem: applyUpdateItem,
  moveItem: applyMoveItem,
  removeItems: applyRemoveItems,
  split: applySplit,
  trimStart: applyTrimStart,
  trimEnd: applyTrimEnd,
  addTransition: applyAddTransition,
  updateTransition: applyUpdateTransition,
  removeTransition: applyRemoveTransition,
  addTrack: applyAddTrack,
  addClip: applyAddClip,
  addKeyframe: applyAddKeyframe,
  setTransformParent: applySetTransformParent,
  removeKeyframes: applyRemoveKeyframes,
  addEffect: applyAddEffect,
  removeEffect: applyRemoveEffect,
  setTransform: applySetTransform,
}

/** Apply a single op by driving the real timeline action modules. Throws on bad input. */
export function applyOp(op: EditOp): unknown {
  const handler = OP_HANDLERS[op.op]
  if (!handler) throw new Error(`Unknown edit op: ${String(op.op)}`)
  return handler(op)
}
