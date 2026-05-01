import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FloatingPanel } from '@/components/ui/floating-panel'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { toast } from 'sonner'
import { useTimelineStore } from '../stores/timeline-store'
import { useSilenceRemovalDialogStore } from '../stores/silence-removal-dialog-store'
import {
  analyzeSilenceForItems,
  applySilencePreviewOverlays,
  clearSilencePreviewOverlays,
  type SilenceRemovalSettings,
} from '../utils/silence-removal-preview'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('SilenceRemovalDialog')
const SILENCE_REMOVAL_PANEL_STORAGE_KEY = 'timeline:silenceRemovalPanelBounds'
const SILENCE_REMOVAL_PANEL_DEFAULT_BOUNDS = { x: -1, y: -1, width: 420, height: 320 }

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0.0s'
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  return `${Math.round(seconds)}s`
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function SettingControl({
  id,
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix: string
  onChange: (value: number) => void
}) {
  const commitValue = useCallback(
    (nextValue: number) => {
      onChange(clampNumber(nextValue, min, max))
    },
    [max, min, onChange],
  )

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="text-xs font-medium">
          {label}
        </Label>
        <div className="flex items-center gap-1">
          <Input
            id={id}
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(event) => commitValue(Number(event.target.value))}
            className="h-7 w-16 px-2 text-right text-xs"
          />
          <span className="w-7 text-xs text-muted-foreground">{suffix}</span>
        </div>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([nextValue]) => {
          if (nextValue !== undefined) commitValue(nextValue)
        }}
      />
    </div>
  )
}

export function SilenceRemovalDialog() {
  const isOpen = useSilenceRemovalDialogStore((state) => state.isOpen)
  const itemIds = useSilenceRemovalDialogStore((state) => state.itemIds)
  const settings = useSilenceRemovalDialogStore((state) => state.settings)
  const rangesByMediaId = useSilenceRemovalDialogStore((state) => state.rangesByMediaId)
  const summary = useSilenceRemovalDialogStore((state) => state.summary)
  const updatePreview = useSilenceRemovalDialogStore((state) => state.updatePreview)
  const close = useSilenceRemovalDialogStore((state) => state.close)
  const [draft, setDraft] = useState<SilenceRemovalSettings>(settings)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setDraft(settings)
    }
  }, [isOpen, settings])

  const handleClose = useCallback(() => {
    clearSilencePreviewOverlays(itemIds)
    close()
  }, [close, itemIds])

  const handlePanelClose = useCallback(() => {
    if (!isAnalyzing) {
      handleClose()
    }
  }, [handleClose, isAnalyzing])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isAnalyzing) {
        handleClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleClose, isAnalyzing, isOpen])

  const handleUpdatePreview = useCallback(() => {
    const run = async () => {
      setIsAnalyzing(true)
      try {
        const nextRangesByMediaId = await analyzeSilenceForItems(itemIds, draft)
        const nextSummary = applySilencePreviewOverlays(itemIds, nextRangesByMediaId)
        updatePreview({
          settings: draft,
          rangesByMediaId: nextRangesByMediaId,
          summary: nextSummary,
        })
        if (nextSummary.rangeCount === 0) {
          toast.info('No removable silence detected with these settings')
        }
      } catch (error) {
        logger.warn('Silence preview failed', error)
        toast.error(error instanceof Error ? error.message : 'Failed to preview silence')
      } finally {
        setIsAnalyzing(false)
      }
    }

    void run()
  }, [draft, itemIds, updatePreview])

  const handleApply = useCallback(() => {
    const result = useTimelineStore.getState().removeSilenceFromItems(itemIds, rangesByMediaId)
    clearSilencePreviewOverlays(itemIds)
    close()

    if (result.removedItemCount === 0) {
      toast.info('No silence segments found inside the selected clips')
      return
    }

    toast.success(
      `Removed ${result.removedItemCount} silence segment${result.removedItemCount === 1 ? '' : 's'}`,
    )
  }, [close, itemIds, rangesByMediaId])

  if (!isOpen) {
    return null
  }

  return (
    <FloatingPanel
      title="Remove Silence"
      defaultBounds={SILENCE_REMOVAL_PANEL_DEFAULT_BOUNDS}
      minWidth={340}
      minHeight={320}
      storageKey={SILENCE_REMOVAL_PANEL_STORAGE_KEY}
      onClose={handlePanelClose}
      resizable={false}
      autoHeight
      className="bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90"
    >
      <section
        role="dialog"
        aria-label="Remove Silence"
        aria-modal="false"
        className="flex flex-col"
      >
        <div className="space-y-4 p-3">
          <div className="rounded-md border bg-muted/35 px-3 py-2 text-sm leading-tight">
            <div className="font-medium">
              {summary.rangeCount} range{summary.rangeCount === 1 ? '' : 's'} selected
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              About {formatSeconds(summary.totalSeconds)} will be removed.
            </div>
          </div>

          <div className="space-y-3.5">
            <SettingControl
              id="silence-threshold"
              label="Threshold"
              value={draft.thresholdDb}
              min={-80}
              max={-20}
              step={1}
              suffix="dB"
              onChange={(thresholdDb) => setDraft((current) => ({ ...current, thresholdDb }))}
            />
            <SettingControl
              id="silence-duration"
              label="Minimum silence"
              value={draft.minSilenceMs}
              min={100}
              max={3000}
              step={50}
              suffix="ms"
              onChange={(minSilenceMs) => setDraft((current) => ({ ...current, minSilenceMs }))}
            />
            <SettingControl
              id="silence-padding"
              label="Keep padding"
              value={draft.paddingMs}
              min={0}
              max={1000}
              step={25}
              suffix="ms"
              onChange={(paddingMs) => setDraft((current) => ({ ...current, paddingMs }))}
            />
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border bg-secondary/10 p-3 sm:flex-row sm:justify-end">
          <Button variant="ghost" size="sm" onClick={handleClose} disabled={isAnalyzing}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleUpdatePreview}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? 'Updating...' : 'Update Preview'}
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={isAnalyzing || summary.rangeCount === 0}
          >
            Remove
          </Button>
        </div>
      </section>
    </FloatingPanel>
  )
}
