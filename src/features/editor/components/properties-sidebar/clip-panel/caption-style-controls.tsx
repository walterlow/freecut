import { memo, useCallback, useMemo } from 'react'

import { Separator } from '@/components/ui/separator'
import { cn } from '@/shared/ui/cn'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import type { SubtitleSegmentItem, TextItem } from '@/types/timeline'

import { ColorPicker, PropertyRow, SliderInput } from '../components'
import {
  CAPTION_STYLE_PRESETS,
  type CaptionStylePreset,
  detectActiveCaptionPreset,
  resolveCaptionStylePatch,
} from './caption-style-presets'

type CaptionStylableItem = SubtitleSegmentItem | TextItem

interface CaptionStyleControlsProps {
  /**
   * Items the controls should affect. Typically a single subtitle segment,
   * but the panel handles multi-select by writing the same patch to each.
   */
  items: CaptionStylableItem[]
  canvasWidth: number
  canvasHeight: number
}

/**
 * Caption / subtitle look-and-feel editor.
 *
 * Surfaces the typography subset shared between {@link TextItem} (captions)
 * and {@link SubtitleSegmentItem}: presets, color, font size, vertical
 * position, and a background-box toggle. Designed to be embedded inside a
 * larger section (e.g. {@link SubtitleSection}).
 */
export const CaptionStyleControls = memo(function CaptionStyleControls({
  items,
  canvasWidth,
  canvasHeight,
}: CaptionStyleControlsProps) {
  const updateItem = useTimelineStore((s) => s.updateItem)

  const applyPatch = useCallback(
    (patch: Partial<CaptionStylableItem>) => {
      for (const item of items) updateItem(item.id, patch)
    },
    [items, updateItem],
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
  const sampleFontSize = sample.fontSize ?? Math.max(36, Math.round(canvasHeight * 0.045))
  const sampleTextPadding = sample.textPadding ?? 16
  const verticalY = Math.round(sample.transform?.y ?? 0)
  const hasBackground = !!sample.backgroundColor
  const verticalRange = Math.max(1, Math.round(canvasHeight / 2))

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
          Style preset
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {CAPTION_STYLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.hint}
              onClick={() => applyPreset(preset)}
              className={cn(
                'rounded border px-2 py-1.5 text-[11px] text-center transition-colors',
                activePreset?.id === preset.id
                  ? 'border-primary bg-primary/15 text-foreground'
                  : 'border-border hover:bg-secondary/40 text-muted-foreground',
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <Separator className="my-1" />

      <ColorPicker
        label="Color"
        color={sampleColor}
        onChange={(color) => applyPatch({ color })}
        onLiveChange={(color) => applyPatch({ color })}
        onReset={() => applyPatch({ color: '#ffffff' })}
        defaultColor="#ffffff"
      />

      <PropertyRow label="Size">
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

      <PropertyRow label="Vertical">
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

      <PropertyRow label="Background">
        <div className="flex flex-1 min-w-0">
          <button
            type="button"
            onClick={() =>
              applyPatch({
                backgroundColor: hasBackground ? undefined : 'rgba(0, 0, 0, 0.55)',
              })
            }
            className={cn(
              'h-7 w-full rounded border text-xs transition-colors',
              hasBackground
                ? 'border-primary bg-primary/15'
                : 'border-border hover:bg-secondary/40 text-muted-foreground',
            )}
          >
            {hasBackground ? 'On' : 'Off'}
          </button>
        </div>
      </PropertyRow>

      {hasBackground && (
        <PropertyRow label="Padding">
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
      )}
    </div>
  )
})
