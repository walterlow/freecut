import { describe, expect, it } from 'vite-plus/test'
import type { TimelineTrack } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import { buildPreviewTransitionData } from './use-preview-transition-model'

describe('buildPreviewTransitionData', () => {
  it('marks effectful and variable-speed transitions as complex', () => {
    const track: TimelineTrack = {
      id: 'track-1',
      name: 'Video',
      height: 80,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 1,
      items: [
        {
          id: 'left',
          trackId: 'track-1',
          type: 'video',
          src: 'left.mp4',
          label: 'Left',
          from: 0,
          durationInFrames: 40,
          effects: [
            {
              id: 'fx-1',
              enabled: true,
              effect: {
                type: 'gpu-effect',
                gpuEffectType: 'gpu-blur',
                params: { amount: 1 },
              },
            },
          ],
        },
        {
          id: 'right',
          trackId: 'track-1',
          type: 'video',
          src: 'right.mp4',
          label: 'Right',
          from: 40,
          durationInFrames: 40,
          speed: 1.25,
        },
      ],
    }

    const transition: Transition = {
      id: 'transition-1',
      type: 'crossfade',
      presentation: 'fade',
      timing: 'linear',
      leftClipId: 'left',
      rightClipId: 'right',
      trackId: 'track-1',
      durationInFrames: 12,
    }

    const result = buildPreviewTransitionData({
      fps: 30,
      transitions: [transition],
      fastScrubScaledTracks: [track],
    })

    expect(result.playbackTransitionFingerprint).toContain('transition-1:crossfade:left:right')
    expect(result.playbackTransitionWindows).toHaveLength(1)
    expect(result.playbackTransitionComplexStartFrames.has(34)).toBe(true)
    expect(result.playbackTransitionOverlayWindows).toEqual([
      { startFrame: 34, endFrame: 46, cooldownFrames: 3 },
    ])
  })

  it('applies extended cooldown for same-origin handoffs', () => {
    const track: TimelineTrack = {
      id: 'track-1',
      name: 'Video',
      height: 80,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 1,
      items: [
        {
          id: 'left',
          trackId: 'track-1',
          type: 'video',
          src: 'left.mp4',
          label: 'Left',
          from: 0,
          durationInFrames: 40,
          originId: 'origin-1',
        },
        {
          id: 'right',
          trackId: 'track-1',
          type: 'video',
          src: 'right.mp4',
          label: 'Right',
          from: 40,
          durationInFrames: 40,
          originId: 'origin-1',
        },
      ],
    }

    const transition: Transition = {
      id: 'transition-2',
      type: 'crossfade',
      presentation: 'fade',
      timing: 'linear',
      leftClipId: 'left',
      rightClipId: 'right',
      trackId: 'track-1',
      durationInFrames: 10,
    }

    const result = buildPreviewTransitionData({
      fps: 30,
      transitions: [transition],
      fastScrubScaledTracks: [track],
    })

    expect(result.playbackTransitionOverlayWindows).toEqual([
      { startFrame: 35, endFrame: 45, cooldownFrames: 15 },
    ])
  })

  it('updates fingerprint and windows when transition alignment changes', () => {
    const track: TimelineTrack = {
      id: 'track-1',
      name: 'Video',
      height: 80,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 1,
      items: [
        {
          id: 'left',
          trackId: 'track-1',
          type: 'video',
          src: 'left.mp4',
          label: 'Left',
          from: 0,
          durationInFrames: 40,
        },
        {
          id: 'right',
          trackId: 'track-1',
          type: 'video',
          src: 'right.mp4',
          label: 'Right',
          from: 40,
          durationInFrames: 40,
        },
      ],
    }

    const transition: Transition = {
      id: 'transition-alignment',
      type: 'crossfade',
      presentation: 'fade',
      timing: 'linear',
      leftClipId: 'left',
      rightClipId: 'right',
      trackId: 'track-1',
      durationInFrames: 10,
      alignment: 0.5,
    }

    const centered = buildPreviewTransitionData({
      fps: 30,
      transitions: [transition],
      fastScrubScaledTracks: [track],
    })
    const leftAligned = buildPreviewTransitionData({
      fps: 30,
      transitions: [{ ...transition, alignment: 1 }],
      fastScrubScaledTracks: [track],
    })

    expect(centered.playbackTransitionFingerprint).not.toBe(
      leftAligned.playbackTransitionFingerprint,
    )
    expect(centered.playbackTransitionWindows[0]).toMatchObject({
      startFrame: 35,
      endFrame: 45,
    })
    expect(leftAligned.playbackTransitionWindows[0]).toMatchObject({
      startFrame: 30,
      endFrame: 40,
    })
  })

  it('marks compound clip transitions as complex because they cannot use DOM video pinning', () => {
    const track: TimelineTrack = {
      id: 'track-1',
      name: 'Video',
      height: 80,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 1,
      items: [
        {
          id: 'compound-left',
          trackId: 'track-1',
          type: 'composition',
          label: 'Compound',
          from: 0,
          durationInFrames: 40,
          compositionId: 'comp-1',
          compositionWidth: 1920,
          compositionHeight: 1080,
        },
        {
          id: 'right',
          trackId: 'track-1',
          type: 'video',
          src: 'right.mp4',
          label: 'Right',
          from: 40,
          durationInFrames: 40,
        },
      ],
    }

    const transition: Transition = {
      id: 'transition-compound',
      type: 'crossfade',
      presentation: 'fade',
      timing: 'linear',
      leftClipId: 'compound-left',
      rightClipId: 'right',
      trackId: 'track-1',
      durationInFrames: 10,
    }

    const result = buildPreviewTransitionData({
      fps: 30,
      transitions: [transition],
      fastScrubScaledTracks: [track],
    })

    expect(result.playbackTransitionWindows[0]).toMatchObject({
      startFrame: 35,
      endFrame: 45,
    })
    expect(result.playbackTransitionComplexStartFrames.has(35)).toBe(true)
  })

  it('marks corner-pinned transitions as complex to keep playback on the rendered path', () => {
    const track: TimelineTrack = {
      id: 'track-1',
      name: 'Titles',
      height: 80,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 1,
      items: [
        {
          id: 'left',
          trackId: 'track-1',
          type: 'text',
          label: 'Pinned Title',
          text: 'Headline',
          from: 0,
          durationInFrames: 40,
          fontSize: 96,
          color: '#ffffff',
          cornerPin: {
            topLeft: [0, 0],
            topRight: [24, -8],
            bottomRight: [0, 0],
            bottomLeft: [-18, 12],
          },
        },
        {
          id: 'right',
          trackId: 'track-1',
          type: 'video',
          src: 'right.mp4',
          label: 'Right',
          from: 40,
          durationInFrames: 40,
        },
      ],
    }

    const transition: Transition = {
      id: 'transition-corner-pin',
      type: 'crossfade',
      presentation: 'fade',
      timing: 'linear',
      leftClipId: 'left',
      rightClipId: 'right',
      trackId: 'track-1',
      durationInFrames: 10,
    }

    const result = buildPreviewTransitionData({
      fps: 30,
      transitions: [transition],
      fastScrubScaledTracks: [track],
    })

    expect(result.playbackTransitionComplexStartFrames.has(35)).toBe(true)
  })

  it('does not mark transitions with stale mask blend modes as complex', () => {
    const track: TimelineTrack = {
      id: 'track-1',
      name: 'Shapes',
      height: 80,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 1,
      items: [
        {
          id: 'left',
          trackId: 'track-1',
          type: 'shape',
          label: 'Left Mask',
          from: 0,
          durationInFrames: 40,
          shapeType: 'path',
          fillColor: '#ffffff',
          isMask: true,
          blendMode: 'multiply',
        },
        {
          id: 'right',
          trackId: 'track-1',
          type: 'shape',
          label: 'Right Mask',
          from: 40,
          durationInFrames: 40,
          shapeType: 'path',
          fillColor: '#ffffff',
          isMask: true,
          blendMode: 'screen',
        },
      ],
    }

    const transition: Transition = {
      id: 'transition-3',
      type: 'crossfade',
      presentation: 'fade',
      timing: 'linear',
      leftClipId: 'left',
      rightClipId: 'right',
      trackId: 'track-1',
      durationInFrames: 10,
    }

    const result = buildPreviewTransitionData({
      fps: 30,
      transitions: [transition],
      fastScrubScaledTracks: [track],
    })

    expect(result.playbackTransitionComplexStartFrames.size).toBe(0)
  })
})
