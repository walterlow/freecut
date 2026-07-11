/**
 * Auto camera moves for stills ("Auto Ken Burns").
 *
 * When enabled (timeline settings), every still image added to the timeline
 * receives a subtle full-clip cinematic camera move, picked from a curated
 * rotation so consecutive stills alternate zoom direction and pan heading —
 * the classic seamless documentary treatment, with zero manual keyframing.
 *
 * GIFs share the `image` item type but animate on their own, so anything
 * labeled `.gif` is left untouched.
 */

import type { AnimatableProperty } from '@/types/keyframe'
import type { CinematicDepthRole, TimelineItem } from '@/types/timeline'
import type { CanvasSettings, ResolvedTransform } from '@/types/transform'
import { useProjectStore } from '../../deps/projects'
import { getSourceDimensions, resolveTransform } from '../../deps/composition-runtime'
import {
  MOTION_PRESETS_BY_ID,
  pickAutoCameraPresetId,
  pickCinematicStoryCameraPresetId,
  pickCompoundParallaxCameraPresetId,
  pickMagnates3dCameraPresetId,
} from '../../deps/keyframes'
import type { CinematicImageMotionResult } from '../../types'
import { useSelectionStore } from '@/shared/state/selection'
import { useItemsStore } from '../items-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import type { KeyframeAddPayload } from '../keyframes-store'
import {
  addKeyframes,
  applyMotionPresetKeyframes,
  type MotionPresetClear,
} from './keyframe-actions'

/** Rotation cursor — advances per animated still so successive drops vary. */
let autoCameraCursor = 0
const CINEMATIC_CAMERA_REPLACE_PROPERTIES: AnimatableProperty[] = [
  'x',
  'y',
  'width',
  'height',
  'rotation',
]

function isStillImage(item: TimelineItem): boolean {
  return (
    item.type === 'image' &&
    item.cinematicDepthRole !== 'depth-map' &&
    !/\.gif$/i.test(item.label ?? '')
  )
}

function sortByTrackThenTime(items: TimelineItem[]): TimelineItem[] {
  const tracks = useItemsStore.getState().tracks
  const trackOrderById = new Map(tracks.map((track, index) => [track.id, track.order ?? index]))
  return [...items].sort((a, b) => {
    const trackDelta = (trackOrderById.get(a.trackId) ?? 0) - (trackOrderById.get(b.trackId) ?? 0)
    if (trackDelta !== 0) return trackDelta
    if (a.from !== b.from) return a.from - b.from
    return a.id.localeCompare(b.id)
  })
}

function currentCanvas(): CanvasSettings | null {
  const project = useProjectStore.getState().currentProject
  if (!project) return null
  return {
    width: project.metadata.width,
    height: project.metadata.height,
    fps: useTimelineSettingsStore.getState().fps,
  }
}

function depthPresetKey(item: TimelineItem): string {
  if (item.cinematicDepthSourceId) return item.cinematicDepthSourceId
  if (item.cinematicDepthRole && item.cinematicDepthRole !== 'flat') {
    return item.originId ?? item.mediaId ?? item.id
  }
  return item.id
}

function depthMotionStrength(role: CinematicDepthRole | undefined): {
  move: number
  zoom: number
  rotation: number
} {
  switch (role) {
    case 'background':
      return { move: 0.68, zoom: 0.76, rotation: 0.6 }
    case 'midground':
      return { move: 0.88, zoom: 0.92, rotation: 0.82 }
    case 'subject':
      return { move: 1.15, zoom: 1.08, rotation: 1.04 }
    case 'foreground':
      return { move: 1.28, zoom: 1.14, rotation: 1.16 }
    default:
      return { move: 1, zoom: 1, rotation: 1 }
  }
}

function anchorValueForProperty(
  anchor: ResolvedTransform,
  property: AnimatableProperty,
): number | null {
  switch (property) {
    case 'x':
      return anchor.x
    case 'y':
      return anchor.y
    case 'width':
      return anchor.width
    case 'height':
      return anchor.height
    case 'rotation':
      return anchor.rotation
    default:
      return null
  }
}

function strengthForProperty(
  strength: ReturnType<typeof depthMotionStrength>,
  property: AnimatableProperty,
): number {
  if (property === 'width' || property === 'height') return strength.zoom
  if (property === 'rotation') return strength.rotation
  return strength.move
}

function buildCameraPayloadsForItems(
  items: TimelineItem[],
  canvas: CanvasSettings,
  pickPresetId: (index: number) => keyof typeof MOTION_PRESETS_BY_ID,
): {
  payloads: KeyframeAddPayload[]
  clearProperties: MotionPresetClear[]
} {
  const payloads: KeyframeAddPayload[] = []
  const clearProperties: MotionPresetClear[] = []
  const presetIndexByDepthSource = new Map<string, number>()
  let nextPresetIndex = 0

  for (const item of items) {
    const presetKey = depthPresetKey(item)
    let presetIndex = presetIndexByDepthSource.get(presetKey)
    if (presetIndex == null) {
      presetIndex = nextPresetIndex
      presetIndexByDepthSource.set(presetKey, presetIndex)
      nextPresetIndex += 1
    }

    const preset = MOTION_PRESETS_BY_ID[pickPresetId(presetIndex)]
    const anchor = resolveTransform(item, canvas, getSourceDimensions(item))
    const built = preset.build({
      anchor,
      durationInFrames: item.durationInFrames,
      fps: canvas.fps,
      frameWidth: canvas.width,
      frameHeight: canvas.height,
    })

    for (const property of CINEMATIC_CAMERA_REPLACE_PROPERTIES) {
      clearProperties.push({ itemId: item.id, property })
    }
    const strength = depthMotionStrength(item.cinematicDepthRole)
    for (const keyframe of built) {
      const anchorValue = anchorValueForProperty(anchor, keyframe.property)
      const scaledValue =
        anchorValue == null
          ? keyframe.value
          : anchorValue +
            (keyframe.value - anchorValue) * strengthForProperty(strength, keyframe.property)
      payloads.push({ itemId: item.id, ...keyframe, value: scaledValue })
    }
  }

  return { payloads, clearProperties }
}

function applyCameraPresetSequence(
  selectedItemIds: string[] | undefined,
  pickPresetId: (index: number) => keyof typeof MOTION_PRESETS_BY_ID,
): CinematicImageMotionResult {
  const selection = selectedItemIds ?? useSelectionStore.getState().selectedItemIds
  const selectedIdSet = new Set(selection)
  const stills = sortByTrackThenTime(
    useItemsStore
      .getState()
      .items.filter((item) => selectedIdSet.has(item.id) && isStillImage(item)),
  )
  if (stills.length === 0) return { status: 'no-images', imageCount: 0, keyframeCount: 0 }

  const canvas = currentCanvas()
  if (!canvas) return { status: 'no-project', imageCount: stills.length, keyframeCount: 0 }

  const { payloads, clearProperties } = buildCameraPayloadsForItems(stills, canvas, pickPresetId)
  const keyframeIds = applyMotionPresetKeyframes(payloads, clearProperties)
  return {
    status: keyframeIds.length > 0 ? 'applied' : 'blocked',
    imageCount: stills.length,
    keyframeCount: keyframeIds.length,
  }
}

/**
 * Apply an automatic cinematic camera move to freshly added still images.
 * No-op unless the `autoCameraOnStills` timeline setting is enabled.
 */
export function applyAutoCameraToNewImageItems(items: TimelineItem[]): void {
  const { autoCameraOnStills, fps } = useTimelineSettingsStore.getState()
  if (!autoCameraOnStills) return

  const stills = items.filter(isStillImage)
  if (stills.length === 0) return

  const canvas = currentCanvas()
  if (!canvas) return
  canvas.fps = fps

  const payloads: KeyframeAddPayload[] = []
  for (const item of stills) {
    const preset = MOTION_PRESETS_BY_ID[pickAutoCameraPresetId(autoCameraCursor)]
    autoCameraCursor += 1
    const anchor = resolveTransform(item, canvas, getSourceDimensions(item))
    const built = preset.build({
      anchor,
      durationInFrames: item.durationInFrames,
      fps: canvas.fps,
      frameWidth: canvas.width,
      frameHeight: canvas.height,
    })
    for (const keyframe of built) {
      payloads.push({ itemId: item.id, ...keyframe })
    }
  }

  if (payloads.length > 0) {
    addKeyframes(payloads)
  }
}

/**
 * Replace selected still-image camera keyframes with a more dramatic
 * story-driven preset rotation. Each shot gets at least two simultaneous camera
 * axes (zoom plus pan/tilt/roll) so image-to-narration generation reads closer
 * to a cinematic motion scene than a simple slideshow.
 */
export function applyCinematicCameraToSelectedImages(
  selectedItemIds?: string[],
): CinematicImageMotionResult {
  return applyCameraPresetSequence(selectedItemIds, pickCinematicStoryCameraPresetId)
}

/**
 * Replace selected still keyframes with synchronized dolly plus pan/tilt
 * motion. Both camera actions remain active across the complete shot, while
 * separated depth layers receive progressively stronger travel.
 */
export function applyCompoundParallaxCameraToSelectedImages(
  selectedItemIds?: string[],
): CinematicImageMotionResult {
  return applyCameraPresetSequence(selectedItemIds, pickCompoundParallaxCameraPresetId)
}

/** Apply a four-axis virtual-camera move tuned for separated 2.5D documentary scenes. */
export function applyMagnates3dCameraToSelectedImages(
  selectedItemIds?: string[],
): CinematicImageMotionResult {
  return applyCameraPresetSequence(selectedItemIds, pickMagnates3dCameraPresetId)
}

/**
 * Replace selected still keyframes with restrained coverage-style motion for
 * editorial documentaries. It alternates between slow pushes and single-axis
 * pans/tilts, preserving the hard-cut rhythm used by factual films.
 */
export function applyDocumentaryCameraToSelectedImages(
  selectedItemIds?: string[],
): CinematicImageMotionResult {
  return applyCameraPresetSequence(selectedItemIds, pickAutoCameraPresetId)
}
