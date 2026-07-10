import { useRef, useEffect, useCallback, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Slider } from '@/components/ui/slider'
import {
  Film,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Magnet,
  Scissors,
  Gauge,
  ArrowRightLeft,
  BetweenHorizontalEnd,
  ChevronDown,
  X,
  MousePointer2,
  Undo2,
  Redo2,
  Flag,
  FlagOff,
  Link2,
  Volume2,
  Clapperboard,
  ImagePlay,
  Music2,
} from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { formatHotkeyBinding } from '@/config/hotkeys'
import { useTimelineZoom } from '../hooks/use-timeline-zoom'
import { useTimelineStore } from '../stores/timeline-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import {
  applySelectedAudioDucking,
  matchSelectedImagesToAudio,
} from '../stores/actions/audio-sync-actions'
import { useTimelineCommandStore } from '../stores/timeline-command-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import {
  ZOOM_FRICTION,
  ZOOM_MIN_VELOCITY,
  ZOOM_MIN,
  ZOOM_MAX,
  SLIP_SLIDE_TOOLS_ENABLED,
} from '../constants'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/config/editor-layout'
import { useResolvedHotkeys } from '@/features/timeline/deps/settings'

interface TimelineHeaderProps {
  onZoomChange?: (newZoom: number) => void
  onZoomIn?: () => void
  onZoomOut?: () => void
  onZoomToFit?: () => void
}

function TrimEditIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="10.6" y="4" width="2.8" height="16" rx="0.75" fill="currentColor" opacity="0.72" />
      <path d="m9 7-6 5 6 5z" fill="currentColor" stroke="none" />
      <path d="m15 7 6 5-6 5z" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * Timeline Toolbar Component
 *
 * Unified toolbar for timeline controls:
 * - Select/Razor tools
 * - Undo/Redo
 * - In/Out points, Snap toggle
 * - Zoom controls
 */
export const TimelineHeader = memo(function TimelineHeader({
  onZoomChange,
  onZoomIn,
  onZoomOut,
  onZoomToFit,
}: TimelineHeaderProps) {
  const { t } = useTranslation()
  const hotkeys = useResolvedHotkeys()
  const { zoomLevel, zoomIn, zoomOut, setZoomImmediate } = useTimelineZoom()
  const snapEnabled = useTimelineStore((s) => s.snapEnabled)
  const toggleSnap = useTimelineStore((s) => s.toggleSnap)
  const audioSkimmingEnabled = useTimelineStore((s) => s.audioSkimmingEnabled)
  const toggleAudioSkimming = useTimelineStore((s) => s.toggleAudioSkimming)
  const autoCameraOnStills = useTimelineSettingsStore((s) => s.autoCameraOnStills)
  const toggleAutoCameraOnStills = useTimelineSettingsStore((s) => s.toggleAutoCameraOnStills)
  const inPoint = useTimelineStore((s) => s.inPoint)
  const outPoint = useTimelineStore((s) => s.outPoint)
  const setInPoint = useTimelineStore((s) => s.setInPoint)
  const setOutPoint = useTimelineStore((s) => s.setOutPoint)
  const clearInOutPoints = useTimelineStore((s) => s.clearInOutPoints)
  const addMarker = useTimelineStore((s) => s.addMarker)
  // Only subscribe to marker count for disabled state - avoids re-render on marker changes
  const hasMarkers = useTimelineStore((s) => s.markers.length > 0)
  const removeMarker = useTimelineStore((s) => s.removeMarker)
  const clearAllMarkers = useTimelineStore((s) => s.clearAllMarkers)
  // NOTE: Don't subscribe to currentFrame - only needed in click handlers
  // Read from store directly when needed to avoid re-renders every frame
  const activeTool = useSelectionStore((s) => s.activeTool)
  const setActiveTool = useSelectionStore((s) => s.setActiveTool)
  const selectedMarkerId = useSelectionStore((s) => s.selectedMarkerId)
  const clearSelection = useSelectionStore((s) => s.clearSelection)
  const linkedSelectionEnabled = useEditorStore((s) => s.linkedSelectionEnabled)
  const setLinkedSelectionEnabled = useEditorStore((s) => s.setLinkedSelectionEnabled)
  const canUndo = useTimelineCommandStore((s) => s.canUndo)
  const canRedo = useTimelineCommandStore((s) => s.canRedo)
  const undoLabel = useTimelineCommandStore((s) => s.getUndoLabel())
  const redoLabel = useTimelineCommandStore((s) => s.getRedoLabel())

  const SlipSlideFlyoutIcon = activeTool === 'slide' ? BetweenHorizontalEnd : ArrowRightLeft

  const btnSize = {
    width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
    height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
  } as const

  // Momentum state for zoom slider
  const zoomVelocityRef = useRef(0)
  const lastZoomValueRef = useRef(zoomLevel)
  const lastZoomTimeRef = useRef(0)
  const momentumIdRef = useRef<number | null>(null)
  const isDraggingRef = useRef(false)
  const zoomLevelRef = useRef(zoomLevel)
  zoomLevelRef.current = zoomLevel

  // Apply zoom with bounds checking
  const applyZoom = useCallback(
    (newZoom: number) => {
      const clampedZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom))
      if (onZoomChange) {
        onZoomChange(clampedZoom)
      } else {
        // Fallback when timeline-content's anchored RAF path isn't wired up
        // (mainly tests). Use immediate so slider drag doesn't sit behind the
        // 120ms throttle that setZoom imposes.
        setZoomImmediate(clampedZoom)
      }
      return clampedZoom
    },
    [onZoomChange, setZoomImmediate],
  )

  // Momentum loop for zoom slider
  const startZoomMomentum = useCallback(() => {
    if (momentumIdRef.current !== null) {
      cancelAnimationFrame(momentumIdRef.current)
    }

    const momentumLoop = () => {
      if (Math.abs(zoomVelocityRef.current) > ZOOM_MIN_VELOCITY) {
        const newZoom = zoomLevelRef.current + zoomVelocityRef.current
        const clampedZoom = applyZoom(newZoom)

        // Stop momentum if we hit bounds
        if (clampedZoom <= ZOOM_MIN || clampedZoom >= ZOOM_MAX) {
          zoomVelocityRef.current = 0
          momentumIdRef.current = null
          return
        }

        zoomVelocityRef.current *= ZOOM_FRICTION
        momentumIdRef.current = requestAnimationFrame(momentumLoop)
      } else {
        zoomVelocityRef.current = 0
        momentumIdRef.current = null
      }
    }

    momentumIdRef.current = requestAnimationFrame(momentumLoop)
  }, [applyZoom])

  // Convert between linear slider position (0-1) and logarithmic zoom level
  // This gives finer control at low zoom levels
  const sliderToZoom = useCallback((sliderValue: number) => {
    // Map 0-1 to log scale: ZOOM_MIN to ZOOM_MAX
    // Using exponential: zoom = min * (max/min)^slider
    return ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, sliderValue)
  }, [])

  const zoomToSlider = useCallback((zoom: number) => {
    // Inverse of sliderToZoom: slider = log(zoom/min) / log(max/min)
    return Math.log(zoom / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN)
  }, [])

  // Handle slider value change (while dragging)
  const handleSliderChange = useCallback(
    (values: number[]) => {
      const sliderValue = values[0] ?? 0.5
      const newZoom = sliderToZoom(sliderValue)
      const now = performance.now()
      const timeDelta = now - lastZoomTimeRef.current

      // Calculate velocity based on change over time (in zoom space, not slider space)
      if (timeDelta > 0 && timeDelta < 100) {
        const valueDelta = newZoom - lastZoomValueRef.current
        zoomVelocityRef.current = (valueDelta / timeDelta) * 16 // Normalize to ~60fps
      }

      lastZoomValueRef.current = newZoom
      lastZoomTimeRef.current = now
      isDraggingRef.current = true
      // Downstream scheduleZoomApply (timeline-content) already RAF-coalesces
      // writes to the zoom store, so a second RAF here would only add a frame
      // of input latency without preventing extra work.
      applyZoom(newZoom)
    },
    [applyZoom, sliderToZoom],
  )

  // Handle slider release - start momentum
  const handleSliderCommit = useCallback(() => {
    isDraggingRef.current = false
    // Only start momentum if there's meaningful velocity
    if (Math.abs(zoomVelocityRef.current) > ZOOM_MIN_VELOCITY) {
      startZoomMomentum()
    }
    // Blur slider to release focus for keyboard shortcuts (play/pause)
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  }, [startZoomMomentum])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (momentumIdRef.current !== null) {
        cancelAnimationFrame(momentumIdRef.current)
      }
    }
  }, [])

  const handleUndo = () => {
    useTimelineStore.temporal.getState().undo()
  }

  const handleRedo = () => {
    useTimelineStore.temporal.getState().redo()
  }

  const handleMatchImagesToAudio = useCallback(() => {
    const result = matchSelectedImagesToAudio()
    if (result.status === 'matched') {
      toast.success(t('timeline.header.matchImagesToAudioSuccess', { count: result.imageCount }))
      return
    }
    if (result.status === 'no-images') {
      toast.error(t('timeline.header.matchImagesToAudioNoImages'))
      return
    }
    toast.error(t('timeline.header.matchImagesToAudioNoAudio'))
  }, [t])

  const handleApplyAudioDucking = useCallback(() => {
    const result = applySelectedAudioDucking()
    if (result.status === 'ducked') {
      toast.success(
        t('timeline.header.autoDuckMusicSuccess', {
          count: result.targetCount,
          keyframes: result.keyframeCount,
        }),
      )
      return
    }
    if (result.status === 'no-targets') {
      toast.error(t('timeline.header.autoDuckMusicNoTargets'))
      return
    }
    toast.error(t('timeline.header.autoDuckMusicNoDialogue'))
  }, [t])

  return (
    <div
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3"
      style={{ height: EDITOR_LAYOUT_CSS_VALUES.timelineHeaderHeight }}
      role="toolbar"
      aria-label={t('timeline.header.controls')}
    >
      {/* Left: Title */}
      <div className="flex min-w-0 items-center gap-2.5">
        <h2 className="text-xs font-semibold tracking-wide uppercase text-muted-foreground flex items-center gap-2">
          <Film className="w-3 h-3" />
          {t('timeline.header.title')}
        </h2>
      </div>

      {/* Middle: Timeline Controls */}
      <div className="min-w-0 overflow-x-auto overflow-y-hidden">
        <div className="flex w-max min-w-full items-center justify-center gap-2.5">
          {/* Timeline Tools */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              style={btnSize}
              className={
                activeTool === 'select'
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : ''
              }
              onClick={() => setActiveTool('select')}
              aria-label={t('timeline.header.selectTool')}
              data-tooltip={t('timeline.header.selectToolTooltip')}
            >
              <MousePointer2 className="w-3.5 h-3.5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              style={btnSize}
              className={
                activeTool === 'trim-edit'
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : ''
              }
              onClick={() => setActiveTool(activeTool === 'trim-edit' ? 'select' : 'trim-edit')}
              aria-label={t('timeline.header.trimEditTool')}
              data-tooltip={t('timeline.header.trimEditToolTooltip')}
            >
              <TrimEditIcon className="w-3.5 h-3.5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              style={btnSize}
              className={
                activeTool === 'razor'
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : ''
              }
              onClick={() => setActiveTool(activeTool === 'razor' ? 'select' : 'razor')}
              aria-label={t('timeline.header.razorTool')}
              data-tooltip={t('timeline.header.razorToolTooltip')}
            >
              <Scissors className="w-3.5 h-3.5 -rotate-90" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              style={btnSize}
              className={
                activeTool === 'rate-stretch'
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : ''
              }
              onClick={() =>
                setActiveTool(activeTool === 'rate-stretch' ? 'select' : 'rate-stretch')
              }
              aria-label={t('timeline.header.rateStretchTool')}
              data-tooltip={t('timeline.header.rateStretchToolTooltip')}
            >
              <Gauge className="w-3.5 h-3.5" />
            </Button>

            {SLIP_SLIDE_TOOLS_ENABLED ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    style={{ height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize }}
                    className={`gap-1 px-2 ${
                      activeTool === 'slip' || activeTool === 'slide'
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : ''
                    }`}
                    aria-label={t('timeline.header.slipSlideTools')}
                    data-tooltip={t('timeline.header.slipSlideToolsTooltip')}
                  >
                    <span className="flex items-center gap-1">
                      <span className="inline-flex items-center justify-center">
                        <SlipSlideFlyoutIcon className="w-3.5 h-3.5" />
                      </span>
                      <ChevronDown className="w-3 h-3 opacity-70" />
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    onClick={() => setActiveTool(activeTool === 'slip' ? 'select' : 'slip')}
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                    <span className="flex-1">{t('timeline.header.slipTool')}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatHotkeyBinding(hotkeys.SLIP_TOOL)}
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setActiveTool(activeTool === 'slide' ? 'select' : 'slide')}
                  >
                    <BetweenHorizontalEnd className="w-3.5 h-3.5" />
                    <span className="flex-1">{t('timeline.header.slideTool')}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatHotkeyBinding(hotkeys.SLIDE_TOOL)}
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>

          <Separator orientation="vertical" className="h-5 mx-1.5" />

          {/* Undo/Redo */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              style={btnSize}
              onClick={handleUndo}
              disabled={!canUndo}
              aria-label={
                undoLabel
                  ? t('timeline.header.undoWithLabel', { label: undoLabel })
                  : t('timeline.header.undo')
              }
              data-tooltip={
                undoLabel
                  ? t('timeline.header.undoWithLabelTooltip', { label: undoLabel })
                  : t('timeline.header.undoTooltip')
              }
            >
              <Undo2 className="w-3.5 h-3.5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              style={btnSize}
              onClick={handleRedo}
              disabled={!canRedo}
              aria-label={
                redoLabel
                  ? t('timeline.header.redoWithLabel', { label: redoLabel })
                  : t('timeline.header.redo')
              }
              data-tooltip={
                redoLabel
                  ? t('timeline.header.redoWithLabelTooltip', { label: redoLabel })
                  : t('timeline.header.redoTooltip')
              }
            >
              <Redo2 className="w-3.5 h-3.5" />
            </Button>
          </div>

          <Separator orientation="vertical" className="h-5 mx-1.5" />

          {/* In/Out Points */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              style={btnSize}
              onClick={() => setInPoint(usePlaybackStore.getState().currentFrame)}
              aria-label={t('timeline.header.setInPoint')}
              data-tooltip={t('timeline.header.setInPointTooltip')}
            >
              <span className="text-sm font-bold" style={{ color: 'var(--color-timeline-in)' }}>
                [
              </span>
            </Button>

            <Button
              variant="ghost"
              size="icon"
              style={btnSize}
              onClick={() => setOutPoint(usePlaybackStore.getState().currentFrame)}
              aria-label={t('timeline.header.setOutPoint')}
              data-tooltip={t('timeline.header.setOutPointTooltip')}
            >
              <span className="text-sm font-bold" style={{ color: 'var(--color-timeline-out)' }}>
                ]
              </span>
            </Button>

            <Button
              variant="ghost"
              size="icon"
              style={btnSize}
              onClick={clearInOutPoints}
              disabled={inPoint === null && outPoint === null}
              aria-label={t('timeline.header.clearInOutPoints')}
              data-tooltip={t('timeline.header.clearInOutPointsTooltip')}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>

          <Separator orientation="vertical" className="h-5 mx-1.5" />

          {/* Markers */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              style={btnSize}
              onClick={() => addMarker(usePlaybackStore.getState().currentFrame)}
              aria-label={t('timeline.header.addMarker')}
              data-tooltip={t('timeline.header.addMarkerTooltip')}
            >
              <Flag className="w-3.5 h-3.5" style={{ color: 'var(--color-timeline-marker)' }} />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              style={btnSize}
              onClick={() => {
                if (selectedMarkerId) {
                  removeMarker(selectedMarkerId)
                  clearSelection()
                }
              }}
              disabled={!selectedMarkerId}
              aria-label={t('timeline.header.removeSelectedMarker')}
              data-tooltip={t('timeline.header.removeSelectedMarkerTooltip')}
            >
              <FlagOff className="w-3.5 h-3.5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              style={btnSize}
              onClick={clearAllMarkers}
              disabled={!hasMarkers}
              aria-label={t('timeline.header.clearAllMarkers')}
              data-tooltip={t('timeline.header.clearAllMarkersTooltip')}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>

          <Separator orientation="vertical" className="h-5 mx-1.5" />

          {/* Snap Toggle */}
          <Button
            variant="ghost"
            size="icon"
            style={btnSize}
            className={snapEnabled ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''}
            onClick={toggleSnap}
            aria-label={
              snapEnabled
                ? t('timeline.header.disableSnapping')
                : t('timeline.header.enableSnapping')
            }
            data-tooltip={
              snapEnabled ? t('timeline.header.snapEnabled') : t('timeline.header.snapDisabled')
            }
          >
            <Magnet className="w-3.5 h-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            style={btnSize}
            className={
              audioSkimmingEnabled ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
            }
            onClick={toggleAudioSkimming}
            aria-label={
              audioSkimmingEnabled
                ? t('timeline.header.disableAudioSkimming')
                : t('timeline.header.enableAudioSkimming')
            }
            aria-pressed={audioSkimmingEnabled}
            data-tooltip={
              audioSkimmingEnabled
                ? t('timeline.header.audioSkimmingEnabled')
                : t('timeline.header.audioSkimmingDisabled')
            }
          >
            <Volume2 className="w-3.5 h-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            style={btnSize}
            className={
              autoCameraOnStills ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
            }
            onClick={toggleAutoCameraOnStills}
            aria-label={
              autoCameraOnStills
                ? t('timeline.header.disableAutoCamera')
                : t('timeline.header.enableAutoCamera')
            }
            aria-pressed={autoCameraOnStills}
            data-tooltip={
              autoCameraOnStills
                ? t('timeline.header.autoCameraEnabled')
                : t('timeline.header.autoCameraDisabled')
            }
          >
            <Clapperboard className="w-3.5 h-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            style={btnSize}
            onClick={handleMatchImagesToAudio}
            aria-label={t('timeline.header.matchImagesToAudio')}
            data-tooltip={t('timeline.header.matchImagesToAudioTooltip')}
          >
            <ImagePlay className="w-3.5 h-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            style={btnSize}
            onClick={handleApplyAudioDucking}
            aria-label={t('timeline.header.autoDuckMusic')}
            data-tooltip={t('timeline.header.autoDuckMusicTooltip')}
          >
            <Music2 className="w-3.5 h-3.5" />
          </Button>

          <Separator orientation="vertical" className="h-5 mx-1.5" />

          <Button
            variant="ghost"
            size="icon"
            style={btnSize}
            className={
              linkedSelectionEnabled ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''
            }
            onClick={() => setLinkedSelectionEnabled(!linkedSelectionEnabled)}
            aria-label={
              linkedSelectionEnabled
                ? t('timeline.header.disableLinkedSelection')
                : t('timeline.header.enableLinkedSelection')
            }
            aria-pressed={linkedSelectionEnabled}
            data-tooltip={t('timeline.header.linkedSelectionTooltip', {
              state: linkedSelectionEnabled
                ? t('timeline.header.linkedSelectionOn')
                : t('timeline.header.linkedSelectionOff'),
              shortcut: formatHotkeyBinding(hotkeys.TOGGLE_LINKED_SELECTION),
            })}
          >
            <Link2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Right: Zoom Controls */}
      <div className="flex items-center justify-end gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          style={btnSize}
          onClick={() => {
            if (onZoomOut) {
              onZoomOut()
            } else {
              zoomOut()
            }
          }}
          aria-label={t('timeline.header.zoomOut')}
          data-tooltip={t('timeline.header.zoomOutTooltip')}
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </Button>

        <Slider
          value={[zoomToSlider(zoomLevel)]}
          onValueChange={handleSliderChange}
          onValueCommit={handleSliderCommit}
          min={0}
          max={1}
          step={0.005}
          className="w-24"
          aria-label={t('timeline.header.zoomSlider')}
        />

        <Button
          variant="ghost"
          size="icon"
          style={btnSize}
          onClick={() => {
            if (onZoomIn) {
              onZoomIn()
            } else {
              zoomIn()
            }
          }}
          aria-label={t('timeline.header.zoomIn')}
          data-tooltip={t('timeline.header.zoomInTooltip')}
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          style={btnSize}
          onClick={onZoomToFit}
          aria-label={t('timeline.header.zoomToFit')}
          data-tooltip={t('timeline.header.zoomToFitTooltip')}
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  )
})
