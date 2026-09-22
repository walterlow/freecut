import React from 'react'
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
import { getLinearGradientUnitEndpoints } from '@/shared/graphics/shapes/linear-gradient'
import { getTaperedOutlineFillPath } from '@/shared/graphics/shapes/taper-outline'
import type { MaskVertex } from '@/types/masks'
import type { ResolvedShapePaint, ResolvedShapeProps } from './shape-content-props'
import type { ShapeLayout } from './shape-content-layout'
import { resolvePathTaperedOutline } from './shape-content-path'

/**
 * Draws the SVG geometry for one shape kind from already-resolved values.
 * Every prop here is derived by the caller; this module only picks the
 * primitive, so it holds no state and reads no store.
 */

export interface ShapeGeometryProps {
  shapeProps: ResolvedShapeProps
  paint: ResolvedShapePaint
  layout: ShapeLayout
  gradientId: string
  pathVertices: MaskVertex[] | undefined
}

/** Centering wrapper for every SVG shape (constant, so it never re-allocates). */
const SHAPE_CENTER_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

interface ShapeFillDefinitionProps {
  gradient: ResolvedShapePaint['linearGradient']
  width: number
  height: number
  gradientId: string
}

/** Two-stop linear fill definition; renders nothing for solid fills. */
function ShapeFillDefinition({ gradient, width, height, gradientId }: ShapeFillDefinitionProps) {
  if (!gradient) return null

  const endpoints = getLinearGradientUnitEndpoints(gradient.angle)
  return (
    <defs>
      <linearGradient
        id={gradientId}
        gradientUnits="userSpaceOnUse"
        x1={endpoints.start.x * width}
        y1={endpoints.start.y * height}
        x2={endpoints.end.x * width}
        y2={endpoints.end.y * height}
      >
        <stop offset="0%" stopColor={gradient.startColor} />
        <stop offset="100%" stopColor={gradient.endColor} />
      </linearGradient>
    </defs>
  )
}

interface ShapeKindProps {
  shapeProps: ResolvedShapeProps
  paint: ResolvedShapePaint
  layout: ShapeLayout
  fillDefinition: React.ReactNode
}

/** Rectangle fills the entire container (naturally supports non-proportional). */
function RectangleShape({ shapeProps, paint, layout, fillDefinition }: ShapeKindProps) {
  return (
    <div style={SHAPE_CENTER_STYLE}>
      <Rect
        width={layout.width}
        height={layout.height}
        fill={paint.fillPaint}
        fillDefinition={fillDefinition}
        cornerRadius={shapeProps.cornerRadius}
        {...shapeProps.strokePaint}
        {...shapeProps.trimPath}
        {...shapeProps.taper}
      />
    </div>
  )
}

/** Circle, triangle, star, polygon and heart squish/squash when unlocked. */
function CircleShape({ shapeProps, paint, layout, fillDefinition }: ShapeKindProps) {
  const radius = layout.baseSize / 2
  return (
    <div style={SHAPE_CENTER_STYLE}>
      <div style={layout.scaleStyle}>
        <Circle
          radius={radius}
          fill={paint.fillPaint}
          fillDefinition={fillDefinition}
          {...shapeProps.strokePaint}
          {...shapeProps.trimPath}
          {...shapeProps.taper}
        />
      </div>
    </div>
  )
}

function TriangleShape({ shapeProps, paint, layout, fillDefinition }: ShapeKindProps) {
  return (
    <div style={SHAPE_CENTER_STYLE}>
      <div style={layout.scaleStyle}>
        <Triangle
          length={layout.baseSize}
          direction={shapeProps.direction}
          fill={paint.fillPaint}
          fillDefinition={fillDefinition}
          cornerRadius={shapeProps.cornerRadius}
          {...shapeProps.strokePaint}
          {...shapeProps.trimPath}
          {...shapeProps.taper}
        />
      </div>
    </div>
  )
}

/** Ellipse naturally supports non-proportional via rx/ry. */
function EllipseShape({ shapeProps, paint, layout, fillDefinition }: ShapeKindProps) {
  return (
    <div style={SHAPE_CENTER_STYLE}>
      <Ellipse
        rx={layout.width / 2}
        ry={layout.height / 2}
        fill={paint.fillPaint}
        fillDefinition={fillDefinition}
        {...shapeProps.strokePaint}
        {...shapeProps.trimPath}
        {...shapeProps.taper}
      />
    </div>
  )
}

function StarShape({ shapeProps, paint, layout, fillDefinition }: ShapeKindProps) {
  const outerRadius = layout.baseSize / 2
  const innerRadiusValue = outerRadius * shapeProps.innerRadius
  return (
    <div style={SHAPE_CENTER_STYLE}>
      <div style={layout.scaleStyle}>
        <Star
          points={shapeProps.points}
          outerRadius={outerRadius}
          innerRadius={innerRadiusValue}
          fill={paint.fillPaint}
          fillDefinition={fillDefinition}
          cornerRadius={shapeProps.cornerRadius}
          {...shapeProps.strokePaint}
          {...shapeProps.trimPath}
          {...shapeProps.taper}
        />
      </div>
    </div>
  )
}

function PolygonShape({ shapeProps, paint, layout, fillDefinition }: ShapeKindProps) {
  const radius = layout.baseSize / 2
  return (
    <div style={SHAPE_CENTER_STYLE}>
      <div style={layout.scaleStyle}>
        <Polygon
          points={shapeProps.points}
          radius={radius}
          fill={paint.fillPaint}
          fillDefinition={fillDefinition}
          cornerRadius={shapeProps.cornerRadius}
          {...shapeProps.strokePaint}
          {...shapeProps.trimPath}
          {...shapeProps.taper}
        />
      </div>
    </div>
  )
}

/**
 * Heart uses Composition's Heart component for consistency with mask path
 * generation. Heart output width = 1.1 × input height, so the input is scaled
 * to fit within baseSize (height = baseSize / 1.1 keeps the width at baseSize).
 */
function HeartShape({ shapeProps, paint, layout, fillDefinition }: ShapeKindProps) {
  const heartHeight = layout.baseSize / 1.1
  return (
    <div style={SHAPE_CENTER_STYLE}>
      <div style={layout.scaleStyle}>
        <Heart
          height={heartHeight}
          fill={paint.fillPaint}
          fillDefinition={fillDefinition}
          {...shapeProps.strokePaint}
          {...shapeProps.trimPath}
          {...shapeProps.taper}
        />
      </div>
    </div>
  )
}

/** Custom bezier path drawn with the pen tool. */
function PathShape({
  shapeProps,
  paint,
  layout,
  fillDefinition,
  pathVertices,
}: ShapeKindProps & { pathVertices: MaskVertex[] | undefined }) {
  if (!pathVertices || pathVertices.length < 2) {
    return <div style={{ width: '100%', height: '100%', background: paint.fallbackBackground }} />
  }

  const pathData = buildBezierPathData(
    pathVertices,
    layout.width,
    layout.height,
    shapeProps.pathClosed,
  )
  const taperedOutline = resolvePathTaperedOutline(pathVertices, shapeProps, layout)

  return (
    <div style={SHAPE_CENTER_STYLE}>
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        overflow="visible"
      >
        {fillDefinition}
        {taperedOutline ? (
          <>
            <path d={pathData} fill={paint.fillPaint} />
            <path
              d={getTaperedOutlineFillPath(taperedOutline)}
              fill={shapeProps.strokeColor}
              data-taper-outline="true"
              data-taper-cap-count={taperedOutline.caps.length}
            />
          </>
        ) : (
          <ShapePath
            d={pathData}
            fill={paint.fillPaint}
            {...shapeProps.strokePaint}
            {...shapeProps.trimPath}
            {...shapeProps.taper}
          />
        )}
      </svg>
    </div>
  )
}

/** Simple coloured div for shape kinds this build does not draw. */
function FallbackShape({ shapeProps, paint }: ShapeKindProps) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: paint.fallbackBackground,
        borderRadius: shapeProps.cornerRadius,
      }}
    />
  )
}

export const ShapeGeometry: React.FC<ShapeGeometryProps> = ({
  shapeProps,
  paint,
  layout,
  gradientId,
  pathVertices,
}) => {
  const fillDefinition = (
    <ShapeFillDefinition
      gradient={paint.linearGradient}
      width={layout.width}
      height={layout.height}
      gradientId={gradientId}
    />
  )
  const kindProps: ShapeKindProps = { shapeProps, paint, layout, fillDefinition }

  switch (shapeProps.shapeType) {
    case 'rectangle':
      return <RectangleShape {...kindProps} />
    case 'circle':
      return <CircleShape {...kindProps} />
    case 'triangle':
      return <TriangleShape {...kindProps} />
    case 'ellipse':
      return <EllipseShape {...kindProps} />
    case 'star':
      return <StarShape {...kindProps} />
    case 'polygon':
      return <PolygonShape {...kindProps} />
    case 'heart':
      return <HeartShape {...kindProps} />
    case 'path':
      return <PathShape {...kindProps} pathVertices={pathVertices} />
    default:
      return <FallbackShape {...kindProps} />
  }
}
