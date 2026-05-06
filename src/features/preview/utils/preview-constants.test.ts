import { describe, expect, it } from 'vite-plus/test'
import type { CompositionInputProps } from '@/types/export'
import { toTrackTopologyFingerprint } from './preview-constants'

function makeTracks(
  overrides: Partial<CompositionInputProps['tracks'][number]['items'][number]> &
    Record<string, unknown> = {},
): CompositionInputProps['tracks'] {
  return [
    {
      id: 'track-1',
      name: 'Video',
      order: 0,
      visible: true,
      muted: false,
      solo: false,
      height: 60,
      locked: false,
      items: [
        {
          id: 'clip-1',
          type: 'video',
          trackId: 'track-1',
          from: 100,
          durationInFrames: 80,
          label: 'Clip',
          mediaId: 'media-1',
          src: 'proxy://clip-1',
          sourceStart: 25,
          sourceEnd: 300,
          sourceDuration: 400,
          sourceFps: 30,
          ...overrides,
        },
      ],
    },
  ] as CompositionInputProps['tracks']
}

describe('toTrackTopologyFingerprint', () => {
  it('stays stable across timing-only trim changes', () => {
    const before = makeTracks()
    const after = makeTracks({
      from: 112,
      durationInFrames: 68,
      sourceStart: 37,
      sourceEnd: 312,
      speed: 1.25,
    })

    expect(toTrackTopologyFingerprint(after)).toBe(toTrackTopologyFingerprint(before))
  })

  it('changes when the underlying source changes', () => {
    const before = makeTracks()
    const after = makeTracks({
      src: 'proxy://clip-1-v2',
    })

    expect(toTrackTopologyFingerprint(after)).not.toBe(toTrackTopologyFingerprint(before))
  })

  it('changes when clip identity changes', () => {
    const before = makeTracks()
    const after = makeTracks({
      id: 'clip-2',
    })

    expect(toTrackTopologyFingerprint(after)).not.toBe(toTrackTopologyFingerprint(before))
  })

  it('changes when a shape toggles into or out of mask mode', () => {
    const before = makeTracks({
      id: 'shape-1',
      type: 'shape',
      mediaId: undefined,
      src: undefined,
      isMask: false,
    })
    const after = makeTracks({
      id: 'shape-1',
      type: 'shape',
      mediaId: undefined,
      src: undefined,
      isMask: true,
    })

    expect(toTrackTopologyFingerprint(after)).not.toBe(toTrackTopologyFingerprint(before))
  })
})
