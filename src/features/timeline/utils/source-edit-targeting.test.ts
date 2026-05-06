import { describe, expect, it } from 'vite-plus/test'
import type { TimelineTrack } from '@/types/timeline'
import { resolveSourceEditTrackTargets } from './source-edit-targeting'

function makeTrack(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id: 'track-1',
    name: 'Track 1',
    height: 64,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    order: 0,
    items: [],
    ...overrides,
  }
}

describe('resolveSourceEditTrackTargets', () => {
  it('uses the active generic lane as video and creates an audio companion below', () => {
    const result = resolveSourceEditTrackTargets({
      tracks: [makeTrack({ id: 'track-1', name: 'Track 1', order: 0 })],
      activeTrackId: 'track-1',
      mediaType: 'video',
      hasAudio: true,
      patchVideo: true,
      patchAudio: true,
      preferredTrackHeight: 72,
    })

    expect(result).toMatchObject({ videoTrackId: 'track-1' })
    expect(result?.tracks.find((track) => track.id === 'track-1')).toMatchObject({
      name: 'V1',
      kind: 'video',
    })
    expect(result?.tracks.find((track) => track.id === result.audioTrackId)).toMatchObject({
      name: 'A1',
      kind: 'audio',
    })
  })

  it('uses an active audio lane for source audio and patches video above it', () => {
    const result = resolveSourceEditTrackTargets({
      tracks: [makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 1 })],
      activeTrackId: 'a1',
      mediaType: 'video',
      hasAudio: true,
      patchVideo: true,
      patchAudio: true,
      preferredTrackHeight: 64,
    })

    expect(result?.audioTrackId).toBe('a1')
    expect(result?.tracks.find((track) => track.id === result.videoTrackId)).toMatchObject({
      name: 'V1',
      kind: 'video',
    })
  })

  it('routes audio-only edits to the first audio destination when the active lane is video', () => {
    const result = resolveSourceEditTrackTargets({
      tracks: [
        makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
        makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 1 }),
      ],
      activeTrackId: 'v1',
      mediaType: 'audio',
      hasAudio: true,
      patchVideo: false,
      patchAudio: true,
      preferredTrackHeight: 64,
    })

    expect(result).toMatchObject({ audioTrackId: 'a1' })
    expect(result?.videoTrackId).toBeUndefined()
  })

  it('supports video-only source patching from a linked source clip', () => {
    const result = resolveSourceEditTrackTargets({
      tracks: [makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 1 })],
      activeTrackId: 'a1',
      mediaType: 'video',
      hasAudio: true,
      patchVideo: true,
      patchAudio: false,
      preferredTrackHeight: 64,
    })

    expect(result?.videoTrackId).toBeTruthy()
    expect(result?.audioTrackId).toBeUndefined()
  })

  it('defaults linked source audio to the first available audio destination', () => {
    const result = resolveSourceEditTrackTargets({
      tracks: [
        makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
        makeTrack({ id: 'v2', name: 'V2', kind: 'video', order: 1 }),
        makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 2 }),
        makeTrack({ id: 'a2', name: 'A2', kind: 'audio', order: 3 }),
      ],
      activeTrackId: 'v2',
      mediaType: 'video',
      hasAudio: true,
      patchVideo: true,
      patchAudio: true,
      preferredTrackHeight: 64,
    })

    expect(result).toMatchObject({ videoTrackId: 'v2', audioTrackId: 'a1' })
  })

  it('uses an explicitly selected audio destination for linked source edits', () => {
    const result = resolveSourceEditTrackTargets({
      tracks: [
        makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
        makeTrack({ id: 'v2', name: 'V2', kind: 'video', order: 1 }),
        makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 2 }),
        makeTrack({ id: 'a2', name: 'A2', kind: 'audio', order: 3 }),
      ],
      activeTrackId: 'v2',
      preferredAudioTrackId: 'a2',
      mediaType: 'video',
      hasAudio: true,
      patchVideo: true,
      patchAudio: true,
      preferredTrackHeight: 64,
    })

    expect(result).toMatchObject({ videoTrackId: 'v2', audioTrackId: 'a2' })
  })

  it('uses an explicitly selected audio destination for audio-only source edits', () => {
    const result = resolveSourceEditTrackTargets({
      tracks: [
        makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
        makeTrack({ id: 'v2', name: 'V2', kind: 'video', order: 1 }),
        makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 2 }),
        makeTrack({ id: 'a2', name: 'A2', kind: 'audio', order: 3 }),
      ],
      activeTrackId: 'v2',
      preferredAudioTrackId: 'a2',
      mediaType: 'audio',
      hasAudio: true,
      patchVideo: false,
      patchAudio: true,
      preferredTrackHeight: 64,
    })

    expect(result).toMatchObject({ audioTrackId: 'a2' })
  })

  it('uses an explicitly selected destination without requiring an active lane', () => {
    const result = resolveSourceEditTrackTargets({
      tracks: [
        makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
        makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 1 }),
        makeTrack({ id: 'a2', name: 'A2', kind: 'audio', order: 2 }),
      ],
      activeTrackId: null,
      preferredAudioTrackId: 'a2',
      mediaType: 'audio',
      hasAudio: true,
      patchVideo: false,
      patchAudio: true,
      preferredTrackHeight: 64,
    })

    expect(result).toMatchObject({ audioTrackId: 'a2' })
  })

  it('keeps an explicitly selected video destination when the active lane is audio', () => {
    const result = resolveSourceEditTrackTargets({
      tracks: [
        makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
        makeTrack({ id: 'v2', name: 'V2', kind: 'video', order: 1 }),
        makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 2 }),
        makeTrack({ id: 'a2', name: 'A2', kind: 'audio', order: 3 }),
      ],
      activeTrackId: 'a2',
      preferredVideoTrackId: 'v2',
      mediaType: 'video',
      hasAudio: true,
      patchVideo: true,
      patchAudio: false,
      preferredTrackHeight: 64,
    })

    expect(result).toMatchObject({ videoTrackId: 'v2' })
  })

  it('ignores a locked active lane when an explicit destination is selected', () => {
    const result = resolveSourceEditTrackTargets({
      tracks: [
        makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0, locked: true }),
        makeTrack({ id: 'v2', name: 'V2', kind: 'video', order: 1 }),
      ],
      activeTrackId: 'v1',
      preferredVideoTrackId: 'v2',
      mediaType: 'image',
      hasAudio: false,
      patchVideo: true,
      patchAudio: false,
      preferredTrackHeight: 64,
    })

    expect(result).toMatchObject({ videoTrackId: 'v2' })
  })

  it('creates a first audio destination when no audio tracks exist yet', () => {
    const result = resolveSourceEditTrackTargets({
      tracks: [makeTrack({ id: 'v4', name: 'V4', kind: 'video', order: 3 })],
      activeTrackId: 'v4',
      mediaType: 'video',
      hasAudio: true,
      patchVideo: true,
      patchAudio: true,
      preferredTrackHeight: 64,
    })

    expect(result?.videoTrackId).toBe('v4')
    expect(result?.tracks.find((track) => track.id === result?.audioTrackId)).toMatchObject({
      kind: 'audio',
      name: 'A1',
    })
  })
})
