import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { AudioItem } from '@/types/timeline'
import {
  makeTimelineTrack as makeTrack,
  makeTimelineVideoItem as makeVideoItem,
  resetTimelineCompositionTestState,
  setDefaultRootTimelineTracks,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from './items-store'
import { useCompositionsStore } from './compositions-store'
import { useCompositionNavigationStore } from './composition-navigation-store'
import { usePlaybackStore } from '@/shared/state/playback'

describe('composition-navigation-store', () => {
  beforeEach(() => {
    resetTimelineCompositionTestState()
    useCompositionNavigationStore.getState().resetToRoot()
    usePlaybackStore.getState().setCurrentFrame(0)
  })

  it('maps playhead using the specific wrapper instance used to enter a compound clip', () => {
    setDefaultRootTimelineTracks()
    useItemsStore.getState().setItems([
      {
        id: 'comp-a-first-video',
        type: 'composition',
        trackId: 'track-v1',
        from: 0,
        durationInFrames: 40,
        label: 'Comp A',
        compositionId: 'comp-a',
        compositionWidth: 1920,
        compositionHeight: 1080,
        transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
      },
      {
        id: 'comp-a-second-video',
        type: 'composition',
        trackId: 'track-v1',
        from: 80,
        durationInFrames: 40,
        label: 'Comp A',
        compositionId: 'comp-a',
        linkedGroupId: 'group-2',
        compositionWidth: 1920,
        compositionHeight: 1080,
        transform: { x: 0, y: 0, rotation: 0, opacity: 1 },
      },
      {
        id: 'comp-a-second-audio',
        type: 'audio',
        trackId: 'track-a1',
        from: 80,
        durationInFrames: 40,
        label: 'Comp A',
        compositionId: 'comp-a',
        linkedGroupId: 'group-2',
        src: '',
      } satisfies AudioItem,
    ])
    useCompositionsStore.getState().setCompositions([
      {
        id: 'comp-a',
        name: 'Comp A',
        tracks: [makeTrack({ id: 'comp-track-v1', name: 'V1', kind: 'video', order: 0 })],
        items: [makeVideoItem({ id: 'nested-video', trackId: 'comp-track-v1' })],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 40,
      },
    ])

    usePlaybackStore.getState().setCurrentFrame(95)

    useCompositionNavigationStore
      .getState()
      .enterComposition('comp-a', 'Comp A', 'comp-a-second-audio')

    expect(useCompositionNavigationStore.getState().activeCompositionId).toBe('comp-a')
    expect(usePlaybackStore.getState().currentFrame).toBe(15)
  })
})
