import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import type { ItemKeyframes } from '@/types/keyframe'
import type { ControllerItem, ShapeItem, TimelineItem } from '@/types/timeline'
import type { ResolvedTransform } from '@/types/transform'
import { createTransformParentBinding } from '@/shared/utils/transform-parenting'
import { VideoConfigProvider, SequenceContext } from '@/runtime/composition-runtime/deps/player'
import { useGizmoStore } from '@/runtime/composition-runtime/deps/stores'
import { KeyframesProvider } from '../../contexts/keyframes-context'
import {
  buildItemTransformDependencyPlan,
  type LiveItemTransformSource,
} from '../../contexts/live-item-transform-context'
import { LiveItemTransformProvider } from '../../contexts/live-item-transform-provider'
import { useItemVisualState } from './use-item-visual-state'

const canvas = { width: 1920, height: 1080, fps: 30 }

function resolvedTransform(overrides: Partial<ResolvedTransform> = {}): ResolvedTransform {
  return {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    anchorX: 50,
    anchorY: 50,
    rotation: 0,
    opacity: 1,
    cornerRadius: 0,
    ...overrides,
  }
}

const nullObject: ControllerItem = {
  id: 'null-1',
  type: 'controller',
  controllerKind: 'null',
  trackId: 'null-track',
  from: 0,
  durationInFrames: 120,
  label: 'Null Object',
  transform: resolvedTransform(),
}

const child: ShapeItem = {
  id: 'child-1',
  type: 'shape',
  shapeType: 'rectangle',
  trackId: 'child-track',
  from: 0,
  durationInFrames: 120,
  label: 'Child',
  fillColor: '#3b82f6',
  strokeWidth: 0,
  transform: resolvedTransform(),
  transformParent: createTransformParentBinding({
    childLocal: resolvedTransform(),
    childWorld: resolvedTransform(),
    parentItemId: nullObject.id,
    parentWorld: resolvedTransform(),
  }),
}

function TransformXProbe({ item }: { item: TimelineItem }) {
  const { transform } = useItemVisualState(item)
  return <output data-testid="transform-x">{transform.x}</output>
}

function ImperativeParentTransformXProbe({ item }: { item: TimelineItem }) {
  const transformDependencyPlan = buildItemTransformDependencyPlan(
    item,
    (itemId) => (itemId === nullObject.id ? nullObject : undefined),
    () => undefined,
  )
  const { transform } = useItemVisualState(item, [], { transformDependencyPlan })
  return <output data-testid="transform-x">{transform.x}</output>
}

function PlannedTransformXProbe({
  item,
  items,
  keyframes,
}: {
  item: TimelineItem
  items: TimelineItem[]
  keyframes: ItemKeyframes[]
}) {
  const transformDependencyPlan = buildItemTransformDependencyPlan(
    item,
    (itemId) => items.find((candidate) => candidate.id === itemId),
    (itemId) => keyframes.find((candidate) => candidate.itemId === itemId),
  )
  const { transform } = useItemVisualState(item, [], { transformDependencyPlan })
  return <output data-testid="transform-x">{transform.x}</output>
}

describe('useItemVisualState parenting', () => {
  afterEach(() => {
    cleanup()
    useGizmoStore.getState().cancelInteraction()
    useGizmoStore.getState().clearPreview()
    useGizmoStore.getState().setSnappingEnabled(true)
  })

  it('moves a child during its parent Null pointer drag before mouseup', () => {
    render(
      <VideoConfigProvider
        id="parenting-preview"
        width={canvas.width}
        height={canvas.height}
        fps={canvas.fps}
        durationInFrames={120}
      >
        <SequenceContext.Provider
          value={{ from: 0, parentFrom: 0, localFrame: 0, durationInFrames: 120 }}
        >
          <KeyframesProvider keyframes={[]} items={[nullObject, child]} canvas={canvas}>
            <TransformXProbe item={child} />
          </KeyframesProvider>
        </SequenceContext.Provider>
      </VideoConfigProvider>,
    )

    expect(screen.getByTestId('transform-x')).toHaveTextContent('0')

    act(() => {
      const gizmo = useGizmoStore.getState()
      gizmo.setSnappingEnabled(false)
      gizmo.startTranslate(nullObject.id, { x: 0, y: 0 }, resolvedTransform())
      gizmo.updateInteraction({ x: 120, y: 0 }, false)
    })

    expect(screen.getByTestId('transform-x')).toHaveTextContent('120')
  })

  it('keeps a child React transform stable when its parent drag is presented imperatively', () => {
    render(
      <VideoConfigProvider
        id="parenting-imperative-preview"
        width={canvas.width}
        height={canvas.height}
        fps={canvas.fps}
        durationInFrames={120}
      >
        <SequenceContext.Provider
          value={{ from: 0, parentFrom: 0, localFrame: 0, durationInFrames: 120 }}
        >
          <KeyframesProvider keyframes={[]} items={[nullObject, child]} canvas={canvas}>
            <ImperativeParentTransformXProbe item={child} />
          </KeyframesProvider>
        </SequenceContext.Provider>
      </VideoConfigProvider>,
    )

    act(() => {
      const gizmo = useGizmoStore.getState()
      gizmo.setSnappingEnabled(false)
      gizmo.startTranslate(nullObject.id, { x: 0, y: 0 }, resolvedTransform())
      gizmo.updateInteraction({ x: 120, y: 0 }, false)
    })

    expect(screen.getByTestId('transform-x')).toHaveTextContent('0')
  })

  it('keeps the React transform stable while a parented item uses the imperative drag preview', () => {
    const movedParent: ControllerItem = {
      ...nullObject,
      transform: resolvedTransform({ x: 100 }),
    }
    const movedChild: ShapeItem = {
      ...child,
      transform: resolvedTransform({ x: 10, width: 20, height: 20 }),
      transformParent: createTransformParentBinding({
        childLocal: resolvedTransform({ x: 10, width: 20, height: 20 }),
        childWorld: resolvedTransform({ x: 10, width: 20, height: 20 }),
        parentItemId: movedParent.id,
        parentWorld: resolvedTransform(),
      }),
    }

    render(
      <VideoConfigProvider
        id="parented-child-gizmo-preview"
        width={canvas.width}
        height={canvas.height}
        fps={canvas.fps}
        durationInFrames={120}
      >
        <SequenceContext.Provider
          value={{ from: 0, parentFrom: 0, localFrame: 0, durationInFrames: 120 }}
        >
          <KeyframesProvider keyframes={[]} items={[movedParent, movedChild]} canvas={canvas}>
            <TransformXProbe item={movedChild} />
          </KeyframesProvider>
        </SequenceContext.Provider>
      </VideoConfigProvider>,
    )

    expect(screen.getByTestId('transform-x')).toHaveTextContent('110')

    act(() => {
      const gizmo = useGizmoStore.getState()
      gizmo.setSnappingEnabled(false)
      gizmo.startTranslate(
        movedChild.id,
        { x: 110, y: 0 },
        resolvedTransform({ x: 110, width: 20, height: 20 }),
        0,
        'shape',
      )
      gizmo.updateInteraction({ x: 130, y: 0 }, false)
    })

    expect(screen.getByTestId('transform-x')).toHaveTextContent('110')
  })

  it('moves a child during a coalesced parent Position preview before commit', () => {
    render(
      <VideoConfigProvider
        id="parenting-position-preview"
        width={canvas.width}
        height={canvas.height}
        fps={canvas.fps}
        durationInFrames={120}
      >
        <SequenceContext.Provider
          value={{ from: 0, parentFrom: 0, localFrame: 0, durationInFrames: 120 }}
        >
          <KeyframesProvider keyframes={[]} items={[nullObject, child]} canvas={canvas}>
            <TransformXProbe item={child} />
          </KeyframesProvider>
        </SequenceContext.Provider>
      </VideoConfigProvider>,
    )

    expect(screen.getByTestId('transform-x')).toHaveTextContent('0')

    act(() => {
      useGizmoStore.getState().setTransformPreview({
        [nullObject.id]: { x: 80, y: 0 },
      })
    })

    expect(screen.getByTestId('transform-x')).toHaveTextContent('80')
  })

  it('re-resolves a child from a live parent transform without replacing scene props', () => {
    let liveState = {
      itemById: {
        [nullObject.id]: nullObject as TimelineItem,
        [child.id]: child as TimelineItem,
      },
    }
    const listeners = new Set<() => void>()
    const liveSource: LiveItemTransformSource = {
      getState: () => liveState,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }

    render(
      <VideoConfigProvider
        id="parenting-live-transform"
        width={canvas.width}
        height={canvas.height}
        fps={canvas.fps}
        durationInFrames={120}
      >
        <SequenceContext.Provider
          value={{ from: 0, parentFrom: 0, localFrame: 0, durationInFrames: 120 }}
        >
          <LiveItemTransformProvider source={liveSource}>
            <KeyframesProvider keyframes={[]} items={[nullObject, child]} canvas={canvas}>
              <TransformXProbe item={child} />
            </KeyframesProvider>
          </LiveItemTransformProvider>
        </SequenceContext.Provider>
      </VideoConfigProvider>,
    )

    expect(screen.getByTestId('transform-x')).toHaveTextContent('0')

    act(() => {
      const movedParent = {
        ...nullObject,
        transform: resolvedTransform({ x: 140 }),
      }
      liveState = {
        itemById: {
          ...liveState.itemById,
          [movedParent.id]: movedParent,
        },
      }
      for (const listener of listeners) listener()
    })

    expect(screen.getByTestId('transform-x')).toHaveTextContent('140')
  })

  it('moves a Position-linked target during its source preview before commit', () => {
    const linkedTarget: ShapeItem = {
      ...child,
      id: 'linked-target',
      transformParent: undefined,
    }
    const linkedTargetKeyframes: ItemKeyframes = {
      itemId: linkedTarget.id,
      properties: [],
      expressions: [
        {
          type: 'link',
          targetProperty: 'position',
          sourceItemId: nullObject.id,
          sourceProperty: 'position',
          enabled: true,
          timeOffsetFrames: 0,
        },
      ],
    }
    render(
      <VideoConfigProvider
        id="linked-position-preview"
        width={canvas.width}
        height={canvas.height}
        fps={canvas.fps}
        durationInFrames={120}
      >
        <SequenceContext.Provider
          value={{ from: 0, parentFrom: 0, localFrame: 0, durationInFrames: 120 }}
        >
          <KeyframesProvider
            keyframes={[linkedTargetKeyframes]}
            items={[nullObject, linkedTarget]}
            canvas={canvas}
          >
            <TransformXProbe item={linkedTarget} />
          </KeyframesProvider>
        </SequenceContext.Provider>
      </VideoConfigProvider>,
    )

    expect(screen.getByTestId('transform-x')).toHaveTextContent('0')

    act(() => {
      useGizmoStore.getState().setTransformPreview({
        [nullObject.id]: { x: 95, y: 0 },
      })
    })

    expect(screen.getByTestId('transform-x')).toHaveTextContent('95')
    expect(nullObject.transform?.x).toBe(0)
  })

  it('re-resolves a Position link when source and target use different parent bases', () => {
    const parent = {
      ...nullObject,
      transform: resolvedTransform({ x: 100 }),
    }
    const sourceLocal = resolvedTransform({ x: 10 })
    const source: ShapeItem = {
      ...child,
      id: 'parented-source',
      transform: sourceLocal,
      transformParent: createTransformParentBinding({
        childLocal: sourceLocal,
        childWorld: resolvedTransform({ x: 110 }),
        parentItemId: parent.id,
        parentWorld: resolvedTransform({ x: 100 }),
      }),
    }
    const target: ShapeItem = {
      ...child,
      id: 'root-target',
      transformParent: undefined,
    }
    const targetKeyframes: ItemKeyframes = {
      itemId: target.id,
      properties: [],
      propertyLinks: [
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
    const items: TimelineItem[] = [parent, source, target]

    render(
      <VideoConfigProvider
        id="linked-position-different-bases"
        width={canvas.width}
        height={canvas.height}
        fps={canvas.fps}
        durationInFrames={120}
      >
        <SequenceContext.Provider
          value={{ from: 0, parentFrom: 0, localFrame: 0, durationInFrames: 120 }}
        >
          <KeyframesProvider keyframes={[targetKeyframes]} items={items} canvas={canvas}>
            <PlannedTransformXProbe item={target} items={items} keyframes={[targetKeyframes]} />
          </KeyframesProvider>
        </SequenceContext.Provider>
      </VideoConfigProvider>,
    )

    expect(screen.getByTestId('transform-x')).toHaveTextContent('10')

    act(() => {
      const gizmo = useGizmoStore.getState()
      gizmo.setSnappingEnabled(false)
      gizmo.startTranslate(source.id, { x: 110, y: 0 }, resolvedTransform({ x: 110 }))
      gizmo.updateInteraction({ x: 130, y: 0 }, false)
    })

    // The source's world drag resolves to local x=30 before the root target
    // consumes the Position link. The React probe would remain at x=10 if this
    // mismatched basis were incorrectly routed through the imperative bridge.
    expect(screen.getByTestId('transform-x')).toHaveTextContent('30')
  })
})
