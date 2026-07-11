import { beforeEach, describe, expect, it } from 'vite-plus/test'

import { useSelectionStore } from '@/shared/state/selection'
import { makeTimelineTrack } from '../../test-helpers'
import { useItemsStore } from '../items-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { insertAudiobookMusicBed, insertAudiobookSoundEffects } from './audiobook-actions'

describe('audiobook actions', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useItemsStore
      .getState()
      .setTracks([makeTimelineTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 0 })])
    useItemsStore.getState().setItems([])
    useSelectionStore.getState().clearSelection()
  })

  it('tiles a generated music bed across the narration span', () => {
    const result = insertAudiobookMusicBed({
      mediaId: 'media-score',
      src: 'blob:score',
      label: 'Cinematic Score Bed',
      startFrame: 15,
      durationInFrames: 95,
      sourceDurationFrames: 30,
      sourceFps: 30,
      volume: -18,
    })

    const state = useItemsStore.getState()
    const musicTrack = state.tracks.find((track) => track.name === 'Audiobook Music')
    const musicItems = state.items.filter((item) => item.trackId === musicTrack?.id)

    expect(result).toMatchObject({ status: 'inserted', itemCount: 4, trackCount: 1 })
    expect(musicTrack).toBeTruthy()
    expect(musicItems.map((item) => item.from)).toEqual([15, 45, 75, 105])
    expect(musicItems.map((item) => item.durationInFrames)).toEqual([30, 30, 30, 5])
    expect(musicItems.every((item) => item.volume === -18)).toBe(true)
    expect(useSelectionStore.getState().selectedItemIds).toEqual(result.itemIds)
  })

  it('returns empty for invalid music-bed placements', () => {
    const result = insertAudiobookMusicBed({
      mediaId: '',
      src: '',
      label: 'Missing Score',
      startFrame: 0,
      durationInFrames: 120,
      sourceDurationFrames: 30,
    })

    expect(result).toEqual({ status: 'empty', itemCount: 0, trackCount: 0, itemIds: [] })
    expect(useItemsStore.getState().items).toEqual([])
  })

  it('places audiobook SFX on role-separated mix tracks', () => {
    const result = insertAudiobookSoundEffects([
      {
        mediaId: 'media-room',
        src: 'blob:room',
        label: 'Scene ambience',
        audiobookSfxRole: 'ambience',
        startFrame: 0,
        durationInFrames: 180,
        sourceDurationFrames: 180,
        sourceFps: 30,
        volume: -3,
        studioAudioSource: {
          provider: 'freesound',
          soundId: 123,
          title: 'Room ambience',
          creator: 'recordist',
          sourceUrl: 'https://freesound.org/s/123/',
          license: 'CC0 1.0',
          licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
          licenseCode: 'cc0',
          retrievedAt: '2026-07-10T00:00:00.000Z',
          sourceKind: 'preview',
          reason: 'The scene is indoors.',
          confidence: 0.9,
          approval: 'approved',
          locked: true,
        },
      },
      {
        mediaId: 'media-hit',
        src: 'blob:hit',
        label: 'Story hit',
        audiobookSfxRole: 'impact',
        startFrame: 30,
        durationInFrames: 60,
        sourceDurationFrames: 60,
        sourceFps: 30,
        volume: 12,
      },
      {
        mediaId: 'media-paper',
        src: 'blob:paper',
        label: 'Folder foley',
        audiobookSfxRole: 'foreground',
        startFrame: 45,
        durationInFrames: 45,
        sourceDurationFrames: 45,
        sourceFps: 30,
        volume: 9,
      },
    ])

    const state = useItemsStore.getState()
    const trackNames = state.tracks.map((track) => track.name)
    const sfxItems = state.items.filter((item) => item.type === 'audio')

    expect(result).toMatchObject({ status: 'inserted', itemCount: 3, trackCount: 3 })
    expect(trackNames).toEqual(
      expect.arrayContaining([
        'Audiobook SFX Ambience',
        'Audiobook SFX Impacts',
        'Audiobook SFX Foley',
      ]),
    )
    expect(sfxItems.map((item) => item.audiobookSfxRole)).toEqual([
      'ambience',
      'impact',
      'foreground',
    ])
    expect(sfxItems.find((item) => item.label === 'Story hit')?.audioFadeIn).toBe(0.005)
    expect(sfxItems.find((item) => item.label === 'Scene ambience')?.audioFadeIn).toBe(0.45)
    expect(
      sfxItems.find((item) => item.label === 'Scene ambience')?.studioAudioSource,
    ).toMatchObject({
      soundId: 123,
      licenseCode: 'cc0',
    })
  })
})
