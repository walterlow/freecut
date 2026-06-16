import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/shared/ui/cn'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useSelectionStore } from '@/shared/state/selection'
import { useProjectStore } from '@/features/editor/deps/projects'
import {
  applyAnimationPreset,
  captureAnimationFromItem,
  getPresetCompatibility,
  useItemsStore,
  useKeyframesStore,
} from '@/features/editor/deps/timeline-store'
import {
  readAnimationPresets,
  saveAnimationPresets,
  type AnimationPreset,
} from '@/infrastructure/storage'
import { SaveAnimationPresetDialog } from './save-animation-preset-dialog'

/**
 * Animation preset library (U7, R16): browse and save/apply the project's saved
 * animation presets from the Animate workspace. Presentational shell over the
 * storage layer (U5) and apply path (U6); presets incompatible with the current
 * selection render disabled with a reason tooltip. (Per-keyframe easing curves
 * live in the dopesheet's interpolation icon row, not here.)
 */
export const AnimationPresetLibrary = memo(function AnimationPresetLibrary() {
  const { t } = useTranslation()
  const projectId = useProjectStore((s) => s.currentProject?.id ?? null)
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const selectedItem = useItemsStore(
    useCallback(
      (s) => {
        for (const id of selectedItemIds) {
          const item = s.itemById[id]
          if (item) return item
        }
        return null
      },
      [selectedItemIds],
    ),
  )
  const selectedItemKeyframes = useKeyframesStore(
    useCallback(
      (s) => (selectedItem ? (s.keyframesByItemId[selectedItem.id] ?? null) : null),
      [selectedItem],
    ),
  )

  const [presets, setPresets] = useState<AnimationPreset[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    if (!projectId) {
      setPresets([])
      return
    }
    let cancelled = false
    void readAnimationPresets(projectId).then((loaded) => {
      if (!cancelled) setPresets(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const canCapture =
    !!selectedItem &&
    !!selectedItemKeyframes &&
    selectedItemKeyframes.properties.some((property) => property.keyframes.length > 0)

  const handleSave = useCallback(
    async (name: string): Promise<boolean> => {
      if (!projectId || !selectedItem) return false
      const captured = captureAnimationFromItem(selectedItem, selectedItemKeyframes ?? undefined)
      if (!captured) return false

      const withoutDuplicate = presets.filter(
        (preset) => preset.name.toLowerCase() !== name.toLowerCase(),
      )
      const next: AnimationPreset[] = [
        ...withoutDuplicate,
        { id: crypto.randomUUID(), name, createdAt: Date.now(), ...captured },
      ]
      try {
        await saveAnimationPresets(projectId, next)
        setPresets(next)
        toast.success(t('editor.animatePresets.savedToast', { name }))
        return true
      } catch {
        return false
      }
    },
    [presets, projectId, selectedItem, selectedItemKeyframes, t],
  )

  const handleApply = useCallback(
    (preset: AnimationPreset) => {
      if (!selectedItem) {
        toast.warning(t('editor.animatePresets.selectClipFirst'))
        return
      }
      const result = applyAnimationPreset(selectedItem.id, preset, 0)
      // Report failure only when nothing was committed. An effect can be added
      // even if every keyframe clamped out — that still mutated the clip.
      if (result.incompatible || (result.applied === 0 && result.addedEffects === 0)) {
        toast.warning(t('editor.animatePresets.applyFailed'))
        return
      }
      toast.success(t('editor.animatePresets.appliedToast', { name: preset.name }))
    },
    [selectedItem, t],
  )

  const handleDelete = useCallback(
    async (preset: AnimationPreset) => {
      if (!projectId) return
      const next = presets.filter((candidate) => candidate.id !== preset.id)
      try {
        await saveAnimationPresets(projectId, next)
        setPresets(next)
      } catch {
        toast.warning(t('editor.animatePresets.saveFailed'))
      }
    },
    [presets, projectId, t],
  )

  // Compatibility depends only on the presets and the target item, so compute
  // it once per change rather than per preset on every render (the component
  // also re-renders on keyframe-selection changes for the easing section).
  const compatibilityByPresetId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getPresetCompatibility>>()
    if (!selectedItem) return map
    for (const preset of presets) {
      map.set(preset.id, getPresetCompatibility(preset, selectedItem))
    }
    return map
  }, [presets, selectedItem])

  const incompatibilityReason = useCallback(
    (preset: AnimationPreset): string | null => {
      if (!selectedItem) return t('editor.animatePresets.selectClipFirst')
      const compatibility = compatibilityByPresetId.get(preset.id)
      if (!compatibility || compatibility.compatible) return null
      return compatibility.reason === 'type-mismatch'
        ? t('editor.animatePresets.incompatibleType', { type: preset.sourceItemType })
        : t('editor.animatePresets.incompatibleProperty')
    },
    [compatibilityByPresetId, selectedItem, t],
  )

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full w-60 min-w-0 flex-col border-l border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            {t('editor.animatePresets.title')}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-[11px]"
                  disabled={!canCapture}
                  onClick={() => setDialogOpen(true)}
                >
                  <Plus className="h-3 w-3" />
                  {t('editor.animatePresets.saveButton')}
                </Button>
              </span>
            </TooltipTrigger>
            {!canCapture && (
              <TooltipContent>{t('editor.animatePresets.noAnimationToSave')}</TooltipContent>
            )}
          </Tooltip>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 p-3">
            <section className="flex flex-col gap-1">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {t('editor.animatePresets.animationsHeading')}
              </h3>
              {presets.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('editor.animatePresets.empty')}</p>
              ) : (
                presets.map((preset) => {
                  const reason = incompatibilityReason(preset)
                  const disabled = reason !== null
                  const row = (
                    <div
                      key={preset.id}
                      className="group flex items-center gap-1 rounded-md border border-border/60"
                    >
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => handleApply(preset)}
                        className={cn(
                          'min-w-0 flex-1 truncate px-2 py-1.5 text-left text-xs',
                          disabled
                            ? 'cursor-not-allowed text-muted-foreground/60'
                            : 'hover:bg-secondary/40',
                        )}
                      >
                        {preset.name}
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                        aria-label={t('editor.animatePresets.deleteLabel')}
                        onClick={() => void handleDelete(preset)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )

                  if (!disabled) return row
                  return (
                    <Tooltip key={preset.id}>
                      <TooltipTrigger asChild>{row}</TooltipTrigger>
                      <TooltipContent>{reason}</TooltipContent>
                    </Tooltip>
                  )
                })
              )}
            </section>
          </div>
        </ScrollArea>

        <SaveAnimationPresetDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          existingNames={presets.map((preset) => preset.name)}
          onSave={handleSave}
        />
      </div>
    </TooltipProvider>
  )
})
