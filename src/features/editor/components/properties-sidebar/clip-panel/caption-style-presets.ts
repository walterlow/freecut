/**
 * Named caption/subtitle look-and-feel presets.
 *
 * Each preset is a *patch* of style fields shared between {@link TextItem}
 * and {@link SubtitleSegmentItem}. Applying a preset overlays these onto
 * the target item(s) without disturbing fields not present in the patch
 * (so a user's custom `transform` size keeps working unless the preset
 * explicitly opts to override it).
 */

import type { SubtitleSegmentItem, TextItem } from '@/types/timeline'

export type CaptionStylePatch = Pick<
  TextItem,
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
>

export interface CaptionStylePreset {
  id: string
  label: string
  /** One-line description shown as button tooltip / muted helper text. */
  hint: string
  patch: CaptionStylePatch
}

export const CAPTION_STYLE_PRESETS: readonly CaptionStylePreset[] = [
  {
    id: 'netflix',
    label: 'Netflix',
    hint: 'White type on a soft black box — high readability, neutral.',
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
      textShadow: { offsetX: 0, offsetY: 3, blur: 10, color: 'rgba(0, 0, 0, 0.75)' },
      stroke: undefined,
    },
  },
  {
    id: 'youtube',
    label: 'YouTube',
    hint: 'White type with a heavy soft shadow — no box, works over any footage.',
    patch: {
      fontFamily: 'Inter',
      fontWeight: 'semibold',
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
  },
  {
    id: 'bold-yellow',
    label: 'Bold Yellow',
    hint: 'Yellow on black — classic subtitle look, high contrast at small sizes.',
    patch: {
      fontFamily: 'Inter',
      fontWeight: 'bold',
      fontStyle: 'normal',
      underline: false,
      color: '#FFD400',
      backgroundColor: 'rgba(0, 0, 0, 0.65)',
      backgroundRadius: 2,
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.15,
      letterSpacing: 0,
      textPadding: 10,
      textShadow: undefined,
      stroke: { width: 1, color: '#000000' },
    },
  },
  {
    id: 'minimal-stroke',
    label: 'Outlined',
    hint: 'White type with a thin black stroke — minimal, no shadow or box.',
    patch: {
      fontFamily: 'Inter',
      fontWeight: 'semibold',
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
      stroke: { width: 4, color: '#000000' },
    },
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    hint: 'Big bold white with stroke and shadow — punchy, social-friendly.',
    patch: {
      fontFamily: 'Inter',
      fontWeight: 'bold',
      fontStyle: 'normal',
      underline: false,
      color: '#ffffff',
      backgroundColor: undefined,
      backgroundRadius: 0,
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.15,
      letterSpacing: 0.5,
      textPadding: 0,
      textShadow: { offsetX: 0, offsetY: 6, blur: 18, color: 'rgba(0, 0, 0, 0.9)' },
      stroke: { width: 6, color: '#000000' },
    },
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
