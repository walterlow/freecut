import type { TimelineTrack } from '@/types/timeline'
import { DEFAULT_TRACK_HEIGHT } from '../constants'

export type TrackKind = 'video' | 'audio'

const VIDEO_TRACK_NAME_REGEX = /^V(\d+)$/i
const AUDIO_TRACK_NAME_REGEX = /^A(\d+)$/i
const GENERIC_TRACK_NAME_REGEX = /^Track\s+\d+$/i

function getTrackNameRegex(kind: TrackKind): RegExp {
  return kind === 'video' ? VIDEO_TRACK_NAME_REGEX : AUDIO_TRACK_NAME_REGEX
}

function getTrackPrefix(kind: TrackKind): 'V' | 'A' {
  return kind === 'video' ? 'V' : 'A'
}

export function getTrackKind(track: TimelineTrack): TrackKind | null {
  if (track.kind === 'video' || track.kind === 'audio') {
    return track.kind
  }
  if (VIDEO_TRACK_NAME_REGEX.test(track.name)) {
    return 'video'
  }
  if (AUDIO_TRACK_NAME_REGEX.test(track.name)) {
    return 'audio'
  }
  return null
}

export function isTrackDisabled(track: TimelineTrack): boolean {
  const kind = getTrackKind(track)
  if (kind === 'audio') {
    return track.muted
  }
  if (kind === 'video') {
    return track.visible === false
  }
  return track.visible === false || track.muted
}

export function getNextClassicTrackName(tracks: TimelineTrack[], kind: TrackKind): string {
  const regex = getTrackNameRegex(kind)
  const numbers = new Set<number>()

  for (const track of tracks) {
    const trackKind = getTrackKind(track)
    if (trackKind !== kind) continue
    const match = track.name.match(regex)
    const number = match?.[1] ? Number.parseInt(match[1], 10) : NaN
    if (Number.isFinite(number) && number > 0) {
      numbers.add(number)
    }
  }

  let next = 1
  while (numbers.has(next)) {
    next += 1
  }

  return `${getTrackPrefix(kind)}${next}`
}

export function getAdjacentTrackOrder(
  tracks: TimelineTrack[],
  targetTrack: TimelineTrack,
  direction: 'above' | 'below',
): number {
  const sortedTracks = [...tracks].sort((a, b) => a.order - b.order)
  const targetIndex = sortedTracks.findIndex((track) => track.id === targetTrack.id)

  if (targetIndex === -1) {
    return direction === 'above' ? (targetTrack.order ?? 0) - 1 : (targetTrack.order ?? 0) + 1
  }

  if (direction === 'above') {
    const higherTrack = sortedTracks[targetIndex - 1]
    return higherTrack ? (higherTrack.order + targetTrack.order) / 2 : targetTrack.order - 1
  }

  const lowerTrack = sortedTracks[targetIndex + 1]
  return lowerTrack ? (targetTrack.order + lowerTrack.order) / 2 : targetTrack.order + 1
}

export function renameTrackForKind(
  track: TimelineTrack,
  tracks: TimelineTrack[],
  kind: TrackKind,
): TimelineTrack {
  const nextName = GENERIC_TRACK_NAME_REGEX.test(track.name)
    ? getNextClassicTrackName(
        tracks.filter((candidate) => candidate.id !== track.id),
        kind,
      )
    : track.name

  return {
    ...track,
    kind,
    name: nextName,
  }
}

export function createClassicTrack(params: {
  tracks: TimelineTrack[]
  kind: TrackKind
  order: number
  height?: number
}): TimelineTrack {
  const { tracks, kind, order, height = DEFAULT_TRACK_HEIGHT } = params
  return {
    id: `track-${crypto.randomUUID()}`,
    name: getNextClassicTrackName(tracks, kind),
    kind,
    height,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    order,
    items: [],
  }
}

export function createDefaultClassicTracks(height = DEFAULT_TRACK_HEIGHT): TimelineTrack[] {
  return [
    {
      id: 'track-1',
      name: 'V1',
      kind: 'video',
      height,
      locked: false,
      syncLock: true,
      visible: true,
      muted: false,
      solo: false,
      volume: 0,
      order: 0,
      items: [],
    },
    {
      id: 'track-2',
      name: 'A1',
      kind: 'audio',
      height,
      locked: false,
      syncLock: true,
      visible: true,
      muted: false,
      solo: false,
      volume: 0,
      order: 1,
      items: [],
    },
  ]
}

export function findNearestTrackByKind(params: {
  tracks: TimelineTrack[]
  targetTrack: TimelineTrack
  kind: TrackKind
  direction: 'above' | 'below'
}): TimelineTrack | null {
  const { tracks, targetTrack, kind, direction } = params
  const candidates = tracks
    .filter((track) => !track.isGroup)
    .filter((track) => getTrackKind(track) === kind)
    .filter((track) =>
      direction === 'above' ? track.order < targetTrack.order : track.order > targetTrack.order,
    )
    .sort((a, b) => (direction === 'above' ? b.order - a.order : a.order - b.order))

  return candidates[0] ?? null
}
