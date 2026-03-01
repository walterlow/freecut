import type { TextItem } from '@/types/timeline';
import type { ResolvedTransform } from '@/types/transform';
import type { ItemPropertiesPreview } from '../stores/gizmo-store';

const FONT_WEIGHT_MAP: Record<string, number> = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

const TEXT_PADDING = 16;

let measureCtx: CanvasRenderingContext2D | null | undefined;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx;
  if (typeof document === 'undefined') {
    measureCtx = null;
    return measureCtx;
  }
  const canvas = document.createElement('canvas');
  measureCtx = canvas.getContext('2d');
  return measureCtx;
}

function measureTextWidth(
  ctx: CanvasRenderingContext2D | null,
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
  ctx: CanvasRenderingContext2D | null,
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
  ctx: CanvasRenderingContext2D | null,
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
  previewProperties?: ItemPropertiesPreview,
): number {
  // Defaults (fontSize: 60, lineHeight: 1.2, letterSpacing: 0, fontFamily: 'Inter',
  // fontWeight: 'normal') mirror TextItem type defaults. Update here if those change.
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

  const strokePad = (item.stroke?.width ?? 0) * 2;
  const shadowPad = item.textShadow
    ? Math.abs(item.textShadow.offsetY) + item.textShadow.blur
    : 0;

  return contentHeight + TEXT_PADDING * 2 + strokePad + shadowPad * 2;
}

/**
 * Expand text transform height during preview so the gizmo can keep pace with
 * text property updates (font size/line height/spacing) without clipping.
 */
export function expandTextTransformForPreview(
  item: TextItem,
  transform: ResolvedTransform,
  previewProperties?: ItemPropertiesPreview,
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
