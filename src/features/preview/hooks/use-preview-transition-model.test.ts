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
