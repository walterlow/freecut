import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import type { Project } from '@/types/project'
import type { CompositionItem, TextItem } from '@/types/timeline'
import {
  makeTimelineTrack,
  makeTimelineVideoItem,
  resetTimelineCompositionTestState,
} from '@/features/timeline/test-helpers'
import { useItemsStore } from './items-store'
import { useCompositionsStore } from './compositions-store'
import { useCompositionNavigationStore } from './composition-navigation-store'
import { useKeyframesStore } from './keyframes-store'
import { buildTimelineFromStores, hydrateTimelineStoresFromProject } from './timeline-persistence'

const rootTrack = makeTimelineTrack({ id: 'root-track', name: 'Root', kind: 'video', order: 0 })
const motionTrack = makeTimelineTrack({
  id: 'motion-track',
  name: 'Motion',
  kind: 'video',
  order: 0,
})

describe('timeline project hydration', () => {
  beforeEach(() => resetTimelineCompositionTestState())
  afterEach(() => resetTimelineCompositionTestState())

  it('unwinds an active Motion composition before hydrating root stores', async () => {
    useItemsStore.getState().setTracks([rootTrack])
    useItemsStore
      .getState()
      .setItems([makeTimelineVideoItem({ id: 'stale-root', trackId: rootTrack.id })])
    useCompositionsStore.getState().addComposition({
      id: 'motion-comp',
      name: 'Motion composition',
      editorKind: 'composite-2d',
      tracks: [motionTrack],
      items: [makeTimelineVideoItem({ id: 'stale-motion', trackId: motionTrack.id })],
      transitions: [],
      keyframes: [],
      fps: 30,
      width: 1920,
      height: 1080,
      durationInFrames: 300,
    })
    useCompositionNavigationStore.getState().switchToSequence('motion-comp')

    const project: Project = {
      id: 'project-1',
      name: 'Project',
      description: '',
      createdAt: 1,
      updatedAt: 1,
      duration: 10,
      metadata: { width: 1920, height: 1080, fps: 30 },
      timeline: {
        tracks: [rootTrack],
        items: [makeTimelineVideoItem({ id: 'project-root', trackId: rootTrack.id })],
        compositions: [
          {
            id: 'motion-comp',
            name: 'Motion composition',
            editorKind: 'composite-2d',
            tracks: [motionTrack],
            items: [makeTimelineVideoItem({ id: 'project-motion', trackId: motionTrack.id })],
            transitions: [],
            keyframes: [],
            fps: 30,
            width: 1920,
            height: 1080,
            durationInFrames: 300,
          },
        ],
      },
    }

    await hydrateTimelineStoresFromProject(project)

    expect(useCompositionNavigationStore.getState().activeCompositionId).toBeNull()
    expect(useItemsStore.getState().items.map((item) => item.id)).toEqual(['project-root'])
    expect(
      useCompositionsStore.getState().compositionById['motion-comp']?.items.map((item) => item.id),
    ).toEqual(['project-motion'])
  })

  it('hydrates an authored Motion duration without expanding it to layer overhang', async () => {
    const overhangingLayer = makeTimelineVideoItem({
      id: 'overhanging-layer',
      trackId: motionTrack.id,
      from: 50,
      durationInFrames: 80,
    })
    const project: Project = {
      id: 'project-motion-duration',
      name: 'Motion duration project',
      description: '',
      createdAt: 1,
      updatedAt: 1,
      duration: 10,
      metadata: { width: 1920, height: 1080, fps: 30 },
      timeline: {
        tracks: [rootTrack],
        items: [],
        compositions: [
          {
            id: 'motion-comp',
            name: 'Motion composition',
            editorKind: 'composite-2d',
            tracks: [motionTrack],
            items: [overhangingLayer],
            transitions: [],
            keyframes: [],
            fps: 30,
            width: 1920,
            height: 1080,
            durationInFrames: 100,
          },
        ],
      },
    }

    await hydrateTimelineStoresFromProject(project)

    const hydratedComposition = useCompositionsStore.getState().compositionById['motion-comp']
    expect(hydratedComposition?.durationInFrames).toBe(100)
    expect(hydratedComposition?.items.map((item) => item.from + item.durationInFrames)).toEqual([
      130,
    ])
  })

  it('preserves versioned RGBA keyframe numbers during project hydration', async () => {
    const rgbaKeyframeValue = 0x100000000 + 0x12345678
    const item = makeTimelineVideoItem({ id: 'rgba-item', trackId: rootTrack.id })
    const project: Project = {
      id: 'project-rgba',
      name: 'RGBA project',
      description: '',
      createdAt: 1,
      updatedAt: 1,
      duration: 10,
      metadata: { width: 1920, height: 1080, fps: 30 },
      timeline: {
        tracks: [rootTrack],
        items: [item],
        keyframes: [
          {
            itemId: item.id,
            properties: [
              {
                property: 'effect:gpu-fluted-glass:fluted-1:colorBack',
                keyframes: [
                  {
                    id: 'rgba-kf',
                    frame: 0,
                    value: rgbaKeyframeValue,
                    easing: 'linear',
                  },
                ],
              },
            ],
          },
        ],
      },
    }

    await hydrateTimelineStoresFromProject(project)

    expect(useKeyframesStore.getState().keyframes[0]?.properties[0]?.keyframes[0]?.value).toBe(
      rgbaKeyframeValue,
    )
  })

  it('serializes and hydrates direct Vector2 property links', async () => {
    const item = makeTimelineVideoItem({ id: 'target', trackId: rootTrack.id })
    useItemsStore.getState().setTracks([rootTrack])
    useItemsStore.getState().setItems([item])
    useKeyframesStore.getState().setKeyframes([
      {
        itemId: item.id,
        properties: [],
        separatedVectorProperties: ['scale'],
        propertyLinks: [
          {
            type: 'link',
            targetProperty: 'position',
            sourceItemId: 'source',
            sourceProperty: 'scale',
            enabled: true,
            timeOffsetFrames: 4,
          },
        ],
        expressions: [
          {
            type: 'expression',
            targetProperty: 'rotation',
            source: 'value + sin(time) * 10',
            enabled: true,
          },
        ],
      },
    ])

    const timeline = buildTimelineFromStores()
    expect(timeline.keyframes?.[0]?.propertyLinks?.[0]).toMatchObject({
      sourceItemId: 'source',
      targetProperty: 'position',
      sourceProperty: 'scale',
      timeOffsetFrames: 4,
    })
    expect(timeline.keyframes?.[0]?.expressions?.[0]).toMatchObject({
      type: 'expression',
      targetProperty: 'rotation',
      source: 'value + sin(time) * 10',
    })
    expect(timeline.keyframes?.[0]?.separatedVectorProperties).toEqual(['scale'])

    const project: Project = {
      id: 'linked-project',
      name: 'Linked project',
      description: '',
      createdAt: 1,
      updatedAt: 1,
      duration: 10,
      metadata: { width: 1920, height: 1080, fps: 30 },
      timeline,
    }
    await hydrateTimelineStoresFromProject(project)

    expect(useKeyframesStore.getState().keyframesByItemId.target?.propertyLinks).toEqual(
      timeline.keyframes?.[0]?.propertyLinks,
    )
    expect(useKeyframesStore.getState().keyframesByItemId.target?.expressions).toEqual(
      timeline.keyframes?.[0]?.expressions,
    )
    expect(
      useKeyframesStore.getState().keyframesByItemId.target?.separatedVectorProperties,
    ).toEqual(['scale'])
  })

  it('round-trips path geometry keyframes without rewriting their property ids', async () => {
    const item = makeTimelineVideoItem({ id: 'path-item', trackId: rootTrack.id })
    useItemsStore.getState().setTracks([rootTrack])
    useItemsStore.getState().setItems([item])
    useKeyframesStore.getState().setKeyframes([
      {
        itemId: item.id,
        properties: [
          {
            property: 'pathVertex:3:outY',
            keyframes: [
              { id: 'path-key-1', frame: 0, value: -0.25, easing: 'linear' },
              { id: 'path-key-2', frame: 12, value: 0.5, easing: 'ease-in-out' },
            ],
          },
        ],
      },
    ])

    const timeline = buildTimelineFromStores()
    const project: Project = {
      id: 'path-keyframe-project',
      name: 'Path keyframe project',
      description: '',
      createdAt: 1,
      updatedAt: 1,
      duration: 10,
      metadata: { width: 1920, height: 1080, fps: 30 },
      timeline,
    }
    await hydrateTimelineStoresFromProject(project)

    expect(useKeyframesStore.getState().keyframesByItemId[item.id]?.properties).toEqual([
      {
        property: 'pathVertex:3:outY',
        keyframes: [
          { id: 'path-key-1', frame: 0, value: -0.25, easing: 'linear' },
          { id: 'path-key-2', frame: 12, value: 0.5, easing: 'ease-in-out' },
        ],
      },
    ])
  })

  it('round-trips composition control definitions and per-instance values', async () => {
    const title: TextItem = {
      id: 'title',
      trackId: motionTrack.id,
      type: 'text',
      label: 'Headline',
      text: 'Original',
      color: '#ffffff',
      from: 0,
      durationInFrames: 30,
    }
    const instance: CompositionItem = {
      id: 'card-instance',
      trackId: rootTrack.id,
      type: 'composition',
      label: 'Card',
      compositionId: 'card',
      compositionWidth: 1920,
      compositionHeight: 1080,
      compositionControlOverrides: { headline: 'Launch day' },
      from: 0,
      durationInFrames: 30,
    }
    useItemsStore.getState().setTracks([rootTrack])
    useItemsStore.getState().setItems([instance])
    useCompositionsStore.getState().setCompositions([
      {
        id: 'card',
        name: 'Card',
        editorKind: 'composite-2d',
        tracks: [motionTrack],
        items: [title],
        transitions: [],
        keyframes: [],
        fps: 30,
        width: 1920,
        height: 1080,
        durationInFrames: 30,
        compositionControls: {
          version: 1,
          controls: [
            {
              id: 'headline',
              name: 'Headline',
              targetItemId: title.id,
              property: 'text.text',
              kind: 'text',
              defaultValue: title.text,
            },
          ],
        },
      },
    ])

    const timeline = buildTimelineFromStores()
    expect(timeline.compositions?.[0]?.compositionControls?.version).toBe(1)
    expect(timeline.items[0]?.compositionControlOverrides).toEqual({ headline: 'Launch day' })

    await hydrateTimelineStoresFromProject({
      id: 'template-project',
      name: 'Template project',
      description: '',
      createdAt: 1,
      updatedAt: 1,
      duration: 1,
      metadata: { width: 1920, height: 1080, fps: 30 },
      timeline,
    })

    expect(
      useCompositionsStore.getState().compositionById.card?.compositionControls?.controls[0],
    ).toMatchObject({ id: 'headline', targetItemId: 'title' })
    expect(
      (useItemsStore.getState().itemById['card-instance'] as CompositionItem)
        .compositionControlOverrides,
    ).toEqual({ headline: 'Launch day' })
  })
})
