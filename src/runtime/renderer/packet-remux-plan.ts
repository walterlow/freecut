/**
 * Packet-remux eligibility planning.
 *
 * Pure decision logic (moved verbatim from canvas-render-orchestrator.ts) for
 * the export fast path: when the timeline is a single unmodified clip, the
 * source packets can be remuxed directly instead of rendering frame by frame.
 * The actual remux execution stays in the orchestrator.
 */

import type { CompositionInputProps } from '@/types/export'
import type { TimelineTrack, TimelineItem, VideoItem } from '@/types/timeline'
import type { ClientExportSettings } from './client-renderer'
import { hasMediaCrop } from '@/shared/utils/media-crop'

export interface PacketRemuxPlan {
  src: string
  trimStartSeconds: number
  trimEndSeconds: number
  includeAudio: boolean
}

const EPSILON = 1e-6

export function isIdentityTransform(item: VideoItem): boolean {
  const transform = item.transform
  if (hasMediaCrop(item.crop)) return false
  if (!transform) return true

  if (transform.width !== undefined || transform.height !== undefined) return false
  if (transform.x !== undefined && Math.abs(transform.x) > EPSILON) return false
  if (transform.y !== undefined && Math.abs(transform.y) > EPSILON) return false
  if (transform.rotation !== undefined && Math.abs(transform.rotation) > EPSILON) return false
  if (transform.cornerRadius !== undefined && Math.abs(transform.cornerRadius) > EPSILON)
    return false
  if (transform.opacity !== undefined && Math.abs(transform.opacity - 1) > EPSILON) return false
  return true
}

export function isRemuxEligibleComposition(
  settings: ClientExportSettings,
  composition: CompositionInputProps,
): boolean {
  if (settings.mode !== 'video') return false
  if (composition.durationInFrames === undefined || composition.durationInFrames <= 0) return false
  if ((composition.transitions?.length ?? 0) > 0) return false
  if ((composition.keyframes?.length ?? 0) > 0) return false
  return true
}

/** The single renderable clip on the visible tracks, or null if there isn't exactly one. */
function findSingleRemuxCandidate(
  composition: CompositionInputProps,
): { item: TimelineItem; track: TimelineTrack } | null {
  const tracks: TimelineTrack[] = (composition.tracks ?? []).filter(
    (track) => track.visible !== false,
  )
  const items: Array<{ item: TimelineItem; track: TimelineTrack }> = []

  for (const track of tracks) {
    for (const item of track.items ?? []) {
      if (item.durationInFrames > 0) {
        items.push({ item, track })
      }
    }
  }

  return items.length === 1 ? items[0]! : null
}

/** True when the clip has edits that force frame-by-frame rendering. */
export function clipBlocksRemux(videoItem: VideoItem, composition: CompositionInputProps): boolean {
  if (!videoItem.src) return true
  if (videoItem.isReversed === true) return true
  if (videoItem.from !== 0) return true
  if (videoItem.durationInFrames !== composition.durationInFrames) return true
  if ((videoItem.effects?.length ?? 0) > 0) return true
  if (!isIdentityTransform(videoItem)) return true

  const speed = videoItem.speed ?? 1
  if (Math.abs(speed - 1) > EPSILON) return true

  return Math.abs(videoItem.fadeIn ?? 0) > EPSILON || Math.abs(videoItem.fadeOut ?? 0) > EPSILON
}

function hasRemuxBlockingAudioAdjustments(videoItem: VideoItem): boolean {
  return (
    Math.abs(videoItem.volume ?? 0) > EPSILON ||
    Math.abs(videoItem.audioFadeIn ?? 0) > EPSILON ||
    Math.abs(videoItem.audioFadeOut ?? 0) > EPSILON
  )
}

export function resolveRemuxTrimBounds(
  videoItem: VideoItem,
  composition: CompositionInputProps,
  settings: ClientExportSettings,
): { trimStartSeconds: number; trimEndSeconds: number } | null {
  const sourceFps = videoItem.sourceFps ?? composition.fps
  if (!Number.isFinite(sourceFps) || sourceFps <= 0) return null
  if (Math.abs((settings.fps ?? composition.fps) - composition.fps) > EPSILON) return null

  // Require clip to start at source frame 0 — a trimmed-from-middle clip can't be
  // remuxed directly and must fall back to frame-by-frame rendering.
  const sourceStartFrames = videoItem.sourceStart ?? videoItem.trimStart ?? videoItem.offset ?? 0
  if (Math.abs(sourceStartFrames) > EPSILON) return null
  const trimStartSeconds = Math.max(0, sourceStartFrames / sourceFps)
  const clipDurationSeconds = videoItem.durationInFrames / composition.fps
  if (!Number.isFinite(clipDurationSeconds) || clipDurationSeconds <= 0) return null

  const trimEndSeconds = trimStartSeconds + clipDurationSeconds
  if (!Number.isFinite(trimEndSeconds) || trimEndSeconds <= trimStartSeconds) return null

  return { trimStartSeconds, trimEndSeconds }
}

/**
 * Stream-level preflight for the fast path: the source's primary streams must
 * already be what the export asked for, so `Conversion` can copy packets
 * instead of transcoding them. Probing the file, decoding it, muxing it and
 * reporting progress all stay in the orchestrator; this decides whether the
 * probed streams are usable at all.
 */

/** The output container's muxable codecs. Absent methods mean "nothing muxable". */
export interface RemuxContainerSupport {
  getSupportedVideoCodecs?: () => string[]
  getSupportedAudioCodecs?: () => string[]
}

/** The source file's primary video stream, as probed by the caller. */
export interface RemuxSourceVideoTrack {
  codec: string | null
  displayWidth: number
  displayHeight: number
}

/** The export settings the video preflight compares the source against. */
export type RemuxExpectedVideo = Pick<ClientExportSettings, 'codec' | 'resolution'>

/**
 * A source without a video stream can't be remuxed, and neither can one whose
 * codec the container can't mux, that isn't the export codec, or that isn't at
 * the export resolution — each of those would need a transcode.
 */
export function isRemuxEligibleSourceVideo(
  videoTrack: RemuxSourceVideoTrack | null,
  options: { settings: RemuxExpectedVideo; containerSupport: RemuxContainerSupport },
): boolean {
  const codec = videoTrack?.codec
  if (!codec) return false
  const supportedCodecs = options.containerSupport.getSupportedVideoCodecs?.() ?? []
  return (
    supportedCodecs.includes(codec) &&
    codec === options.settings.codec &&
    videoTrack.displayWidth === options.settings.resolution.width &&
    videoTrack.displayHeight === options.settings.resolution.height
  )
}

/**
 * Audio is optional: a source without an audio stream still remuxes, but one
 * whose codec the container can't mux does not (it would have to be discarded
 * or transcoded, which the plan doesn't ask for).
 */
export function isRemuxEligibleSourceAudio(
  audioTrack: { codec: string | null } | null,
  containerSupport: RemuxContainerSupport,
): boolean {
  const codec = audioTrack?.codec
  if (!codec) return true
  return (containerSupport.getSupportedAudioCodecs?.() ?? []).includes(codec)
}

export function getPacketRemuxPlan(
  settings: ClientExportSettings,
  composition: CompositionInputProps,
): PacketRemuxPlan | null {
  if (!isRemuxEligibleComposition(settings, composition)) return null

  const candidate = findSingleRemuxCandidate(composition)
  if (!candidate || candidate.item.type !== 'video') return null

  const videoItem = candidate.item as VideoItem
  if (clipBlocksRemux(videoItem, composition)) return null

  const includeAudio = candidate.track.muted !== true
  if (includeAudio && hasRemuxBlockingAudioAdjustments(videoItem)) return null

  const trim = resolveRemuxTrimBounds(videoItem, composition, settings)
  if (!trim) return null

  return {
    src: videoItem.src,
    trimStartSeconds: trim.trimStartSeconds,
    trimEndSeconds: trim.trimEndSeconds,
    includeAudio,
  }
}
