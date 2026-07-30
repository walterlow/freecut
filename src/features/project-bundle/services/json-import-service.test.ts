// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { validateSnapshotData } from './json-import-service'

describe('validateSnapshotData', () => {
  it('accepts legacy snapshots that need migration instead of rejecting them up front', async () => {
    const result = await validateSnapshotData({
      version: '1.0',
      exportedAt: '2026-03-30T11:29:25.781Z',
      editorVersion: '1.0.0',
      project: {
        id: 'legacy-project',
        name: 'Legacy Project',
        description: '',
        createdAt: 0,
        updatedAt: 0,
        duration: 0,
        schemaVersion: 8,
        metadata: {
          width: 1920,
          height: 1080,
          fps: 30,
          backgroundColor: '#000000',
        },
        timeline: {
          tracks: [
            {
              id: 'track-video',
              name: 'V1',
              kind: 'video',
              height: 100,
              locked: false,
              visible: true,
              muted: false,
              solo: false,
              volume: 0,
              order: -1,
            },
          ],
          items: [
            {
              id: 'item-shape',
              type: 'shape',
              trackId: 'track-video',
              from: 0,
              durationInFrames: 30,
              label: 'Path Shape',
              shapeType: 'path',
              fillColor: '#ffffff',
              pathVertices: [
                {
                  position: [0, 0],
                  inHandle: [0, 0],
                  outHandle: [0, 0],
                },
                {
                  position: [1, 0],
                  inHandle: [0, 0],
                  outHandle: [0, 0],
                },
              ],
              effects: [
                {
                  id: 'effect-1',
                  effect: {
                    type: 'gpu-effect',
                    gpuEffectType: 'gpu-halftone',
                    params: {
                      intensity: 0.4,
                      patternType: 'dots',
                    },
                  },
                  enabled: true,
                },
              ],
            },
          ],
          zoomLevel: 0.025,
          scrollPosition: 0,
          compositions: [
            {
              id: 'comp-1',
              name: 'Comp 1',
              fps: 30,
              width: 1920,
              height: 1080,
              durationInFrames: 30,
              tracks: [
                {
                  id: 'comp-track',
                  name: 'V1',
                  kind: 'video',
                  height: 100,
                  locked: false,
                  visible: true,
                  muted: false,
                  solo: false,
                  volume: 0,
                  order: 5,
                },
              ],
              items: [
                {
                  id: 'comp-item',
                  type: 'video',
                  trackId: 'comp-track',
                  from: 0,
                  durationInFrames: 30,
                  label: 'Comp Clip',
                  src: 'blob:http://localhost:5173/example',
                },
              ],
            },
          ],
        },
      },
      mediaReferences: [],
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        path: 'project.schemaVersion',
        message: expect.stringContaining('upgraded'),
      }),
    )
  })

  it('accepts snapshots that use any shipped text preset id', async () => {
    const result = await validateSnapshotData({
      version: '1.0',
      exportedAt: '2026-03-30T11:29:25.781Z',
      editorVersion: '1.0.0',
      project: {
        id: 'preset-project',
        name: 'Preset Project',
        description: '',
        createdAt: 0,
        updatedAt: 0,
        duration: 0,
        metadata: {
          width: 1920,
          height: 1080,
          fps: 30,
          backgroundColor: '#000000',
        },
        timeline: {
          tracks: [
            {
              id: 'track-video',
              name: 'V1',
              kind: 'video',
              height: 100,
              locked: false,
              visible: true,
              muted: false,
              solo: false,
              volume: 0,
              order: 0,
            },
          ],
          items: [
            {
              id: 'item-text',
              type: 'text',
              trackId: 'track-video',
              from: 0,
              durationInFrames: 30,
              label: 'Poster',
              text: 'Tonight',
              color: '#ffffff',
              textStylePresetId: 'charter-italic',
            },
          ],
          zoomLevel: 1,
          scrollPosition: 0,
        },
      },
      mediaReferences: [],
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('accepts Animation Core v2 vector lanes and scalar links', async () => {
    const result = await validateSnapshotData({
      version: '1.0',
      exportedAt: '2026-07-17T00:00:00.000Z',
      editorVersion: '1.0.0',
      project: {
        id: 'motion-project',
        name: 'Motion Project',
        description: '',
        createdAt: 0,
        updatedAt: 0,
        duration: 1,
        schemaVersion: 15,
        metadata: { width: 1920, height: 1080, fps: 30 },
        timeline: {
          tracks: [
            {
              id: 'track-1',
              name: 'V1',
              kind: 'video',
              height: 80,
              locked: false,
              visible: true,
              muted: false,
              solo: false,
              order: 0,
            },
          ],
          items: [
            {
              id: 'shape-1',
              type: 'shape',
              trackId: 'track-1',
              from: 0,
              durationInFrames: 30,
              label: 'Shape',
              shapeType: 'rectangle',
            },
          ],
          keyframes: [
            {
              itemId: 'shape-1',
              animationVersion: 2,
              properties: [],
              expressions: [
                {
                  type: 'link',
                  targetProperty: 'rotation',
                  sourceItemId: 'shape-1',
                  sourceProperty: 'x',
                  enabled: false,
                  timeOffsetFrames: 0,
                },
              ],
              vectorProperties: [
                {
                  property: 'position',
                  keyframes: [
                    {
                      id: 'p1',
                      frame: 0,
                      value: { x: 0, y: 0 },
                      easing: 'hold',
                      temporalEase: { out: { speed: 0, influence: 33.333 } },
                      spatial: {
                        inTangent: { x: 0, y: 0 },
                        outTangent: { x: 100, y: 0 },
                        continuous: true,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      mediaReferences: [],
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('accepts null controllers and pose-preserving transform parent bindings', async () => {
    const reference = { x: 0, y: 0, width: 100, height: 100, rotation: 0 }
    const result = await validateSnapshotData({
      version: '1.0',
      exportedAt: '2026-07-18T00:00:00.000Z',
      editorVersion: '1.0.0',
      project: {
        id: 'hierarchy-project',
        name: 'Hierarchy Project',
        description: '',
        createdAt: 0,
        updatedAt: 0,
        duration: 1,
        schemaVersion: 15,
        metadata: { width: 1920, height: 1080, fps: 30 },
        timeline: {
          tracks: [
            {
              id: 'track-1',
              name: 'V1',
              kind: 'video',
              height: 80,
              locked: false,
              visible: true,
              muted: false,
              solo: false,
              order: 0,
            },
          ],
          items: [
            {
              id: 'controller-1',
              type: 'controller',
              controllerKind: 'null',
              trackId: 'track-1',
              from: 0,
              durationInFrames: 30,
              label: 'Controller',
              transform: reference,
            },
            {
              id: 'shape-1',
              type: 'shape',
              shapeType: 'rectangle',
              trackId: 'track-1',
              from: 0,
              durationInFrames: 30,
              label: 'Child',
              transformParent: {
                parentItemId: 'controller-1',
                parentReference: reference,
                childLocalReference: { ...reference, x: 20 },
                childWorldReference: { ...reference, x: 20 },
              },
            },
          ],
        },
      },
      mediaReferences: [],
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })
})
