import { beforeEach, describe, expect, it } from 'vite-plus/test'

import type { ImageItem } from '@/types/timeline'
import type { Project } from '@/types/project'
import { useProjectStore } from '../../deps/projects'
import { useSelectionStore } from '@/shared/state/selection'
import { makeTimelineAudioItem, makeTimelineTrack } from '../../test-helpers'
import { useItemsStore } from '../items-store'
import { useKeyframesStore } from '../keyframes-store'
import { useTimelineCommandStore } from '../timeline-command-store'
import { useTimelineSettingsStore } from '../timeline-settings-store'
import { useTransitionsStore } from '../transitions-store'
import {
  applyCinematicCameraToSelectedImages,
  applyDocumentaryCameraToSelectedImages,
} from './auto-camera-actions'

function makeImageItem(overrides: Partial<ImageItem> = {}): ImageItem {
  return {
    id: 'image-1',
    type: 'image',
    trackId: 'track-v1',
    from: 0,
    durationInFrames: 90,
    label: 'still.jpg',
    src: 'blob:image',
    mediaId: 'media-image',
    sourceWidth: 1920,
    sourceHeight: 1080,
    ...overrides,
  }
}

function makeProject(): Project {
  return {
    id: 'project-1',
    name: 'Cinematic Test',
    description: '',
    createdAt: 1,
    updatedAt: 1,
    duration: 90,
    metadata: {
      width: 1920,
      height: 1080,
      fps: 30,
    },
  }
}

describe('auto camera actions', () => {
  beforeEach(() => {
    useTimelineCommandStore.getState().clearHistory()
    useTimelineSettingsStore.setState({ fps: 30, isDirty: false })
    useItemsStore
      .getState()
      .setTracks([
        makeTimelineTrack({ id: 'track-v1', name: 'V1', kind: 'video', order: 0 }),
        makeTimelineTrack({ id: 'track-a1', name: 'A1', kind: 'audio', order: 1 }),
      ])
    useItemsStore.getState().setItems([])
    useKeyframesStore.getState().setKeyframes([])
    useTransitionsStore.getState().setTransitions([])
    useSelectionStore.getState().clearSelection()
    useProjectStore.getState().setCurrentProject(makeProject())
  })

  it('applies dramatic multi-axis camera motion to selected still images', () => {
    useItemsStore
      .getState()
      .setItems([
        makeImageItem({ id: 'image-later', from: 120 }),
        makeTimelineAudioItem({ id: 'narration', trackId: 'track-a1', from: 0 }),
        makeImageItem({ id: 'image-first', from: 0 }),
      ])
    useKeyframesStore.getState()._addKeyframe('image-first', 'x', 10, 999)

    const result = applyCinematicCameraToSelectedImages(['image-later', 'narration', 'image-first'])

    expect(result).toMatchObject({ status: 'applied', imageCount: 2 })
    expect(result.keyframeCount).toBeGreaterThanOrEqual(8)

    const firstWidth = useKeyframesStore
      .getState()
      .getAllKeyframesForProperty('image-first', 'width')
    const firstX = useKeyframesStore.getState().getAllKeyframesForProperty('image-first', 'x')
    const firstY = useKeyframesStore.getState().getAllKeyframesForProperty('image-first', 'y')
    const laterY = useKeyframesStore.getState().getAllKeyframesForProperty('image-later', 'y')

    expect(firstWidth.map((keyframe) => keyframe.frame)).toEqual([0, 27, 89])
    expect(firstX.map((keyframe) => keyframe.frame)).toEqual([0, 27, 89])
    expect(firstY.map((keyframe) => keyframe.frame)).toEqual([0, 27, 89])
    expect(firstWidth[2]?.value).toBeGreaterThan(firstWidth[1]?.value ?? 0)
    expect(firstX[0]?.value).toBeLessThan(firstX[1]?.value ?? 0)
    expect(firstX[2]?.value).toBeGreaterThan(firstX[1]?.value ?? 0)
    expect(firstY[0]?.value).toBeLessThan(firstY[1]?.value ?? 0)
    expect(firstY[2]?.value).toBeGreaterThan(firstY[1]?.value ?? 0)
    expect(firstX.some((keyframe) => keyframe.frame === 10)).toBe(false)
    expect(laterY.map((keyframe) => keyframe.frame)).toEqual([0, 28, 89])
  })

  it('reports no-project without changing keyframes when no canvas is available', () => {
    useProjectStore.getState().setCurrentProject(null)
    useItemsStore.getState().setItems([makeImageItem({ id: 'image-1' })])

    const result = applyCinematicCameraToSelectedImages(['image-1'])

    expect(result).toEqual({ status: 'no-project', imageCount: 1, keyframeCount: 0 })
    expect(useKeyframesStore.getState().keyframes).toEqual([])
  })

  it('uses a restrained two-keyframe coverage move for documentary stills', () => {
    useItemsStore.getState().setItems([makeImageItem({ id: 'image-1' })])

    const result = applyDocumentaryCameraToSelectedImages(['image-1'])
    const width = useKeyframesStore.getState().getAllKeyframesForProperty('image-1', 'width')

    expect(result).toMatchObject({ status: 'applied', imageCount: 1 })
    expect(width.map((keyframe) => keyframe.frame)).toEqual([0, 89])
    expect(width[1]?.value).toBeGreaterThan(width[0]?.value ?? 0)
  })

  it('keeps depth-layer scenes on one preset with stronger foreground motion', () => {
    useItemsStore.getState().setItems([
      makeImageItem({
        id: 'background',
        cinematicDepthRole: 'background',
        cinematicDepthSourceId: 'scene-1',
      }),
      makeImageItem({
        id: 'subject',
        cinematicDepthRole: 'subject',
        cinematicDepthSourceId: 'scene-1',
      }),
      makeImageItem({
        id: 'depth-map',
        cinematicDepthRole: 'depth-map',
        cinematicDepthSourceId: 'scene-1',
      }),
    ])

    const result = applyCinematicCameraToSelectedImages(['background', 'subject', 'depth-map'])

    expect(result).toMatchObject({ status: 'applied', imageCount: 2 })

    const backgroundWidth = useKeyframesStore
      .getState()
      .getAllKeyframesForProperty('background', 'width')
    const subjectWidth = useKeyframesStore.getState().getAllKeyframesForProperty('subject', 'width')
    const depthMapX = useKeyframesStore.getState().getAllKeyframesForProperty('depth-map', 'x')

    const backgroundZoom = Math.abs(
      (backgroundWidth.at(-1)?.value ?? 0) - (backgroundWidth[0]?.value ?? 0),
    )
    const subjectZoom = Math.abs((subjectWidth.at(-1)?.value ?? 0) - (subjectWidth[0]?.value ?? 0))

    expect(depthMapX).toEqual([])
    expect(subjectZoom).toBeGreaterThan(backgroundZoom)
  })
})
