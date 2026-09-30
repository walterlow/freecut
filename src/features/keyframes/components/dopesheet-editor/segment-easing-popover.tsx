import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { usePrefersReducedMotion } from '@/shared/hooks/use-prefers-reduced-motion'
import { ChevronLeft, Plus, RotateCcw, Save, SlidersHorizontal, X } from 'lucide-react'
import { toast } from 'sonner'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/shared/ui/cn'
import { useElementSize } from './use-element-size'
import { applyEasingConfig } from '@/shared/utils/easing'
import type {
  BezierControlPoints,
  EasingConfig,
  EasingType,
  KeyframeRef,
  SpringParameters,
} from '@/types/keyframe'

import {
  EASING_PRESETS,
  SPRING_PRESETS,
  type EasingDirection,
  type EasingPreset,
  findMatchingPreset,
  presetDirection,
  presetMatchesEasing,
  presetToEasing,
} from './easings-dev-presets'
import { EasingCurveEditor } from './easing-curve-editor'
import { loadCustomPresets, saveCustomPresets } from './custom-easing-presets'
import './easing-preset-thumbnail.css'

type PresetType = 'Easing' | 'Spring'
type DirectionFilter = 'all' | EasingDirection

const DIRECTION_FILTERS: Array<{ value: DirectionFilter; labelKey: string; defaultValue: string }> =
  [
    { value: 'all', labelKey: 'timeline.keyframeEditor.filterAll', defaultValue: 'All' },
    { value: 'in', labelKey: 'timeline.keyframeEditor.filterIn', defaultValue: 'In' },
    { value: 'out', labelKey: 'timeline.keyframeEditor.filterOut', defaultValue: 'Out' },
    { value: 'inout', labelKey: 'timeline.keyframeEditor.filterInOut', defaultValue: 'In-Out' },
  ]

// Both views share one width so switching between them animates height only —
// a pure vertical morph. Changing width too would move the panel's edges
// horizontally at the same time, which reads as a diagonal resize.
const PANEL_WIDTH = 480

/** Easing updates applied to a segment's originating keyframe(s). */
export interface SegmentEasingUpdate {
  easing: EasingType
  easingConfig?: EasingConfig
}

export type SegmentEasingChange = (
  refs: KeyframeRef[],
  updates: SegmentEasingUpdate,
  options?: { commit?: boolean },
) => void

interface SegmentEasingPopoverProps {
  /** Left offset of the connector band, in px within the timeline cell. */
  left: number
  /** Width of the connector band, in px. */
  width: number
  /** Relative frames used to keep the hit target aligned during live zoom. */
  fromFrame: number
  toFrame: number
  /** Keyframe(s) that begin this segment (one per property for group rows). */
  refs: KeyframeRef[]
  /** Representative easing (first ref). */
  easing: EasingType
  /** Representative easing config (first ref). */
  easingConfig?: EasingConfig
  /** True when a group segment's properties don't all share the same easing. */
  mixed?: boolean
  /** Held segments render dashed; used only for the band's resting style. */
  held?: boolean
  onChange: SegmentEasingChange
  onDragStart?: () => void
  onDragEnd?: () => void
}

export function SegmentEasingPopover({
  left,
  width,
  fromFrame,
  toFrame,
  refs,
  easing,
  easingConfig,
  mixed = false,
  held = false,
  onChange,
  onDragStart,
  onDragEnd,
}: SegmentEasingPopoverProps) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(false)
  const [presetType, setPresetType] = useState<PresetType>('Easing')
  const [direction, setDirection] = useState<DirectionFilter>('all')
  // The user's last explicit preset pick, used to disambiguate identical-curve
  // presets (e.g. Snappy Out vs Out Expo) when highlighting the active one.
  const [pickedName, setPickedName] = useState<string | null>(null)
  const [customPresets, setCustomPresets] = useState<EasingPreset[]>(() => loadCustomPresets())
  // null = not naming; string = the Save name field is open with this draft.
  const [savingName, setSavingName] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // The side (top/bottom) Radix resolved on first open, pinned for the rest of
  // the session. The preset grid and the taller spring/bezier editor differ in
  // height, and `ResizePanel` animates between them — without pinning, Radix
  // re-runs collision detection on that height change and can flip the panel to
  // the opposite side mid-transition. `sideLocked` gates avoidCollisions so the
  // FIRST view still gets a collision-aware placement; we then freeze it.
  const [lockedSide, setLockedSide] = useState<'top' | 'bottom'>('top')
  const [sideLocked, setSideLocked] = useState(false)
  // Horizontal anchor for the popover, in the cell's coordinate space. Set from
  // the pointer position on open so the panel grows out of where the user
  // clicked the connector band, not from its center.
  const [anchorLeft, setAnchorLeft] = useState<number | null>(null)
  // The easing as it was when the popover opened — the Reset fallback when the
  // curve isn't based on a named preset.
  const openBaselineRef = useRef<SegmentEasingUpdate | null>(null)

  // The timeline stops `pointerdown` propagation, which swallows Radix's own
  // outside-click dismissal. Listen in the capture phase (runs top-down, before
  // the timeline handlers) so an outside click reliably closes the popover.
  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (contentRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      // Nested Radix poppers (the preview-mode dropdown) portal to the body, so
      // they're outside contentRef — clicking one must not close the popover.
      const el = target instanceof Element ? target : target.parentElement
      if (el?.closest('[data-radix-popper-content-wrapper]')) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [open])

  // Pin the resolved side once Radix has positioned the initial (preset) view.
  // Read `data-side` after a frame — Radix sets it after its floating-position
  // pass — then lock it so later height changes (Edit ↔ Presets) don't re-flip.
  useEffect(() => {
    // Don't unlock on close — that would flip the side back mid-exit-animation
    // and cause a flicker. Unlocking happens synchronously on open (below).
    if (!open) return
    const raf = requestAnimationFrame(() => {
      const side = contentRef.current?.getAttribute('data-side')
      if (side === 'top' || side === 'bottom') {
        setLockedSide(side)
        setSideLocked(true)
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [open])

  // Center a padded band on the connector so it never covers the diamond hit
  // targets at either end; fall back to the full span for very short segments.
  const inset = width > 22 ? 8 : 0
  const bandLeft = left + inset
  const bandWidth = Math.max(2, width - inset * 2)
  // Clamp the click anchor to the band so the panel always tethers to the
  // segment; default to the band center before the first click.
  const bandCenter = bandLeft + bandWidth / 2
  const effectiveAnchor =
    anchorLeft != null ? Math.min(bandLeft + bandWidth, Math.max(bandLeft, anchorLeft)) : bandCenter
  // The band (trigger) is the positioning reference. With `align="start"` the
  // panel's left edge sits at the band's left edge; `alignOffset` then shifts it
  // so the fixed-width panel is centered on the click point. Uses the static
  // width, never a measurement, so positioning doesn't depend on layout timing.
  const alignOffset = effectiveAnchor - bandLeft - PANEL_WIDTH / 2

  // Prefer the user's explicit pick when its curve still matches the segment, so
  // an identical-curve twin (e.g. Snappy Out vs Out Expo) can't steal the
  // highlight; otherwise fall back to the first matching preset.
  const pickedPreset =
    pickedName != null
      ? [...EASING_PRESETS, ...SPRING_PRESETS, ...customPresets].find(
          (preset) => preset.name === pickedName,
        )
      : undefined
  const activePresetName = mixed
    ? null
    : pickedPreset && presetMatchesEasing(pickedPreset, easing, easingConfig)
      ? pickedPreset.name
      : (findMatchingPreset(easing, easingConfig)?.name ?? null)
  const isHold = easing === 'hold'

  const filteredPresets =
    presetType === 'Spring'
      ? SPRING_PRESETS
      : EASING_PRESETS.filter(
          (preset) => direction === 'all' || presetDirection(preset.name) === direction,
        )

  const applyPreset = (preset: EasingPreset) => {
    setPickedName(preset.name)
    onChange(refs, presetToEasing(preset))
  }

  const applyBezier = (bezier: BezierControlPoints, commit: boolean) => {
    onChange(
      refs,
      { easing: 'cubic-bezier', easingConfig: { type: 'cubic-bezier', bezier } },
      { commit },
    )
  }

  const applySpring = (spring: SpringParameters, commit: boolean) => {
    onChange(refs, { easing: 'spring', easingConfig: { type: 'spring', spring } }, { commit })
  }

  const setHold = () => {
    onChange(refs, { easing: 'hold', easingConfig: undefined })
  }

  // Reset: jump back to the preset the curve is based on (the last one picked),
  // or the value the popover opened with if it was never a named preset. Unlike
  // undo, this is a single step back to the clean curve.
  const sameEasing = (a: SegmentEasingUpdate, b: SegmentEasingUpdate) =>
    a.easing === b.easing &&
    JSON.stringify(a.easingConfig ?? null) === JSON.stringify(b.easingConfig ?? null)
  const resetTarget: SegmentEasingUpdate | null = pickedPreset
    ? presetToEasing(pickedPreset)
    : openBaselineRef.current
  const canReset = !!resetTarget && !mixed && !sameEasing(resetTarget, { easing, easingConfig })
  const handleReset = () => {
    if (resetTarget) onChange(refs, resetTarget)
  }

  // Save: persist the current tweaked curve as a reusable custom preset.
  const canSave = !mixed && (easing === 'cubic-bezier' || easing === 'spring')
  // The saved custom preset this curve came from (if any) — the Update target.
  const activeCustomName =
    pickedName && customPresets.some((preset) => preset.name === pickedName) ? pickedName : null
  // Name for a brand-new preset (Save As) — the next free "Custom N".
  const newSuggestedName = () => {
    let n = customPresets.length + 1
    const taken = new Set(customPresets.map((preset) => preset.name))
    while (taken.has(`Custom ${n}`)) n++
    return `Custom ${n}`
  }
  const persistPreset = (rawName: string) => {
    const name = rawName.trim()
    if (!name) {
      toast.error(
        t('timeline.keyframeEditor.presetNameRequired', {
          defaultValue: 'Preset name is required',
        }),
      )
      return
    }
    let preset: EasingPreset | null = null
    if (easing === 'cubic-bezier' && easingConfig?.type === 'cubic-bezier' && easingConfig.bezier) {
      preset = { name, type: 'Easing', bezier: easingConfig.bezier }
    } else if (easing === 'spring' && easingConfig?.type === 'spring' && easingConfig.spring) {
      preset = { name, type: 'Spring', spring: easingConfig.spring }
    }
    if (!preset) return
    const next = [...customPresets.filter((p) => p.name !== name), preset]
    setCustomPresets(next)
    saveCustomPresets(next)
    setPickedName(name)
    setPresetType(preset.type)
    setSavingName(null)
  }
  // Header name of the curve being edited.
  const editingName =
    activeCustomName ??
    activePresetName ??
    (isHold
      ? t('timeline.keyframeEditor.easing.hold')
      : t('timeline.keyframeEditor.custom', { defaultValue: 'Custom' }))
  const deleteCustomPreset = (name: string) => {
    const next = customPresets.filter((preset) => preset.name !== name)
    setCustomPresets(next)
    saveCustomPresets(next)
  }
  const myPresets = customPresets.filter((preset) => preset.type === presetType)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          openBaselineRef.current = { easing, easingConfig }
          // Unlock before the content mounts so the fresh open gets a
          // collision-aware placement; the effect re-pins it a frame later.
          setSideLocked(false)
        } else {
          setEditing(false)
          setSavingName(null)
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          data-testid={`segment-easing-${refs[0]?.property}-${refs[0]?.keyframeId}`}
          data-dopesheet-from-frame={fromFrame}
          data-dopesheet-to-frame={toFrame}
          data-dopesheet-responsive-inset={8}
          data-dopesheet-min-width={2}
          className={cn(
            'absolute z-[6] h-2 -translate-y-1/2 rounded-full',
            'bg-transparent hover:bg-blue-400/25 focus-visible:bg-blue-400/30',
            'cursor-pointer outline-none transition-colors',
          )}
          style={{ left: bandLeft, width: bandWidth, top: '50%' }}
          onPointerDown={(event) => {
            event.stopPropagation()
            // Record where along the band the user pressed (in cell coords) so
            // the popover anchors there. Runs before the click that opens it.
            const rect = event.currentTarget.getBoundingClientRect()
            setAnchorLeft(event.currentTarget.offsetLeft + (event.clientX - rect.left))
          }}
          onClick={(event) => event.stopPropagation()}
          title={t('timeline.keyframeEditor.editCurve', { defaultValue: 'Easing' })}
          aria-label={t('timeline.keyframeEditor.editCurve', { defaultValue: 'Easing' })}
        >
          <span className="sr-only">{held ? 'hold' : easing}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align="start"
        alignOffset={alignOffset}
        collisionPadding={12}
        // Until the initial view is placed, let Radix pick the side with
        // collision avoidance; afterwards pin that side so switching to the
        // taller editor view can't flip the panel to the opposite direction.
        side={sideLocked ? lockedSide : 'top'}
        avoidCollisions={!sideLocked}
        className="w-auto max-w-[calc(100vw-24px)] overflow-hidden p-0"
        onPointerDown={(event) => event.stopPropagation()}
        // Disable Radix's automatic dismissal (focus-out, internal focus shifts,
        // its own outside detection). The popover closes ONLY via our explicit
        // capture-phase outside-click listener above, so interacting with the
        // sliders / inputs / preset grid never auto-closes it.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <ResizePanel viewKey={editing ? 'editor' : 'presets'}>
          <div style={{ width: PANEL_WIDTH }}>
            {/* Header: current selection + Edit / back toggle. */}
            <div className="flex h-9 items-center justify-between border-b border-border/60 px-3">
              {editing ? (
                <div className="flex min-w-0 items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    className="flex shrink-0 items-center gap-1 text-muted-foreground hover:text-foreground"
                    onClick={() => setEditing(false)}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    {t('timeline.keyframeEditor.presets', { defaultValue: 'Presets' })}
                  </button>
                  {!mixed && (
                    <span className="truncate text-muted-foreground/70">— {editingName}</span>
                  )}
                </div>
              ) : (
                <span className="truncate text-xs font-medium text-foreground">
                  {mixed
                    ? t('timeline.keyframeEditor.mixedCurves')
                    : (activePresetName ??
                      (isHold
                        ? t('timeline.keyframeEditor.easing.hold')
                        : t('timeline.keyframeEditor.custom')))}
                </span>
              )}
              {!editing && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-[11px]"
                  onClick={() => setEditing(true)}
                >
                  <SlidersHorizontal className="h-3 w-3" />
                  {t('timeline.keyframeEditor.edit', { defaultValue: 'Edit' })}
                </Button>
              )}
            </div>

            {editing ? (
              <div className="p-3">
                <EasingCurveEditor
                  easing={easing}
                  config={easingConfig}
                  onChangeBezier={applyBezier}
                  onChangeSpring={applySpring}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                />
                <div className="mt-3 flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!canReset}
                    onClick={handleReset}
                    className="h-6 gap-1 px-1.5 text-[11px]"
                  >
                    <RotateCcw className="h-3 w-3" />
                    {t('timeline.keyframeEditor.reset', { defaultValue: 'Reset' })}
                  </Button>
                  {savingName === null ? (
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!canSave}
                        onClick={() => setSavingName(newSuggestedName())}
                        className="h-6 gap-1 px-1.5 text-[11px]"
                      >
                        <Plus className="h-3 w-3" />
                        {t('timeline.keyframeEditor.saveAsPreset', { defaultValue: 'Save As' })}
                      </Button>
                      {activeCustomName && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={!canSave}
                          onClick={() => persistPreset(activeCustomName)}
                          className="h-6 gap-1 px-1.5 text-[11px]"
                        >
                          <Save className="h-3 w-3" />
                          {t('timeline.keyframeEditor.updatePreset', { defaultValue: 'Update' })}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Input
                        autoFocus
                        autoComplete="off"
                        data-bwignore="true"
                        value={savingName}
                        onChange={(event) => setSavingName(event.target.value)}
                        onKeyDown={(event) => {
                          // Keep Enter/Escape inside the field so they don't reach
                          // Radix (close popover) or the timeline key handlers.
                          event.stopPropagation()
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            persistPreset(savingName)
                          } else if (event.key === 'Escape') {
                            setSavingName(null)
                          }
                        }}
                        placeholder={t('timeline.keyframeEditor.presetName', {
                          defaultValue: 'Preset name',
                        })}
                        className="h-6 w-28 px-1.5 text-[11px]"
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => persistPreset(savingName)}
                        className="h-6 px-2 text-[11px]"
                      >
                        {t('timeline.keyframeEditor.savePreset', { defaultValue: 'Save' })}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* Filter bar: type (Cubic Easing / Spring) + direction. */}
                <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5">
                  <div className="flex items-center gap-3 text-xs">
                    {(['Easing', 'Spring'] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setPresetType(type)}
                        className={cn(
                          'transition-colors',
                          presetType === type
                            ? 'font-medium text-foreground'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {type === 'Easing'
                          ? t('timeline.keyframeEditor.cubicEasing', {
                              defaultValue: 'Cubic Easing',
                            })
                          : t('timeline.keyframeEditor.spring')}
                      </button>
                    ))}
                  </div>
                  {presetType === 'Easing' && (
                    <div className="flex items-center gap-2 text-[11px]">
                      {DIRECTION_FILTERS.map((filter) => (
                        <button
                          key={filter.value}
                          type="button"
                          onClick={() => setDirection(filter.value)}
                          className={cn(
                            'transition-colors',
                            direction === filter.value
                              ? 'text-foreground'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {t(filter.labelKey, { defaultValue: filter.defaultValue })}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="max-h-[300px] overflow-y-auto p-2">
                  {myPresets.length > 0 && (
                    <div className="mb-2">
                      <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t('timeline.keyframeEditor.customPresets', { defaultValue: 'Custom' })}
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {myPresets.map((preset) => (
                          <PresetChip
                            key={preset.name}
                            label={preset.name}
                            active={preset.name === activePresetName}
                            onClick={() => applyPreset(preset)}
                            thumb={<PresetThumb preset={preset} />}
                            onDelete={() => deleteCustomPreset(preset.name)}
                            deleteLabel={t('timeline.keyframeEditor.deletePreset', {
                              defaultValue: 'Delete preset',
                            })}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {presetType === 'Easing' && (
                    <div className="grid grid-cols-4 gap-1">
                      <PresetChip
                        label={t('timeline.keyframeEditor.easing.hold')}
                        active={isHold}
                        onClick={setHold}
                        thumb={<HoldThumb />}
                      />
                    </div>
                  )}
                  <div className="mt-1 grid grid-cols-4 gap-1">
                    {filteredPresets.map((preset) => (
                      <PresetChip
                        key={preset.name}
                        label={preset.name}
                        active={preset.name === activePresetName}
                        onClick={() => applyPreset(preset)}
                        thumb={<PresetThumb preset={preset} />}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </ResizePanel>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Wraps the popover's two views (presets grid / curve editor) and animates the
 * panel's height whenever the active view — or the content within a view (tab,
 * direction filter) — changes. Width is fixed, so this is a pure vertical morph:
 * the visible content cross-fades while the container springs to the new
 * measured height, reading as a single fluid resize rather than a hard jump.
 */
function ResizePanel({ viewKey, children }: { viewKey: string; children: ReactNode }) {
  const reduce = usePrefersReducedMotion()
  const measureRef = useRef<HTMLDivElement>(null)
  const { height } = useElementSize(measureRef)
  const measured = height > 0
  // Apply the first measured height instantly; only animate height changes that
  // happen afterwards (tab / view switches). Without this, the panel visibly
  // grows to its natural height the moment it opens.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (measured && !ready) setReady(true)
  }, [measured, ready])

  return (
    <motion.div
      initial={false}
      animate={{ height: measured ? height : 'auto' }}
      transition={
        reduce || !ready
          ? { duration: 0 }
          : { type: 'spring', stiffness: 460, damping: 38, mass: 0.8 }
      }
      className="overflow-hidden"
    >
      {/* `relative` anchors the exiting view (popLayout positions it absolutely);
          `w-fit` lets the wrapper size to the active view's explicit width so the
          measured box is exact. */}
      <div ref={measureRef} className="relative w-fit">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={viewKey}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.12 }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

function PresetChip({
  label,
  active,
  onClick,
  thumb,
  onDelete,
  deleteLabel,
}: {
  label: string
  active: boolean
  onClick: () => void
  thumb: ReactNode
  /** When set, renders a hover-reveal delete affordance in the top-right corner. */
  onDelete?: () => void
  deleteLabel?: string
}) {
  // The select action and the delete action are sibling buttons inside a group
  // container (not a control nested in a button), so both have real button
  // semantics and are keyboard-reachable.
  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-md border transition-colors',
        active
          ? 'border-blue-500/70 bg-blue-500/10'
          : 'border-transparent hover:border-border hover:bg-muted/50',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        title={label}
        className="flex w-full flex-col items-center gap-1 rounded-md p-1.5"
      >
        {thumb}
        <span className="w-full truncate text-center text-[10px] leading-tight text-foreground">
          {label}
        </span>
      </button>
      {onDelete && (
        <button
          type="button"
          aria-label={deleteLabel}
          // Sibling of the select button, so this can't also apply the preset;
          // stopPropagation is belt-and-suspenders against any container handler.
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
          className="absolute right-1 top-1 rounded-full bg-background/90 p-0.5 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  )
}

// Thumbnail geometry — square tile. Y range shows anticipation (<0) and
// overshoot (>1). Path coords are in px so the SVG curve and the marker's CSS
// motion path (offset-path) share one coordinate space.
const T_SIZE = 44
const T_PAD = 7
const T_YMIN = -0.3
const T_YMAX = 1.3

const projX = (t: number) => T_PAD + t * (T_SIZE - T_PAD * 2)
const projY = (v: number) => T_PAD + ((T_YMAX - v) / (T_YMAX - T_YMIN)) * (T_SIZE - T_PAD * 2)

// Wrapper: muted dot grid + square SVG curve + orange marker that rides the
// curve on hover (animation defined in easing-preset-thumbnail.css).
function ThumbFrame({ d }: { d: string }) {
  return (
    <div
      className="ep-thumb shrink-0 overflow-hidden rounded"
      style={{ width: T_SIZE, height: T_SIZE }}
    >
      <svg
        width={T_SIZE}
        height={T_SIZE}
        viewBox={`0 0 ${T_SIZE} ${T_SIZE}`}
        className="absolute inset-0"
        aria-hidden
      >
        <path
          d={d}
          className="fill-none stroke-foreground/90"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      </svg>
      <span className="ep-dot" style={{ offsetPath: `path('${d}')` }} aria-hidden />
    </div>
  )
}

function PresetThumb({ preset }: { preset: EasingPreset }) {
  const { easingConfig } = presetToEasing(preset)
  const steps = 24
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const v = applyEasingConfig(t, easingConfig)
    d += `${i === 0 ? 'M' : 'L'} ${projX(t).toFixed(1)} ${projY(v).toFixed(1)} `
  }
  return <ThumbFrame d={d} />
}

function HoldThumb() {
  // A step: flat, then a vertical jump at the end.
  const midY = projY(0)
  const topY = projY(1)
  const right = T_SIZE - T_PAD
  return <ThumbFrame d={`M ${T_PAD} ${midY} L ${right} ${midY} L ${right} ${topY}`} />
}
