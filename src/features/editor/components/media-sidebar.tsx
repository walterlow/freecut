import { useCallback, useMemo, useRef, useEffect, memo, lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Film,
  Layers,
  Type,
  Square,
  Circle,
  Triangle,
  Star,
  Hexagon,
  Heart,
  Pentagon,
  Blend,
  Pen,
  Captions,
  Sticker,
  WandSparkles,
  AudioWaveform,
  Eye,
  EyeOff,
  Check,
  X,
  Sparkles,
  Trash2,
  AlertTriangle,
  Eraser,
} from 'lucide-react'
import { toast } from 'sonner'
import { useGizmoStore } from '@/features/editor/deps/preview'
import { usePreviewBridgeStore } from '@/shared/state/preview-bridge'
import { AudioTabPanel } from './audio-tab'
import type { ItemEffect } from '@/types/effects'
import { motion } from 'motion/react'
import { usePrefersReducedMotion } from '@/shared/hooks/use-prefers-reduced-motion'
import { Button } from '@/components/ui/button'
import { cn } from '@/shared/ui/cn'
import { useEditorStore } from '@/shared/state/editor'
import {
  useCompositionNavigationStore,
  useCompositionsStore,
  useTimelineStore,
} from '@/features/editor/deps/timeline-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { useProjectStore } from '@/features/editor/deps/projects'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import {
  clearMediaDragData,
  MediaLibrary,
  setMediaDragData,
} from '@/features/editor/deps/media-library'
import { importTranscriptEditorPanel } from '@/features/editor/deps/timeline-panels'
import { LottieBrowserPanel } from '@/features/editor/deps/lottie-browser'
import { TransitionsPanel } from './transitions-panel'
import {
  createDefaultGradientItem,
  createDefaultShapeItem,
  createDefaultSolidColorItem,
  createOverlayLayerTrack,
  createTextTemplateItem,
  getDefaultGeneratedLayerDurationInFrames,
} from '@/features/editor/deps/timeline-utils'
import { addAdjustmentLayer } from '../utils/add-adjustment-layer'
import type { TextItem, ShapeItem, ShapeType } from '@/types/timeline'
import { useMaskEditorStore } from '@/features/editor/deps/preview'
import type { VisualEffect } from '@/types/effects'
import { EFFECT_PRESETS } from '@/types/effects'
import { getGpuEffect, getGpuEffectDefaultParams } from '@/infrastructure/gpu-effects'
import { EffectThumbnail, useGpuEffectPreviewData } from '@/features/editor/deps/effects-contract'
import { createLogger } from '@/shared/logging/logger'
import { useSettingsStore } from '@/features/editor/deps/settings'
import { resolveGeneratedLayerCanvasSize } from '../utils/generated-layer-canvas-size'
const LazyAiPanel = lazy(() => import('./ai-tab').then((m) => ({ default: m.AiTab })))
const LazyTranscriptEditorPanel = lazy(() =>
  importTranscriptEditorPanel().then(({ TranscriptEditorPanel }) => ({
    default: TranscriptEditorPanel,
  })),
)
import {
  TEXT_STYLE_PRESETS,
  type TextStylePresetLayout,
  type TextStylePreset,
} from '@/shared/typography/text-style-presets'
import {
  EDITOR_LAYOUT_CSS_VALUES,
  clampLeftEditorSidebarWidth,
  getEditorLayout,
} from '@/config/editor-layout'

const logger = createLogger('MediaSidebar')
const TEXT_TEMPLATE_PREVIEW_SHELL =
  'w-full aspect-video rounded-sm border border-border bg-slate-950'

function renderTextTemplatePreview(preset?: TextStylePreset) {
  if (!preset) {
    return (
      <div
        className={`${TEXT_TEMPLATE_PREVIEW_SHELL} flex flex-col items-center justify-center gap-1`}
      >
        <Type className="w-3.5 h-3.5 text-muted-foreground/80" />
        <div className="text-[9px] leading-none tracking-wide text-muted-foreground/80 uppercase">
          Text
        </div>
      </div>
    )
  }

  const copy = preset.sample

  if (preset.previewKind === 'clean') {
    return (
      <div className={`${TEXT_TEMPLATE_PREVIEW_SHELL} flex items-center justify-center px-1.5`}>
        <div className="text-[10px] font-bold tracking-[-0.05em] text-white uppercase leading-none">
          {copy.title}
        </div>
      </div>
    )
  }

  if (preset.previewKind === 'lower-third') {
    return (
      <div className={`${TEXT_TEMPLATE_PREVIEW_SHELL} relative overflow-hidden`}>
        <div className="absolute inset-x-1.5 bottom-1.5 rounded-sm bg-slate-800/95 px-1.5 py-1 text-left">
          <div className="text-[8px] font-semibold leading-none text-slate-50">{copy.title}</div>
          <div className="mt-0.5 text-[7px] leading-none text-slate-300">{copy.subtitle}</div>
        </div>
      </div>
    )
  }

  if (preset.previewKind === 'poster') {
    return (
      <div className={`${TEXT_TEMPLATE_PREVIEW_SHELL} flex items-center justify-center px-1.5`}>
        <div className="text-[12px] tracking-[-0.05em] text-amber-100 uppercase leading-none [text-shadow:0_2px_10px_rgba(127,29,29,0.85)]">
          {copy.title}
        </div>
      </div>
    )
  }

  if (preset.previewKind === 'outline-pill') {
    return (
      <div className={`${TEXT_TEMPLATE_PREVIEW_SHELL} flex items-center justify-center px-1.5`}>
        <div className="rounded-full border border-sky-400/70 bg-slate-900 px-2 py-1 text-[7px] font-bold tracking-[0.18em] text-slate-100 uppercase leading-none">
          {copy.title}
        </div>
      </div>
    )
  }

  if (preset.previewKind === 'cinematic') {
    return (
      <div
        className={`${TEXT_TEMPLATE_PREVIEW_SHELL} flex flex-col items-center justify-center px-1`}
      >
        <div className="text-[11px] tracking-[0.28em] text-amber-100 uppercase leading-none [text-shadow:0_2px_8px_rgba(17,24,39,0.9)]">
          {copy.title}
        </div>
      </div>
    )
  }

  if (preset.previewKind === 'quote') {
    return (
      <div className={`${TEXT_TEMPLATE_PREVIEW_SHELL} p-1.5 flex items-center justify-center`}>
        <div className="w-full rounded-sm bg-slate-800 px-2 py-1.5 text-center">
          <div className="text-[8px] italic leading-tight text-slate-50">{copy.title}</div>
          <div className="mt-0.5 text-[7px] leading-none tracking-[0.08em] text-slate-300">
            {copy.subtitle}
          </div>
        </div>
      </div>
    )
  }

  if (preset.previewKind === 'speaker') {
    return (
      <div className={`${TEXT_TEMPLATE_PREVIEW_SHELL} px-1.5 py-1 flex flex-col justify-end`}>
        <div className="rounded-sm bg-slate-800/95 px-1.5 py-1">
          <div className="text-[8px] font-bold leading-none text-slate-50">{copy.title}</div>
          <div className="mt-0.5 text-[7px] leading-none text-slate-300">{copy.subtitle}</div>
        </div>
      </div>
    )
  }

  if (preset.previewKind === 'neon') {
    return (
      <div className={`${TEXT_TEMPLATE_PREVIEW_SHELL} p-1.5 flex items-center justify-center`}>
        <div className="w-full rounded-sm bg-cyan-950 px-1.5 py-1.5 text-center">
          <div className="text-[10px] font-semibold tracking-[0.16em] text-cyan-300 drop-shadow-[0_0_6px_rgba(34,211,238,0.85)] uppercase">
            {copy.title}
          </div>
        </div>
      </div>
    )
  }

  if (preset.previewKind === 'stacked') {
    return (
      <div
        className={`${TEXT_TEMPLATE_PREVIEW_SHELL} flex flex-col items-center justify-center px-1.5`}
      >
        <div className="text-[6px] font-semibold tracking-[0.2em] text-amber-300 uppercase">
          {copy.eyebrow}
        </div>
        <div className="mt-1 text-[10px] font-bold tracking-[-0.04em] text-white leading-none">
          {copy.title}
        </div>
        <div className="mt-0.5 text-[7px] leading-none text-slate-300">{copy.subtitle}</div>
      </div>
    )
  }

  if (preset.previewKind === 'breaking') {
    return (
      <div className={`${TEXT_TEMPLATE_PREVIEW_SHELL} p-1.5 flex items-center justify-center`}>
        <div className="w-full rounded-sm bg-slate-900 px-1.5 py-1 text-left">
          <div className="text-[6px] font-bold tracking-[0.18em] text-red-300 uppercase leading-none">
            {copy.eyebrow}
          </div>
          <div className="mt-1 text-[9px] font-bold tracking-[-0.04em] text-slate-50 leading-none">
            {copy.title}
          </div>
          <div className="mt-0.5 text-[7px] font-semibold leading-none text-amber-200">
            {copy.subtitle}
          </div>
        </div>
      </div>
    )
  }

  if (preset.previewKind === 'launch') {
    return (
      <div className={`${TEXT_TEMPLATE_PREVIEW_SHELL} p-1.5 flex items-center justify-center`}>
        <div className="w-full rounded-sm border border-blue-800/80 bg-slate-900 px-1.5 py-1 text-center">
          <div className="text-[6px] font-bold tracking-[0.22em] text-cyan-300 uppercase">
            {copy.eyebrow}
          </div>
          <div className="mt-1 text-[9px] font-bold tracking-[-0.04em] text-slate-50 leading-tight">
            {copy.title}
          </div>
          <div className="mt-0.5 text-[7px] leading-none text-blue-200">{copy.subtitle}</div>
        </div>
      </div>
    )
  }

  if (preset.previewKind === 'event') {
    return (
      <div className={`${TEXT_TEMPLATE_PREVIEW_SHELL} p-1.5 flex items-center justify-center`}>
        <div className="w-full rounded-sm bg-slate-900 px-1.5 py-1 text-center">
          <div className="text-[6px] font-bold tracking-[0.22em] text-rose-300 uppercase">
            {copy.eyebrow}
          </div>
          <div className="mt-1 text-[9px] font-bold text-slate-50 leading-tight">{copy.title}</div>
          <div className="mt-0.5 text-[7px] text-blue-200 leading-none uppercase">
            {copy.subtitle}
          </div>
        </div>
      </div>
    )
  }

  if (preset.previewKind === 'badge') {
    return (
      <div className={`${TEXT_TEMPLATE_PREVIEW_SHELL} flex items-center justify-center px-1.5`}>
        <div className="rounded-full border border-slate-600 bg-slate-800 px-2 py-1 text-[7px] font-bold tracking-[0.18em] text-slate-50 uppercase leading-none">
          {copy.title}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`${TEXT_TEMPLATE_PREVIEW_SHELL} flex flex-col items-center justify-center px-1.5`}
    >
      <div className="text-[10px] font-bold tracking-[-0.04em] text-white uppercase leading-none">
        {copy.title}
      </div>
      <div className="mt-0.5 text-[7px] leading-none text-slate-300 uppercase">{copy.subtitle}</div>
    </div>
  )
}

const TEXT_TEMPLATE_GROUPS: ReadonlyArray<{
  key: TextStylePresetLayout
  labelKey: string
}> = [
  { key: 'single', labelKey: 'editor.mediaSidebar.textGroupSingle' },
  { key: 'two', labelKey: 'editor.mediaSidebar.textGroupTwoSpans' },
  { key: 'three', labelKey: 'editor.mediaSidebar.textGroupThreeSpans' },
]

const DEFAULT_TEXT_TEMPLATE_LABEL = 'Text'
const ADD_TEXT_TEMPLATE_LABEL = 'Add Text'

export const MediaSidebar = memo(function MediaSidebar() {
  const { t } = useTranslation()
  const editorDensity = useSettingsStore((s) => s.editorDensity)
  const editorLayout = getEditorLayout(editorDensity)
  // Use granular selectors - Zustand v5 best practice
  const leftSidebarOpen = useEditorStore((s) => s.leftSidebarOpen)
  const toggleLeftSidebar = useEditorStore((s) => s.toggleLeftSidebar)
  const mediaFullColumn = useEditorStore((s) => s.mediaFullColumn)
  const toggleMediaFullColumn = useEditorStore((s) => s.toggleMediaFullColumn)
  const activeTab = useEditorStore((s) => s.activeTab)
  const setActiveTab = useEditorStore((s) => s.setActiveTab)
  const sidebarWidth = useEditorStore((s) => s.sidebarWidth)
  const setSidebarWidth = useEditorStore((s) => s.setSidebarWidth)
  const prefersReducedMotion = usePrefersReducedMotion()

  const [aiTabActivated, setAiTabActivated] = useState(activeTab === 'ai')
  // The Lottie panel hits an external API on mount, so keep it unmounted until
  // the tab is first opened; it then stays mounted (state preserved).
  const [lottieTabActivated, setLottieTabActivated] = useState(activeTab === 'lottie')
  useEffect(() => {
    if (activeTab === 'ai') setAiTabActivated(true)
    if (activeTab === 'lottie') setLottieTabActivated(true)
  }, [activeTab])

  // The collapsed panel stays mounted (clipped to 0 width, see NOTE below), so
  // its buttons/inputs would remain in the tab order while invisible. Mark the
  // content `inert` once the close animation settles to pull them out of tab
  // order without yanking focus mid-animation; clear it immediately on open so
  // the panel is interactive as it slides in. Mirrors the right sidebar's
  // contentVisible/onAnimationComplete handoff.
  const [contentInert, setContentInert] = useState(!leftSidebarOpen)
  useEffect(() => {
    if (leftSidebarOpen) setContentInert(false)
  }, [leftSidebarOpen])

  // NOTE: the heavy media-library subtree is deliberately NOT gated behind
  // Activity `hidden` when collapsed. React defers the hidden→visible reveal, so
  // on open the content lands after the (ease-out) width has already raced open —
  // reading as a snap. Instead it stays mounted and is promoted to its own GPU
  // layer (translateZ on the holder below): rasterized once, then the width /
  // overflow clip reveals it via the compositor — no per-frame repaint (the old
  // churn) and it slides symmetrically open/closed. When collapsed it's clipped to
  // 0 width so it isn't painted; the only residual cost is occasional
  // reconciliation, which is negligible for this panel.

  // Resize handle logic
  const isResizingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)
  const suppressGeneratedItemClickRef = useRef(false)

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isResizingRef.current = true
      startXRef.current = e.clientX
      startWidthRef.current = sidebarWidth
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [sidebarWidth],
  )

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return
      const delta = e.clientX - startXRef.current
      const newWidth = clampLeftEditorSidebarWidth(startWidthRef.current + delta, editorLayout)
      setSidebarWidth(newWidth)
    }

    const handleMouseUp = () => {
      if (!isResizingRef.current) return
      isResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      isResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [editorLayout, setSidebarWidth])

  // NOTE: Don't subscribe to tracks, items, currentProject here!
  // These change frequently and would cause re-renders cascading to MediaLibrary/MediaCards
  // Read from store directly in callbacks using getState()

  // Add text item on its own new layer at the playhead, matching what dragging
  // the same preset onto the canvas does (minus the cursor-driven position).
  const handleAddText = useCallback(
    (presetId?: (typeof TEXT_STYLE_PRESETS)[number]['id']) => {
      // Read all needed state from stores directly to avoid subscriptions
      const { tracks, fps, addItemOnNewTrack } = useTimelineStore.getState()
      const { activeTrackId, selectItems, setActiveTrack } = useSelectionStore.getState()
      const currentProject = useProjectStore.getState().currentProject

      const newTrack = createOverlayLayerTrack({ tracks, activeTrackId })

      if (!newTrack) {
        logger.warn('No available track for text item')
        return
      }

      const durationInFrames = getDefaultGeneratedLayerDurationInFrames(fps)

      // Get canvas dimensions for initial transform
      const canvasWidth = currentProject?.metadata.width ?? DEFAULT_PROJECT_WIDTH
      const canvasHeight = currentProject?.metadata.height ?? DEFAULT_PROJECT_HEIGHT

      const textStylePreset = presetId
        ? TEXT_STYLE_PRESETS.find((preset) => preset.id === presetId)
        : undefined
      const textItem: TextItem = createTextTemplateItem({
        placement: {
          trackId: newTrack.trackId,
          from: Math.max(0, usePlaybackStore.getState().currentFrame),
          durationInFrames,
          canvasWidth,
          canvasHeight,
          fps,
        },
        label: textStylePreset?.label,
        text: t('editor.textSection.defaultText'),
        textStylePresetId: presetId,
      })

      addItemOnNewTrack(textItem, newTrack.tracks)
      setActiveTrack(newTrack.trackId)
      selectItems([textItem.id])
    },
    [t],
  )

  // Add shape item on its own new layer at the playhead, matching the canvas drop.
  const handleAddShape = useCallback((shapeType: ShapeType, shapePreset?: 'solid' | 'gradient') => {
    // Read all needed state from stores directly to avoid subscriptions
    const { tracks, fps, addItemOnNewTrack } = useTimelineStore.getState()
    const { activeTrackId, selectItems, setActiveTrack } = useSelectionStore.getState()
    const currentProject = useProjectStore.getState().currentProject
    const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId
    const activeComposition = activeCompositionId
      ? useCompositionsStore.getState().getComposition(activeCompositionId)
      : undefined

    const newTrack = createOverlayLayerTrack({ tracks, activeTrackId })

    if (!newTrack) {
      logger.warn('No available track for shape item')
      return
    }

    const { width: canvasWidth, height: canvasHeight } = resolveGeneratedLayerCanvasSize(
      activeComposition,
      currentProject?.metadata,
    )

    const placement = {
      trackId: newTrack.trackId,
      from: Math.max(0, usePlaybackStore.getState().currentFrame),
      durationInFrames: getDefaultGeneratedLayerDurationInFrames(fps),
      canvasWidth,
      canvasHeight,
      shapeType,
    }
    const shapeItem: ShapeItem =
      shapePreset === 'solid'
        ? createDefaultSolidColorItem(placement)
        : shapePreset === 'gradient'
          ? createDefaultGradientItem(placement)
          : createDefaultShapeItem(placement)

    addItemOnNewTrack(shapeItem, newTrack.tracks)
    setActiveTrack(newTrack.trackId)
    selectItems([shapeItem.id])
  }, [])

  // Add adjustment layer to timeline at the best available position
  // Optionally with pre-applied effects and custom label
  const handleAddAdjustmentLayer = useCallback((effects?: VisualEffect[], label?: string) => {
    addAdjustmentLayer(effects, label)
  }, [])

  // Effect inspection & preview state
  const [inspectingEffect, setInspectingEffect] = useState<{
    kind: 'preset' | 'gpu'
    id: string
    name: string
    effects: VisualEffect[]
  } | null>(null)
  const [isPreviewingOnPlayer, setIsPreviewingOnPlayer] = useState(false)

  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const timelineItems = useTimelineStore((s) => s.items)
  const selectedVisualItems = useMemo(() => {
    return timelineItems.filter((i) => selectedItemIds.includes(i.id) && i.type !== 'audio')
  }, [timelineItems, selectedItemIds])

  const selectedVisualItemEffectsCount = useMemo(() => {
    return selectedVisualItems.reduce((acc, item) => acc + (item.effects?.length || 0), 0)
  }, [selectedVisualItems])

  const totalProjectEffectsCount = useMemo(() => {
    return timelineItems.reduce((acc, item) => acc + (item.effects?.length || 0), 0)
  }, [timelineItems])

  const adjustmentLayerItems = useMemo(() => {
    return timelineItems.filter((i) => i.type === 'adjustment')
  }, [timelineItems])

  const hasSelectedVisualClip = selectedVisualItems.length > 0

  const handleClearSelectedClipEffects = useCallback(() => {
    if (selectedVisualItems.length === 0) {
      toast.warning('Selecciona un clip en la línea de tiempo primero')
      return
    }
    const { clearEffects } = useTimelineStore.getState()
    selectedVisualItems.forEach((item) => {
      clearEffects(item.id)
    })
    useGizmoStore.getState().clearPreview()
    setIsPreviewingOnPlayer(false)
    setInspectingEffect(null)
    const currentFrame = usePlaybackStore.getState().currentFrame
    const { items } = useTimelineStore.getState()
    usePreviewBridgeStore.getState().requestPostEditWarm(
      currentFrame,
      items.map((i) => i.id),
    )
    usePreviewBridgeStore.getState().setDisplayedFrame(null)
    toast.success('Efectos eliminados del clip seleccionado')
  }, [selectedVisualItems])

  const handleDeleteAdjustmentLayers = useCallback(() => {
    const { removeItems, items } = useTimelineStore.getState()
    const adjItems = items.filter((i) => i.type === 'adjustment')
    if (adjItems.length === 0) return
    removeItems(adjItems.map((adj) => adj.id))
    useGizmoStore.getState().clearPreview()
    setIsPreviewingOnPlayer(false)
    setInspectingEffect(null)
    const currentFrame = usePlaybackStore.getState().currentFrame
    const freshItems = useTimelineStore.getState().items
    usePreviewBridgeStore.getState().requestPostEditWarm(
      currentFrame,
      freshItems.map((i) => i.id),
    )
    usePreviewBridgeStore.getState().setDisplayedFrame(null)
    toast.success(`${adjItems.length} capa(s) de ajuste eliminada(s) de la línea de tiempo`)
  }, [])

  const handleClearAllProjectEffects = useCallback(() => {
    const { items, clearEffects, removeItems } = useTimelineStore.getState()
    let clearedCount = 0

    // 1. Remove all adjustment layers
    const adjItemIds = items.filter((item) => item.type === 'adjustment').map((item) => item.id)
    const removedLayersCount = adjItemIds.length
    if (adjItemIds.length > 0) {
      removeItems(adjItemIds)
    }

    // 2. Clear effects on all items
    items.forEach((item) => {
      if (item.effects && item.effects.length > 0) {
        clearEffects(item.id)
        clearedCount += item.effects.length
      }
    })

    // 3. Force clean gizmo store preview
    useGizmoStore.getState().clearPreview()
    setIsPreviewingOnPlayer(false)
    setInspectingEffect(null)

    // 4. Invalidate frame caches & force player re-render
    const currentFrame = usePlaybackStore.getState().currentFrame
    const freshItems = useTimelineStore.getState().items
    usePreviewBridgeStore.getState().requestPostEditWarm(
      currentFrame,
      freshItems.map((i) => i.id),
    )
    usePreviewBridgeStore.getState().setDisplayedFrame(null)

    if (clearedCount > 0 || removedLayersCount > 0) {
      toast.success(
        `Video restablecido: ${clearedCount} efecto(s) eliminados${
          removedLayersCount > 0 ? ` y ${removedLayersCount} capa(s) de ajuste quitadas` : ''
        }.`,
      )
    } else {
      toast.info('Video restablecido y memoria caché de efectos purgada.')
    }
  }, [])

  // Clear live preview when switching away from effects tab or unmounting
  useEffect(() => {
    if (activeTab !== 'effects') {
      if (isPreviewingOnPlayer) {
        useGizmoStore.getState().clearPreview()
        setIsPreviewingOnPlayer(false)
        const currentFrame = usePlaybackStore.getState().currentFrame
        const { items } = useTimelineStore.getState()
        usePreviewBridgeStore.getState().requestPostEditWarm(
          currentFrame,
          items.map((i) => i.id),
        )
        usePreviewBridgeStore.getState().setDisplayedFrame(null)
      }
      setInspectingEffect(null)
    }
  }, [activeTab, isPreviewingOnPlayer])

  useEffect(() => {
    return () => {
      useGizmoStore.getState().clearPreview()
    }
  }, [])

  // Select preset for inspection instead of arbitrary auto-insertion
  const handleSelectPresetForInspection = useCallback(
    (presetId: string) => {
      const preset = EFFECT_PRESETS.find((p) => p.id === presetId)
      if (!preset) return
      if (isPreviewingOnPlayer) {
        useGizmoStore.getState().clearPreview()
        setIsPreviewingOnPlayer(false)
        const currentFrame = usePlaybackStore.getState().currentFrame
        const { items } = useTimelineStore.getState()
        usePreviewBridgeStore.getState().requestPostEditWarm(
          currentFrame,
          items.map((i) => i.id),
        )
        usePreviewBridgeStore.getState().setDisplayedFrame(null)
      }
      setInspectingEffect({
        kind: 'preset',
        id: preset.id,
        name: preset.name,
        effects: preset.effects,
      })
    },
    [isPreviewingOnPlayer],
  )

  // Select GPU effect for inspection instead of arbitrary auto-insertion
  const handleSelectGpuEffectForInspection = useCallback(
    (gpuEffectId: string) => {
      const defaults = getGpuEffectDefaultParams(gpuEffectId)
      const def = getGpuEffect(gpuEffectId)
      const effectName = def?.name || gpuEffectId
      if (isPreviewingOnPlayer) {
        useGizmoStore.getState().clearPreview()
        setIsPreviewingOnPlayer(false)
        const currentFrame = usePlaybackStore.getState().currentFrame
        const { items } = useTimelineStore.getState()
        usePreviewBridgeStore.getState().requestPostEditWarm(
          currentFrame,
          items.map((i) => i.id),
        )
        usePreviewBridgeStore.getState().setDisplayedFrame(null)
      }
      setInspectingEffect({
        kind: 'gpu',
        id: gpuEffectId,
        name: effectName,
        effects: [{ type: 'gpu-effect', gpuEffectType: gpuEffectId, params: defaults }],
      })
    },
    [isPreviewingOnPlayer],
  )

  const handleCloseEffectInspector = useCallback(() => {
    if (isPreviewingOnPlayer) {
      useGizmoStore.getState().clearPreview()
      setIsPreviewingOnPlayer(false)
      const currentFrame = usePlaybackStore.getState().currentFrame
      const { items } = useTimelineStore.getState()
      usePreviewBridgeStore.getState().requestPostEditWarm(
        currentFrame,
        items.map((i) => i.id),
      )
      usePreviewBridgeStore.getState().setDisplayedFrame(null)
    }
    setInspectingEffect(null)
  }, [isPreviewingOnPlayer])

  // Toggle live effect preview on video player
  const handleTogglePlayerPreview = useCallback(() => {
    if (!inspectingEffect) return

    if (isPreviewingOnPlayer) {
      useGizmoStore.getState().clearPreview()
      setIsPreviewingOnPlayer(false)
      const currentFrame = usePlaybackStore.getState().currentFrame
      const { items } = useTimelineStore.getState()
      usePreviewBridgeStore.getState().requestPostEditWarm(
        currentFrame,
        items.map((i) => i.id),
      )
      usePreviewBridgeStore.getState().setDisplayedFrame(null)
      return
    }

    const { selectedItemIds } = useSelectionStore.getState()
    const { items } = useTimelineStore.getState()
    const visualItems = items.filter((i) => i.type !== 'audio')

    let targetItem = visualItems.find((i) => selectedItemIds.includes(i.id))
    if (!targetItem && visualItems.length > 0) {
      targetItem = visualItems[0]
    }

    if (!targetItem) {
      toast.info('Añade un video o imagen a la línea de tiempo para previsualizar')
      return
    }

    const previewEffects: ItemEffect[] = inspectingEffect.effects.map((eff, index) => ({
      id: `preview-effect-${index}`,
      effect: eff,
      enabled: true,
    }))

    useGizmoStore.getState().setEffectsPreviewNew({ [targetItem.id]: previewEffects })
    setIsPreviewingOnPlayer(true)
  }, [inspectingEffect, isPreviewingOnPlayer])

  // Explicitly apply to selected clip
  const handleApplyToSelectedClip = useCallback(() => {
    if (!inspectingEffect) return
    const { selectedItemIds } = useSelectionStore.getState()
    const { items, addEffect } = useTimelineStore.getState()
    const visualIds = selectedItemIds.filter((id) => {
      const item = items.find((i) => i.id === id)
      return item && item.type !== 'audio'
    })

    if (visualIds.length === 0) {
      toast.warning('Selecciona un clip en la línea de tiempo primero')
      return
    }

    visualIds.forEach((id) => {
      inspectingEffect.effects.forEach((eff) => addEffect(id, eff))
    })

    if (isPreviewingOnPlayer) {
      useGizmoStore.getState().clearPreview()
      setIsPreviewingOnPlayer(false)
    }
    setInspectingEffect(null)
    toast.success(`Efecto "${inspectingEffect.name}" aplicado al clip`)
  }, [inspectingEffect, isPreviewingOnPlayer])

  // Explicitly insert as timeline block (adjustment layer)
  const handleInsertAsTimelineBlock = useCallback(() => {
    if (!inspectingEffect) return
    handleAddAdjustmentLayer(inspectingEffect.effects, inspectingEffect.name)

    if (isPreviewingOnPlayer) {
      useGizmoStore.getState().clearPreview()
      setIsPreviewingOnPlayer(false)
    }
    setInspectingEffect(null)
    toast.success(`Bloque "${inspectingEffect.name}" añadido a la línea de tiempo`)
  }, [handleAddAdjustmentLayer, inspectingEffect, isPreviewingOnPlayer])

  const { gpuCategories, triggerPreviews } = useGpuEffectPreviewData()
  // Which effect/preset tile is hovered — drives its live sweep animation.
  const [hoveredEffectKey, setHoveredEffectKey] = useState<string | null>(null)
  const textTemplatesByLayout = useMemo(() => {
    const grouped = {
      single: [] as TextStylePreset[],
      two: [] as TextStylePreset[],
      three: [] as TextStylePreset[],
    }

    for (const preset of TEXT_STYLE_PRESETS) {
      grouped[preset.layout].push(preset)
    }

    return grouped
  }, [])

  // Category items for the vertical nav
  const categories = [
    { id: 'media' as const, icon: Film, label: t('editor.mediaSidebar.media') },
    { id: 'audio' as const, icon: AudioWaveform, label: t('editor.mediaSidebar.audio', 'Audio') },
    { id: 'text' as const, icon: Type, label: t('editor.mediaSidebar.text') },
    { id: 'shapes' as const, icon: Pentagon, label: t('editor.mediaSidebar.shapes') },
    { id: 'effects' as const, icon: Layers, label: t('editor.mediaSidebar.effects') },
    { id: 'transitions' as const, icon: Blend, label: t('editor.mediaSidebar.transitions') },
    { id: 'lottie' as const, icon: Sticker, label: t('lottieBrowser.tabLabel') },
    { id: 'transcript' as const, icon: Captions, label: t('transcript.tabLabel') },
    { id: 'ai' as const, icon: WandSparkles, label: t('editor.mediaSidebar.ai') },
  ]

  const shouldSuppressGeneratedItemClick = useCallback(() => {
    if (!suppressGeneratedItemClickRef.current) {
      return false
    }

    suppressGeneratedItemClickRef.current = false
    return true
  }, [])

  const handleTemplateDragStart = useCallback(
    (payload: {
      itemType: 'text' | 'shape' | 'adjustment'
      label: string
      textStylePresetId?: (typeof TEXT_STYLE_PRESETS)[number]['id']
      shapeType?: ShapeType
      shapePreset?: 'solid' | 'gradient'
      effects?: VisualEffect[]
    }) =>
      (event: React.DragEvent<HTMLButtonElement>) => {
        event.dataTransfer.effectAllowed = 'copy'
        const dragData = {
          type: 'timeline-template' as const,
          ...payload,
        }

        suppressGeneratedItemClickRef.current = true
        event.dataTransfer.setData('application/json', JSON.stringify(dragData))
        setMediaDragData(dragData)
      },
    [],
  )

  const handleTemplateDragEnd = useCallback(() => {
    clearMediaDragData()
    window.setTimeout(() => {
      suppressGeneratedItemClickRef.current = false
    }, 0)
  }, [])

  return (
    <div className="flex h-full flex-shrink-0">
      {/* Vertical Category Bar */}
      <div
        className="panel-header border-r border-border flex flex-col items-center flex-shrink-0"
        style={{ width: EDITOR_LAYOUT_CSS_VALUES.sidebarRailWidth }}
      >
        {/* Header row - aligned with content panel header */}
        <div
          className="flex items-center justify-center border-b border-border w-full"
          style={{ height: EDITOR_LAYOUT_CSS_VALUES.sidebarHeaderHeight }}
        >
          <button
            onClick={toggleLeftSidebar}
            className="rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
            style={{
              width: EDITOR_LAYOUT_CSS_VALUES.sidebarHeaderButtonSize,
              height: EDITOR_LAYOUT_CSS_VALUES.sidebarHeaderButtonSize,
            }}
            data-tooltip={
              leftSidebarOpen
                ? t('editor.mediaSidebar.collapsePanel')
                : t('editor.mediaSidebar.expandPanel')
            }
            data-tooltip-side="right"
          >
            {leftSidebarOpen ? (
              <ChevronLeft className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {/* Category Icons */}
        <div className="flex flex-col gap-1 py-1.5">
          {categories.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => {
                if (activeTab === id && leftSidebarOpen) {
                  toggleLeftSidebar()
                } else {
                  setActiveTab(id)
                  if (!leftSidebarOpen) toggleLeftSidebar()
                  if (id === 'effects') triggerPreviews()
                }
              }}
              className={`
                w-9 h-9 rounded-lg flex items-center justify-center transition-[transform,background-color,color] duration-150 active:scale-95
                ${
                  activeTab === id && leftSidebarOpen
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }
              `}
              data-tooltip={label}
              data-tooltip-side="right"
            >
              <Icon className="w-4 h-4" />
            </button>
          ))}
        </div>
      </div>

      {/* Content Panel — width animated via motion for the open/close toggle.
          We intentionally animate `width` (a layout property, not the cheaper
          transform/opacity) because collapsing must reclaim layout space for the
          preview — transform can't do that. The heavy content is GPU-composited
          (translateZ below) so the clip reveal is compositor-only and does not
          repaint the subtree each frame — that's what previously churned. Close is
          a touch faster than open (exit < entrance). During a resize-drag we snap
          (duration 0) so width tracks the pointer instead of easing behind it. */}
      <motion.div
        className="panel-bg border-r border-border overflow-hidden relative"
        initial={false}
        animate={{ width: leftSidebarOpen ? sidebarWidth : 0 }}
        transition={
          isResizingRef.current || prefersReducedMotion
            ? { duration: 0 }
            : { type: 'tween', duration: leftSidebarOpen ? 0.26 : 0.2, ease: [0.32, 0.72, 0, 1] }
        }
        onAnimationComplete={() => {
          if (!leftSidebarOpen) setContentInert(true)
        }}
      >
        {/* Promote the content to its own GPU layer so the panel's width/clip
            animation reveals it without repainting the subtree each frame. The
            sidebar has no fixed-position descendants, so the containing block this
            establishes is harmless. */}
        <div
          className="h-full min-h-0 flex flex-col"
          style={{ width: sidebarWidth, transform: 'translateZ(0)' }}
          inert={contentInert}
        >
          <>
            {/* Panel Header — sits with the tab content */}
            <div
              className="flex items-center justify-between px-3 border-b border-border flex-shrink-0"
              style={{ height: EDITOR_LAYOUT_CSS_VALUES.sidebarHeaderHeight }}
            >
              <span className="text-sm font-medium text-foreground">
                {categories.find((c) => c.id === activeTab)?.label}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                style={{
                  width: EDITOR_LAYOUT_CSS_VALUES.sidebarHeaderButtonSize,
                  height: EDITOR_LAYOUT_CSS_VALUES.sidebarHeaderButtonSize,
                }}
                onClick={toggleMediaFullColumn}
                aria-label={
                  mediaFullColumn
                    ? t('editor.propertiesSidebar.dockToPreview')
                    : t('editor.propertiesSidebar.expandFullColumn')
                }
                data-tooltip={
                  mediaFullColumn
                    ? t('editor.propertiesSidebar.dockToPreview')
                    : t('editor.propertiesSidebar.expandFullColumn')
                }
                data-tooltip-side="bottom"
              >
                {mediaFullColumn ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </Button>
            </div>

            {/* Media Tab - Full Media Library */}
            <div
              className={`min-h-0 flex-1 overflow-hidden ${activeTab === 'media' ? 'block' : 'hidden'}`}
            >
              <MediaLibrary />
            </div>

            {/* Audio Tab - Project Audio & SFX */}
            <div
              className={`min-h-0 flex-1 overflow-hidden ${activeTab === 'audio' ? 'block' : 'hidden'}`}
            >
              {activeTab === 'audio' && <AudioTabPanel />}
            </div>

            {/* Text Tab */}
            <div
              className={`min-h-0 flex-1 overflow-y-auto p-3 ${activeTab === 'text' ? 'block' : 'hidden'}`}
            >
              <div className="space-y-3">
                <div className="space-y-3">
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    {t('editor.mediaSidebar.templates')}
                  </div>
                  {TEXT_TEMPLATE_GROUPS.map((group) => {
                    const presets = textTemplatesByLayout[group.key]
                    const showAddText = group.key === 'single'

                    if (!showAddText && presets.length === 0) {
                      return null
                    }

                    return (
                      <div key={group.key} className="space-y-1.5">
                        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                          {t(group.labelKey)}
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          {showAddText ? (
                            <button
                              draggable={true}
                              onDragStart={handleTemplateDragStart({
                                itemType: 'text',
                                label: DEFAULT_TEXT_TEMPLATE_LABEL,
                              })}
                              onDragEnd={handleTemplateDragEnd}
                              onClick={() => {
                                if (shouldSuppressGeneratedItemClick()) return
                                handleAddText()
                              }}
                              className="flex flex-col items-center gap-1 p-1.5 rounded-md border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.98] group"
                            >
                              {renderTextTemplatePreview()}
                              <span className="text-[9px] text-muted-foreground group-hover:text-foreground text-center leading-tight w-full">
                                {ADD_TEXT_TEMPLATE_LABEL}
                              </span>
                            </button>
                          ) : null}
                          {presets.map((preset) => (
                            <button
                              key={preset.id}
                              draggable={true}
                              onDragStart={handleTemplateDragStart({
                                itemType: 'text',
                                label: preset.label,
                                textStylePresetId: preset.id,
                              })}
                              onDragEnd={handleTemplateDragEnd}
                              onClick={() => {
                                if (shouldSuppressGeneratedItemClick()) return
                                handleAddText(preset.id)
                              }}
                              className={cn(
                                'flex flex-col items-center gap-1 p-1.5 rounded-md border border-border',
                                'bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50',
                                'transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.98] group',
                              )}
                            >
                              {renderTextTemplatePreview(preset)}
                              <span className="text-[9px] text-muted-foreground group-hover:text-foreground text-center leading-tight w-full">
                                {preset.label}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Shapes Tab */}
            <div
              className={`min-h-0 flex-1 overflow-y-auto p-3 ${activeTab === 'shapes' ? 'block' : 'hidden'}`}
            >
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  draggable={true}
                  onDragStart={handleTemplateDragStart({
                    itemType: 'shape',
                    label: t('editor.shapeSection.solidColor'),
                    shapeType: 'rectangle',
                    shapePreset: 'solid',
                  })}
                  onDragEnd={handleTemplateDragEnd}
                  onClick={() => {
                    if (shouldSuppressGeneratedItemClick()) return
                    handleAddShape('rectangle', 'solid')
                  }}
                  className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.98] group"
                >
                  <div className="w-7 h-7 rounded border border-border bg-[#2d2d2d] shadow-inner group-hover:border-primary/50" />
                  <span className="text-[9px] text-muted-foreground group-hover:text-foreground">
                    {t('editor.shapeSection.solidColor')}
                  </span>
                </button>

                <button
                  draggable={true}
                  onDragStart={handleTemplateDragStart({
                    itemType: 'shape',
                    label: t('editor.shapeSection.gradient'),
                    shapeType: 'rectangle',
                    shapePreset: 'gradient',
                  })}
                  onDragEnd={handleTemplateDragEnd}
                  onClick={() => {
                    if (shouldSuppressGeneratedItemClick()) return
                    handleAddShape('rectangle', 'gradient')
                  }}
                  className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.98] group"
                >
                  <div className="w-7 h-7 rounded border border-border bg-gradient-to-r from-blue-500 to-violet-500 shadow-inner group-hover:border-primary/50" />
                  <span className="text-[9px] text-muted-foreground group-hover:text-foreground">
                    {t('editor.shapeSection.gradient')}
                  </span>
                </button>

                <button
                  draggable={true}
                  onDragStart={handleTemplateDragStart({
                    itemType: 'shape',
                    label: t('editor.shapeSection.typeRectangle'),
                    shapeType: 'rectangle',
                  })}
                  onDragEnd={handleTemplateDragEnd}
                  onClick={() => {
                    if (shouldSuppressGeneratedItemClick()) return
                    handleAddShape('rectangle')
                  }}
                  className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.98] group"
                >
                  <div className="w-7 h-7 rounded border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70">
                    <Square className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground" />
                  </div>
                  <span className="text-[9px] text-muted-foreground group-hover:text-foreground">
                    {t('editor.shapeSection.typeRectangle')}
                  </span>
                </button>

                <button
                  draggable={true}
                  onDragStart={handleTemplateDragStart({
                    itemType: 'shape',
                    label: t('editor.shapeSection.typeCircle'),
                    shapeType: 'circle',
                  })}
                  onDragEnd={handleTemplateDragEnd}
                  onClick={() => {
                    if (shouldSuppressGeneratedItemClick()) return
                    handleAddShape('circle')
                  }}
                  className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.98] group"
                >
                  <div className="w-7 h-7 rounded border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70">
                    <Circle className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground" />
                  </div>
                  <span className="text-[9px] text-muted-foreground group-hover:text-foreground">
                    {t('editor.shapeSection.typeCircle')}
                  </span>
                </button>

                <button
                  draggable={true}
                  onDragStart={handleTemplateDragStart({
                    itemType: 'shape',
                    label: t('editor.shapeSection.typeTriangle'),
                    shapeType: 'triangle',
                  })}
                  onDragEnd={handleTemplateDragEnd}
                  onClick={() => {
                    if (shouldSuppressGeneratedItemClick()) return
                    handleAddShape('triangle')
                  }}
                  className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.98] group"
                >
                  <div className="w-7 h-7 rounded border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70">
                    <Triangle className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground" />
                  </div>
                  <span className="text-[9px] text-muted-foreground group-hover:text-foreground">
                    {t('editor.shapeSection.typeTriangle')}
                  </span>
                </button>

                <button
                  draggable={true}
                  onDragStart={handleTemplateDragStart({
                    itemType: 'shape',
                    label: t('editor.shapeSection.typeEllipse'),
                    shapeType: 'ellipse',
                  })}
                  onDragEnd={handleTemplateDragEnd}
                  onClick={() => {
                    if (shouldSuppressGeneratedItemClick()) return
                    handleAddShape('ellipse')
                  }}
                  className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.98] group"
                >
                  <div className="w-7 h-7 rounded border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70">
                    <Circle className="w-3.5 h-2.5 text-muted-foreground group-hover:text-foreground" />
                  </div>
                  <span className="text-[9px] text-muted-foreground group-hover:text-foreground">
                    {t('editor.shapeSection.typeEllipse')}
                  </span>
                </button>

                <button
                  draggable={true}
                  onDragStart={handleTemplateDragStart({
                    itemType: 'shape',
                    label: t('editor.shapeSection.typeStar'),
                    shapeType: 'star',
                  })}
                  onDragEnd={handleTemplateDragEnd}
                  onClick={() => {
                    if (shouldSuppressGeneratedItemClick()) return
                    handleAddShape('star')
                  }}
                  className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.98] group"
                >
                  <div className="w-7 h-7 rounded border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70">
                    <Star className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground" />
                  </div>
                  <span className="text-[9px] text-muted-foreground group-hover:text-foreground">
                    {t('editor.shapeSection.typeStar')}
                  </span>
                </button>

                <button
                  draggable={true}
                  onDragStart={handleTemplateDragStart({
                    itemType: 'shape',
                    label: t('editor.shapeSection.typePolygon'),
                    shapeType: 'polygon',
                  })}
                  onDragEnd={handleTemplateDragEnd}
                  onClick={() => {
                    if (shouldSuppressGeneratedItemClick()) return
                    handleAddShape('polygon')
                  }}
                  className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.98] group"
                >
                  <div className="w-7 h-7 rounded border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70">
                    <Hexagon className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground" />
                  </div>
                  <span className="text-[9px] text-muted-foreground group-hover:text-foreground">
                    {t('editor.shapeSection.typePolygon')}
                  </span>
                </button>

                <button
                  draggable={true}
                  onDragStart={handleTemplateDragStart({
                    itemType: 'shape',
                    label: t('editor.shapeSection.typeHeart'),
                    shapeType: 'heart',
                  })}
                  onDragEnd={handleTemplateDragEnd}
                  onClick={() => {
                    if (shouldSuppressGeneratedItemClick()) return
                    handleAddShape('heart')
                  }}
                  className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.98] group"
                >
                  <div className="w-7 h-7 rounded border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70">
                    <Heart className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground" />
                  </div>
                  <span className="text-[9px] text-muted-foreground group-hover:text-foreground">
                    {t('editor.shapeSection.typeHeart')}
                  </span>
                </button>

                <button
                  onClick={() => useMaskEditorStore.getState().startShapePenMode()}
                  className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.98] group"
                  title={t('editor.mediaSidebar.penToolHint')}
                >
                  <div className="w-7 h-7 rounded border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70">
                    <Pen className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground" />
                  </div>
                  <span className="text-[9px] text-muted-foreground group-hover:text-foreground">
                    {t('editor.mediaSidebar.pen')}
                  </span>
                </button>
              </div>
            </div>

            {/* Effects Tab */}
            <div
              className={`min-h-0 flex-1 overflow-y-auto p-3 ${activeTab === 'effects' ? 'block' : 'hidden'}`}
            >
              <div className="space-y-3">
                {/* Adjustment Layer Alert if active on timeline */}
                {adjustmentLayerItems.length > 0 && (
                  <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-2.5 space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <div className="text-xs space-y-0.5">
                        <span className="font-semibold text-amber-500 block">
                          Capa de Ajuste activa en la línea de tiempo
                        </span>
                        <span className="text-muted-foreground text-[10px] block leading-tight">
                          Hay {adjustmentLayerItems.length} capa(s) de ajuste aplicando efectos a
                          los videos inferiores.
                        </span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleDeleteAdjustmentLayers}
                      className="w-full h-7 text-xs gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Eliminar Capa(s) de Ajuste</span>
                    </Button>
                  </div>
                )}

                {/* Permanent Effects Action Toolbar - ALWAYS VISIBLE */}
                <div className="rounded-lg border border-border bg-card p-2.5 space-y-2 shadow-sm">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="font-semibold text-foreground truncate">
                        {selectedVisualItems.length > 0
                          ? selectedVisualItems[0]?.label || 'Clip seleccionado'
                          : 'Control de Efectos'}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded shrink-0">
                      {selectedVisualItems.length > 0
                        ? `${selectedVisualItemEffectsCount} en clip`
                        : `${totalProjectEffectsCount} en proyecto`}
                    </span>
                  </div>

                  {selectedVisualItems.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleClearSelectedClipEffects}
                      className="w-full h-7 text-xs gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
                      title="Elimina todos los efectos del clip actualmente seleccionado"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Limpiar efectos del clip ({selectedVisualItemEffectsCount})</span>
                    </Button>
                  )}

                  {isPreviewingOnPlayer && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCloseEffectInspector}
                      className="w-full h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Quitar preview del reproductor</span>
                    </Button>
                  )}

                  {/* Red Master Clear / Reset Button - ALWAYS VISIBLE */}
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleClearAllProjectEffects}
                    className="w-full h-8 text-xs font-semibold gap-1.5 bg-red-600 hover:bg-red-700 text-white shadow-sm"
                    title="Elimina todos los efectos de todos los clips, capas de ajuste y purga la caché para restaurar el video original limpio"
                  >
                    <Eraser className="w-3.5 h-3.5" />
                    <span>Restablecer Video (Eliminar todos los efectos)</span>
                  </Button>
                </div>
                {/* Active Effect Inspection & Preview Card */}
                {inspectingEffect && (
                  <div className="rounded-lg border border-primary/40 bg-secondary/30 p-3 shadow-md space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-medium text-xs text-foreground min-w-0">
                        <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="truncate">{inspectingEffect.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleCloseEffectInspector}
                        className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                        title="Cerrar vista previa"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="w-full aspect-video rounded overflow-hidden border border-border bg-black/40">
                      <EffectThumbnail
                        effects={inspectingEffect.effects}
                        active={true}
                        className="w-full h-full object-cover"
                      />
                    </div>

                    <div className="space-y-1.5 pt-1">
                      <Button
                        size="sm"
                        variant={isPreviewingOnPlayer ? 'default' : 'outline'}
                        onClick={handleTogglePlayerPreview}
                        className="w-full h-7 text-xs gap-1.5"
                      >
                        {isPreviewingOnPlayer ? (
                          <>
                            <EyeOff className="w-3.5 h-3.5" />
                            <span>Desactivar Preview en Reproductor</span>
                          </>
                        ) : (
                          <>
                            <Eye className="w-3.5 h-3.5" />
                            <span>Previsualizar en Reproductor</span>
                          </>
                        )}
                      </Button>

                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleApplyToSelectedClip}
                        disabled={!hasSelectedVisualClip}
                        className="w-full h-7 text-xs gap-1.5"
                        title={
                          !hasSelectedVisualClip
                            ? 'Selecciona un clip en la línea de tiempo'
                            : undefined
                        }
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>
                          {hasSelectedVisualClip
                            ? 'Aplicar al Clip Seleccionado'
                            : 'Aplicar (Selecciona un clip)'}
                        </span>
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleInsertAsTimelineBlock}
                        className="w-full h-7 text-xs gap-1.5"
                      >
                        <Layers className="w-3.5 h-3.5" />
                        <span>Insertar en Línea de Tiempo como Bloque</span>
                      </Button>
                    </div>
                  </div>
                )}

                {/* Blank Adjustment Layer */}
                <button
                  draggable={true}
                  onDragStart={handleTemplateDragStart({
                    itemType: 'adjustment',
                    label: t('editor.mediaSidebar.adjustmentLayer'),
                  })}
                  onDragEnd={handleTemplateDragEnd}
                  onClick={() => {
                    if (shouldSuppressGeneratedItemClick()) return
                    handleAddAdjustmentLayer()
                  }}
                  className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.98] group"
                >
                  <div className="w-8 h-8 rounded-md border border-border bg-secondary/50 flex items-center justify-center group-hover:bg-secondary/70 flex-shrink-0">
                    <Layers className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
                  </div>
                  <div className="text-left">
                    <div className="text-xs text-muted-foreground group-hover:text-foreground">
                      {t('editor.mediaSidebar.blankAdjustmentLayer')}
                    </div>
                  </div>
                </button>

                {/* Presets */}
                <div>
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    {t('editor.mediaSidebar.presets')}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {EFFECT_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        draggable={true}
                        onDragStart={handleTemplateDragStart({
                          itemType: 'adjustment',
                          label: preset.name,
                          effects: preset.effects,
                        })}
                        onDragEnd={handleTemplateDragEnd}
                        onMouseEnter={() => setHoveredEffectKey(`preset:${preset.id}`)}
                        onMouseLeave={() =>
                          setHoveredEffectKey((k) => (k === `preset:${preset.id}` ? null : k))
                        }
                        onClick={() => {
                          if (shouldSuppressGeneratedItemClick()) return
                          handleSelectPresetForInspection(preset.id)
                        }}
                        className="flex flex-col items-center gap-1 p-1.5 rounded-md border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.98] group"
                      >
                        <EffectThumbnail
                          effects={preset.effects}
                          active={hoveredEffectKey === `preset:${preset.id}`}
                          className="w-full aspect-video rounded-sm"
                        />
                        <span className="text-[9px] text-muted-foreground group-hover:text-foreground text-center leading-tight">
                          {preset.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* GPU Effects by Category */}
                {gpuCategories.map(({ category, effects: catEffects }) => (
                  <div key={category}>
                    <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                      {category}
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {catEffects.map((def) => (
                        <button
                          key={def.id}
                          draggable={true}
                          onDragStart={handleTemplateDragStart({
                            itemType: 'adjustment',
                            label: def.name,
                            effects: [
                              {
                                type: 'gpu-effect',
                                gpuEffectType: def.id,
                                params: getGpuEffectDefaultParams(def.id),
                              },
                            ],
                          })}
                          onDragEnd={handleTemplateDragEnd}
                          onMouseEnter={() => setHoveredEffectKey(def.id)}
                          onMouseLeave={() => setHoveredEffectKey((k) => (k === def.id ? null : k))}
                          onClick={() => {
                            if (shouldSuppressGeneratedItemClick()) return
                            handleSelectGpuEffectForInspection(def.id)
                          }}
                          className="flex flex-col items-center gap-1 p-1.5 rounded-md border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-[transform,background-color,border-color,color] duration-150 active:scale-[0.98] group"
                        >
                          <EffectThumbnail
                            effectId={def.id}
                            active={hoveredEffectKey === def.id}
                            className="w-full aspect-video rounded-sm"
                          />
                          <span className="text-[9px] text-muted-foreground group-hover:text-foreground text-center leading-tight truncate w-full">
                            {def.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Transitions Tab */}
            <div
              className={`min-h-0 flex-1 overflow-hidden ${activeTab === 'transitions' ? 'block' : 'hidden'}`}
            >
              {activeTab === 'transitions' && <TransitionsPanel />}
            </div>

            {/* Lottie Browser Tab */}
            <div
              className={`min-h-0 flex-1 overflow-hidden ${activeTab === 'lottie' ? 'block' : 'hidden'}`}
            >
              {lottieTabActivated && <LottieBrowserPanel />}
            </div>

            {/* Transcript Tab */}
            <div
              className={`min-h-0 flex-1 overflow-hidden ${activeTab === 'transcript' ? 'block' : 'hidden'}`}
            >
              {activeTab === 'transcript' && (
                <Suspense fallback={null}>
                  <LazyTranscriptEditorPanel active />
                </Suspense>
              )}
            </div>

            {/* AI Tab */}
            <div
              className={`min-h-0 flex-1 overflow-hidden ${activeTab === 'ai' ? 'block' : 'hidden'}`}
            >
              {aiTabActivated && (
                <Suspense fallback={null}>
                  <LazyAiPanel />
                </Suspense>
              )}
            </div>
          </>
        </div>
        {/* Resize Handle */}
        {leftSidebarOpen && (
          <div
            data-resize-handle
            onMouseDown={handleResizeStart}
            className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/50 active:bg-primary/50 transition-colors z-10"
          />
        )}
      </motion.div>
    </div>
  )
})
