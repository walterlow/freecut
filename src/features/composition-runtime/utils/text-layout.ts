import type { TextItem } from '@/types/timeline';
import type { ResolvedTransform } from '@/types/transform';
import { FONT_WEIGHT_MAP } from '@/shared/typography/fonts';

export interface TextLayoutPreviewProperties {
  fontSize?: number;
  letterSpacing?: number;
  lineHeight?: number;
  textShadow?: TextItem['textShadow'];
  stroke?: TextItem['stroke'];
}

const TEXT_PADDING = 16;

type TextMeasureContext = Pick<CanvasRenderingContext2D, 'font' | 'measureText'>
  | Pick<OffscreenCanvasRenderingContext2D, 'font' | 'measureText'>;

let measureCtx: TextMeasureContext | null | undefined;

function getMeasureContext(): TextMeasureContext | null {
  if (measureCtx !== undefined) return measureCtx;

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(1, 1);
    measureCtx = canvas.getContext('2d');
    if (measureCtx) {
      return measureCtx;
    }
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    measureCtx = canvas.getContext('2d');
    return measureCtx;
  }

  measureCtx = null;
  return measureCtx;
}

function measureTextWidth(
  ctx: TextMeasureContext | null,
  text: string,
  letterSpacing: number,
  fontSize: number,
): number {
  if (!text) return 0;
  if (!ctx) {
    const approxCharWidth = fontSize * 0.6;
    return text.length * approxCharWidth + Math.max(0, text.length - 1) * letterSpacing;
  }
  if (letterSpacing === 0) return ctx.measureText(text).width;

  let width = 0;
  for (let i = 0; i < text.length; i++) {
    width += ctx.measureText(text[i] ?? '').width;
    if (i < text.length - 1) width += letterSpacing;
  }
  return width;
}

function breakWord(
  ctx: TextMeasureContext | null,
  word: string,
  maxWidth: number,
  letterSpacing: number,
  fontSize: number,
): string[] {
  if (!word) return [''];

  const parts: string[] = [];
  let current = '';

  for (const char of word) {
    const next = current + char;
    if (measureTextWidth(ctx, next, letterSpacing, fontSize) > maxWidth && current) {
      parts.push(current);
      current = char;
    } else {
      current = next;
    }
  }

  if (current) parts.push(current);
  return parts;
}

function wrapTextLines(
  ctx: TextMeasureContext | null,
  text: string,
  maxWidth: number,
  letterSpacing: number,
  fontSize: number,
): string[] {
  if (!text) return [''];

  const lines: string[] = [];
  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }

    const words = paragraph.split(' ');
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = measureTextWidth(ctx, testLine, letterSpacing, fontSize);

      if (testWidth > maxWidth) {
        if (currentLine) {
          lines.push(currentLine);
        }

        if (measureTextWidth(ctx, word, letterSpacing, fontSize) > maxWidth) {
          const broken = breakWord(ctx, word, maxWidth, letterSpacing, fontSize);
          for (let i = 0; i < broken.length - 1; i++) {
            lines.push(broken[i] ?? '');
          }
          currentLine = broken[broken.length - 1] ?? '';
        } else {
          currentLine = word;
        }
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [''];
}

function getTextRequiredHeight(
  item: TextItem,
  width: number,
  previewProperties?: TextLayoutPreviewProperties,
): number {
  const fontSize = previewProperties?.fontSize ?? item.fontSize ?? 60;
  const lineHeight = previewProperties?.lineHeight ?? item.lineHeight ?? 1.2;
  const letterSpacing = previewProperties?.letterSpacing ?? item.letterSpacing ?? 0;
  const fontFamily = item.fontFamily ?? 'Inter';
  const fontStyle = item.fontStyle ?? 'normal';
  const fontWeight = FONT_WEIGHT_MAP[item.fontWeight ?? 'normal'] ?? 400;
  const availableWidth = Math.max(1, width - TEXT_PADDING * 2);

  const ctx = getMeasureContext();
  if (ctx) {
    ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`;
  }

  const lines = wrapTextLines(ctx, item.text ?? '', availableWidth, letterSpacing, fontSize);
  const lineHeightPx = fontSize * lineHeight;
  const contentHeight = lines.length * lineHeightPx;

  const hasPreviewStroke = previewProperties
    ? Object.prototype.hasOwnProperty.call(previewProperties, 'stroke')
    : false;
  const hasPreviewShadow = previewProperties
    ? Object.prototype.hasOwnProperty.call(previewProperties, 'textShadow')
    : false;
  const stroke = hasPreviewStroke ? previewProperties?.stroke : item.stroke;
  const textShadow = hasPreviewShadow ? previewProperties?.textShadow : item.textShadow;

  const strokePad = (stroke?.width ?? 0) * 2;
  const shadowPad = textShadow
    ? Math.abs(textShadow.offsetY) + textShadow.blur
    : 0;

  return contentHeight + TEXT_PADDING * 2 + strokePad + shadowPad * 2;
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
  const requiredHeight = getTextRequiredHeight(item, transform.width, previewProperties);
  if (requiredHeight <= transform.height + 0.5) {
    return transform;
  }

  return {
    ...transform,
    height: requiredHeight,
  };
}
