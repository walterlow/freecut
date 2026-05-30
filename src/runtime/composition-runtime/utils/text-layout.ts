import type { TextItem } from '@/types/timeline'
import type { ResolvedTransform } from '@/types/transform'
import { layoutTextBlock } from '@/shared/typography/text-block-layout'
import {
  createCanvasTextMeasurer,
  parseFontSizePx,
  type TextMeasurer,
} from '@/shared/typography/text-measurer'
import { resolveTextStyle } from '@/shared/typography/text-style'

export interface TextLayoutPreviewProperties {
  text?: string
  textSpans?: TextItem['textSpans']
  fontSize?: number
  letterSpacing?: number
  lineHeight?: number
  textPadding?: number
  backgroundRadius?: number
  textShadow?: TextItem['textShadow']
  stroke?: TextItem['stroke']
}

type TextMeasureContext =
  | Pick<CanvasRenderingContext2D, 'font' | 'measureText'>
  | Pick<OffscreenCanvasRenderingContext2D, 'font' | 'measureText'>

let measureCtx: TextMeasureContext | null | undefined

function getMeasureContext(): TextMeasureContext | null {
  if (measureCtx !== undefined) return measureCtx

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(1, 1)
    measureCtx = canvas.getContext('2d')
    if (measureCtx) {
      return measureCtx
    }
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    measureCtx = canvas.getContext('2d')
    return measureCtx
  }

  measureCtx = null
  return measureCtx
}

/**
 * Measurer used for auto-fit height. Shares the canvas measurer (native
 * letter-spacing) when a 2D context is available so wrap points match the
 * actual render; falls back to an advance estimate in non-canvas environments.
 */
function getHeightMeasurer(): TextMeasurer {
  const ctx = getMeasureContext()
  if (ctx) {
    return createCanvasTextMeasurer(ctx as CanvasRenderingContext2D)
  }
  return {
    measure: (text, cssFont, letterSpacing) => {
      const fontSize = parseFontSizePx(cssFont)
      return text.length * fontSize * 0.6 + text.length * letterSpacing
    },
    fontMetrics: (cssFont) => {
      const fontSize = parseFontSizePx(cssFont)
      return { ascent: fontSize * 0.8, descent: fontSize * 0.2 }
    },
  }
}

/** Merge live preview overrides onto the item before measuring. */
function applyPreviewProperties(
  item: TextItem,
  previewProperties?: TextLayoutPreviewProperties,
): TextItem {
  if (!previewProperties) return item
  const hasStroke = Object.prototype.hasOwnProperty.call(previewProperties, 'stroke')
  const hasShadow = Object.prototype.hasOwnProperty.call(previewProperties, 'textShadow')
  return {
    ...item,
    text: previewProperties.text ?? item.text,
    textSpans: previewProperties.textSpans ?? item.textSpans,
    fontSize: previewProperties.fontSize ?? item.fontSize,
    letterSpacing: previewProperties.letterSpacing ?? item.letterSpacing,
    lineHeight: previewProperties.lineHeight ?? item.lineHeight,
    textPadding: previewProperties.textPadding ?? item.textPadding,
    backgroundRadius: previewProperties.backgroundRadius ?? item.backgroundRadius,
    stroke: hasStroke ? previewProperties.stroke : item.stroke,
    textShadow: hasShadow ? previewProperties.textShadow : item.textShadow,
  }
}

function getTextRequiredHeight(
  item: TextItem,
  width: number,
  previewProperties?: TextLayoutPreviewProperties,
): number {
  const merged = applyPreviewProperties(item, previewProperties)
  const style = resolveTextStyle(merged)
  // boxHeight is irrelevant to content height (vertical-align only shifts the
  // block, never its size), so pass 0 and read the wrapped content height.
  const layout = layoutTextBlock(merged, width, 0, getHeightMeasurer())

  const strokePad = (style.stroke?.width ?? 0) * 2
  const shadowPad = style.textShadow
    ? Math.abs(style.textShadow.offsetY) + style.textShadow.blur
    : 0

  return layout.totalHeight + style.textPadding * 2 + strokePad + shadowPad * 2
}

/**
 * Expands text height to fit wrapped content. This never shrinks the authored
 * bounds, so manual sizing still acts as a minimum box size.
 */
export function expandTextTransformToFitContent(
  item: TextItem,
  transform: ResolvedTransform,
  previewProperties?: TextLayoutPreviewProperties,
): ResolvedTransform {
  const requiredHeight = getTextRequiredHeight(item, transform.width, previewProperties)
  if (requiredHeight <= transform.height + 0.5) {
    return transform
  }

  return {
    ...transform,
    height: requiredHeight,
  }
}
