import type { AudioItem, TimelineTrack } from '@/types/timeline'
import type {
  AudiobookMusicBedPlacement,
  AudiobookSoundEffectPlacement,
  InsertAudiobookMusicBedResult,
  InsertAudiobookSoundEffectsResult,
} from '../../types'
import { DEFAULT_TRACK_HEIGHT } from '../../constants'
import { useSelectionStore } from '@/shared/state/selection'
import { useItemsStore } from '../items-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { execute, warnIfOverlapping } from './shared'

type AudiobookSfxTrackGroup = 'ambience' | 'foley' | 'impact'

interface LanePlan {
  track: TimelineTrack
  endFrame: number
  group: AudiobookSfxTrackGroup
}

function getAudiobookSfxTrackGroup(
  role: AudiobookSoundEffectPlacement['audiobookSfxRole'],
): AudiobookSfxTrackGroup {
  if (role === 'ambience') return 'ambience'
  if (role === 'impact' || role === 'transition') return 'impact'
  return 'foley'
}

function getAudiobookSfxTrackName(group: AudiobookSfxTrackGroup, laneIndex: number): string {
  const baseName =
    group === 'ambience'
      ? 'Audiobook SFX Ambience'
      : group === 'impact'
        ? 'Audiobook SFX Impacts'
        : 'Audiobook SFX Foley'
  return laneIndex === 0 ? baseName : `${baseName} ${laneIndex + 1}`
}

function createAudiobookSfxTrack(
  tracks: TimelineTrack[],
  laneIndex: number,
  group: AudiobookSfxTrackGroup,
): TimelineTrack {
  const maxOrder = tracks.reduce((max, track) => Math.max(max, track.order ?? 0), 0)
  return {
    id: `track-${crypto.randomUUID()}`,
    name: getAudiobookSfxTrackName(group, laneIndex),
    kind: 'audio',
    height: DEFAULT_TRACK_HEIGHT,
    locked: false,
    syncLock: true,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    order: maxOrder + laneIndex + 1,
    items: [],
  }
}

function createAudiobookMusicTrack(tracks: TimelineTrack[]): TimelineTrack {
  const maxOrder = tracks.reduce((max, track) => Math.max(max, track.order ?? 0), 0)
  return {
    id: `track-${crypto.randomUUID()}`,
    name: 'Audiobook Music',
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

function getSourceDurationFrames(
  placement: AudiobookSoundEffectPlacement,
  durationInFrames: number,
): number {
  return Math.max(durationInFrames, Math.round(placement.sourceDurationFrames ?? durationInFrames))
}

function getAudiobookSfxFades(placement: AudiobookSoundEffectPlacement): {
  audioFadeIn: number
  audioFadeOut: number
} {
  if (placement.audiobookSfxRole === 'ambience') {
    return { audioFadeIn: 0.45, audioFadeOut: 1.1 }
  }

  if (placement.audiobookSfxRole === 'impact' || placement.audiobookSfxRole === 'transition') {
    return { audioFadeIn: 0.005, audioFadeOut: 0.55 }
  }

  return { audioFadeIn: 0.02, audioFadeOut: 0.35 }
}

function buildAudiobookMusicItems(params: {
  placement: Required<AudiobookMusicBedPlacement>
  trackId: string
}): AudioItem[] {
  const { placement, trackId } = params
  const items: AudioItem[] = []
  const totalEndFrame = placement.startFrame + placement.durationInFrames
  const sourceDurationFrames = Math.max(1, placement.sourceDurationFrames)

  for (
    let startFrame = placement.startFrame, index = 0;
    startFrame < totalEndFrame;
    startFrame += sourceDurationFrames, index += 1
  ) {
    const durationInFrames = Math.min(sourceDurationFrames, totalEndFrame - startFrame)
    items.push({
      id: crypto.randomUUID(),
      type: 'audio',
      trackId,
      from: startFrame,
      durationInFrames,
      label: index === 0 ? placement.label : `${placement.label} ${index + 1}`,
      mediaId: placement.mediaId,
      originId: crypto.randomUUID(),
      src: placement.src,
      sourceStart: 0,
      sourceEnd: durationInFrames,
      sourceDuration: sourceDurationFrames,
      sourceFps: placement.sourceFps,
      trimStart: 0,
      trimEnd: Math.max(0, sourceDurationFrames - durationInFrames),
      volume: placement.volume,
      audioFadeIn: index === 0 ? 1.2 : 0.08,
      audioFadeOut: startFrame + durationInFrames >= totalEndFrame ? 1.8 : 0.08,
    })
  }

  return items
}

export function insertAudiobookMusicBed(
  placement: AudiobookMusicBedPlacement,
): InsertAudiobookMusicBedResult {
  const normalized: Required<AudiobookMusicBedPlacement> = {
    ...placement,
    sourceFps: placement.sourceFps ?? useTimelineSettingsStore.getState().fps,
    volume: placement.volume ?? -18,
    startFrame: Math.max(0, Math.round(placement.startFrame)),
    durationInFrames: Math.max(0, Math.round(placement.durationInFrames)),
    sourceDurationFrames: Math.max(0, Math.round(placement.sourceDurationFrames)),
  }

  if (
    !normalized.mediaId ||
    !normalized.src ||
    normalized.durationInFrames <= 0 ||
    normalized.sourceDurationFrames <= 0
  ) {
    return { status: 'empty', itemCount: 0, trackCount: 0, itemIds: [] }
  }

  const itemStore = useItemsStore.getState()
  const track = createAudiobookMusicTrack(itemStore.tracks)
  const items = buildAudiobookMusicItems({ placement: normalized, trackId: track.id })

  execute(
    'INSERT_AUDIOBOOK_MUSIC_BED',
    () => {
      const store = useItemsStore.getState()
      store.setTracks([...store.tracks, track])
      store._addItems(items)
      useTimelineSettingsStore.getState().markDirty()
      useSelectionStore.getState().selectItems(items.map((item) => item.id))
      warnIfOverlapping('insertAudiobookMusicBed')
    },
    { count: items.length },
  )

  return {
    status: 'inserted',
    itemCount: items.length,
    trackCount: 1,
    itemIds: items.map((item) => item.id),
  }
}

export function insertAudiobookSoundEffects(
  placements: AudiobookSoundEffectPlacement[],
): InsertAudiobookSoundEffectsResult {
  const sortedPlacements = placements
    .map((placement) => ({
      ...placement,
      startFrame: Math.max(0, Math.round(placement.startFrame)),
      durationInFrames: Math.max(1, Math.round(placement.durationInFrames)),
    }))
    .filter((placement) => placement.mediaId && placement.src && placement.durationInFrames > 0)
    .sort((left, right) => left.startFrame - right.startFrame)

  if (sortedPlacements.length === 0) {
    return { status: 'empty', itemCount: 0, trackCount: 0 }
  }

  const itemStore = useItemsStore.getState()
  const fps = useTimelineSettingsStore.getState().fps
  const tracks = [...itemStore.tracks]
  const lanes: LanePlan[] = []
  const newTracks: TimelineTrack[] = []
  const items: AudioItem[] = []

  for (const placement of sortedPlacements) {
    const durationInFrames = Math.max(1, placement.durationInFrames)
    const sourceDurationFrames = getSourceDurationFrames(placement, durationInFrames)
    const group = getAudiobookSfxTrackGroup(placement.audiobookSfxRole)
    const laneIndex = lanes.findIndex(
      (lane) => lane.group === group && placement.startFrame >= lane.endFrame,
    )
    const lane =
      laneIndex >= 0
        ? lanes[laneIndex]!
        : (() => {
            const groupLaneIndex = lanes.filter((candidate) => candidate.group === group).length
            const track = createAudiobookSfxTrack([...tracks, ...newTracks], groupLaneIndex, group)
            const nextLane = { track, endFrame: 0, group }
            lanes.push(nextLane)
            newTracks.push(track)
            return nextLane
          })()

    lane.endFrame = Math.max(lane.endFrame, placement.startFrame + durationInFrames)
    const fades = getAudiobookSfxFades(placement)

    items.push({
      id: crypto.randomUUID(),
      type: 'audio',
      trackId: lane.track.id,
      from: placement.startFrame,
      durationInFrames,
      label: placement.label,
      audiobookSfxRole: placement.audiobookSfxRole,
      mediaId: placement.mediaId,
      originId: crypto.randomUUID(),
      src: placement.src,
      sourceStart: 0,
      sourceEnd: sourceDurationFrames,
      sourceDuration: sourceDurationFrames,
      sourceFps: placement.sourceFps ?? fps,
      trimStart: 0,
      trimEnd: Math.max(0, sourceDurationFrames - durationInFrames),
      volume: placement.volume ?? -1,
      audioFadeIn: fades.audioFadeIn,
      audioFadeOut: fades.audioFadeOut,
    })
  }

  execute(
    'INSERT_AUDIOBOOK_SFX',
    () => {
      const store = useItemsStore.getState()
      store.setTracks([...store.tracks, ...newTracks])
      store._addItems(items)
      useTimelineSettingsStore.getState().markDirty()
      useSelectionStore.getState().selectItems(items.map((item) => item.id))
      warnIfOverlapping('insertAudiobookSoundEffects')
    },
    { count: items.length, tracks: newTracks.length },
  )

  return {
    status: 'inserted',
    itemCount: items.length,
    trackCount: newTracks.length,
  }
}
