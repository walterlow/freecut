import React, { useCallback, useContext, useId, useMemo } from 'react'
import { useItemGizmoPreview, useKeyframesStore } from '@/runtime/composition-runtime/deps/stores'
import type { ShapeItem } from '@/types/timeline'
import { useCompositionSpace } from '../contexts/composition-space-context'
import { useItemVisualTransform } from '../contexts/item-visual-transform-context'
import { useSequenceContext } from '@/runtime/composition-runtime/deps/player'
import { useItemKeyframesFromContext } from '../contexts/keyframes-context'
import { KeyframesContext } from '../contexts/keyframes-context-core'
import { resolveAnimatedShapeItem } from '@/runtime/composition-runtime/deps/keyframes'
import { ShapeGeometry } from './shape-content-geometry'
import { resolveShapePaint, resolveShapeRenderProps } from './shape-content-props'
import {
  resolveRenderScale,
  resolveShapeLayout,
  resolveShapeRelativeFrame,
} from './shape-content-layout'

/**
 * Shape content with live property preview support.
 * Renders Composition shapes (Rect, Circle, Triangle, Ellipse, Star, Polygon).
 * Reads preview values from gizmo store for real-time updates during editing.
 */
export const ShapeContent: React.FC<{ item: ShapeItem & { _sequenceFrameOffset?: number } }> = ({
  item,
}) => {
  const compositionSpace = useCompositionSpace()
  const { scaleX: renderScaleX, scaleY: renderScaleY, scale: renderScale } =
    resolveRenderScale(compositionSpace)
  const visualTransform = useItemVisualTransform()
  const sequenceContext = useSequenceContext()
  const keyframesContext = useContext(KeyframesContext)
  const contextKeyframes = useItemKeyframesFromContext(item.id)
  const storeKeyframes = useKeyframesStore(
    useCallback((s) => s.keyframesByItemId[item.id], [item.id]),
  )
  const relativeFrame = resolveShapeRelativeFrame(item, sequenceContext)
  const resolvedItem = useMemo(
    () =>
      resolveAnimatedShapeItem(
        item,
        contextKeyframes ?? storeKeyframes,
        relativeFrame,
        keyframesContext?.canvas
          ? {
              globalFrame: item.from + relativeFrame,
              canvas: keyframesContext.canvas,
              getItem: keyframesContext.getItem,
              getKeyframes: keyframesContext.getItemKeyframes,
            }
          : undefined,
      ),
    [contextKeyframes, item, keyframesContext, relativeFrame, storeKeyframes],
  )

  const { activeGizmo, previewTransform, itemPreview } = useItemGizmoPreview(item.id, {
    imperativeTranslate: true,
  })
  const gradientId = `shape-gradient-${useId().replaceAll(':', '')}`

  const shapeProps = resolveShapeRenderProps(itemPreview?.properties, resolvedItem, renderScale)
  const paint = resolveShapePaint(shapeProps, gradientId)

  const layout = resolveShapeLayout({
    item,
    visualTransform,
    itemPreviewTransform: itemPreview?.transform,
    previewTransform,
    activeGizmo,
    renderScaleX,
    renderScaleY,
  })

  return (
    <ShapeGeometry
      shapeProps={shapeProps}
      paint={paint}
      layout={layout}
      gradientId={gradientId}
      pathVertices={resolvedItem.pathVertices}
    />
  )
}
