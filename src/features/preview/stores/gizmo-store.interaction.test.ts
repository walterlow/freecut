import { afterEach, describe, expect, it } from 'vite-plus/test'
import { useGizmoStore } from './gizmo-store'
import type { Transform } from '../types/gizmo'

const transform: Transform = {
  x: 100,
  y: 100,
  width: 200,
  height: 100,
  rotation: 0,
  opacity: 1,
}

describe('gizmo interaction ownership', () => {
  afterEach(() => {
    useGizmoStore.getState().cancelInteraction()
  })

  it('does not let deferred cleanup from an older drag clear the current drag', () => {
    const firstInteractionId = useGizmoStore
      .getState()
      .startTranslate('shape-1', { x: 100, y: 100 }, transform, undefined, 'shape')
    const secondInteractionId = useGizmoStore
      .getState()
      .startTranslate('shape-1', { x: 120, y: 120 }, transform, undefined, 'shape')

    useGizmoStore.getState().updateInteraction({ x: 150, y: 140 }, false)
    useGizmoStore.getState().clearInteraction(firstInteractionId)

    expect(useGizmoStore.getState().activeGizmo?.interactionId).toBe(secondInteractionId)
    expect(useGizmoStore.getState().previewTransform).not.toBeNull()

    useGizmoStore.getState().clearInteraction(secondInteractionId)

    expect(useGizmoStore.getState().activeGizmo).toBeNull()
    expect(useGizmoStore.getState().previewTransform).toBeNull()
    expect(useGizmoStore.getState().presentationHandoff).toMatchObject({
      interactionId: secondInteractionId,
      itemId: 'shape-1',
      mode: 'translate',
    })
  })

  it('retains the final transform until a canonical presentation acknowledges it', () => {
    const interactionId = useGizmoStore
      .getState()
      .startTranslate('shape-1', { x: 100, y: 100 }, transform, undefined, 'shape')

    useGizmoStore.getState().updateInteraction({ x: 175, y: 140 }, false)
    const finalTransform = useGizmoStore.getState().previewTransform
    useGizmoStore.getState().clearInteraction(interactionId)

    expect(useGizmoStore.getState().presentationHandoff).toEqual({
      interactionId,
      itemId: 'shape-1',
      mode: 'translate',
      startTransform: transform,
      finalTransform,
    })

    useGizmoStore.getState().completePresentationHandoff(interactionId)

    expect(useGizmoStore.getState().presentationHandoff).toBeNull()
  })

  it('does not let a stale presentation acknowledgement clear a newer handoff', () => {
    const firstInteractionId = useGizmoStore
      .getState()
      .startTranslate('shape-1', { x: 100, y: 100 }, transform, undefined, 'shape')
    useGizmoStore.getState().updateInteraction({ x: 150, y: 140 }, false)
    useGizmoStore.getState().clearInteraction(firstInteractionId)

    const secondStart = useGizmoStore.getState().presentationHandoff!.finalTransform
    const secondInteractionId = useGizmoStore
      .getState()
      .startTranslate('shape-1', { x: 150, y: 140 }, secondStart, undefined, 'shape')
    useGizmoStore.getState().updateInteraction({ x: 190, y: 170 }, false)
    useGizmoStore.getState().clearInteraction(secondInteractionId)

    useGizmoStore.getState().completePresentationHandoff(firstInteractionId)
    expect(useGizmoStore.getState().presentationHandoff?.interactionId).toBe(secondInteractionId)
  })
})
