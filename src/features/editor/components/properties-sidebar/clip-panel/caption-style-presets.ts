/**
 * Named caption/subtitle look-and-feel presets.
 *
 * Each preset is a *patch* of style fields shared between {@link TextItem}
 * and {@link SubtitleSegmentItem}. Applying a preset overlays these onto
 * the target item(s).
 *
 * `layout` carries canvas-relative tweaks (font size, vertical position,
 * box width). They're stored as ratios of the canvas so the same preset
 * looks right on a 720p edit, a 1080p edit, and a vertical 9:16 edit
 * without per-resolution tuning. Resolved into absolute pixels at apply
 * time by `resolveCaptionStylePatch`.
 */

import type { TransformProperties } from '@/types/transform'
import type { SubtitleSegmentItem, TextItem } from '@/types/timeline'

export type CaptionStylePatch = Pick<
  TextItem,
  | 'fontSize'
  | 'fontFamily'
  | 'fontWeight'
  | 'fontStyle'
  | 'underline'
  | 'color'
  | 'backgroundColor'
  | 'backgroundRadius'
  | 'textAlign'
  | 'verticalAlign'
  | 'lineHeight'
  | 'letterSpacing'
  | 'textPadding'
  | 'textShadow'
  | 'stroke'
> & { transform?: TransformProperties }

export interface CaptionStylePreset {
  id: string
  label: string
  /** One-line description shown as button tooltip / muted helper text. */
  hint: string
  patch: Omit<CaptionStylePatch, 'transform' | 'fontSize'>
  /** Canvas-relative layout overrides — see top-of-file comment. */
  layout?: {
    /** fontSize = round(canvasHeight * fontSizeRatio). */
    fontSizeRatio?: number
    /** transform.y = round(canvasHeight * yRatio). 0 = vertical center, +ve = below. */
    yRatio?: number
    /** transform.width = round(canvasWidth * widthRatio). */
    widthRatio?: number
    /** transform.height = round(canvasHeight * heightRatio). */
    heightRatio?: number
  }
}

export const CAPTION_STYLE_PRESETS: readonly CaptionStylePreset[] = [
  {
    id: 'netflix',
    label: 'Netflix',
    hint: 'Inter on a rounded dark box, lower-third — broadcast-grade neutral.',
    patch: {
      fontFamily: 'Inter',
      fontWeight: 'semibold',
      fontStyle: 'normal',
      underline: false,
      color: '#ffffff',
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
      backgroundRadius: 4,
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.15,
      letterSpacing: 0,
      textPadding: 12,
      textShadow: { offsetX: 0, offsetY: 2, blur: 6, color: 'rgba(0, 0, 0, 0.6)' },
      stroke: undefined,
    },
    layout: { fontSizeRatio: 0.04, yRatio: 0.36, widthRatio: 0.7, heightRatio: 0.16 },
  },
  {
    id: 'youtube',
    label: 'YouTube',
    hint: 'Roboto with a soft drop shadow, no box — the auto-captions vibe.',
    patch: {
      fontFamily: 'Roboto',
      fontWeight: 'medium',
      fontStyle: 'normal',
      underline: false,
      color: '#ffffff',
      backgroundColor: undefined,
      backgroundRadius: 0,
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.2,
      letterSpacing: 0,
      textPadding: 0,
      textShadow: { offsetX: 0, offsetY: 4, blur: 14, color: 'rgba(0, 0, 0, 0.85)' },
      stroke: undefined,
    },
    layout: { fontSizeRatio: 0.045, yRatio: 0.34, widthRatio: 0.85, heightRatio: 0.18 },
  },
  {
    id: 'bold-yellow',
    label: 'Bold Yellow',
    hint: 'Roboto Slab in cinema yellow with a black drop shadow — DVD-era classic.',
    patch: {
      fontFamily: 'Roboto Slab',
      fontWeight: 'bold',
      fontStyle: 'normal',
      underline: false,
      color: '#FFD400',
      backgroundColor: undefined,
      backgroundRadius: 0,
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.1,
      letterSpacing: 0,
      textPadding: 0,
      textShadow: { offsetX: 0, offsetY: 3, blur: 5, color: 'rgba(0, 0, 0, 1)' },
      stroke: { width: 1.5, color: '#000000' },
    },
    layout: { fontSizeRatio: 0.05, yRatio: 0.38, widthRatio: 0.85, heightRatio: 0.18 },
  },
  {
    id: 'minimal-stroke',
    label: 'Outlined',
    hint: 'Manrope with a hairline outline — clean, modern, no shadow.',
    patch: {
      fontFamily: 'Manrope',
      fontWeight: 'medium',
      fontStyle: 'normal',
      underline: false,
      color: '#ffffff',
      backgroundColor: undefined,
      backgroundRadius: 0,
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.2,
      letterSpacing: 0,
      textPadding: 0,
      textShadow: undefined,
      stroke: { width: 1, color: '#000000' },
    },
    layout: { fontSizeRatio: 0.04, yRatio: 0.34, widthRatio: 0.85, heightRatio: 0.16 },
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    hint: 'Anton display, oversized and centered — vertical-video viral look.',
    patch: {
      fontFamily: 'Anton',
      fontWeight: 'normal',
      fontStyle: 'normal',
      underline: false,
      color: '#ffffff',
      backgroundColor: undefined,
      backgroundRadius: 0,
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.05,
      letterSpacing: 1,
      textPadding: 0,
      textShadow: { offsetX: 0, offsetY: 4, blur: 8, color: 'rgba(0, 0, 0, 0.9)' },
      stroke: { width: 2, color: '#000000' },
    },
    layout: { fontSizeRatio: 0.075, yRatio: 0, widthRatio: 0.9, heightRatio: 0.22 },
  },
] as const

/**
 * Heuristic match: pick the preset whose patch most closely matches the
 * given item's current style. Used to highlight the active preset chip in
 * the UI. Returns null when nothing matches well — the user has tweaked.
 */
export function detectActiveCaptionPreset(
  item: SubtitleSegmentItem | (TextItem & { textRole?: 'caption' }),
): CaptionStylePreset | null {
  for (const preset of CAPTION_STYLE_PRESETS) {
    if (matchesPreset(item, preset.patch)) return preset
  }
  return null
}

/**
 * Resolve a preset into a fully concrete patch for the given canvas. Layout
 * ratios become absolute fontSize / transform values; the user's existing
 * transform.x / rotation / opacity is preserved so applying a preset
 * doesn't reset position tweaks the user made by hand.
 */
export function resolveCaptionStylePatch(
  preset: CaptionStylePreset,
  canvasWidth: number,
  canvasHeight: number,
  baseTransform?: TransformProperties,
): CaptionStylePatch {
  const layout = preset.layout
  const patch: CaptionStylePatch = { ...preset.patch }

  if (layout?.fontSizeRatio !== undefined) {
    patch.fontSize = Math.max(8, Math.round(canvasHeight * layout.fontSizeRatio))
  }

  if (
    layout &&
    (layout.yRatio !== undefined ||
      layout.widthRatio !== undefined ||
      layout.heightRatio !== undefined)
  ) {
    patch.transform = {
      x: baseTransform?.x ?? 0,
      y:
        layout.yRatio !== undefined
          ? Math.round(canvasHeight * layout.yRatio)
          : (baseTransform?.y ?? 0),
      width:
        layout.widthRatio !== undefined
          ? Math.round(canvasWidth * layout.widthRatio)
          : (baseTransform?.width ?? canvasWidth * 0.82),
      height:
        layout.heightRatio !== undefined
          ? Math.round(canvasHeight * layout.heightRatio)
          : (baseTransform?.height ?? canvasHeight * 0.16),
      rotation: baseTransform?.rotation ?? 0,
      opacity: baseTransform?.opacity ?? 1,
    }
  }

  return patch
}

function matchesPreset(item: SubtitleSegmentItem | TextItem, patch: CaptionStylePatch): boolean {
  for (const key of Object.keys(patch) as Array<keyof CaptionStylePatch>) {
    const expected = patch[key]
    const actual = item[key]
    if (!equalShallow(expected, actual)) return false
  }
  return true
}

function equalShallow(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return a === b
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const aKeys = Object.keys(a as Record<string, unknown>)
  const bKeys = Object.keys(b as Record<string, unknown>)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) {
      return false
    }
  }
  return true
}
