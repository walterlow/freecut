import { describe, expect, it } from 'vite-plus/test'
import type { ResolvedTransform } from '@/types/transform'
import { resolveGizmoDomTranslation } from './gizmo-dom-translation'

const transform = (x: number, y: number) => ({
  x,
  y,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
})

const resolved = (x: number, y: number): ResolvedTransform => ({
  ...transform(x, y),
  anchorX: 50,
  anchorY: 50,
  cornerRadius: 0,
})

describe('resolveGizmoDomTranslation', () => {
  it('moves the selected DOM item from its last painted transform to the latest preview', () => {
    expect(
      resolveGizmoDomTranslation({
        itemId: 'polygon',
        activeItemId: 'polygon',
        activeStartTransform: transform(100, 80),
        previewTransform: transform(124, 68),
        renderedTransform: resolved(112, 74),
        interactionStartTransform: resolved(100, 80),
        scaleX: 0.5,
        scaleY: 0.5,
      }),
    ).toEqual({ x: 6, y: -3 })
  })

  it('applies the source delta to a Position-linked follower', () => {
    expect(
      resolveGizmoDomTranslation({
        itemId: 'text',
        positionSourceItemId: 'polygon',
        activeItemId: 'polygon',
        activeStartTransform: transform(100, 80),
        previewTransform: transform(124, 68),
        renderedTransform: resolved(210, 160),
        interactionStartTransform: resolved(200, 170),
        scaleX: 0.5,
        scaleY: 0.25,
      }),
    ).toEqual({ x: 7, y: -0.5 })
  })

  it('applies the parent delta to an imperatively presented descendant', () => {
    expect(
      resolveGizmoDomTranslation({
        itemId: 'text',
        followsActiveItem: true,
        activeItemId: 'polygon',
        activeStartTransform: transform(100, 80),
        previewTransform: transform(124, 68),
        renderedTransform: resolved(210, 160),
        interactionStartTransform: resolved(200, 170),
        scaleX: 0.5,
        scaleY: 0.25,
      }),
    ).toEqual({ x: 7, y: -0.5 })
  })

  it('does not touch unrelated DOM items', () => {
    expect(
      resolveGizmoDomTranslation({
        itemId: 'other',
        activeItemId: 'polygon',
        activeStartTransform: transform(100, 80),
        previewTransform: transform(124, 68),
        renderedTransform: resolved(0, 0),
        interactionStartTransform: resolved(0, 0),
        scaleX: 1,
        scaleY: 1,
      }),
    ).toBeNull()
  })
})
