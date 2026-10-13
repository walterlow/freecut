import type { ReactNode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { ShapeItem } from '@/types/timeline'
import { useGizmoStore } from '@/features/editor/deps/preview'
import { useItemsStore, useKeyframesStore } from '@/features/editor/deps/timeline-store'
import { LayoutSection } from './layout-section'

const layoutTestState = vi.hoisted(() => ({
  sectionRenderCount: 0,
  keyframeRenderCounts: { x: 0, y: 0 } as Record<string, number>,
}))

vi.mock('../components', () => ({
  PropertySection: ({ children }: { children: ReactNode }) => {
    layoutTestState.sectionRenderCount += 1
    return <section>{children}</section>
  },
  PropertyRow: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  NumberInput: ({ label, value }: { label?: string; value: number | 'mixed' }) => (
    <input readOnly aria-label={`number-${label}`} value={value} />
  ),
  SliderInput: ({ value }: { value: number | 'mixed' }) => (
    <input readOnly aria-label="rotation" value={value} />
  ),
}))

vi.mock('@/features/editor/deps/keyframes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/editor/deps/keyframes')>()
  return {
    ...actual,
    KeyframeToggle: ({ property }: { property: string }) => {
      layoutTestState.keyframeRenderCounts[property] =
        (layoutTestState.keyframeRenderCounts[property] ?? 0) + 1
      return <button type="button" aria-label={`keyframe-${property}`} />
    },
  }
})

const SHAPE: ShapeItem = {
  id: 'shape-1',
  type: 'shape',
  trackId: 'track-1',
  from: 0,
  durationInFrames: 120,
  label: 'Shape',
  shapeType: 'rectangle',
  fillColor: '#ffffff',
  strokeWidth: 0,
  transform: {
    x: 100,
    y: 80,
    width: 400,
    height: 220,
    rotation: 0,
    opacity: 1,
  },
}

const CANVAS = { width: 1920, height: 1080, fps: 30 }

function renderLayout(item: ShapeItem = SHAPE) {
  return render(
    <LayoutSection
      items={[item]}
      canvas={CANVAS}
      onTransformChange={vi.fn()}
      aspectLocked={false}
      onAspectLockToggle={vi.fn()}
    />,
  )
}

describe('LayoutSection live gizmo position', () => {
  beforeEach(() => {
    layoutTestState.sectionRenderCount = 0
    layoutTestState.keyframeRenderCounts = { x: 0, y: 0 }
    useItemsStore.getState().setItems([SHAPE])
    useKeyframesStore.setState({ keyframesByItemId: {} })
    useGizmoStore.setState({
      activeGizmo: null,
      previewTransform: null,
      presentationHandoff: null,
      preview: null,
    })
  })

  it('updates only the X/Y leaves during drag and settles from the canonical item', () => {
    const view = renderLayout()

    const parentRenderCount = layoutTestState.sectionRenderCount
    const xKeyframeRenderCount = layoutTestState.keyframeRenderCounts.x
    const yKeyframeRenderCount = layoutTestState.keyframeRenderCounts.y
    const startTransform = {
      x: 100,
      y: 80,
      width: 400,
      height: 220,
      rotation: 0,
      opacity: 1,
    }

    let interactionId = 0
    act(() => {
      interactionId = useGizmoStore
        .getState()
        .startTranslate(SHAPE.id, { x: 0, y: 0 }, startTransform)
    })

    for (const [x, y] of [
      [180, 130],
      [310, 205],
      [470, 290],
    ] as const) {
      act(() => {
        useGizmoStore.setState({
          previewTransform: { ...startTransform, x, y },
        })
      })
      expect(screen.getByRole('textbox', { name: 'number-X' })).toHaveValue(String(x))
      expect(screen.getByRole('textbox', { name: 'number-Y' })).toHaveValue(String(y))
    }

    expect(layoutTestState.sectionRenderCount).toBe(parentRenderCount)
    expect(layoutTestState.keyframeRenderCounts.x).toBe(xKeyframeRenderCount)
    expect(layoutTestState.keyframeRenderCounts.y).toBe(yKeyframeRenderCount)

    act(() => {
      useItemsStore.getState()._updateItemTransform(SHAPE.id, { x: 470, y: 290 })
      useGizmoStore.getState().clearInteraction(interactionId)
    })

    expect(screen.getByRole('textbox', { name: 'number-X' })).toHaveValue('470')
    expect(screen.getByRole('textbox', { name: 'number-Y' })).toHaveValue('290')
    expect(layoutTestState.sectionRenderCount).toBe(parentRenderCount)

    view.rerender(
      <LayoutSection
        items={[
          {
            ...SHAPE,
            transform: { ...SHAPE.transform, x: 470, y: 290 },
          },
        ]}
        canvas={CANVAS}
        onTransformChange={vi.fn()}
        aspectLocked={false}
        onAspectLockToggle={vi.fn()}
      />,
    )

    expect(layoutTestState.keyframeRenderCounts.x).toBe(xKeyframeRenderCount)
    expect(layoutTestState.keyframeRenderCounts.y).toBe(yKeyframeRenderCount)
  })

  it('settles linked position values from the canonical source', () => {
    const source: ShapeItem = {
      ...SHAPE,
      id: 'source',
      transform: { ...SHAPE.transform, x: 25, y: 15 },
    }
    const target: ShapeItem = {
      ...SHAPE,
      id: 'target',
      transform: { ...SHAPE.transform, x: -20, y: -30 },
    }
    useItemsStore.getState().setItems([source, target])
    useKeyframesStore.setState({
      keyframesByItemId: {
        [source.id]: {
          itemId: source.id,
          properties: [
            {
              property: 'x',
              keyframes: [{ id: 'source-x', frame: 0, value: 325, easing: 'linear' }],
            },
            {
              property: 'y',
              keyframes: [{ id: 'source-y', frame: 0, value: 215, easing: 'linear' }],
            },
          ],
        },
        [target.id]: {
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
            {
              type: 'link',
              targetProperty: 'y',
              sourceItemId: source.id,
              sourceProperty: 'y',
              enabled: true,
              timeOffsetFrames: 0,
            },
          ],
        },
      },
    })

    renderLayout(target)

    expect(screen.getByRole('textbox', { name: 'number-X' })).toHaveValue('325')
    expect(screen.getByRole('textbox', { name: 'number-Y' })).toHaveValue('215')

    act(() => {
      useKeyframesStore.setState((state) => ({
        keyframesByItemId: {
          ...state.keyframesByItemId,
          [source.id]: {
            itemId: source.id,
            properties: [
              {
                property: 'x',
                keyframes: [{ id: 'source-x', frame: 0, value: 510, easing: 'linear' }],
              },
              {
                property: 'y',
                keyframes: [{ id: 'source-y', frame: 0, value: 340, easing: 'linear' }],
              },
            ],
          },
        },
      }))
    })

    expect(screen.getByRole('textbox', { name: 'number-X' })).toHaveValue('510')
    expect(screen.getByRole('textbox', { name: 'number-Y' })).toHaveValue('340')
  })
})
