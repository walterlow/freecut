/**
 * Normalization Utilities
 *
 * Applied on every project load to ensure data conforms to current defaults.
 * Unlike migrations, normalization is not versioned - it always applies
 * the current expected defaults and constraints.
 *
 * Use normalization for:
 * - Applying default values for missing optional fields
 * - Clamping values to valid ranges
 * - Ensuring type consistency
 *
 * Use migrations for:
 * - Breaking schema changes
 * - Renaming fields
 * - Restructuring data
 */

import type { Project, ProjectTimeline } from '@/types/project'
import { DEFAULT_TRACK_HEIGHT, DEFAULT_FPS } from '@/shared/timeline/defaults'
import { normalizeAudioEqSettings } from '@/shared/utils/audio-eq'
import { applyOptionalClamps } from '@/shared/timeline/item-clamps'
import { sanitizeTextMotion } from './sanitize-text-motion'
import { sanitizeTextCounter } from '@/shared/typography/text-counter'
import type { ProjectWarning } from './types'

/**
 * Normalize a track to ensure all fields have valid values.
 */
function normalizeTrack(
  track: ProjectTimeline['tracks'][number],
  index: number,
): ProjectTimeline['tracks'][number] {
  const normalizedVolume = track.volume
  const normalizedKind = track.kind === 'video' || track.kind === 'audio' ? track.kind : undefined
  return {
    ...track,
    // Track height is a local view preference, persisted to localStorage and
    // re-derived by items-store.setTracks() on load. The field is kept at the
    // default so project files stay stable; its stored value is never read.
    height: DEFAULT_TRACK_HEIGHT,
    // Ensure boolean fields have defaults
    locked: track.locked ?? false,
    syncLock: track.syncLock ?? true,
    visible: track.visible ?? true,
    muted: track.muted ?? false,
    solo: track.solo ?? false,
    volume: normalizedVolume === undefined ? 0 : Math.max(-60, Math.min(12, normalizedVolume)),
    audioEq: normalizeAudioEqSettings(track.audioEq),
    kind: normalizedKind,
    // Ensure order is set (fallback to index if missing)
    order: track.order ?? index,
  }
}

/**
 * Normalize a timeline item to ensure all fields have valid values.
 */
function normalizeItem(
  item: ProjectTimeline['items'][number],
  warnings?: ProjectWarning[],
  compositionId?: string,
): ProjectTimeline['items'][number] {
  const normalized = { ...item }

  // Keep timeline coordinates aligned to whole frames.
  normalized.from = Math.max(0, Math.round(normalized.from ?? 0))
  normalized.durationInFrames = Math.max(1, Math.round(normalized.durationInFrames ?? 1))

  // A shape item without `shapeType` passes schema validation (the field is
  // optional there) but the renderer draws nothing — report it loudly instead
  // of letting the element vanish from the frame.
  if (normalized.type === 'shape' && !(normalized as { shapeType?: unknown }).shapeType) {
    warnings?.push({
      code: 'SHAPE_MISSING_TYPE',
      message: `Shape item "${normalized.id}" has no "shapeType" (e.g. 'rectangle') and will not render`,
      itemIds: [normalized.id],
      trackId: normalized.trackId,
      compositionId,
    })
  }

  // Frame/audio/EQ optional-field clamps — shared with the runtime items-store
  // normalizer so adding a new clamped field only needs registering once.
  applyOptionalClamps(normalized as Record<string, unknown>)

  // Motion-text spec: drop malformed slots and clamp numerics on every load.
  if (normalized.textMotion !== undefined) {
    normalized.textMotion = sanitizeTextMotion(normalized.textMotion)
  }

  // Text counter: coerce malformed fields (hand-edited / agent-written JSON).
  if (normalized.textCounter !== undefined) {
    normalized.textCounter = sanitizeTextCounter(normalized.textCounter)
  }

  // Ensure speed is valid (default 1.0, range 0.1-10.0)
  if (normalized.speed !== undefined) {
    normalized.speed = Math.max(0.1, Math.min(10.0, normalized.speed))
  }

  // Ensure volume is valid (default 0dB, range -60 to +12)
  if (normalized.volume !== undefined) {
    normalized.volume = Math.max(-60, Math.min(12, normalized.volume))
  }

  // Ensure fade values are non-negative
  if (normalized.fadeIn !== undefined) {
    normalized.fadeIn = Math.max(0, normalized.fadeIn)
  }
  if (normalized.fadeOut !== undefined) {
    normalized.fadeOut = Math.max(0, normalized.fadeOut)
  }
  if (normalized.audioFadeIn !== undefined) {
    normalized.audioFadeIn = Math.max(0, normalized.audioFadeIn)
  }
  if (normalized.audioFadeOut !== undefined) {
    normalized.audioFadeOut = Math.max(0, normalized.audioFadeOut)
  }

  // Normalize transform if present
  if (normalized.transform) {
    normalized.transform = {
      ...normalized.transform,
      // Ensure rotation is normalized to 0-360
      rotation:
        normalized.transform.rotation !== undefined
          ? ((normalized.transform.rotation % 360) + 360) % 360
          : undefined,
      anchorX: normalized.transform.anchorX,
      anchorY: normalized.transform.anchorY,
      flipHorizontal:
        normalized.transform.flipHorizontal !== undefined
          ? !!normalized.transform.flipHorizontal
          : undefined,
      flipVertical:
        normalized.transform.flipVertical !== undefined
          ? !!normalized.transform.flipVertical
          : undefined,
      // Ensure opacity is 0-1
      opacity:
        normalized.transform.opacity !== undefined
          ? Math.max(0, Math.min(1, normalized.transform.opacity))
          : undefined,
      // Ensure cornerRadius is non-negative
      cornerRadius:
        normalized.transform.cornerRadius !== undefined
          ? Math.max(0, normalized.transform.cornerRadius)
          : undefined,
    }
  }

  return normalized
}

/**
 * Normalize a transition to ensure all fields have valid values.
 */
function normalizeTransition(
  transition: NonNullable<ProjectTimeline['transitions']>[number],
): NonNullable<ProjectTimeline['transitions']>[number] {
  const timing =
    (transition.timing as string | undefined) === 'spring' ? 'linear' : transition.timing

  return {
    ...transition,
    // Ensure duration is at least 1 frame
    durationInFrames: Math.max(1, Math.round(transition.durationInFrames)),
    timing: timing ?? 'linear',
  }
}

function flattenTrackGroups(tracks: ProjectTimeline['tracks']): ProjectTimeline['tracks'] {
  return tracks
    .filter((track) => !track.isGroup)
    .map((track) => ({
      ...track,
      parentTrackId: undefined,
      isGroup: undefined,
      isCollapsed: undefined,
    }))
    .sort((a, b) => a.order - b.order)
}

/**
 * Build a set of item ID pairs that are linked by a transition.
 * Overlaps between transition-linked clips are intentional and must not be repaired.
 */
function buildTransitionPairs(
  transitions?: NonNullable<ProjectTimeline['transitions']>,
): Set<string> {
  const pairs = new Set<string>()
  if (!transitions) return pairs
  for (const t of transitions) {
    // Store both directions for O(1) lookup
    pairs.add(`${t.leftClipId}:${t.rightClipId}`)
    pairs.add(`${t.rightClipId}:${t.leftClipId}`)
  }
  return pairs
}

/**
 * Detect and repair overlapping items on the same track.
 * Pushes later-starting items forward to eliminate overlaps.
 * Transition-linked overlaps are intentional and left untouched.
 * Every repair is reported to `warnings` — for hand-built projects a silent
 * shift reads as "the item vanished from its window".
 */
function repairOverlappingItems(
  items: ProjectTimeline['items'],
  transitions?: NonNullable<ProjectTimeline['transitions']>,
  warnings?: ProjectWarning[],
  compositionId?: string,
): ProjectTimeline['items'] {
  const transitionPairs = buildTransitionPairs(transitions)

  // Group items by track, sorted by start frame
  const byTrack = new Map<
    string,
    Array<{ index: number; item: ProjectTimeline['items'][number] }>
  >()
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    let group = byTrack.get(item.trackId)
    if (!group) {
      group = []
      byTrack.set(item.trackId, group)
    }
    group.push({ index: i, item })
  }

  const repaired = [...items]

  for (const [, group] of byTrack) {
    group.sort((a, b) => a.item.from - b.item.from)

    for (let i = 0; i < group.length; i++) {
      const current = group[i]!
      const currentEnd = current.item.from + current.item.durationInFrames

      for (let j = i + 1; j < group.length; j++) {
        const next = group[j]!
        if (next.item.from >= currentEnd) break // No overlap

        // Skip transition-linked overlaps — they're intentional
        const pairKey = `${current.item.id}:${next.item.id}`
        if (transitionPairs.has(pairKey)) continue

        // Push the later item to start right after the current one
        warnings?.push({
          code: 'TRACK_OVERLAP_REPAIRED',
          message:
            `Items "${current.item.id}" and "${next.item.id}" overlap on track ` +
            `"${current.item.trackId}" (frames ${next.item.from}-${currentEnd}); ` +
            `"${next.item.id}" was shifted to frame ${currentEnd}`,
          itemIds: [current.item.id, next.item.id],
          trackId: current.item.trackId,
          compositionId,
        })
        const repairedItem = { ...next.item, from: currentEnd }
        repaired[next.index] = repairedItem
        next.item = repairedItem
      }
    }
  }

  return repaired
}

/**
 * Normalize a timeline to ensure all data conforms to current defaults.
 */
function normalizeTimeline(
  timeline: ProjectTimeline,
  warnings?: ProjectWarning[],
): ProjectTimeline {
  const normalizedTracks = flattenTrackGroups(
    timeline.tracks.map((track, index) => normalizeTrack(track, index)),
  )

  const normalizedItems = timeline.items.map((item) => normalizeItem(item, warnings))
  const normalizedTransitions = timeline.transitions?.map(normalizeTransition)

  // Drop tab ids that don't resolve to a composition (and any duplicates), so
  // standalone-timeline tabs never dangle after a composition is deleted.
  const validSequenceIds = new Set(
    (timeline.compositions ?? [])
      .filter((comp) => comp.editorKind !== 'composite-2d')
      .map((comp) => comp.id),
  )
  const normalizedTopLevelSequenceIds = timeline.topLevelSequenceIds
    ? [...new Set(timeline.topLevelSequenceIds.filter((id) => validSequenceIds.has(id)))]
    : undefined

  return {
    ...timeline,
    topLevelSequenceIds: normalizedTopLevelSequenceIds,
    // Normalize tracks
    tracks: normalizedTracks,
    busAudioEq: normalizeAudioEqSettings(timeline.busAudioEq),
    // Normalize items and repair overlaps
    items: repairOverlappingItems(normalizedItems, normalizedTransitions, warnings),
    // Normalize transitions if present
    transitions: normalizedTransitions,
    // Normalize sub-composition tracks and items
    compositions: timeline.compositions?.map((comp) => {
      const compItems = comp.items.map((item) => normalizeItem(item, warnings, comp.id))
      const compTransitions = comp.transitions?.map(normalizeTransition)
      return {
        ...comp,
        editorKind: comp.editorKind === 'composite-2d' ? 'composite-2d' : 'sequence',
        tracks: flattenTrackGroups(comp.tracks.map((track, index) => normalizeTrack(track, index))),
        busAudioEq: normalizeAudioEqSettings(comp.busAudioEq),
        items: repairOverlappingItems(compItems, compTransitions, warnings, comp.id),
        transitions: compTransitions,
      }
    }),
    // Ensure frame values are non-negative integers
    currentFrame: Math.max(0, Math.floor(timeline.currentFrame ?? 0)),
    // Ensure zoom is positive
    zoomLevel: Math.max(0.01, timeline.zoomLevel ?? 1),
    // Ensure scroll is non-negative
    scrollPosition: Math.max(0, timeline.scrollPosition ?? 0),
  }
}

/**
 * Normalize project metadata.
 */
function normalizeMetadata(metadata: Project['metadata']): Project['metadata'] {
  return {
    ...metadata,
    // Ensure dimensions are positive
    width: Math.max(1, metadata.width),
    height: Math.max(1, metadata.height),
    // Ensure FPS is valid
    fps: Math.max(1, Math.min(120, metadata.fps ?? DEFAULT_FPS)),
  }
}

/**
 * Normalize a project to ensure all data conforms to current defaults.
 * This is applied after migrations on every load.
 */
export function normalizeProject(project: Project, warnings?: ProjectWarning[]): Project {
  const normalized: Project = {
    ...project,
    // Normalize metadata
    metadata: normalizeMetadata(project.metadata),
  }

  // Normalize timeline if present
  if (normalized.timeline) {
    normalized.timeline = normalizeTimeline(normalized.timeline, warnings)
  }

  return normalized
}

/**
 * Check if normalization changed the project.
 * Uses JSON comparison for simplicity (works for our data types).
 */
export function didNormalizationChange(original: Project, normalized: Project): boolean {
  return JSON.stringify(original) !== JSON.stringify(normalized)
}
