import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import {
  buildDroppedCompositionTimelineItems,
  buildDroppedMediaTimelineItems,
  createTimelineTemplateItem,
  getDroppedMediaDurationInFrames,
  isTimelineTemplateDragData,
  type DroppedMediaEntry,
} from '@/features/editor/deps/timeline-motion'
import { resolveMediaUrl } from '@/features/editor/deps/media-library-contract'
import { LAYER_ROW_HEIGHT } from './motion-timeline-primitives'

/** A layer a drop adds to the Motion timeline: one item on its own new track. */
export interface MotionDroppedLayer {
  item: TimelineItem
  track: TimelineTrack
}

/** Canvas and rate a dropped layer is authored against. */
export interface MotionDropCanvas {
  width: number
  height: number
  fps: number
}

type DroppedComposition = Parameters<typeof buildDroppedCompositionTimelineItems>[0]['composition']

/** One layer track: Motion row height, unlocked, visible, not yet populated. */
function createLayerTrack(params: {
  id: string
  name: string
  kind: 'video' | 'audio'
  order: number
}): TimelineTrack {
  return {
    id: params.id,
    name: params.name,
    kind: params.kind,
    height: LAYER_ROW_HEIGHT,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    order: params.order,
    items: [],
  }
}

/**
 * The payload a Motion drop carries: the serialized JSON the drag attached when
 * it has one, else the in-memory media drag. Anything that is not a record —
 * including JSON that failed to parse — is `null`, which the caller treats as
 * "nothing to add" rather than as an unsupported drop.
 */
export function resolveMotionDropPayload(
  rawJson: string,
  mediaDragPayload: unknown,
): Record<string, unknown> | null {
  let payload: unknown = mediaDragPayload
  if (rawJson) {
    try {
      payload = JSON.parse(rawJson)
    } catch {
      payload = null
    }
  }
  if (!payload || typeof payload !== 'object') return null
  return payload as Record<string, unknown>
}

/** The dragged composition's id, when the drop is a composition. */
export function resolveCompositionDropId(payload: Record<string, unknown>): string | null {
  const { type, compositionId } = payload
  return type === 'composition' && typeof compositionId === 'string' ? compositionId : null
}

/** The frame a drop lands on: the playhead, clamped inside the composition. */
export function resolveMotionDropFrame(input: {
  currentFrame: number
  compositionEndFrame: number | null
  durationInFrames: number
}): number {
  const lastFrame = (input.compositionEndFrame ?? input.durationInFrames) - 1
  return Math.max(0, Math.min(lastFrame, input.currentFrame))
}

/**
 * The item and its own new track for a nested composition, placed at `from`.
 *
 * Returns `null` when the drop cannot produce a composition item; the caller
 * runs the cycle check and the nest itself, so nothing is committed here.
 */
export function buildCompositionDropLayer(input: {
  composition: DroppedComposition
  tracks: readonly TimelineTrack[]
  from: number
  durationInFrames: number
}): MotionDroppedLayer | null {
  const { composition, tracks, from, durationInFrames } = input
  const trackId = crypto.randomUUID()
  const order = tracks.reduce((max, track) => Math.max(max, track.order), -1) + 1
  const track = createLayerTrack({ id: trackId, name: composition.name, kind: 'video', order })
  const [item] = buildDroppedCompositionTimelineItems({
    compositionId: composition.id,
    composition,
    label: composition.name,
    placements: [
      {
        trackId,
        from,
        durationInFrames: Math.max(
          1,
          Math.min(durationInFrames - from, composition.durationInFrames),
        ),
        mediaType: 'video',
      },
    ],
  })
  return item && item.type === 'composition' ? { item, track } : null
}

/** The text/shape template layer a drop adds, when the payload is one. */
export function buildTemplateDropLayer(input: {
  payload: Record<string, unknown>
  nextOrder: number
  dropFrame: number
  durationInFrames: number
  canvas: MotionDropCanvas
}): MotionDroppedLayer | null {
  const { payload, dropFrame, durationInFrames, canvas } = input
  if (!isTimelineTemplateDragData(payload)) return null
  const trackId = crypto.randomUUID()
  const track = createLayerTrack({
    id: trackId,
    name: payload.label,
    kind: 'video',
    order: input.nextOrder,
  })
  const item = createTimelineTemplateItem({
    template: payload,
    placement: {
      trackId,
      from: dropFrame,
      durationInFrames: Math.max(1, durationInFrames - dropFrame),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      fps: canvas.fps,
    },
  })
  return { item, track }
}

/**
 * The layers a media drop adds: one item on its own new track per resolved
 * media entry, in the order the entries arrived. An entry whose media URL
 * cannot be resolved is dropped from the result.
 */
export async function buildDroppedMediaLayers(input: {
  entries: readonly DroppedMediaEntry[]
  nextOrder: number
  dropFrame: number
  durationInFrames: number
  canvas: MotionDropCanvas
}): Promise<MotionDroppedLayer[]> {
  const { entries, nextOrder, dropFrame, durationInFrames, canvas } = input
  const resolved = await Promise.all(
    entries.map(async (entry, index) => {
      const blobUrl = await resolveMediaUrl(entry.mediaId)
      if (!blobUrl) return null
      const trackId = crypto.randomUUID()
      const track = createLayerTrack({
        id: trackId,
        name: entry.label,
        kind: entry.mediaType === 'audio' ? 'audio' : 'video',
        order: nextOrder + index,
      })
      const sourceDuration = getDroppedMediaDurationInFrames(entry.media, entry.mediaType, canvas.fps)
      const [item] = buildDroppedMediaTimelineItems({
        media: entry.media,
        mediaId: entry.mediaId,
        mediaType: entry.mediaType,
        label: entry.label,
        timelineFps: canvas.fps,
        blobUrl,
        thumbnailUrl: null,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        placement: {
          primary: {
            trackId,
            from: dropFrame,
            durationInFrames: Math.max(
              1,
              Math.min(durationInFrames - dropFrame, sourceDuration),
            ),
          },
        },
        linkVideoAudio: false,
      })
      return item ? { item, track } : null
    }),
  )
  return resolved.filter((entry): entry is MotionDroppedLayer => entry !== null)
}
