import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import type { ReactNode } from 'react'
import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import {
  buildItemTransformDependencyPlan,
  useLiveItemContentTransform,
  useLiveItemTransform,
  useLiveTransformDependencySignature,
  useLiveTransformDependencySignatureForItems,
  type LiveItemTransformSource,
} from './live-item-transform-context'
import { LiveItemTransformProvider } from './live-item-transform-provider'

function createShape(
  id: string,
  overrides: Partial<Extract<TimelineItem, { type: 'shape' }>> = {},
): Extract<TimelineItem, { type: 'shape' }> {
  return {
    id,
    trackId: 'track-1',
    type: 'shape',
    shapeType: 'polygon',
    fillColor: '#4488ff',
    label: id,
    from: 0,
    durationInFrames: 100,
    transform: { x: 0, y: 0, width: 100, height: 100 },
    ...overrides,
  }
}

function createSource(initialItems: TimelineItem[]) {
  let state = {
    itemById: Object.fromEntries(initialItems.map((item) => [item.id, item])),
  }
  const listeners = new Set<() => void>()
  const source: LiveItemTransformSource = {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    source,
    setItem(item: TimelineItem) {
      state = {
        itemById: {
          ...state.itemById,
          [item.id]: item,
        },
      }
      for (const listener of listeners) listener()
    },
  }
}

describe('live item transform context', () => {
  it('merges only the live transform and preserves runtime-enriched fields', () => {
    const stored = createShape('shape-1')
    const runtimeItem = {
      ...stored,
      label: 'runtime-resolved-label',
      runtimeDecoration: 'keep-me',
    } as typeof stored & { runtimeDecoration: string }
    const testSource = createSource([stored])
    const wrapper = ({ children }: { children: ReactNode }) => (
      <LiveItemTransformProvider source={testSource.source}>{children}</LiveItemTransformProvider>
    )

    const { result } = renderHook(() => useLiveItemTransform(runtimeItem), { wrapper })
    const moved = {
      ...stored,
      label: 'raw-store-label',
      transform: { ...stored.transform, x: 320 },
    }

    act(() => testSource.setItem(moved))

    expect(result.current.transform?.x).toBe(320)
    expect(result.current.label).toBe('runtime-resolved-label')
    expect(result.current.runtimeDecoration).toBe('keep-me')
  })

  it('updates only for transform ancestors and direct-link sources', () => {
    const parent = createShape('parent')
    const sourceItem = createShape('source')
    const unrelated = createShape('unrelated')
    const childReference = { x: 0, y: 0, width: 100, height: 100, rotation: 0 }
    const child = createShape('child', {
      transformParent: {
        parentItemId: parent.id,
        childLocalReference: childReference,
        childWorldReference: childReference,
      },
    })
    const testSource = createSource([parent, sourceItem, unrelated, child])
    const keyframesByItemId: Record<string, ItemKeyframes> = {
      [child.id]: {
        itemId: child.id,
        properties: [],
        propertyLinks: [
          {
            type: 'link',
            targetProperty: 'position',
            sourceItemId: sourceItem.id,
            sourceProperty: 'position',
            enabled: true,
            timeOffsetFrames: 0,
          },
        ],
      },
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <LiveItemTransformProvider source={testSource.source}>{children}</LiveItemTransformProvider>
    )
    let renderCount = 0

    const { result } = renderHook(
      () => {
        renderCount += 1
        return useLiveTransformDependencySignature(child, (itemId) => keyframesByItemId[itemId])
      },
      { wrapper },
    )
    const initialSignature = result.current

    act(() =>
      testSource.setItem({
        ...unrelated,
        transform: { ...unrelated.transform, x: 10 },
      }),
    )
    expect(result.current).toBe(initialSignature)
    expect(renderCount).toBe(1)

    act(() =>
      testSource.setItem({
        ...parent,
        transform: { ...parent.transform, x: 20 },
      }),
    )
    expect(result.current).not.toBe(initialSignature)
    expect(renderCount).toBe(2)
  })

  it('tracks transitive Position-link dependencies for canonical commits', () => {
    const sourceItem = createShape('source')
    const middle = createShape('middle')
    const target = createShape('target')
    const unrelated = createShape('unrelated')
    const keyframesByItemId: Record<string, ItemKeyframes> = {
      [middle.id]: {
        itemId: middle.id,
        properties: [],
        propertyLinks: [
          {
            type: 'link',
            targetProperty: 'position',
            sourceItemId: sourceItem.id,
            sourceProperty: 'position',
            enabled: true,
            timeOffsetFrames: 0,
          },
        ],
      },
      [target.id]: {
        itemId: target.id,
        properties: [],
        propertyLinks: [
          {
            type: 'link',
            targetProperty: 'position',
            sourceItemId: middle.id,
            sourceProperty: 'position',
            enabled: true,
            timeOffsetFrames: 0,
          },
        ],
      },
    }
    const testSource = createSource([sourceItem, middle, target, unrelated])
    const wrapper = ({ children }: { children: ReactNode }) => (
      <LiveItemTransformProvider source={testSource.source}>{children}</LiveItemTransformProvider>
    )
    let renderCount = 0
    const { result } = renderHook(
      () => {
        renderCount += 1
        return useLiveTransformDependencySignature(target, (itemId) => keyframesByItemId[itemId])
      },
      { wrapper },
    )
    const initialSignature = result.current

    act(() =>
      testSource.setItem({
        ...unrelated,
        transform: { ...unrelated.transform, x: 10 },
      }),
    )
    expect(result.current).toBe(initialSignature)
    expect(renderCount).toBe(1)

    act(() =>
      testSource.setItem({
        ...sourceItem,
        transform: { ...sourceItem.transform, x: 80 },
      }),
    )
    expect(result.current).not.toBe(initialSignature)
    expect(renderCount).toBe(2)
  })

  it('uses conservative wildcard invalidation for expression dependencies', () => {
    const sourceItem = createShape('source')
    const target = createShape('target')
    const keyframesByItemId: Record<string, ItemKeyframes> = {
      [target.id]: {
        itemId: target.id,
        properties: [],
        expressions: [
          {
            type: 'expression',
            targetProperty: 'position',
            source: `prop("${sourceItem.id}", "position")`,
            enabled: true,
          },
        ],
      },
    }
    const testSource = createSource([sourceItem, target])
    const wrapper = ({ children }: { children: ReactNode }) => (
      <LiveItemTransformProvider source={testSource.source}>{children}</LiveItemTransformProvider>
    )
    const { result } = renderHook(
      () => useLiveTransformDependencySignature(target, (itemId) => keyframesByItemId[itemId]),
      { wrapper },
    )
    const initialSignature = result.current

    act(() =>
      testSource.setItem({
        ...sourceItem,
        transform: { ...sourceItem.transform, x: 48 },
      }),
    )
    expect(result.current).not.toBe(initialSignature)
  })

  it('aggregates transitive dependencies for composition-wide mask consumers', () => {
    const sourceItem = createShape('source')
    const middle = createShape('middle')
    const mask = createShape('mask', { isMask: true })
    const keyframesByItemId: Record<string, ItemKeyframes> = {
      [mask.id]: {
        itemId: mask.id,
        properties: [],
        propertyLinks: [
          {
            type: 'link',
            targetProperty: 'position',
            sourceItemId: middle.id,
            sourceProperty: 'position',
            enabled: true,
            timeOffsetFrames: 0,
          },
        ],
      },
      [middle.id]: {
        itemId: middle.id,
        properties: [],
        propertyLinks: [
          {
            type: 'link',
            targetProperty: 'position',
            sourceItemId: sourceItem.id,
            sourceProperty: 'position',
            enabled: true,
            timeOffsetFrames: 0,
          },
        ],
      },
    }
    const testSource = createSource([sourceItem, middle, mask])
    const wrapper = ({ children }: { children: ReactNode }) => (
      <LiveItemTransformProvider source={testSource.source}>{children}</LiveItemTransformProvider>
    )
    const { result } = renderHook(
      () =>
        useLiveTransformDependencySignatureForItems([mask], (itemId) => keyframesByItemId[itemId]),
      { wrapper },
    )
    const initialSignature = result.current

    act(() =>
      testSource.setItem({
        ...sourceItem,
        transform: { ...sourceItem.transform, y: 72 },
      }),
    )
    expect(result.current).not.toBe(initialSignature)
  })

  it('limits raw Position-link deltas to a shared transform-parent basis', () => {
    const commonParent = createShape('parent')
    const target = createShape('target')
    const middle = createShape('middle')
    const rootSource = createShape('root-source')
    const parentedSource = createShape('parented-source', {
      transformParent: {
        parentItemId: commonParent.id,
        childLocalReference: {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
        },
        childWorldReference: {
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
        },
      },
    })
    const items = new Map(
      [commonParent, target, middle, rootSource, parentedSource].map((item) => [item.id, item]),
    )
    const targetKeyframes = (sourceItemId: string): ItemKeyframes => ({
      itemId: target.id,
      properties: [],
      propertyLinks: [
        {
          type: 'link',
          targetProperty: 'position',
          sourceItemId,
          sourceProperty: 'position',
          enabled: true,
          timeOffsetFrames: 0,
        },
      ],
    })

    const rootPlan = buildItemTransformDependencyPlan(
      target,
      (itemId) => items.get(itemId),
      (itemId) => (itemId === target.id ? targetKeyframes(rootSource.id) : undefined),
    )
    expect(rootPlan.linearTranslateSourceItemIds.has(rootSource.id)).toBe(true)

    const transitiveKeyframes: Record<string, ItemKeyframes> = {
      [target.id]: targetKeyframes(middle.id),
      [middle.id]: {
        itemId: middle.id,
        properties: [],
        propertyLinks: [
          {
            type: 'link',
            targetProperty: 'position',
            sourceItemId: rootSource.id,
            sourceProperty: 'position',
            enabled: true,
            timeOffsetFrames: 0,
          },
        ],
      },
    }
    const transitivePlan = buildItemTransformDependencyPlan(
      target,
      (itemId) => items.get(itemId),
      (itemId) => transitiveKeyframes[itemId],
    )
    expect(transitivePlan.linearTranslateSourceItemIds.has(middle.id)).toBe(true)
    expect(transitivePlan.linearTranslateSourceItemIds.has(rootSource.id)).toBe(true)

    const mismatchedPlan = buildItemTransformDependencyPlan(
      target,
      (itemId) => items.get(itemId),
      (itemId) => (itemId === target.id ? targetKeyframes(parentedSource.id) : undefined),
    )
    expect(mismatchedPlan.linearTranslateSourceItemIds.has(parentedSource.id)).toBe(false)
    expect(mismatchedPlan.sourceItemIds.has(parentedSource.id)).toBe(true)
  })

  it('keeps content idle for position-only commits but refreshes for size changes', () => {
    const stored = createShape('shape-1')
    const runtimeItem = {
      ...stored,
      runtimeDecoration: 'keep-me',
    } as typeof stored & { runtimeDecoration: string }
    const testSource = createSource([stored])
    const wrapper = ({ children }: { children: ReactNode }) => (
      <LiveItemTransformProvider source={testSource.source}>{children}</LiveItemTransformProvider>
    )
    let renderCount = 0

    const { result } = renderHook(
      () => {
        renderCount += 1
        return useLiveItemContentTransform(runtimeItem)
      },
      { wrapper },
    )

    act(() =>
      testSource.setItem({
        ...stored,
        transform: { ...stored.transform, x: 320, y: -140 },
      }),
    )
    expect(renderCount).toBe(1)
    expect(result.current.transform).toBe(runtimeItem.transform)

    act(() =>
      testSource.setItem({
        ...stored,
        transform: { ...stored.transform, x: 320, y: -140, width: 240 },
      }),
    )
    expect(renderCount).toBe(2)
    expect(result.current.transform?.width).toBe(240)
    expect(result.current.runtimeDecoration).toBe('keep-me')
  })
})
