import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Separator } from '@/components/ui/separator'
import { cn } from '@/shared/ui/cn'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import type { SubtitleSegmentItem, TextItem } from '@/types/timeline'

import { ColorPicker, PropertyRow, SliderInput } from '../components'
import { FontPicker } from './font-picker'
import {
  CAPTION_STYLE_PRESETS,
  type CaptionStylePreset,
  detectActiveCaptionPreset,
  resolveCaptionStylePatch,
} from '@/shared/typography/caption-style-presets'

type CaptionStylableItem = SubtitleSegmentItem | TextItem

interface CaptionStyleControlsProps {
  /**
   * Items the controls should affect. Typically a single subtitle segment,
   * but the panel handles multi-select by writing the same patch to each.
   */
  items: CaptionStylableItem[]
  canvasWidth: number
  canvasHeight: number
  onApplyPatch?: (patch: Partial<CaptionStylableItem>) => void
}

/**
 * Caption / subtitle look-and-feel editor.
 *
 * Surfaces typography, outline/stroke, drop shadow, background-box,
 * and dynamic word animations. Shared between {@link TextItem} (captions)
 * and {@link SubtitleSegmentItem}.
 */
export const CaptionStyleControls = memo(function CaptionStyleControls({
  items,
  canvasWidth,
  canvasHeight,
  onApplyPatch,
}: CaptionStyleControlsProps) {
  const { t } = useTranslation()
  const updateItem = useTimelineStore((s) => s.updateItem)

  const applyPatch = useCallback(
    (patch: Partial<CaptionStylableItem>) => {
      if (onApplyPatch) {
        onApplyPatch(patch)
        return
      }
      for (const item of items) updateItem(item.id, patch)
    },
    [items, onApplyPatch, updateItem],
  )

  const applyPreset = useCallback(
    (preset: CaptionStylePreset) => {
      // Resolve the preset's canvas-relative layout (font size, transform.y,
      // etc.) into absolute values for THIS canvas, anchored to the
      // first-selected item's existing transform so we preserve x/rotation.
      const baseTransform = items[0]?.transform
      const resolved = resolveCaptionStylePatch(preset, canvasWidth, canvasHeight, baseTransform)
      applyPatch(resolved as Partial<CaptionStylableItem>)
    },
    [applyPatch, canvasHeight, canvasWidth, items],
  )

  // Prefer the first item as the canonical sample for displaying current
  // values — multi-select with mismatched values shows the first's value
  // and the user can override it for everyone in one click.
  const sample = items[0]
  const activePreset = useMemo(() => (sample ? detectActiveCaptionPreset(sample) : null), [sample])

  if (!sample) return null

  const sampleColor = sample.color ?? '#ffffff'
  const sampleFontFamily = sample.fontFamily ?? 'Inter'
  const sampleFontWeight = sample.fontWeight ?? 'normal'
  const sampleFontSize = sample.fontSize ?? Math.max(36, Math.round(canvasHeight * 0.045))
  const sampleTextPadding = sample.textPadding ?? 16
  const sampleBackgroundRadius = sample.backgroundRadius ?? 0
  const sampleBackgroundColor = sample.backgroundColor ?? 'rgba(0, 0, 0, 0.65)'
  const verticalY = Math.round(sample.transform?.y ?? 0)
  const hasBackground = !!sample.backgroundColor
  const verticalRange = Math.max(1, Math.round(canvasHeight / 2))

  const strokeWidth = sample.stroke?.width ?? 0
  const strokeColor = sample.stroke?.color ?? '#000000'
  const hasStroke = strokeWidth > 0

  const shadowBlur = sample.textShadow?.blur ?? 0
  const shadowOffsetY = sample.textShadow?.offsetY ?? 3
  const shadowColor = sample.textShadow?.color ?? 'rgba(0, 0, 0, 0.8)'
  const hasShadow = shadowBlur > 0 || (sample.textShadow?.offsetY ?? 0) !== 0

  const updateVerticalPosition = (value: number) => {
    applyPatch({
      transform: {
        ...(sample.transform ?? {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          rotation: 0,
          opacity: 1,
        }),
        y: value,
      },
    } as Partial<CaptionStylableItem>)
  }

  return (
    <div className="space-y-1">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground pb-1.5">
          {t('editor.captionStyleControls.stylePreset')}
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {CAPTION_STYLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={t(preset.hintKey)}
              onClick={() => applyPreset(preset)}
              className={cn(
                'rounded border px-2 py-1.5 text-[11px] text-center transition-colors',
                activePreset?.id === preset.id
                  ? 'border-border/70 bg-secondary/60 text-foreground'
                  : 'border-border hover:bg-secondary/40 text-muted-foreground',
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <Separator className="my-1" />

      {/* Typography: Font & Weight */}
      <PropertyRow label={t('editor.captionStyleControls.font', 'Fuente')}>
        <div className="flex-1 min-w-0">
          <FontPicker
            value={sampleFontFamily}
            onValueChange={(fontFamily) => applyPatch({ fontFamily })}
          />
        </div>
      </PropertyRow>

      <PropertyRow label={t('editor.captionStyleControls.weight', 'Grosor')}>
        <select
          value={sampleFontWeight}
          onChange={(e) =>
            applyPatch({
              fontWeight: e.target.value as any,
            })
          }
          className="h-7 w-full rounded border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="normal">Normal (400)</option>
          <option value="medium">Medio (500)</option>
          <option value="semibold">Semibold (600)</option>
          <option value="bold">Bold (700)</option>
        </select>
      </PropertyRow>

      <ColorPicker
        label={t('editor.captionStyleControls.color')}
        color={sampleColor}
        onChange={(color) => applyPatch({ color })}
        onLiveChange={(color) => applyPatch({ color })}
        onReset={() => applyPatch({ color: '#ffffff' })}
        defaultColor="#ffffff"
      />

      <PropertyRow label={t('editor.captionStyleControls.size')}>
        <SliderInput
          value={sampleFontSize}
          onChange={(fontSize) => applyPatch({ fontSize })}
          onLiveChange={(fontSize) => applyPatch({ fontSize })}
          min={8}
          max={400}
          step={1}
          unit="px"
          className="flex-1 min-w-0"
        />
      </PropertyRow>

      <PropertyRow label={t('editor.captionStyleControls.vertical')}>
        <SliderInput
          value={verticalY}
          onChange={updateVerticalPosition}
          onLiveChange={updateVerticalPosition}
          min={-verticalRange}
          max={verticalRange}
          step={1}
          unit="px"
          className="flex-1 min-w-0"
        />
      </PropertyRow>

      <Separator className="my-1" />

      {/* Animation & Word Effects */}
      <PropertyRow label={t('editor.captionStyleControls.animation', 'Animación')}>
        <select
          value={(sample as SubtitleSegmentItem).captionAnimationStyle ?? 'none'}
          onChange={(e) =>
            applyPatch({
              captionAnimationStyle: e.target.value as any,
            } as any)
          }
          className="h-7 w-full rounded border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="none">Ninguna (Estático)</option>
          <option value="hormozi">Hormozi (Palabra activa)</option>
          <option value="mrbeast">MrBeast (Impacto Bold)</option>
          <option value="karaoke">Karaoke (Progresivo)</option>
          <option value="bounce">Bounce Pop (Salto activo)</option>
        </select>
      </PropertyRow>

      {(sample as SubtitleSegmentItem).captionAnimationStyle &&
        (sample as SubtitleSegmentItem).captionAnimationStyle !== 'none' && (
          <ColorPicker
            label={t('editor.captionStyleControls.highlightColor', 'Resalte')}
            color={(sample as SubtitleSegmentItem).captionHighlightColor ?? '#facc15'}
            onChange={(color) => applyPatch({ captionHighlightColor: color } as any)}
            onLiveChange={(color) => applyPatch({ captionHighlightColor: color } as any)}
            onReset={() => applyPatch({ captionHighlightColor: '#facc15' } as any)}
            defaultColor="#facc15"
          />
        )}

      <Separator className="my-1" />

      {/* Contorno / Stroke (Ideal para 'Solo Letra' sin recuadro) */}
      <PropertyRow label={t('editor.captionStyleControls.stroke', 'Borde / Trazo')}>
        <SliderInput
          value={strokeWidth}
          onChange={(width) =>
            applyPatch({
              stroke: width > 0 ? { width, color: strokeColor } : undefined,
            })
          }
          onLiveChange={(width) =>
            applyPatch({
              stroke: width > 0 ? { width, color: strokeColor } : undefined,
            })
          }
          min={0}
          max={20}
          step={0.5}
          unit="px"
          className="flex-1 min-w-0"
        />
      </PropertyRow>

      {hasStroke && (
        <ColorPicker
          label={t('editor.captionStyleControls.strokeColor', 'Color borde')}
          color={strokeColor}
          onChange={(color) =>
            applyPatch({
              stroke: { width: strokeWidth || 2, color },
            })
          }
          onLiveChange={(color) =>
            applyPatch({
              stroke: { width: strokeWidth || 2, color },
            })
          }
          onReset={() =>
            applyPatch({
              stroke: { width: strokeWidth || 2, color: '#000000' },
            })
          }
          defaultColor="#000000"
        />
      )}

      {/* Sombra / Shadow */}
      <PropertyRow label={t('editor.captionStyleControls.shadow', 'Sombra')}>
        <SliderInput
          value={shadowBlur}
          onChange={(blur) =>
            applyPatch({
              textShadow:
                blur > 0 || shadowOffsetY !== 0
                  ? {
                      offsetX: sample.textShadow?.offsetX ?? 0,
                      offsetY: shadowOffsetY,
                      blur,
                      color: shadowColor,
                    }
                  : undefined,
            })
          }
          onLiveChange={(blur) =>
            applyPatch({
              textShadow:
                blur > 0 || shadowOffsetY !== 0
                  ? {
                      offsetX: sample.textShadow?.offsetX ?? 0,
                      offsetY: shadowOffsetY,
                      blur,
                      color: shadowColor,
                    }
                  : undefined,
            })
          }
          min={0}
          max={30}
          step={1}
          unit="px"
          className="flex-1 min-w-0"
        />
      </PropertyRow>

      {hasShadow && (
        <>
          <PropertyRow label={t('editor.captionStyleControls.shadowOffset', 'Distancia sombra')}>
            <SliderInput
              value={shadowOffsetY}
              onChange={(offsetY) =>
                applyPatch({
                  textShadow: {
                    offsetX: sample.textShadow?.offsetX ?? 0,
                    offsetY,
                    blur: shadowBlur || 4,
                    color: shadowColor,
                  },
                })
              }
              onLiveChange={(offsetY) =>
                applyPatch({
                  textShadow: {
                    offsetX: sample.textShadow?.offsetX ?? 0,
                    offsetY,
                    blur: shadowBlur || 4,
                    color: shadowColor,
                  },
                })
              }
              min={-20}
              max={20}
              step={1}
              unit="px"
              className="flex-1 min-w-0"
            />
          </PropertyRow>
          <ColorPicker
            label={t('editor.captionStyleControls.shadowColor', 'Color sombra')}
            color={shadowColor}
            onChange={(color) =>
              applyPatch({
                textShadow: {
                  offsetX: sample.textShadow?.offsetX ?? 0,
                  offsetY: shadowOffsetY,
                  blur: shadowBlur || 4,
                  color,
                },
              })
            }
            onLiveChange={(color) =>
              applyPatch({
                textShadow: {
                  offsetX: sample.textShadow?.offsetX ?? 0,
                  offsetY: shadowOffsetY,
                  blur: shadowBlur || 4,
                  color,
                },
              })
            }
            onReset={() =>
              applyPatch({
                textShadow: {
                  offsetX: 0,
                  offsetY: 3,
                  blur: 4,
                  color: 'rgba(0, 0, 0, 0.8)',
                },
              })
            }
            defaultColor="rgba(0, 0, 0, 0.8)"
          />
        </>
      )}

      <Separator className="my-1" />

      {/* Recuadro de fondo (Background Box) */}
      <PropertyRow label={t('editor.captionStyleControls.background')}>
        <div className="flex flex-1 min-w-0">
          <button
            type="button"
            onClick={() =>
              applyPatch({
                backgroundColor: hasBackground ? undefined : 'rgba(0, 0, 0, 0.65)',
              })
            }
            className={cn(
              'h-7 w-full rounded border text-xs transition-colors',
              hasBackground
                ? 'border-border/70 bg-secondary/60 text-foreground'
                : 'border-border hover:bg-secondary/40 text-muted-foreground',
            )}
          >
            {hasBackground
              ? t('editor.captionStyleControls.on')
              : t('editor.captionStyleControls.off')}
          </button>
        </div>
      </PropertyRow>

      {hasBackground && (
        <>
          <ColorPicker
            label={t('editor.captionStyleControls.bgColor', 'Color fondo')}
            color={sampleBackgroundColor}
            onChange={(backgroundColor) => applyPatch({ backgroundColor })}
            onLiveChange={(backgroundColor) => applyPatch({ backgroundColor })}
            onReset={() => applyPatch({ backgroundColor: 'rgba(0, 0, 0, 0.65)' })}
            defaultColor="rgba(0, 0, 0, 0.65)"
          />
          <PropertyRow label={t('editor.captionStyleControls.radius', 'Esquinas')}>
            <SliderInput
              value={sampleBackgroundRadius}
              onChange={(backgroundRadius) => applyPatch({ backgroundRadius })}
              onLiveChange={(backgroundRadius) => applyPatch({ backgroundRadius })}
              min={0}
              max={32}
              step={1}
              unit="px"
              className="flex-1 min-w-0"
            />
          </PropertyRow>
          <PropertyRow label={t('editor.captionStyleControls.padding')}>
            <SliderInput
              value={sampleTextPadding}
              onChange={(textPadding) => applyPatch({ textPadding })}
              onLiveChange={(textPadding) => applyPatch({ textPadding })}
              min={0}
              max={80}
              step={1}
              unit="px"
              className="flex-1 min-w-0"
            />
          </PropertyRow>
        </>
      )}
    </div>
  )
})

