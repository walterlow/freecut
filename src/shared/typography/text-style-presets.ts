import type { TextItem, TextSpan } from '@/types/timeline'
import type { CanvasSettings } from '@/types/transform'
import { buildTextItemLabelFromText } from '@/shared/utils/text-item-spans'
import { TEXT_STYLE_PRESET_IDS, type TextStylePresetId } from './text-style-preset-ids'

export { TEXT_STYLE_PRESET_IDS, type TextStylePresetId }

export type TextStylePresetPreviewKind =
  | 'clean'
  | 'poster'
  | 'outline-pill'
  | 'lower-third'
  | 'speaker'
  | 'cinematic'
  | 'quote'
  | 'neon'
  | 'stacked'
  | 'breaking'
  | 'launch'
  | 'event'
  | 'badge'

export type TextStylePresetLayout = 'single' | 'two' | 'three'

export interface TextStylePreset {
  id: TextStylePresetId
  label: string
  previewKind: TextStylePresetPreviewKind
  layout: TextStylePresetLayout
  sample: {
    eyebrow?: string
    title: string
    subtitle?: string
  }
}

type TextSizeToken = 'badge' | 'title' | 'display'
type TextSpacingToken = 'sm' | 'badge' | 'md' | 'lg' | 'xl' | 'quote'
type TextRadiusToken = 'none' | 'sm' | 'md' | 'lg' | 'pill'
type TextTrackingToken = 'tight' | 'normal' | 'wide' | 'badge' | 'cinematic'
type TextShadowToken = 'sm' | 'md' | 'lg' | 'xl' | 'glow'

interface TextStyleRecipe extends TextStylePreset {
  style: {
    fontFamily: string
    fontWeight: NonNullable<TextItem['fontWeight']>
    fontStyle: NonNullable<TextItem['fontStyle']>
    underline: boolean
    size: {
      token: TextSizeToken
      multiplier?: number
    }
    color: string
    backgroundColor?: string
    backgroundRadius: TextRadiusToken
    textAlign: NonNullable<TextItem['textAlign']>
    verticalAlign: NonNullable<TextItem['verticalAlign']>
    lineHeight: number
    letterSpacing: number | TextTrackingToken
    textPadding: TextSpacingToken
    textShadow?: {
      token: TextShadowToken
      color: string
    }
    stroke?: TextItem['stroke']
  }
}

export interface TextScale {
  sizes: {
    badge: number
    title: number
    display: number
  }
  spacing: Record<TextSpacingToken, number>
  radius: Record<TextRadiusToken, number>
  tracking: Record<TextTrackingToken, number>
  shadows: Record<
    TextShadowToken,
    {
      offsetX: number
      offsetY: number
      blur: number
    }
  >
}

const TEXT_STYLE_RECIPES: Record<TextStylePresetId, TextStyleRecipe> = {
  'clean-title': {
    id: 'clean-title',
    label: 'Clean',
    previewKind: 'clean',
    layout: 'single',
    sample: { title: 'Main', subtitle: 'Title' },
    style: {
      fontFamily: 'Inter Tight',
      fontWeight: 'bold',
      fontStyle: 'normal',
      underline: false,
      size: { token: 'title' },
      color: '#ffffff',
      backgroundColor: undefined,
      backgroundRadius: 'none',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 0.95,
      letterSpacing: 'tight',
      textPadding: 'sm',
      textShadow: {
        token: 'md',
        color: '#111827',
      },
      stroke: undefined,
    },
  },
  poster: {
    id: 'poster',
    label: 'Poster',
    previewKind: 'poster',
    layout: 'single',
    sample: { title: 'Tonight' },
    style: {
      fontFamily: 'Anton',
      fontWeight: 'normal',
      fontStyle: 'normal',
      underline: false,
      size: { token: 'display', multiplier: 0.98 },
      color: '#fef3c7',
      backgroundColor: undefined,
      backgroundRadius: 'none',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 0.88,
      letterSpacing: 'tight',
      textPadding: 'sm',
      textShadow: {
        token: 'xl',
        color: '#7f1d1d',
      },
      stroke: {
        width: 2,
        color: '#991b1b',
      },
    },
  },
  'outline-pill': {
    id: 'outline-pill',
    label: 'Outline',
    previewKind: 'outline-pill',
    layout: 'single',
    sample: { title: 'Featured' },
    style: {
      fontFamily: 'Inter',
      fontWeight: 'bold',
      fontStyle: 'normal',
      underline: false,
      size: { token: 'badge', multiplier: 0.96 },
      color: '#e2e8f0',
      backgroundColor: '#0f172a',
      backgroundRadius: 'pill',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1,
      letterSpacing: 'badge',
      textPadding: 'badge',
      textShadow: {
        token: 'sm',
        color: '#020617',
      },
      stroke: {
        width: 1,
        color: '#38bdf8',
      },
    },
  },
  'lower-third': {
    id: 'lower-third',
    label: 'Lower Third',
    previewKind: 'lower-third',
    layout: 'two',
    sample: { title: 'Name', subtitle: 'Role or subtitle' },
    style: {
      fontFamily: 'Inter',
      fontWeight: 'semibold',
      fontStyle: 'normal',
      underline: false,
      size: { token: 'title', multiplier: 0.587 },
      color: '#f9fafb',
      backgroundColor: '#111827',
      backgroundRadius: 'md',
      textAlign: 'left',
      verticalAlign: 'middle',
      lineHeight: 1.05,
      letterSpacing: 'normal',
      textPadding: 'lg',
      textShadow: {
        token: 'sm',
        color: '#030712',
      },
      stroke: undefined,
    },
  },
  'speaker-card': {
    id: 'speaker-card',
    label: 'Speaker',
    previewKind: 'speaker',
    layout: 'two',
    sample: { title: 'Alex Morgan', subtitle: 'Product Designer' },
    style: {
      fontFamily: 'Inter Tight',
      fontWeight: 'bold',
      fontStyle: 'normal',
      underline: false,
      size: { token: 'title', multiplier: 0.61 },
      color: '#f8fafc',
      backgroundColor: '#1e293b',
      backgroundRadius: 'lg',
      textAlign: 'left',
      verticalAlign: 'middle',
      lineHeight: 1,
      letterSpacing: 'tight',
      textPadding: 'xl',
      textShadow: {
        token: 'md',
        color: '#020617',
      },
      stroke: undefined,
    },
  },
  cinematic: {
    id: 'cinematic',
    label: 'Cinematic',
    previewKind: 'cinematic',
    layout: 'single',
    sample: { title: 'CINEMA', subtitle: 'PRESENTS' },
    style: {
      fontFamily: 'Bebas Neue',
      fontWeight: 'normal',
      fontStyle: 'normal',
      underline: false,
      size: { token: 'display' },
      color: '#f8e6b8',
      backgroundColor: undefined,
      backgroundRadius: 'none',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 0.92,
      letterSpacing: 'cinematic',
      textPadding: 'sm',
      textShadow: {
        token: 'lg',
        color: '#111827',
      },
      stroke: {
        width: 1,
        color: '#2b2112',
      },
    },
  },
  quote: {
    id: 'quote',
    label: 'Quote',
    previewKind: 'quote',
    layout: 'two',
    sample: { title: 'Quote', subtitle: 'Attribution' },
    style: {
      fontFamily: 'Playfair Display',
      fontWeight: 'semibold',
      fontStyle: 'italic',
      underline: false,
      size: { token: 'title', multiplier: 0.83 },
      color: '#f8fafc',
      backgroundColor: '#1f2937',
      backgroundRadius: 'lg',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.08,
      letterSpacing: 'normal',
      textPadding: 'quote',
      textShadow: {
        token: 'lg',
        color: '#020617',
      },
      stroke: undefined,
    },
  },
  neon: {
    id: 'neon',
    label: 'Neon',
    previewKind: 'neon',
    layout: 'single',
    sample: { title: 'NEON', subtitle: 'Glow' },
    style: {
      fontFamily: 'Orbitron',
      fontWeight: 'semibold',
      fontStyle: 'normal',
      underline: false,
      size: { token: 'title', multiplier: 0.935 },
      color: '#67e8f9',
      backgroundColor: '#082f49',
      backgroundRadius: 'sm',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1,
      letterSpacing: 'wide',
      textPadding: 'md',
      textShadow: {
        token: 'glow',
        color: '#22d3ee',
      },
      stroke: {
        width: 1,
        color: '#22d3ee',
      },
    },
  },
  'headline-stack': {
    id: 'headline-stack',
    label: 'Headline',
    previewKind: 'stacked',
    layout: 'three',
    sample: { eyebrow: 'TOP STORY', title: 'Headline', subtitle: 'Subhead' },
    style: {
      fontFamily: 'Inter Tight',
      fontWeight: 'bold',
      fontStyle: 'normal',
      underline: false,
      size: { token: 'title', multiplier: 0.913 },
      color: '#f8fafc',
      backgroundColor: undefined,
      backgroundRadius: 'none',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 0.96,
      letterSpacing: 'tight',
      textPadding: 'sm',
      textShadow: {
        token: 'lg',
        color: '#020617',
      },
      stroke: undefined,
    },
  },
  'breaking-update': {
    id: 'breaking-update',
    label: 'Breaking',
    previewKind: 'breaking',
    layout: 'three',
    sample: { eyebrow: 'BREAKING', title: 'Major Update', subtitle: 'Developing now' },
    style: {
      fontFamily: 'Inter Tight',
      fontWeight: 'bold',
      fontStyle: 'normal',
      underline: false,
      size: { token: 'title', multiplier: 0.92 },
      color: '#f8fafc',
      backgroundColor: '#111827',
      backgroundRadius: 'md',
      textAlign: 'left',
      verticalAlign: 'middle',
      lineHeight: 0.94,
      letterSpacing: 'tight',
      textPadding: 'lg',
      textShadow: {
        token: 'lg',
        color: '#020617',
      },
      stroke: undefined,
    },
  },
  'event-card': {
    id: 'event-card',
    label: 'Event',
    previewKind: 'event',
    layout: 'three',
    sample: { eyebrow: 'LIVE', title: 'Summer Fest', subtitle: 'Friday 8 PM' },
    style: {
      fontFamily: 'Inter Tight',
      fontWeight: 'bold',
      fontStyle: 'normal',
      underline: false,
      size: { token: 'title', multiplier: 0.848 },
      color: '#f8fafc',
      backgroundColor: '#0f172a',
      backgroundRadius: 'lg',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 0.98,
      letterSpacing: -0.5,
      textPadding: 'xl',
      textShadow: {
        token: 'xl',
        color: '#020617',
      },
      stroke: undefined,
    },
  },
  'launch-stack': {
    id: 'launch-stack',
    label: 'Launch',
    previewKind: 'launch',
    layout: 'three',
    sample: { eyebrow: 'NOW LIVE', title: 'New Collection', subtitle: 'Shop the drop' },
    style: {
      fontFamily: 'Space Grotesk',
      fontWeight: 'bold',
      fontStyle: 'normal',
      underline: false,
      size: { token: 'title', multiplier: 0.88 },
      color: '#f8fafc',
      backgroundColor: '#0f172a',
      backgroundRadius: 'lg',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 0.96,
      letterSpacing: 'tight',
      textPadding: 'xl',
      textShadow: {
        token: 'glow',
        color: '#60a5fa',
      },
      stroke: {
        width: 1,
        color: '#1d4ed8',
      },
    },
  },
  badge: {
    id: 'badge',
    label: 'Badge',
    previewKind: 'badge',
    layout: 'single',
    sample: { title: 'NEW DROP', subtitle: 'Tag' },
    style: {
      fontFamily: 'Inter',
      fontWeight: 'bold',
      fontStyle: 'normal',
      underline: false,
      size: { token: 'badge' },
      color: '#f8fafc',
      backgroundColor: '#111827',
      backgroundRadius: 'pill',
      textAlign: 'center',
      verticalAlign: 'middle',
      lineHeight: 1,
      letterSpacing: 'badge',
      textPadding: 'badge',
      textShadow: {
        token: 'sm',
        color: '#020617',
      },
      stroke: {
        width: 1,
        color: '#334155',
      },
    },
  },
}

export const TEXT_STYLE_PRESETS: readonly TextStylePreset[] = Object.values(TEXT_STYLE_RECIPES).map(
  ({ id, label, previewKind, layout, sample }) => ({
    id,
    label,
    previewKind,
    layout,
    sample,
  }),
)

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function sizeFromCanvas(
  canvas: CanvasSettings,
  multiplier: number,
  min: number,
  max: number,
): number {
  return clamp(Math.round(canvas.height * multiplier), min, max)
}

function spacingFromCanvas(
  canvas: CanvasSettings,
  multiplier: number,
  min: number,
  max: number,
): number {
  const basis = Math.min(canvas.width, canvas.height)
  return clamp(Math.round(basis * multiplier), min, max)
}

function buildTemplateTextFromSpans(spans: TextSpan[]): string {
  return spans.map((span) => span.text).join('\n')
}

function getPresetById(presetId: TextStylePresetId): TextStyleRecipe {
  const preset = TEXT_STYLE_RECIPES[presetId]
  if (!preset) {
    throw new Error(`Unknown text style preset: ${presetId}`)
  }

  return preset
}

function resolveSize(scale: TextScale, config: TextStyleRecipe['style']['size']): number {
  const baseSize = scale.sizes[config.token]
  return Math.round(baseSize * (config.multiplier ?? 1))
}

function resolveTracking(scale: TextScale, value: number | TextTrackingToken): number {
  return typeof value === 'number' ? value : scale.tracking[value]
}

export function buildTextScale(canvas: CanvasSettings): TextScale {
  return {
    sizes: {
      badge: sizeFromCanvas(canvas, 0.048, 32, 68),
      title: sizeFromCanvas(canvas, 0.085, 56, 132),
      display: sizeFromCanvas(canvas, 0.11, 72, 164),
    },
    spacing: {
      sm: spacingFromCanvas(canvas, 0.0148, 16, 16),
      badge: spacingFromCanvas(canvas, 0.0167, 18, 18),
      md: spacingFromCanvas(canvas, 0.0185, 20, 20),
      lg: spacingFromCanvas(canvas, 0.0222, 24, 24),
      xl: spacingFromCanvas(canvas, 0.0259, 28, 28),
      quote: spacingFromCanvas(canvas, 0.0278, 30, 30),
    },
    radius: {
      none: 0,
      sm: spacingFromCanvas(canvas, 0.0167, 18, 18),
      md: spacingFromCanvas(canvas, 0.0185, 20, 20),
      lg: spacingFromCanvas(canvas, 0.0259, 28, 28),
      pill: 999,
    },
    tracking: {
      tight: -1,
      normal: 0,
      wide: 1,
      badge: 2,
      cinematic: 4,
    },
    shadows: {
      sm: { offsetX: 0, offsetY: 4, blur: 14 },
      md: { offsetX: 0, offsetY: 6, blur: 18 },
      lg: { offsetX: 0, offsetY: 8, blur: 24 },
      xl: { offsetX: 0, offsetY: 10, blur: 24 },
      glow: { offsetX: 0, offsetY: 0, blur: 22 },
    },
  }
}

function buildResolvedPresetStyle(
  presetId: TextStylePresetId,
  canvas: CanvasSettings,
  styleScale = 1,
): Partial<TextItem> {
  const preset = getPresetById(presetId)
  const scale = buildTextScale(canvas)
  const shadowScale = preset.style.textShadow
    ? scale.shadows[preset.style.textShadow.token]
    : undefined

  return {
    fontFamily: preset.style.fontFamily,
    fontWeight: preset.style.fontWeight,
    fontStyle: preset.style.fontStyle,
    underline: preset.style.underline,
    fontSize: Math.round(resolveSize(scale, preset.style.size) * styleScale),
    color: preset.style.color,
    backgroundColor: preset.style.backgroundColor,
    backgroundRadius:
      preset.style.backgroundRadius === 'pill'
        ? scale.radius[preset.style.backgroundRadius]
        : Math.round(scale.radius[preset.style.backgroundRadius] * styleScale),
    textAlign: preset.style.textAlign,
    verticalAlign: preset.style.verticalAlign,
    lineHeight: preset.style.lineHeight,
    letterSpacing: resolveTracking(scale, preset.style.letterSpacing) * styleScale,
    textPadding: Math.round(scale.spacing[preset.style.textPadding] * styleScale),
    textShadow: shadowScale
      ? {
          offsetX: shadowScale.offsetX * styleScale,
          offsetY: shadowScale.offsetY * styleScale,
          blur: shadowScale.blur * styleScale,
          color: preset.style.textShadow?.color ?? '#000000',
        }
      : undefined,
    stroke: preset.style.stroke
      ? {
          ...preset.style.stroke,
          width: preset.style.stroke.width * styleScale,
        }
      : undefined,
    textStylePresetId: presetId,
    textStyleScale: styleScale,
  }
}

export function buildTextStylePresetUpdates(
  presetId: TextStylePresetId,
  canvas: CanvasSettings,
  styleScale = 1,
): Partial<TextItem> {
  return buildResolvedPresetStyle(presetId, canvas, styleScale)
}

export function buildTextStylePresetTemplate(
  presetId: TextStylePresetId,
  canvas: CanvasSettings,
  styleScale = 1,
): Partial<TextItem> {
  const preset = getPresetById(presetId)
  const styles = buildResolvedPresetStyle(presetId, canvas, styleScale)
  const baseFontSize = styles.fontSize ?? 60

  switch (presetId) {
    case 'speaker-card': {
      const spans: TextSpan[] = [
        {
          text: preset.sample.title,
          fontWeight: 'bold',
        },
        {
          text: preset.sample.subtitle ?? 'Product Designer',
          fontSize: Math.max(20, Math.round(baseFontSize * 0.44)),
          fontWeight: 'medium',
          color: '#cbd5e1',
        },
      ]

      return {
        ...styles,
        label: preset.label,
        text: buildTemplateTextFromSpans(spans),
        textSpans: spans,
      }
    }
    case 'lower-third': {
      const spans: TextSpan[] = [
        {
          text: preset.sample.title,
          fontWeight: 'bold',
        },
        {
          text: preset.sample.subtitle ?? 'Role or subtitle',
          fontSize: Math.max(22, Math.round(baseFontSize * 0.54)),
          fontWeight: 'medium',
          color: '#cbd5e1',
        },
      ]

      return {
        ...styles,
        label: preset.label,
        text: buildTemplateTextFromSpans(spans),
        textSpans: spans,
      }
    }
    case 'quote': {
      const spans: TextSpan[] = [
        {
          text: preset.sample.title,
          fontStyle: 'italic',
        },
        {
          text: preset.sample.subtitle ?? 'Attribution',
          fontSize: Math.max(18, Math.round(baseFontSize * 0.4)),
          fontStyle: 'normal',
          fontWeight: 'medium',
          color: '#cbd5e1',
          letterSpacing: 1,
        },
      ]

      return {
        ...styles,
        label: preset.label,
        text: buildTemplateTextFromSpans(spans),
        textSpans: spans,
      }
    }
    case 'breaking-update': {
      const spans: TextSpan[] = [
        {
          text: preset.sample.eyebrow ?? 'BREAKING',
          fontSize: Math.max(16, Math.round(baseFontSize * 0.28)),
          fontWeight: 'bold',
          color: '#fca5a5',
          letterSpacing: 2,
        },
        {
          text: preset.sample.title,
        },
        {
          text: preset.sample.subtitle ?? 'Developing now',
          fontSize: Math.max(20, Math.round(baseFontSize * 0.38)),
          fontWeight: 'semibold',
          color: '#fde68a',
        },
      ]

      return {
        ...styles,
        label: preset.label,
        text: buildTemplateTextFromSpans(spans),
        textSpans: spans,
      }
    }
    case 'headline-stack': {
      const spans: TextSpan[] = [
        {
          text: preset.sample.eyebrow ?? 'TOP STORY',
          fontSize: Math.max(16, Math.round(baseFontSize * 0.3)),
          fontWeight: 'semibold',
          color: '#fbbf24',
          letterSpacing: 2,
        },
        {
          text: preset.sample.title,
        },
        {
          text: preset.sample.subtitle ?? 'Subhead',
          fontSize: Math.max(20, Math.round(baseFontSize * 0.42)),
          fontWeight: 'medium',
          color: '#cbd5e1',
        },
      ]

      return {
        ...styles,
        label: preset.label,
        text: buildTemplateTextFromSpans(spans),
        textSpans: spans,
      }
    }
    case 'launch-stack': {
      const spans: TextSpan[] = [
        {
          text: preset.sample.eyebrow ?? 'NOW LIVE',
          fontSize: Math.max(16, Math.round(baseFontSize * 0.26)),
          fontWeight: 'bold',
          color: '#67e8f9',
          letterSpacing: 2,
        },
        {
          text: preset.sample.title,
        },
        {
          text: preset.sample.subtitle ?? 'Shop the drop',
          fontSize: Math.max(20, Math.round(baseFontSize * 0.4)),
          fontWeight: 'medium',
          color: '#bfdbfe',
        },
      ]

      return {
        ...styles,
        label: preset.label,
        text: buildTemplateTextFromSpans(spans),
        textSpans: spans,
      }
    }
    case 'event-card': {
      const spans: TextSpan[] = [
        {
          text: preset.sample.eyebrow ?? 'LIVE',
          fontSize: Math.max(18, Math.round(baseFontSize * 0.28)),
          fontWeight: 'bold',
          color: '#fca5a5',
          letterSpacing: 2,
        },
        {
          text: preset.sample.title,
        },
        {
          text: preset.sample.subtitle ?? 'Friday 8 PM',
          fontSize: Math.max(22, Math.round(baseFontSize * 0.38)),
          fontWeight: 'semibold',
          color: '#bfdbfe',
          letterSpacing: 1,
        },
      ]

      return {
        ...styles,
        label: preset.label,
        text: buildTemplateTextFromSpans(spans),
        textSpans: spans,
      }
    }
    case 'badge':
      return {
        ...styles,
        label: preset.label,
        text: preset.sample.title,
        textSpans: [
          {
            text: preset.sample.title,
            letterSpacing: 2,
          },
        ],
      }
    default:
      return {
        ...styles,
        label: preset.label,
        text: preset.sample.title,
        textSpans: undefined,
      }
  }
}

function getSpanStyle(span?: TextSpan): Omit<TextSpan, 'text'> {
  if (!span) {
    return {}
  }

  const style: Partial<TextSpan> = { ...span }
  delete style.text
  return style
}

export function applyTextStylePresetToItem(
  item: TextItem,
  presetId: TextStylePresetId,
  canvas: CanvasSettings,
  styleScale = 1,
): Partial<TextItem> {
  const template = buildTextStylePresetTemplate(presetId, canvas, styleScale)
  const currentSpans =
    Array.isArray(item.textSpans) && item.textSpans.length > 0 ? item.textSpans : undefined
  const templateSpans =
    Array.isArray(template.textSpans) && template.textSpans.length > 0
      ? template.textSpans
      : undefined
  const nextSpans = currentSpans
    ? currentSpans.map((span, index) => {
        const templateSpan =
          templateSpans?.[Math.min(index, Math.max(0, (templateSpans?.length ?? 1) - 1))]
        return {
          ...span,
          ...getSpanStyle(templateSpan),
          text: span.text,
        }
      })
    : undefined
  const nextText = nextSpans ? nextSpans.map((span) => span.text).join('\n') : item.text

  return {
    ...template,
    text: nextText,
    textSpans: nextSpans,
    label: buildTextItemLabelFromText(nextText),
  }
}
