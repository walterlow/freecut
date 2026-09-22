import React, { useCallback, useContext, useId, useMemo } from 'react'
import {
  Rect,
  Circle,
  Triangle,
  Ellipse,
  Star,
  Polygon,
  Heart,
  ShapePath,
  buildBezierPathData,
} from '@/shared/graphics/shapes'
import { flattenBezierPath } from '@/shared/graphics/shapes/bezier-path'
import { hasActiveTaper } from '@/shared/graphics/shapes/taper-path'
import { getLinearGradientUnitEndpoints } from '@/shared/graphics/shapes/linear-gradient'
import {
  buildTaperedOutline,
  getTaperedOutlineFillPath,
} from '@/shared/graphics/shapes/taper-outline'
import { useItemGizmoPreview, useKeyframesStore } from '@/runtime/composition-runtime/deps/stores'
import type { ShapeItem } from '@/types/timeline'
import { useCompositionSpace } from '../contexts/composition-space-context'
import { useItemVisualTransform } from '../contexts/item-visual-transform-context'
import { useSequenceContext } from '@/runtime/composition-runtime/deps/player'
import { useItemKeyframesFromContext } from '../contexts/keyframes-context'
import { KeyframesContext } from '../contexts/keyframes-context-core'
import { resolveAnimatedShapeItem } from '@/runtime/composition-runtime/deps/keyframes'
import { resolveShapePaint, resolveShapeRenderProps } from './shape-content-props'

/**
 * Shape content with live property preview support.
 * Renders Composition shapes (Rect, Circle, Triangle, Ellipse, Star, Polygon).
 * Reads preview values from gizmo store for real-time updates during editing.
 */
export const ShapeContent: React.FC<{ item: ShapeItem & { _sequenceFrameOffset?: number } }> = ({
  item,
}) => {
  const compositionSpace = useCompositionSpace()
  const renderScaleX = compositionSpace?.scaleX ?? 1
  const renderScaleY = compositionSpace?.scaleY ?? 1
  const renderScale = compositionSpace?.scale ?? 1
  const visualTransform = useItemVisualTransform()
  const sequenceContext = useSequenceContext()
  const keyframesContext = useContext(KeyframesContext)
  const contextKeyframes = useItemKeyframesFromContext(item.id)
  const storeKeyframes = useKeyframesStore(
    useCallback((s) => s.keyframesByItemId[item.id], [item.id]),
  )
  const sequenceFrameOffset =
    item._sequenceFrameOffset ??
    (sequenceContext ? item.from - (sequenceContext.from - sequenceContext.parentFrom) : 0)
  const relativeFrame = (sequenceContext?.localFrame ?? 0) - sequenceFrameOffset
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
  const { linearGradient, fillPaint, fallbackBackground } = paint
  const gradientEndpoints = linearGradient
    ? getLinearGradientUnitEndpoints(linearGradient.angle)
    : null
  const {
    shapeType,
    pathClosed,
    strokeEnabled,
    strokeColor,
    strokeWidth,
    cornerRadius,
    direction,
    points,
    innerRadius,
    strokeLineCap,
    strokePaint: strokeProps,
    trimPath: trimPathProps,
    taper: taperProps,
  } = shapeProps

  // Get dimensions with preview support for real-time gizmo scaling
  // Priority: Unified preview (group/properties) > Single gizmo preview > Base transform
  let width = (visualTransform?.width ?? item.transform?.width ?? 200) * renderScaleX
  let height = (visualTransform?.height ?? item.transform?.height ?? 200) * renderScaleY

  const itemPreviewTransform = itemPreview?.transform
  const isGizmoPreviewActive = activeGizmo?.itemId === item.id && previewTransform !== null

  if (!visualTransform && itemPreviewTransform) {
    width = (itemPreviewTransform.width ?? width / renderScaleX) * renderScaleX
    height = (itemPreviewTransform.height ?? height / renderScaleY) * renderScaleY
  } else if (!visualTransform && isGizmoPreviewActive && previewTransform) {
    width = previewTransform.width * renderScaleX
    height = previewTransform.height * renderScaleY
  }
  const fillDefinition =
    linearGradient && gradientEndpoints ? (
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={gradientEndpoints.start.x * width}
          y1={gradientEndpoints.start.y * height}
          x2={gradientEndpoints.end.x * width}
          y2={gradientEndpoints.end.y * height}
        >
          <stop offset="0%" stopColor={linearGradient.startColor} />
          <stop offset="100%" stopColor={linearGradient.endColor} />
        </linearGradient>
      </defs>
    ) : undefined


  // Check if aspect ratio is locked (for squish/squash behavior)
  // Read from preview transforms if available, otherwise from item
  let aspectLocked = item.transform?.aspectRatioLocked ?? true
  if (itemPreviewTransform?.aspectRatioLocked !== undefined) {
    aspectLocked = itemPreviewTransform.aspectRatioLocked
  } else if (isGizmoPreviewActive && previewTransform?.aspectRatioLocked !== undefined) {
    aspectLocked = previewTransform.aspectRatioLocked
  }

  // Centering wrapper style for SVG shapes
  const centerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }

  // For shapes that need to squish/squash when aspect is unlocked,
  // we render at base size and apply CSS scale transform
  const baseSize = Math.min(width, height)
  const scaleX = aspectLocked ? 1 : width / baseSize
  const scaleY = aspectLocked ? 1 : height / baseSize
  const needsScale = !aspectLocked && (scaleX !== 1 || scaleY !== 1)

  const scaleStyle: React.CSSProperties = needsScale
    ? {
        transform: `scale(${scaleX}, ${scaleY})`,
      }
    : {}

  // Render appropriate shape based on shapeType
  switch (shapeType) {
    case 'rectangle':
      // Rectangle fills the entire container (naturally supports non-proportional)
      return (
        <div style={centerStyle}>
          <Rect
            width={width}
            height={height}
            fill={fillPaint}
            fillDefinition={fillDefinition}
            cornerRadius={cornerRadius}
            {...strokeProps}
            {...trimPathProps}
            {...taperProps}
          />
        </div>
      )

    case 'circle': {
      // Circle: squish/squash when aspect unlocked
      const radius = baseSize / 2
      return (
        <div style={centerStyle}>
          <div style={scaleStyle}>
            <Circle
              radius={radius}
              fill={fillPaint}
              fillDefinition={fillDefinition}
              {...strokeProps}
              {...trimPathProps}
              {...taperProps}
            />
          </div>
        </div>
      )
    }

    case 'triangle': {
      // Triangle: squish/squash when aspect unlocked
      return (
        <div style={centerStyle}>
          <div style={scaleStyle}>
            <Triangle
              length={baseSize}
              direction={direction}
              fill={fillPaint}
              fillDefinition={fillDefinition}
              cornerRadius={cornerRadius}
              {...strokeProps}
              {...trimPathProps}
              {...taperProps}
            />
          </div>
        </div>
      )
    }

    case 'ellipse': {
      // Ellipse naturally supports non-proportional via rx/ry
      const rx = width / 2
      const ry = height / 2
      return (
        <div style={centerStyle}>
          <Ellipse
            rx={rx}
            ry={ry}
            fill={fillPaint}
            fillDefinition={fillDefinition}
            {...strokeProps}
            {...trimPathProps}
            {...taperProps}
          />
        </div>
      )
    }

    case 'star': {
      // Star: squish/squash when aspect unlocked
      const outerRadius = baseSize / 2
      const innerRadiusValue = outerRadius * innerRadius
      return (
        <div style={centerStyle}>
          <div style={scaleStyle}>
            <Star
              points={points}
              outerRadius={outerRadius}
              innerRadius={innerRadiusValue}
              fill={fillPaint}
              fillDefinition={fillDefinition}
              cornerRadius={cornerRadius}
              {...strokeProps}
              {...trimPathProps}
              {...taperProps}
            />
          </div>
        </div>
      )
    }

    case 'polygon': {
      // Polygon: squish/squash when aspect unlocked
      const radius = baseSize / 2
      return (
        <div style={centerStyle}>
          <div style={scaleStyle}>
            <Polygon
              points={points}
              radius={radius}
              fill={fillPaint}
              fillDefinition={fillDefinition}
              cornerRadius={cornerRadius}
              {...strokeProps}
              {...trimPathProps}
              {...taperProps}
            />
          </div>
        </div>
      )
    }

    case 'heart': {
      // Heart: use Composition's Heart component for consistency with mask path generation
      // Heart output width = 1.1 × input height, so we scale input to fit within baseSize
      // Using height = baseSize / 1.1 ensures output width = baseSize (fits container)
      const heartHeight = baseSize / 1.1
      return (
        <div style={centerStyle}>
          <div style={scaleStyle}>
            <Heart
              height={heartHeight}
              fill={fillPaint}
              fillDefinition={fillDefinition}
              {...strokeProps}
              {...trimPathProps}
              {...taperProps}
            />
          </div>
        </div>
      )
    }

    case 'path': {
      // Custom bezier path drawn with pen tool
      const pathVerts = resolvedItem.pathVertices
      if (!pathVerts || pathVerts.length < 2) {
        return <div style={{ width: '100%', height: '100%', background: fallbackBackground }} />
      }
      const pathData = buildBezierPathData(pathVerts, width, height, pathClosed)
      const taperedOutline =
        strokeEnabled && strokeColor && hasActiveTaper(taperProps)
          ? buildTaperedOutline(flattenBezierPath(pathVerts, width, height, pathClosed), {
              strokeWidth,
              lineCap: strokeLineCap,
              ...trimPathProps,
              ...taperProps,
            })
          : null
      return (
        <div style={centerStyle}>
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} overflow="visible">
            {fillDefinition}
            {taperedOutline ? (
              <>
                <path d={pathData} fill={fillPaint} />
                <path
                  d={getTaperedOutlineFillPath(taperedOutline)}
                  fill={strokeColor}
                  data-taper-outline="true"
                  data-taper-cap-count={taperedOutline.caps.length}
                />
              </>
            ) : (
              <ShapePath
                d={pathData}
                fill={fillPaint}
                {...strokeProps}
                {...trimPathProps}
                {...taperProps}
              />
            )}
          </svg>
        </div>
      )
    }

    default:
      // Fallback to simple colored div for unknown types
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            background: fallbackBackground,
            borderRadius: cornerRadius,
          }}
        />
      )
  }
}
