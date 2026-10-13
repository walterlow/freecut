/**
 * Load-time validation helpers for the headless harness.
 *
 * Programmatically-built projects fail in ways the interactive editor can't:
 * nobody is looking at the timeline, so an item that silently renders wrong
 * (or not at all) costs hours of false trails. These checks turn the known
 * silent failures into explicit warnings the driver can log or fail on.
 */
import type { TimelineItem } from '@/types/timeline'
import type { MediaMetadata } from '@/types/storage'
import type { CompositionInputProps } from '@/types/export'
import type { Transition } from '@/types/transition'
import {
  CANVAS_FALLBACK_PRESENTATIONS,
  resolveTransitionRenderPath,
} from '@/features/export/utils/canvas-transitions'
import { getGpuTransition } from '@/infrastructure/gpu-transitions'

export interface SourceRangeFinding {
  itemId: string
  mediaId: string
  /** Seconds of source material the item's cut requires. */
  neededSeconds: number
  /** Seconds the media actually has (from metadata.json). */
  availableSeconds: number
}

/**
 * Find items whose source cut runs past the end of their media — the engine
 * pads the tail with black frames / silence without any warning.
 *
 * `sourceStart`/`sourceEnd` are in source-native fps (see CLAUDE.md); when
 * `sourceEnd` is absent the needed range is derived from the timeline duration
 * and speed. Media without a known duration is skipped.
 */
function findSourceOverrun(
  item: TimelineItem,
  metadata: MediaMetadata,
  projectFps: number,
): SourceRangeFinding | null {
  const sourceFps = metadata.fps > 0 ? metadata.fps : projectFps
  const speed = (item as { speed?: number }).speed ?? 1
  const sourceStart = (item as { sourceStart?: number }).sourceStart ?? 0
  const sourceEnd =
    (item as { sourceEnd?: number }).sourceEnd ??
    sourceStart + (item.durationInFrames * speed * sourceFps) / projectFps

  const neededSeconds = sourceEnd / sourceFps
  // Half a frame + a small epsilon of slack: metadata durations are rounded.
  const tolerance = Math.max(0.05, 0.5 / sourceFps)
  if (neededSeconds <= metadata.duration + tolerance) return null
  return {
    itemId: item.id,
    mediaId: (item as { mediaId?: string }).mediaId ?? '',
    neededSeconds,
    availableSeconds: metadata.duration,
  }
}

export function collectSourceRangeFindings(
  items: readonly TimelineItem[],
  mediaById: ReadonlyMap<string, MediaMetadata>,
  projectFps: number,
): SourceRangeFinding[] {
  const findings: SourceRangeFinding[] = []
  for (const item of items) {
    if (item.type !== 'video' && item.type !== 'audio') continue
    const mediaId = (item as { mediaId?: string }).mediaId
    const metadata = mediaId ? mediaById.get(mediaId) : undefined
    if (!metadata || !(metadata.duration > 0)) continue
    const finding = findSourceOverrun(item, metadata, projectFps)
    if (finding) findings.push(finding)
  }
  return findings
}

export interface TransitionFinding {
  transitionId: string
  kind:
    | 'clip_not_found'
    | 'cross_track'
    | 'not_adjacent'
    | 'missing_presentation'
    | 'invalid_direction'
    | 'unsupported_presentation'
  message: string
}

/** The engine renders a directional transition with an unknown direction as a BLACK frame. */
const VALID_TRANSITION_DIRECTIONS = new Set(['from-left', 'from-right', 'from-top', 'from-bottom'])

/**
 * Find transitions that will silently do nothing (or degrade to a hard cut)
 * at render time. The planner only builds a transition window when the two
 * clips touch (|leftEnd - rightStart| <= 1 frame) or overlap; a transition
 * whose clips are missing, on different tracks, or separated by a gap simply
 * never renders — no error, no warning from the engine itself.
 */
/** A window-killing structural problem: the planner never builds a window for these. */
function structuralTransitionFinding(
  transition: Transition,
  itemById: ReadonlyMap<string, TimelineItem>,
): TransitionFinding | null {
  const left = itemById.get(transition.leftClipId)
  const right = itemById.get(transition.rightClipId)
  if (!left || !right) {
    const missing = [
      ...(left ? [] : [`leftClipId "${transition.leftClipId}"`]),
      ...(right ? [] : [`rightClipId "${transition.rightClipId}"`]),
    ].join(' and ')
    return {
      transitionId: transition.id,
      kind: 'clip_not_found',
      message: `Transition "${transition.id}" references ${missing} which does not exist — it will never render`,
    }
  }
  if (left.trackId !== right.trackId) {
    return {
      transitionId: transition.id,
      kind: 'cross_track',
      message:
        `Transition "${transition.id}" spans clips on different tracks ` +
        `("${left.trackId}" vs "${right.trackId}") — it will never render`,
    }
  }
  const leftEnd = left.from + left.durationInFrames
  const gap = right.from - leftEnd
  if (gap > 1) {
    return {
      transitionId: transition.id,
      kind: 'not_adjacent',
      message:
        `Transition "${transition.id}" clips are ${gap} frames apart ` +
        `(left ends at ${leftEnd}, right starts at ${right.from}) — ` +
        `clips must touch within 1 frame or the transition never renders`,
    }
  }
  return null
}

/** Problems that keep the window but visibly degrade it (hard cut / black frames). */
function degradationTransitionFindings(transition: Transition): TransitionFinding[] {
  const findings: TransitionFinding[] = []
  if (!transition.presentation) {
    findings.push({
      transitionId: transition.id,
      kind: 'missing_presentation',
      message: `Transition "${transition.id}" has no \`presentation\` — it renders as a hard cut instead of a transition`,
    })
  }
  if (transition.direction && !VALID_TRANSITION_DIRECTIONS.has(transition.direction)) {
    findings.push({
      transitionId: transition.id,
      kind: 'invalid_direction',
      message:
        `Transition "${transition.id}" has unknown direction "${transition.direction}" — ` +
        `the window renders BLACK; valid: ${[...VALID_TRANSITION_DIRECTIONS].join(', ')}`,
    })
  }
  return findings
}

/**
 * A declared presentation that no available path can draw renders as a hard cut.
 *
 * `BuiltinTransitionPresentation` declares far more presets than the Canvas2D
 * fallback implements, and without a GPU the rest reach `default:` and produce a
 * plain cut — no error, no warning, just a project that silently looks wrong.
 * The generic WEBGPU_TRANSITION_FALLBACK warning does not name which transitions
 * degraded, which is the part a caller actually needs.
 */
function unsupportedPresentationFinding(
  transition: Transition,
  gpuAvailable: boolean,
): TransitionFinding | null {
  if (!transition.presentation) return null
  const path = resolveTransitionRenderPath(transition.presentation, {
    gpuAvailable,
    // The pipeline can only ever compile ids the GPU registry knows, so an id it
    // does not carry can never take the GPU path — checkable here, before any
    // pipeline exists. `TransitionPipeline.render` applies the same condition.
    hasGpuTransition: (id) => Boolean(getGpuTransition(id)),
  })
  if (path !== 'cut') return null
  return {
    transitionId: transition.id,
    kind: 'unsupported_presentation',
    message:
      `Transition "${transition.id}" uses presentation "${transition.presentation}", which has no ` +
      `${gpuAvailable ? '' : 'Canvas2D '}implementation here — it renders as a HARD CUT, not a transition` +
      (gpuAvailable ? '' : '. Presets drawable without a GPU: ') +
      (gpuAvailable
        ? ''
        : [...CANVAS_FALLBACK_PRESENTATIONS].filter((p) => p !== 'none').join(', ')),
  }
}

export function collectTransitionFindings(
  transitions: readonly Transition[],
  items: readonly TimelineItem[],
  options: { gpuAvailable: boolean } = { gpuAvailable: false },
): TransitionFinding[] {
  const itemById = new Map(items.map((item) => [item.id, item]))
  return transitions.flatMap((transition) => {
    const structural = structuralTransitionFinding(transition, itemById)
    if (structural) return [structural]
    const degradations = degradationTransitionFindings(transition)
    const unsupported = unsupportedPresentationFinding(transition, options.gpuAvailable)
    return unsupported ? [...degradations, unsupported] : degradations
  })
}

export interface TransformParentFinding {
  itemId: string
  kind: 'parent_not_found' | 'cycle' | 'invalid_type'
  message: string
}

const UNPARENTABLE_TYPES = new Set(['audio', 'adjustment'])

type ParentedItem = TimelineItem & { transformParent?: { parentItemId?: string } }

/** Follow the parent chain from `start`; true when it loops back onto itself. */
function hasParentCycle(start: ParentedItem, itemById: ReadonlyMap<string, TimelineItem>): boolean {
  const seen = new Set<string>([start.id])
  let parentId = start.transformParent?.parentItemId
  while (parentId) {
    if (seen.has(parentId)) return true
    seen.add(parentId)
    parentId = (itemById.get(parentId) as ParentedItem | undefined)?.transformParent?.parentItemId
  }
  return false
}

/**
 * Transform-parent bindings that silently degrade at render time: a missing
 * parent renders the child unparented, a cycle falls back to local transforms,
 * and audio/adjustment items never participate in the hierarchy. The editor
 * validates these on assignment; raw project.json bypasses those checks.
 */
export function collectTransformParentFindings(
  items: readonly TimelineItem[],
): TransformParentFinding[] {
  const itemById = new Map(items.map((item) => [item.id, item]))
  const findings: TransformParentFinding[] = []
  for (const item of items as readonly ParentedItem[]) {
    const parentId = item.transformParent?.parentItemId
    if (!parentId) continue
    const parent = itemById.get(parentId)
    if (!parent) {
      findings.push({
        itemId: item.id,
        kind: 'parent_not_found',
        message: `Item "${item.id}" is transform-parented to "${parentId}" which does not exist — it renders unparented`,
      })
      continue
    }
    if (UNPARENTABLE_TYPES.has(parent.type) || UNPARENTABLE_TYPES.has(item.type)) {
      findings.push({
        itemId: item.id,
        kind: 'invalid_type',
        message: `Item "${item.id}" (${item.type}) is transform-parented to "${parentId}" (${parent.type}) — audio/adjustment items never participate in the transform hierarchy`,
      })
      continue
    }
    if (hasParentCycle(item, itemById)) {
      findings.push({
        itemId: item.id,
        kind: 'cycle',
        message: `Item "${item.id}" is part of a transform-parent cycle — the chain silently falls back to local transforms`,
      })
    }
  }
  return findings
}

/** Build the mediaId → metadata lookup from the driver's media list. */
export function buildMediaMetadataMap(
  media: Array<{ mediaId: string; metadata?: MediaMetadata }> | undefined,
): Map<string, MediaMetadata> {
  const mediaById = new Map<string, MediaMetadata>()
  for (const m of media ?? []) {
    if (m.metadata) mediaById.set(m.mediaId, m.metadata)
  }
  return mediaById
}

export function videoCarriesAudio(
  videoItem: { embeddedAudioMuted?: boolean; mediaId?: string },
  mediaById: Map<string, MediaMetadata>,
): boolean {
  if (videoItem.embeddedAudioMuted) return false
  const metadata = videoItem.mediaId ? mediaById.get(videoItem.mediaId) : undefined
  // Without metadata assume the video may carry audio; with it require an audio track.
  return !metadata || Boolean(metadata.audioCodec)
}

function itemCanCarryAudio(
  item: CompositionInputProps['tracks'][number]['items'][number],
  mediaById: Map<string, MediaMetadata>,
): boolean {
  if (item.type === 'audio') return true
  return item.type === 'video' && videoCarriesAudio(item, mediaById)
}

/** True when any item on an unmuted, visible track can contribute audio. */
export function hasAudioCapableItems(
  tracks: CompositionInputProps['tracks'],
  mediaById: Map<string, MediaMetadata>,
): boolean {
  return tracks.some(
    (track) =>
      track.visible !== false &&
      track.muted !== true &&
      (track.items ?? []).some((item) => itemCanCarryAudio(item, mediaById)),
  )
}
