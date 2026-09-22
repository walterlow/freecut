import type { TextItem } from '@/types/timeline'
import { getTextItemPlainText } from '@/shared/utils/text-item-spans'

/** A value that every selected text item agrees on, or `'mixed'` when they differ. */
export type SharedTextValue<T> = T | 'mixed'

/**
 * Values shared by the whole text selection, as the inspector shows them.
 * `undefined` marks a disagreement for enum-like fields so the control falls
 * back to its placeholder; numeric/boolean fields use `'mixed'`.
 */
export interface TextSharedValues {
  text: string | undefined
  fontSize: SharedTextValue<number>
  fontFamily: string | undefined
  fontWeight: TextItem['fontWeight']
  fontStyle: TextItem['fontStyle']
  underline: TextItem['underline']
  color: string | undefined
  textStylePresetId: TextItem['textStylePresetId']
  textStyleScale: SharedTextValue<number>
  backgroundColor: string | undefined
  backgroundRadius: SharedTextValue<number>
  textAlign: TextItem['textAlign']
  verticalAlign: TextItem['verticalAlign']
  letterSpacing: SharedTextValue<number>
  lineHeight: SharedTextValue<number>
  textPadding: SharedTextValue<number>
  shadowColor: string | undefined
  shadowOffsetX: SharedTextValue<number>
  shadowOffsetY: SharedTextValue<number>
  shadowBlur: SharedTextValue<number>
  strokeColor: string | undefined
  strokeWidth: SharedTextValue<number>
}

/**
 * Reads the same property from every text item and keeps it only while all of
 * them still agree; the first disagreement yields `fallback`.
 */
function readSharedValue<TValue, TFallback>(
  items: TextItem[],
  read: (item: TextItem) => TValue,
  fallback: TFallback,
): TValue | TFallback {
  const first = read(items[0]!)
  for (let index = 1; index < items.length; index += 1) {
    if (read(items[index]!) !== first) return fallback
  }
  return first
}

/** Shared text values for the selection, or `null` when nothing is selected. */
export function getSharedTextValues(items: TextItem[]): TextSharedValues | null {
  if (items.length === 0) return null

  return {
    text: readSharedValue(items, (item) => getTextItemPlainText(item), undefined),
    fontSize: readSharedValue(items, (item) => item.fontSize ?? 60, 'mixed' as const),
    fontFamily: readSharedValue(items, (item) => item.fontFamily ?? 'Inter', undefined),
    fontWeight: readSharedValue(items, (item) => item.fontWeight ?? 'normal', undefined),
    fontStyle: readSharedValue(items, (item) => item.fontStyle ?? 'normal', undefined),
    underline: readSharedValue(items, (item) => item.underline ?? false, undefined),
    color: readSharedValue(items, (item) => item.color, undefined),
    textStylePresetId: readSharedValue(items, (item) => item.textStylePresetId, undefined),
    textStyleScale: readSharedValue(items, (item) => item.textStyleScale ?? 1, 'mixed' as const),
    backgroundColor: readSharedValue(items, (item) => item.backgroundColor ?? '', undefined),
    backgroundRadius: readSharedValue(
      items,
      (item) => item.backgroundRadius ?? 0,
      'mixed' as const,
    ),
    textAlign: readSharedValue(items, (item) => item.textAlign ?? 'center', undefined),
    verticalAlign: readSharedValue(items, (item) => item.verticalAlign ?? 'middle', undefined),
    letterSpacing: readSharedValue(items, (item) => item.letterSpacing ?? 0, 'mixed' as const),
    lineHeight: readSharedValue(items, (item) => item.lineHeight ?? 1.2, 'mixed' as const),
    textPadding: readSharedValue(items, (item) => item.textPadding ?? 16, 'mixed' as const),
    shadowColor: readSharedValue(items, (item) => item.textShadow?.color ?? '', undefined),
    shadowOffsetX: readSharedValue(
      items,
      (item) => item.textShadow?.offsetX ?? 0,
      'mixed' as const,
    ),
    shadowOffsetY: readSharedValue(
      items,
      (item) => item.textShadow?.offsetY ?? 0,
      'mixed' as const,
    ),
    shadowBlur: readSharedValue(items, (item) => item.textShadow?.blur ?? 0, 'mixed' as const),
    strokeColor: readSharedValue(items, (item) => item.stroke?.color ?? '', undefined),
    strokeWidth: readSharedValue(items, (item) => item.stroke?.width ?? 0, 'mixed' as const),
  }
}
