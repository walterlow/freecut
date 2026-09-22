import type { ItemPropertiesPreview } from '@/runtime/composition-runtime/deps/stores'
import type { TaperPathValues } from '@/shared/graphics/shapes/taper-path'
import type { TrimPathValues } from '@/shared/graphics/shapes/trim-path'
import {
  resolveShapeLinearGradient,
  type ResolvedShapeLinearGradient,
} from '@/shared/graphics/shapes/linear-gradient'
import type { ShapeItem } from '@/types/timeline'

/**
 * Resolves one shape property with live-preview priority: gizmo preview
 * values win, then keyframe-resolved values, then the fallback. Key pairings
 * below are moved verbatim from the previous inline expressions.
 */
function resolveShapeProp<
  TPreview extends object,
  TResolved extends object,
  TPreviewKey extends keyof TPreview,
  TResolvedKey extends keyof TResolved,
>(
  preview: TPreview | undefined | null,
  previewKey: TPreviewKey,
  resolved: TResolved,
  resolvedKey: TResolvedKey,
  fallback: NonNullable<TPreview[TPreviewKey] | TResolved[TResolvedKey]>,
): NonNullable<TPreview[TPreviewKey] | TResolved[TResolvedKey]> {
  const previewValue = preview?.[previewKey]
  const resolvedValue = resolved[resolvedKey]
  return (previewValue ?? resolvedValue ?? fallback) as NonNullable<
    TPreview[TPreviewKey] | TResolved[TResolvedKey]
  >
}

/** Preview-over-resolved lookup without a fallback (result stays optional). */
function resolveShapePropValue<
  TPreview extends object,
  TResolved extends object,
  TKey extends keyof TPreview & keyof TResolved,
>(
  preview: TPreview | undefined | null,
  resolved: TResolved,
  key: TKey,
): TPreview[TKey] | TResolved[TKey] | undefined {
  return preview?.[key] ?? resolved[key]
}

/** Stroke attributes spread onto a shape; empty while the stroke is off. */
export interface ShapeStrokePaintProps {
  stroke?: string
  strokeWidth?: number
  strokeLinecap?: 'butt' | 'round' | 'square'
  strokeLinejoin?: 'miter' | 'round' | 'bevel'
  strokeMiterlimit?: number
}

/** Every shape property ShapeContent renders from, after preview resolution. */
export interface ResolvedShapeProps {
  fillColor: string
  fillType: 'solid' | 'linear'
  gradientStartColor: string | undefined
  gradientEndColor: string | undefined
  gradientAngle: number | undefined
  strokeColor: string | undefined
  strokeWidth: number
  cornerRadius: number
  direction: 'up' | 'down' | 'left' | 'right'
  points: number
  innerRadius: number
  shapeType: ShapeItem['shapeType'] | undefined
  pathClosed: boolean
  fillEnabled: boolean
  strokeEnabled: boolean
  strokeLineCap: 'butt' | 'round' | 'square'
  strokeLineJoin: 'miter' | 'round' | 'bevel'
  strokeMiterLimit: number
  trimPath: TrimPathValues
  taper: TaperPathValues
  strokePaint: ShapeStrokePaintProps
}

/**
 * Resolves every shape property once per render: live gizmo-preview values
 * first, then the keyframe-resolved item, then the stored defaults. The
 * open-path fill rule and the stroke-enabled fallback used to be inline
 * ternaries at the call site and stay here, one branch each.
 */
export function resolveShapeRenderProps(
  preview: ItemPropertiesPreview | undefined | null,
  resolved: ShapeItem,
  renderScale: number,
): ResolvedShapeProps {
  const shapeType = resolveShapePropValue(preview, resolved, 'shapeType')
  const pathClosed = resolveShapeProp(preview, 'pathClosed', resolved, 'pathClosed', true)
  const strokeColor = resolveShapePropValue(preview, resolved, 'strokeColor')
  const strokeWidth =
    resolveShapeProp(preview, 'strokeWidth', resolved, 'strokeWidth', 0) * renderScale
  const strokeEnabled = resolveShapeProp(
    preview,
    'strokeEnabled',
    resolved,
    'strokeEnabled',
    strokeWidth > 0 && strokeColor !== undefined,
  )
  const strokeLineCap = resolveShapeProp(
    preview,
    'strokeLineCap',
    resolved,
    'strokeLineCap',
    'butt',
  )
  const strokeLineJoin = resolveShapeProp(
    preview,
    'strokeLineJoin',
    resolved,
    'strokeLineJoin',
    'miter',
  )
  const strokeMiterLimit = resolveShapeProp(
    preview,
    'strokeMiterLimit',
    resolved,
    'strokeMiterLimit',
    4,
  )
  const trimPathStart = resolveShapeProp(
    preview,
    'trimPathStart',
    resolved,
    'trimPathStart',
    0,
  )
  const trimPathEnd = resolveShapeProp(preview, 'trimPathEnd', resolved, 'trimPathEnd', 100)
  const trimPathOffset = resolveShapeProp(
    preview,
    'trimPathOffset',
    resolved,
    'trimPathOffset',
    0,
  )
  const taperStartWidth = resolveShapeProp(
    preview,
    'taperStartWidth',
    resolved,
    'taperStartWidth',
    100,
  )
  const taperEndWidth = resolveShapeProp(
    preview,
    'taperEndWidth',
    resolved,
    'taperEndWidth',
    100,
  )
  const taperStartLength = resolveShapeProp(
    preview,
    'taperStartLength',
    resolved,
    'taperStartLength',
    0,
  )
  const taperEndLength = resolveShapeProp(
    preview,
    'taperEndLength',
    resolved,
    'taperEndLength',
    0,
  )

  return {
    fillColor: resolveShapeProp(preview, 'fillColor', resolved, 'fillColor', '#3b82f6'),
    fillType: resolveShapeProp(preview, 'fillType', resolved, 'fillType', 'solid'),
    gradientStartColor: resolveShapePropValue(preview, resolved, 'gradientStartColor'),
    gradientEndColor: resolveShapePropValue(preview, resolved, 'gradientEndColor'),
    gradientAngle: resolveShapePropValue(preview, resolved, 'gradientAngle'),
    strokeColor,
    strokeWidth,
    cornerRadius:
      resolveShapeProp(preview, 'cornerRadius', resolved, 'cornerRadius', 0) * renderScale,
    direction: resolveShapeProp(preview, 'direction', resolved, 'direction', 'up'),
    points: resolveShapeProp(preview, 'points', resolved, 'points', 5),
    innerRadius: resolveShapeProp(preview, 'innerRadius', resolved, 'innerRadius', 0.5),
    shapeType,
    pathClosed,
    // An open custom path is never filled, whatever the item or preview says.
    fillEnabled:
      shapeType === 'path' && !pathClosed
        ? false
        : resolveShapeProp(preview, 'fillEnabled', resolved, 'fillEnabled', true),
    strokeEnabled,
    strokeLineCap,
    strokeLineJoin,
    strokeMiterLimit,
    trimPath: { trimPathStart, trimPathEnd, trimPathOffset },
    taper: { taperStartWidth, taperEndWidth, taperStartLength, taperEndLength },
    strokePaint:
      strokeEnabled && strokeWidth > 0 && strokeColor
        ? {
            stroke: strokeColor,
            strokeWidth,
            strokeLinecap: strokeLineCap,
            strokeLinejoin: strokeLineJoin,
            strokeMiterlimit: strokeMiterLimit,
          }
        : {},
  }
}

/** The resolved two-stop gradient and the two paint strings it feeds. */
export interface ResolvedShapePaint {
  linearGradient: ResolvedShapeLinearGradient | null
  fillPaint: string
  /** Used where a real SVG shape cannot be drawn (fallback divs). */
  fallbackBackground: string
}

/**
 * Resolves the fill paint plus the CSS fallback offered to the non-SVG
 * fallback regions. The gradient definition itself is rendered from
 * `linearGradient` by the fill-definition component.
 */
export function resolveShapePaint(
  props: ResolvedShapeProps,
  gradientId: string,
): ResolvedShapePaint {
  const linearGradient = resolveShapeLinearGradient({
    fillType: props.fillType,
    fillColor: props.fillColor,
    gradientStartColor: props.gradientStartColor,
    gradientEndColor: props.gradientEndColor,
    gradientAngle: props.gradientAngle,
  })

  return {
    linearGradient,
    fillPaint: props.fillEnabled
      ? linearGradient
        ? `url(#${gradientId})`
        : props.fillColor
      : 'none',
    fallbackBackground: linearGradient
      ? `linear-gradient(${linearGradient.angle + 90}deg, ${linearGradient.startColor}, ${linearGradient.endColor})`
      : props.fillColor,
  }
}
