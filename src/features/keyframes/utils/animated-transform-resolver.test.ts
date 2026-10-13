// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { ItemKeyframes } from '@/types/keyframe'
import type { ShapeItem, TimelineItem } from '@/types/timeline'
import {
  resolveAnimatedTransform,
  wouldCreateDirectPropertyLinkCycle,
} from './animated-transform-resolver'

describe('resolveAnimatedTransform', () => {
  it('resolves vector Position, percentage Scale, and Anchor before scalar expressions', () => {
    const baseTransform = {
      x: 0,
      y: 0,
      width: 320,
      height: 180,
      anchorX: 160,
      anchorY: 90,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
    }
    const itemKeyframes: ItemKeyframes = {
      itemId: 'video-1',
      animationVersion: 2,
      properties: [
        {
          property: 'x',
          keyframes: [{ id: 'legacy-x', frame: 5, value: 999, easing: 'linear' }],
        },
      ],
      vectorProperties: [
        {
          property: 'position',
          keyframes: [
            { id: 'p1', frame: 0, value: { x: 0, y: 20 }, easing: 'linear' },
            { id: 'p2', frame: 10, value: { x: 100, y: 220 }, easing: 'linear' },
          ],
        },
        {
          property: 'scale',
          keyframes: [
            { id: 's1', frame: 0, value: { x: 100, y: 100 }, easing: 'linear' },
            { id: 's2', frame: 10, value: { x: 200, y: 50 }, easing: 'linear' },
          ],
        },
        {
          property: 'anchor',
          keyframes: [
            { id: 'a1', frame: 0, value: { x: 80, y: 40 }, easing: 'linear' },
            { id: 'a2', frame: 10, value: { x: 180, y: 140 }, easing: 'linear' },
          ],
        },
      ],
    }

    const resolved = resolveAnimatedTransform(baseTransform, itemKeyframes, 5)

    expect(resolved.x).toBe(50)
    expect(resolved.y).toBe(120)
    expect(resolved.width).toBe(480)
    expect(resolved.height).toBe(135)
    expect(resolved.anchorX).toBe(130)
    expect(resolved.anchorY).toBe(90)
  })

  it('interpolates anchor keyframes alongside the base transform', () => {
    const baseTransform = {
      x: 0,
      y: 0,
      width: 320,
      height: 180,
      anchorX: 160,
      anchorY: 90,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
    }

    const itemKeyframes: ItemKeyframes = {
      itemId: 'video-1',
      properties: [
        {
          property: 'anchorX',
          keyframes: [
            { id: 'ax-1', frame: 0, value: 40, easing: 'linear' },
            { id: 'ax-2', frame: 10, value: 140, easing: 'linear' },
          ],
        },
        {
          property: 'anchorY',
          keyframes: [
            { id: 'ay-1', frame: 0, value: 30, easing: 'linear' },
            { id: 'ay-2', frame: 10, value: 110, easing: 'linear' },
          ],
        },
      ],
    }

    const resolved = resolveAnimatedTransform(baseTransform, itemKeyframes, 5)

    expect(resolved.anchorX).toBe(90)
    expect(resolved.anchorY).toBe(70)
    expect(resolved.width).toBe(320)
    expect(resolved.height).toBe(180)
  })

  it('resolves linked properties at shared composition time', () => {
    const source: ShapeItem = {
      id: 'source',
      type: 'shape',
      shapeType: 'rectangle',
      trackId: 'track-1',
      from: 10,
      durationInFrames: 100,
      label: 'Source',
      transform: { x: 5 },
      fillColor: '#fff',
      strokeColor: '#fff',
      strokeWidth: 1,
    }
    const target: TimelineItem = {
      ...source,
      id: 'target',
      from: 20,
      label: 'Target',
      transform: { x: -10 },
    }
    const sourceKeyframes: ItemKeyframes = {
      itemId: source.id,
      properties: [
        {
          property: 'x',
          keyframes: [
            { id: 'source-x-1', frame: 0, value: 100, easing: 'linear' },
            { id: 'source-x-2', frame: 20, value: 300, easing: 'linear' },
          ],
        },
      ],
    }
    const targetKeyframes: ItemKeyframes = {
      itemId: target.id,
      properties: [],
      expressions: [
        {
          type: 'link',
          targetProperty: 'x',
          sourceItemId: source.id,
          sourceProperty: 'x',
          enabled: true,
          timeOffsetFrames: 0,
        },
      ],
    }
    const items = new Map([
      [source.id, source],
      [target.id, target],
    ])
    const keyframes = new Map([
      [source.id, sourceKeyframes],
      [target.id, targetKeyframes],
    ])

    const resolved = resolveAnimatedTransform(
      {
        x: -10,
        y: 0,
        width: 100,
        height: 100,
        anchorX: 50,
        anchorY: 50,
        rotation: 0,
        opacity: 1,
        cornerRadius: 0,
      },
      targetKeyframes,
      5,
      {
        globalFrame: 25,
        canvas: { width: 1920, height: 1080, fps: 30 },
        getItem: (itemId) => items.get(itemId),
        getKeyframes: (itemId) => keyframes.get(itemId),
      },
    )

    // Composition frame 25 is source-relative frame 15, not target-relative 5.
    expect(resolved.x).toBe(250)
  })

  it('resolves Vector2 Position links as one coupled value', () => {
    const source: ShapeItem = {
      id: 'vector-source',
      type: 'shape',
      shapeType: 'rectangle',
      trackId: 'track-source',
      from: 0,
      durationInFrames: 60,
      label: 'Vector source',
      transform: { x: 10, y: 20, width: 100, height: 100 },
      fillColor: '#fff',
      strokeColor: '#fff',
      strokeWidth: 1,
    }
    const target: ShapeItem = {
      ...source,
      id: 'vector-target',
      trackId: 'track-target',
      label: 'Vector target',
      transform: { x: -50, y: -40, width: 100, height: 100 },
    }
    const sourceKeyframes: ItemKeyframes = {
      itemId: source.id,
      animationVersion: 2,
      properties: [],
      vectorProperties: [
        {
          property: 'position',
          keyframes: [
            { id: 'position-1', frame: 0, value: { x: 10, y: 20 }, easing: 'linear' },
            { id: 'position-2', frame: 10, value: { x: 110, y: 220 }, easing: 'linear' },
          ],
        },
      ],
    }
    const targetKeyframes: ItemKeyframes = {
      itemId: target.id,
      properties: [],
      expressions: [
        {
          type: 'link',
          targetProperty: 'position',
          sourceItemId: source.id,
          sourceProperty: 'position',
          enabled: true,
          timeOffsetFrames: 0,
        },
      ],
    }
    const items = new Map<string, TimelineItem>([
      [source.id, source],
      [target.id, target],
    ])
    const keyframes = new Map([
      [source.id, sourceKeyframes],
      [target.id, targetKeyframes],
    ])

    const resolved = resolveAnimatedTransform(
      {
        x: -50,
        y: -40,
        width: 100,
        height: 100,
        anchorX: 50,
        anchorY: 50,
        rotation: 0,
        opacity: 1,
        cornerRadius: 0,
      },
      targetKeyframes,
      5,
      {
        globalFrame: 5,
        canvas: { width: 1920, height: 1080, fps: 30 },
        getItem: (itemId) => items.get(itemId),
        getKeyframes: (itemId) => keyframes.get(itemId),
      },
    )

    expect(resolved.x).toBe(60)
    expect(resolved.y).toBe(120)
  })

  it('resolves a Position link from its source live preview before commit', () => {
    const source: ShapeItem = {
      id: 'preview-source',
      type: 'shape',
      shapeType: 'rectangle',
      trackId: 'track-source',
      from: 0,
      durationInFrames: 60,
      label: 'Preview source',
      transform: { x: 10, y: 20, width: 100, height: 100 },
      fillColor: '#fff',
      strokeColor: '#fff',
      strokeWidth: 1,
    }
    const target: ShapeItem = {
      ...source,
      id: 'preview-target',
      trackId: 'track-target',
      label: 'Preview target',
      transform: { x: -50, y: -40, width: 100, height: 100 },
    }
    const targetKeyframes: ItemKeyframes = {
      itemId: target.id,
      properties: [],
      expressions: [
        {
          type: 'link',
          targetProperty: 'position',
          sourceItemId: source.id,
          sourceProperty: 'position',
          enabled: true,
          timeOffsetFrames: 0,
        },
      ],
    }
    const items = new Map<string, TimelineItem>([
      [source.id, source],
      [target.id, target],
    ])

    const resolved = resolveAnimatedTransform(
      {
        x: -50,
        y: -40,
        width: 100,
        height: 100,
        anchorX: 50,
        anchorY: 50,
        rotation: 0,
        opacity: 1,
        cornerRadius: 0,
      },
      targetKeyframes,
      0,
      {
        globalFrame: 0,
        canvas: { width: 1920, height: 1080, fps: 30 },
        getItem: (itemId) => items.get(itemId),
        getKeyframes: (itemId) => (itemId === target.id ? targetKeyframes : undefined),
        getPreviewTransform: (itemId) => (itemId === source.id ? { x: 120, y: 180 } : undefined),
      },
    )

    expect(resolved.x).toBe(120)
    expect(resolved.y).toBe(180)
    expect(source.transform?.x).toBe(10)
    expect(source.transform?.y).toBe(20)

    const offsetTargetKeyframes: ItemKeyframes = {
      ...targetKeyframes,
      expressions: targetKeyframes.expressions?.map((expression) => ({
        ...expression,
        timeOffsetFrames: 5,
      })),
    }
    const offsetResolved = resolveAnimatedTransform(
      {
        x: -50,
        y: -40,
        width: 100,
        height: 100,
        anchorX: 50,
        anchorY: 50,
        rotation: 0,
        opacity: 1,
        cornerRadius: 0,
      },
      offsetTargetKeyframes,
      0,
      {
        globalFrame: 0,
        canvas: { width: 1920, height: 1080, fps: 30 },
        getItem: (itemId) => items.get(itemId),
        getKeyframes: (itemId) => (itemId === target.id ? offsetTargetKeyframes : undefined),
        getPreviewTransform: (itemId) => (itemId === source.id ? { x: 120, y: 180 } : undefined),
      },
    )

    expect(offsetResolved.x).toBe(10)
    expect(offsetResolved.y).toBe(20)
  })

  it('falls back to the authored value for broken references and cycles', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: 'target',
      properties: [],
      expressions: [
        {
          type: 'link',
          targetProperty: 'x',
          sourceItemId: 'missing',
          sourceProperty: 'x',
          enabled: true,
          timeOffsetFrames: 0,
        },
      ],
    }
    const base = {
      x: 42,
      y: 0,
      width: 100,
      height: 100,
      anchorX: 50,
      anchorY: 50,
      rotation: 0,
      opacity: 1,
      cornerRadius: 0,
    }

    const resolved = resolveAnimatedTransform(base, itemKeyframes, 0, {
      globalFrame: 0,
      canvas: { width: 1920, height: 1080, fps: 30 },
      getItem: () => undefined,
      getKeyframes: (itemId) => (itemId === 'target' ? itemKeyframes : undefined),
    })

    expect(resolved.x).toBe(42)
  })

  it('evaluates sandboxed expressions after keyframes and direct links', () => {
    const itemKeyframes: ItemKeyframes = {
      itemId: 'expression-target',
      properties: [
        {
          property: 'x',
          keyframes: [{ id: 'x-1', frame: 0, value: 25, easing: 'linear' }],
        },
      ],
      expressions: [
        {
          type: 'expression',
          targetProperty: 'x',
          source: 'value * 2 + frame',
          enabled: true,
        },
      ],
    }

    const resolved = resolveAnimatedTransform(
      {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        anchorX: 50,
        anchorY: 50,
        rotation: 0,
        opacity: 1,
        cornerRadius: 0,
      },
      itemKeyframes,
      0,
      {
        globalFrame: 10,
        canvas: { width: 1920, height: 1080, fps: 30 },
        getItem: () => undefined,
        getKeyframes: (itemId) => (itemId === itemKeyframes.itemId ? itemKeyframes : undefined),
      },
    )

    expect(resolved.x).toBe(60)
  })

  it('resolves expression property references and safely breaks expression cycles', () => {
    const source: ShapeItem = {
      id: 'expression-source',
      type: 'shape',
      shapeType: 'rectangle',
      trackId: 'track-source',
      from: 0,
      durationInFrames: 60,
      label: 'Expression source',
      transform: { x: 20, y: 0, width: 100, height: 100 },
      fillColor: '#fff',
      strokeColor: '#fff',
      strokeWidth: 1,
    }
    const target: ShapeItem = {
      ...source,
      id: 'expression-target',
      trackId: 'track-target',
      transform: { x: 10, y: 0, width: 100, height: 100 },
    }
    const sourceKeyframes: ItemKeyframes = {
      itemId: source.id,
      properties: [],
      expressions: [
        {
          type: 'expression',
          targetProperty: 'x',
          source: 'prop("expression-target", "x")',
          enabled: true,
        },
      ],
    }
    const targetKeyframes: ItemKeyframes = {
      itemId: target.id,
      properties: [],
      expressions: [
        {
          type: 'expression',
          targetProperty: 'x',
          source: 'prop("expression-source", "x")',
          enabled: true,
        },
      ],
    }
    const items = new Map<string, TimelineItem>([
      [source.id, source],
      [target.id, target],
    ])
    const keyframes = new Map([
      [source.id, sourceKeyframes],
      [target.id, targetKeyframes],
    ])

    const resolved = resolveAnimatedTransform(
      {
        x: 10,
        y: 0,
        width: 100,
        height: 100,
        anchorX: 50,
        anchorY: 50,
        rotation: 0,
        opacity: 1,
        cornerRadius: 0,
      },
      targetKeyframes,
      0,
      {
        globalFrame: 0,
        canvas: { width: 1920, height: 1080, fps: 30 },
        getItem: (itemId) => items.get(itemId),
        getKeyframes: (itemId) => keyframes.get(itemId),
      },
    )

    expect(resolved.x).toBe(10)
  })

  it('resolves a transform property linked to a shape property', () => {
    const source: ShapeItem = {
      id: 'shape-source',
      type: 'shape',
      shapeType: 'path',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Shape source',
      fillColor: '#fff',
      strokeColor: '#fff',
      strokeWidth: 1,
      trimPathStart: 35,
    }
    const target: TimelineItem = { ...source, id: 'shape-target', transform: { rotation: 5 } }
    const targetKeyframes: ItemKeyframes = {
      itemId: target.id,
      properties: [],
      expressions: [
        {
          type: 'link',
          targetProperty: 'rotation',
          sourceItemId: source.id,
          sourceProperty: 'trimPathStart',
          enabled: true,
          timeOffsetFrames: 0,
        },
      ],
    }

    const resolved = resolveAnimatedTransform(
      {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        anchorX: 50,
        anchorY: 50,
        rotation: 5,
        opacity: 1,
        cornerRadius: 0,
      },
      targetKeyframes,
      0,
      {
        globalFrame: 0,
        canvas: { width: 1920, height: 1080, fps: 30 },
        getItem: (itemId) => (itemId === source.id ? source : target),
        getKeyframes: (itemId) => (itemId === target.id ? targetKeyframes : undefined),
      },
    )

    expect(resolved.rotation).toBe(35)
  })

  it('detects direct and transitive dependency cycles', () => {
    const byItem: Record<string, ItemKeyframes> = {
      source: {
        itemId: 'source',
        properties: [],
        expressions: [
          {
            type: 'link',
            targetProperty: 'y',
            sourceItemId: 'middle',
            sourceProperty: 'rotation',
            enabled: true,
            timeOffsetFrames: 0,
          },
        ],
      },
      middle: {
        itemId: 'middle',
        properties: [],
        expressions: [
          {
            type: 'link',
            targetProperty: 'rotation',
            sourceItemId: 'target',
            sourceProperty: 'x',
            enabled: true,
            timeOffsetFrames: 0,
          },
        ],
      },
    }

    expect(
      wouldCreateDirectPropertyLinkCycle('target', 'x', 'target', 'x', (itemId) => byItem[itemId]),
    ).toBe(true)
    expect(
      wouldCreateDirectPropertyLinkCycle('target', 'x', 'source', 'y', (itemId) => byItem[itemId]),
    ).toBe(true)
    expect(
      wouldCreateDirectPropertyLinkCycle('target', 'x', 'source', 'x', (itemId) => byItem[itemId]),
    ).toBe(false)
  })
})
