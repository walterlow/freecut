/**
 * Embedded-audio splitting.
 *
 * Audio and video are kept on separate tracks in this editor: a video clip's
 * embedded audio is meant to live on its own linked audio track, never baked
 * into the video item. Most entry points already do this (timeline drop,
 * source edit), but two do not by themselves:
 *
 *  - the preview canvas drop, which places a bare visual item, and
 *  - legacy / pre-existing projects whose videos were never split.
 *
 * The helpers here produce the missing linked audio item (reusing
 * {@link makeGeneratedAudioItem} so every audio-specific field is carried over)
 * and pick — or create — an audio track to hold it without disturbing the
 * existing track layout.
 */

import type { AudioItem, TimelineItem, TimelineTrack, VideoItem } from '@/types/timeline'
import type { ItemKeyframes } from '@/types/keyframe'
import { getLinkedAudioCompanion } from '@/shared/utils/linked-media'
import { getTrackKind, getNextClassicTrackName } from './classic-tracks'
import { cloneVolumeKeyframes, makeGeneratedAudioItem } from './legacy-av-track-repair'
import { DEFAULT_TRACK_HEIGHT } from '../constants'

function rangesOverlap(
  aFrom: number,
  aDuration: number,
  bFrom: number,
  bDuration: number,
): boolean {
  return aFrom < bFrom + bDuration && bFrom < aFrom + aDuration
}

function buildItemsByTrackId(items: readonly TimelineItem[]): Map<string, TimelineItem[]> {
  const map = new Map<string, TimelineItem[]>()
  for (const item of items) {
    const existing = map.get(item.trackId)
    if (existing) {
      existing.push(item)
    } else {
      map.set(item.trackId, [item])
    }
  }
  return map
}

function buildAudioTrack(tracks: readonly TimelineTrack[], createId: () => string): TimelineTrack {
  const maxOrder = tracks.reduce((max, track) => Math.max(max, track.order ?? 0), -1)
  return {
    id: `track-${createId()}`,
    name: getNextClassicTrackName(tracks as TimelineTrack[], 'audio'),
    kind: 'audio',
    height: DEFAULT_TRACK_HEIGHT,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    order: maxOrder + 1,
    items: [],
  }
}

export interface LinkedAudioForVideo {
  /** The video item, with a `linkedGroupId` assigned if it lacked one. */
  updatedVideo: VideoItem
  /** The generated linked audio companion. */
  audioItem: AudioItem
  /** A freshly created audio track to append, or `null` if an existing one was reused. */
  newTrack: TimelineTrack | null
}

/**
 * Build a linked audio companion for a single video and decide which audio
 * track should hold it: the first existing audio track with free space at the
 * video's time range, otherwise a brand-new audio track placed below the rest.
 * Pure — returns the pieces for the caller to commit.
 */
export function buildLinkedAudioForVideo(params: {
  video: VideoItem
  tracks: readonly TimelineTrack[]
  itemsByTrackId: ReadonlyMap<string, TimelineItem[]>
  createId?: () => string
}): LinkedAudioForVideo {
  const createId = params.createId ?? (() => crypto.randomUUID())
  const linkedGroupId = params.video.linkedGroupId ?? createId()
  const updatedVideo: VideoItem =
    params.video.linkedGroupId === linkedGroupId ? params.video : { ...params.video, linkedGroupId }

  const { from, durationInFrames } = updatedVideo

  let targetTrackId: string | null = null
  const audioTracks = params.tracks
    .filter((track) => !track.isGroup && getTrackKind(track) === 'audio')
    .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0))

  for (const track of audioTracks) {
    const occupants = params.itemsByTrackId.get(track.id) ?? []
    const overlaps = occupants.some((item) =>
      rangesOverlap(from, durationInFrames, item.from, item.durationInFrames),
    )
    if (!overlaps) {
      targetTrackId = track.id
      break
    }
  }

  let newTrack: TimelineTrack | null = null
  if (!targetTrackId) {
    newTrack = buildAudioTrack(params.tracks, createId)
    targetTrackId = newTrack.id
  }

  const audioItem = makeGeneratedAudioItem(updatedVideo, targetTrackId, createId)
  return { updatedVideo, audioItem, newTrack }
}

/** A video qualifies for splitting when it has audible media and no companion. */
export function isUnpairedAudibleVideo(
  item: TimelineItem,
  items: readonly TimelineItem[],
  videoHasAudioByMediaId: Record<string, boolean | undefined>,
): item is VideoItem {
  return (
    item.type === 'video' &&
    !item.embeddedAudioMuted &&
    !!item.mediaId &&
    videoHasAudioByMediaId[item.mediaId] === true &&
    getLinkedAudioCompanion(items as TimelineItem[], item) === null
  )
}

export interface SplitUnpairedResult {
  tracks: TimelineTrack[]
  items: TimelineItem[]
  keyframes: ItemKeyframes[]
  changed: boolean
}

/**
 * Surgically split every audible video that lacks a linked audio companion.
 *
 * Existing track names and order are preserved; this only appends generated
 * audio items (and audio tracks, when no existing track has room). Companion
 * detection uses the input `items`, so already-split videos are left untouched.
 */
export function splitUnpairedVideoAudio(params: {
  tracks: readonly TimelineTrack[]
  items: readonly TimelineItem[]
  keyframes: readonly ItemKeyframes[]
  videoHasAudioByMediaId: Record<string, boolean | undefined>
  createId?: () => string
}): SplitUnpairedResult {
  const createId = params.createId ?? (() => crypto.randomUUID())

  const unpaired = params.items.filter((item): item is VideoItem =>
    isUnpairedAudibleVideo(item, params.items, params.videoHasAudioByMediaId),
  )

  if (unpaired.length === 0) {
    return {
      tracks: params.tracks as TimelineTrack[],
      items: params.items as TimelineItem[],
      keyframes: params.keyframes as ItemKeyframes[],
      changed: false,
    }
  }

  // Deterministic order so generated ids / track assignment are stable.
  const trackOrderById = new Map(params.tracks.map((track) => [track.id, track.order ?? 0]))
  const ordered = [...unpaired].sort((a, b) => {
    const orderA = trackOrderById.get(a.trackId) ?? 0
    const orderB = trackOrderById.get(b.trackId) ?? 0
    if (orderA !== orderB) return orderA - orderB
    if (a.from !== b.from) return a.from - b.from
    return a.id.localeCompare(b.id)
  })

  let tracksOut: TimelineTrack[] = [...params.tracks]
  const updatedVideoById = new Map<string, VideoItem>()
  const itemsByTrackId = buildItemsByTrackId(params.items)
  const keyframesByItemId = new Map(params.keyframes.map((entry) => [entry.itemId, entry]))
  const keyframesOut: ItemKeyframes[] = [...params.keyframes]
  const generatedAudio: TimelineItem[] = []

  for (const video of ordered) {
    const { updatedVideo, audioItem, newTrack } = buildLinkedAudioForVideo({
      video,
      tracks: tracksOut,
      itemsByTrackId,
      createId,
    })

    if (newTrack) {
      tracksOut = [...tracksOut, newTrack]
    }
    if (updatedVideo !== video) {
      updatedVideoById.set(video.id, updatedVideo)
    }
    generatedAudio.push(audioItem)

    // Track the new occupant so the next split on this track sees it.
    const occupants = itemsByTrackId.get(audioItem.trackId) ?? []
    itemsByTrackId.set(audioItem.trackId, [...occupants, audioItem])

    const clonedKeyframes = cloneVolumeKeyframes(keyframesByItemId.get(video.id), audioItem.id)
    if (clonedKeyframes) {
      keyframesOut.push(clonedKeyframes)
    }
  }

  const itemsOut: TimelineItem[] = params.items.map((item) => updatedVideoById.get(item.id) ?? item)
  itemsOut.push(...generatedAudio)

  return { tracks: tracksOut, items: itemsOut, keyframes: keyframesOut, changed: true }
}
