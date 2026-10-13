import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { useGizmoStore } from './gizmo-store'
import { useItemGizmoPreview } from './use-item-gizmo-preview'

const transform = {
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
}

describe('useItemGizmoPreview', () => {
  beforeEach(() => {
    useGizmoStore.getState().cancelInteraction()
  })

  it('does not re-render item content for translate pointer updates', () => {
    let renderCount = 0
    const { result } = renderHook(() => {
      renderCount += 1
      return useItemGizmoPreview('polygon', { imperativeTranslate: true })
    })

    act(() => {
      useGizmoStore.getState().startTranslate('polygon', { x: 0, y: 0 }, transform, 0, 'shape')
    })
    const renderCountAfterStart = renderCount

    act(() => {
      useGizmoStore.getState().updateInteraction({ x: 24, y: 12 }, false)
    })

    expect(renderCount).toBe(renderCountAfterStart)
    expect(result.current.activeGizmo).toEqual({
      itemId: 'polygon',
      mode: 'translate',
    })
    expect(result.current.previewTransform).toBeNull()
  })

  it('does not wake an unrelated item when another item is translated', () => {
    let renderCount = 0
    renderHook(() => {
      renderCount += 1
      return useItemGizmoPreview('text', { imperativeTranslate: true })
    })
    const initialRenderCount = renderCount

    act(() => {
      useGizmoStore.getState().startTranslate('polygon', { x: 0, y: 0 }, transform, 0, 'shape')
      useGizmoStore.getState().updateInteraction({ x: 24, y: 12 }, false)
    })

    expect(renderCount).toBe(initialRenderCount)
  })
})
