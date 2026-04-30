import { memo, useCallback, useMemo } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/shared/ui/cn'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import type { SubtitleSegmentItem, TextItem } from '@/types/timeline'

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
  const verticalY = Math.round(sample.transform?.y ?? 0)
  const hasBackground = !!sample.backgroundColor

  return (
    <div className="space-y-3">
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

      <Separator />

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="caption-color" className="text-[10px] text-muted-foreground">
            Color
          </Label>
          <div className="flex items-center gap-1.5">
            <input
              id="caption-color"
              type="color"
              value={normalizeColor(sampleColor)}
              onChange={(event) => applyPatch({ color: event.target.value })}
              className="h-7 w-7 cursor-pointer rounded border border-border bg-transparent"
            />
            <Input
              value={sampleColor}
              onChange={(event) => applyPatch({ color: event.target.value })}
              className="h-7 flex-1 text-xs tabular-nums"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="caption-font-size" className="text-[10px] text-muted-foreground">
            Size
          </Label>
          <Input
            id="caption-font-size"
            type="number"
            min={8}
            max={400}
            step={1}
            value={sampleFontSize}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (Number.isFinite(value) && value > 0) applyPatch({ fontSize: value })
            }}
            className="h-7 text-xs tabular-nums"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="caption-y" className="text-[10px] text-muted-foreground">
            Vertical position (px from center)
          </Label>
          <Input
            id="caption-y"
            type="number"
            step={1}
            value={verticalY}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (!Number.isFinite(value)) return
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
            }}
            className="h-7 text-xs tabular-nums"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Background box</Label>
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
      </div>
    </div>
  )
})

/**
 * Native `<input type="color">` only accepts 6-digit hex. If a user has set
 * a non-hex color (e.g. `oklch(...)` or `rgba(…)` from a preset), feed the
 * picker a sensible default while leaving the canonical value in the text
 * input next to it.
 */
function normalizeColor(value: string): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value
  return '#ffffff'
}
