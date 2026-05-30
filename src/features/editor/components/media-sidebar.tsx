import { useCallback, useMemo, useRef, useEffect, memo, Activity, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Film,
  Layers,
  LineChart,
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
  WandSparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/shared/ui/cn'
import { useEditorStore } from '@/shared/state/editor'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { useProjectStore } from '@/features/editor/deps/projects'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import {
  clearMediaDragData,
  importMediaLibrary,
  setMediaDragData,
} from '@/features/editor/deps/media-library'
import { importKeyframeGraphPanel } from '@/features/editor/deps/timeline-contract'
import {
  createDefaultAdjustmentItem,
  createDefaultShapeItem,
  createTextTemplateItem,
  findCompatibleTrackForItemType,
  findNearestAvailableSpace,
  getDefaultGeneratedLayerDurationInFrames,
} from '@/features/editor/deps/timeline-utils'
import type { TextItem, ShapeItem, ShapeType, AdjustmentItem } from '@/types/timeline'
import { useMaskEditorStore } from '@/features/editor/deps/preview'
import type { VisualEffect } from '@/types/effects'
import { createLogger } from '@/shared/logging/logger'
import { useSettingsStore } from '@/features/editor/deps/settings'
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
const LazyAiPanel = lazy(() => import('./ai-panel').then((module) => ({ default: module.AiPanel })))
const LazyTransitionsPanel = lazy(() =>
  import('./transitions-panel').then((module) => ({ default: module.TransitionsPanel })),
)
const LazyKeyframeGraphPanel = lazy(() =>
  importKeyframeGraphPanel().then((module) => ({
    default: module.KeyframeGraphPanel,
  })),
)
const LazyEffectsTab = lazy(() =>
  import('./media-sidebar-effects-tab').then((module) => ({
    default: module.MediaSidebarEffectsTab,
  })),
)
const LazyMediaLibrary = lazy(() =>
  importMediaLibrary().then((module) => ({
    default: module.MediaLibrary,
  })),
)

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
  const keyframeEditorOpen = useEditorStore((s) => s.keyframeEditorOpen)
  const setKeyframeEditorOpen = useEditorStore((s) => s.setKeyframeEditorOpen)
  const toggleKeyframeEditorOpen = useEditorStore((s) => s.toggleKeyframeEditorOpen)
  const activeTab = useEditorStore((s) => s.activeTab)
  const setActiveTab = useEditorStore((s) => s.setActiveTab)
  const sidebarWidth = useEditorStore((s) => s.sidebarWidth)
  const setSidebarWidth = useEditorStore((s) => s.setSidebarWidth)

  // Auto-expand sidebar to 35% viewport when keyframe editor opens
  const prevKeyframeOpenRef = useRef(keyframeEditorOpen)
  const savedWidthBeforeExpandRef = useRef<number | null>(null)

  useEffect(() => {
    const wasOpen = prevKeyframeOpenRef.current
    prevKeyframeOpenRef.current = keyframeEditorOpen

    if (keyframeEditorOpen && !wasOpen) {
      const targetWidth = Math.floor(window.innerWidth * 0.35)
      const clamped = clampLeftEditorSidebarWidth(targetWidth, editorLayout)
      if (clamped > sidebarWidth) {
        savedWidthBeforeExpandRef.current = sidebarWidth
        setSidebarWidth(clamped)
      }
    } else if (!keyframeEditorOpen && wasOpen && savedWidthBeforeExpandRef.current !== null) {
      setSidebarWidth(savedWidthBeforeExpandRef.current)
      savedWidthBeforeExpandRef.current = null
    }
  }, [keyframeEditorOpen, editorLayout, sidebarWidth, setSidebarWidth])

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

  // Add text item to timeline at the best available position
  const handleAddText = useCallback(
    (presetId?: (typeof TEXT_STYLE_PRESETS)[number]['id']) => {
      // Read all needed state from stores directly to avoid subscriptions
      const { tracks, items, fps, addItem } = useTimelineStore.getState()
      const { activeTrackId, selectItems } = useSelectionStore.getState()
      const currentProject = useProjectStore.getState().currentProject

      const targetTrack = findCompatibleTrackForItemType({
        tracks,
        items,
        itemType: 'text',
        preferredTrackId: activeTrackId,
      })

      if (!targetTrack) {
        logger.warn('No available track for text item')
        return
      }

      const durationInFrames = getDefaultGeneratedLayerDurationInFrames(fps)

      // Find the best position: start at playhead, find nearest available space
      const proposedPosition = usePlaybackStore.getState().currentFrame
      const finalPosition =
        findNearestAvailableSpace(proposedPosition, durationInFrames, targetTrack.id, items) ??
        proposedPosition // Fallback to proposed if no space found

      // Get canvas dimensions for initial transform
      const canvasWidth = currentProject?.metadata.width ?? DEFAULT_PROJECT_WIDTH
      const canvasHeight = currentProject?.metadata.height ?? DEFAULT_PROJECT_HEIGHT

      const textStylePreset = presetId
        ? TEXT_STYLE_PRESETS.find((preset) => preset.id === presetId)
        : undefined
      const textItem: TextItem = createTextTemplateItem({
        placement: {
          trackId: targetTrack.id,
          from: finalPosition,
          durationInFrames,
          canvasWidth,
          canvasHeight,
          fps,
        },
        label: textStylePreset?.label,
        text: t('editor.textSection.defaultText'),
        textStylePresetId: presetId,
      })

      addItem(textItem)
      // Select the new item
      selectItems([textItem.id])
    },
    [t],
  )

  // Add shape item to timeline at the best available position
  const handleAddShape = useCallback((shapeType: ShapeType) => {
    // Read all needed state from stores directly to avoid subscriptions
    const { tracks, items, fps, addItem } = useTimelineStore.getState()
    const { activeTrackId, selectItems } = useSelectionStore.getState()
    const currentProject = useProjectStore.getState().currentProject

    const targetTrack = findCompatibleTrackForItemType({
      tracks,
      items,
      itemType: 'shape',
      preferredTrackId: activeTrackId,
    })

    if (!targetTrack) {
      logger.warn('No available track for shape item')
      return
    }

    const durationInFrames = getDefaultGeneratedLayerDurationInFrames(fps)

    // Find the best position: start at playhead, find nearest available space
    const proposedPosition = usePlaybackStore.getState().currentFrame
    const finalPosition =
      findNearestAvailableSpace(proposedPosition, durationInFrames, targetTrack.id, items) ??
      proposedPosition

    const canvasWidth = currentProject?.metadata.width ?? DEFAULT_PROJECT_WIDTH
    const canvasHeight = currentProject?.metadata.height ?? DEFAULT_PROJECT_HEIGHT

    const shapeItem: ShapeItem = createDefaultShapeItem({
      trackId: targetTrack.id,
      from: finalPosition,
      durationInFrames,
      canvasWidth,
      canvasHeight,
      shapeType,
    })

    addItem(shapeItem)
    // Select the new item
    selectItems([shapeItem.id])
  }, [])

  // Add adjustment layer to timeline at the best available position
  // Optionally with pre-applied effects and custom label
  const handleAddAdjustmentLayer = useCallback((effects?: VisualEffect[], label?: string) => {
    // Read all needed state from stores directly to avoid subscriptions
    const { tracks, items, fps, addItem } = useTimelineStore.getState()
    const { activeTrackId, selectItems } = useSelectionStore.getState()

    const targetTrack = findCompatibleTrackForItemType({
      tracks,
      items,
      itemType: 'adjustment',
      preferredTrackId: activeTrackId,
    })

    if (!targetTrack) {
      logger.warn('No available track for adjustment layer')
      return
    }

    const durationInFrames = getDefaultGeneratedLayerDurationInFrames(fps)

    // Find the best position: start at playhead, find nearest available space
    const proposedPosition = usePlaybackStore.getState().currentFrame
    const finalPosition =
      findNearestAvailableSpace(proposedPosition, durationInFrames, targetTrack.id, items) ??
      proposedPosition

    const adjustmentItem: AdjustmentItem = createDefaultAdjustmentItem({
      trackId: targetTrack.id,
      from: finalPosition,
      durationInFrames,
      effects,
      label,
    })

    addItem(adjustmentItem)
    // Select the new item
    selectItems([adjustmentItem.id])
  }, [])

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
    { id: 'text' as const, icon: Type, label: t('editor.mediaSidebar.text') },
    { id: 'shapes' as const, icon: Pentagon, label: t('editor.mediaSidebar.shapes') },
    { id: 'effects' as const, icon: Layers, label: t('editor.mediaSidebar.effects') },
    { id: 'transitions' as const, icon: Blend, label: t('editor.mediaSidebar.transitions') },
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
                }
              }}
              className={`
                w-9 h-9 rounded-lg flex items-center justify-center transition-all
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

          <div className="w-6 border-t border-border mx-auto my-0.5" />

          <button
            onClick={toggleKeyframeEditorOpen}
            className={`
              w-9 h-9 rounded-lg flex items-center justify-center transition-all
              ${
                keyframeEditorOpen
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              }
            `}
            data-tooltip={
              keyframeEditorOpen
                ? t('editor.mediaSidebar.hideKeyframeEditor')
                : t('editor.mediaSidebar.keyframeEditor')
            }
            data-tooltip-side="right"
            aria-label={
              keyframeEditorOpen
                ? t('editor.mediaSidebar.hideKeyframeEditor')
                : t('editor.mediaSidebar.showKeyframeEditor')
            }
          >
            <LineChart className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content Panel */}
      <div
        className={`panel-bg border-r border-border overflow-hidden relative ${
          leftSidebarOpen ? '' : 'w-0'
        }`}
        style={
          leftSidebarOpen
            ? { width: sidebarWidth, transition: isResizingRef.current ? 'none' : 'width 200ms' }
            : { transition: 'width 200ms' }
        }
      >
        {/* Use Activity for React 19 performance optimization - defers updates when hidden */}
        <Activity mode={leftSidebarOpen ? 'visible' : 'hidden'}>
          <div className="h-full min-h-0 flex flex-col" style={{ width: sidebarWidth }}>
            {keyframeEditorOpen && (
              <Suspense fallback={null}>
                <LazyKeyframeGraphPanel
                  isOpen={keyframeEditorOpen}
                  onToggle={toggleKeyframeEditorOpen}
                  onClose={() => setKeyframeEditorOpen(false)}
                  placement="top"
                />
              </Suspense>
            )}

            {/* Panel Header ââ‚¬” sits with the tab content, below the keyframe editor */}
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
              {activeTab === 'media' && (
                <Suspense fallback={null}>
                  <LazyMediaLibrary />
                </Suspense>
              )}
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
                              className="flex flex-col items-center gap-1 p-1.5 rounded-md border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
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
                                'transition-colors group',
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
                    label: t('editor.shapeSection.typeRectangle'),
                    shapeType: 'rectangle',
                  })}
                  onDragEnd={handleTemplateDragEnd}
                  onClick={() => {
                    if (shouldSuppressGeneratedItemClick()) return
                    handleAddShape('rectangle')
                  }}
                  className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
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
                  className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
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
                  className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
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
                  className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
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
                  className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
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
                  className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
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
                  className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
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
                  className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary/50 transition-colors group"
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
              {activeTab === 'effects' && (
                <Suspense fallback={null}>
                  <LazyEffectsTab
                    onAddAdjustmentLayer={handleAddAdjustmentLayer}
                    onTemplateDragStart={handleTemplateDragStart}
                    onTemplateDragEnd={handleTemplateDragEnd}
                    shouldSuppressGeneratedItemClick={shouldSuppressGeneratedItemClick}
                  />
                </Suspense>
              )}
            </div>

            {/* Transitions Tab */}
            <div
              className={`min-h-0 flex-1 overflow-hidden ${activeTab === 'transitions' ? 'block' : 'hidden'}`}
            >
              {activeTab === 'transitions' && (
                <Suspense fallback={null}>
                  <LazyTransitionsPanel />
                </Suspense>
              )}
            </div>

            {/* AI Tab */}
            <div
              className={`min-h-0 flex-1 overflow-hidden ${activeTab === 'ai' ? 'block' : 'hidden'}`}
            >
              {activeTab === 'ai' && (
                <Suspense fallback={null}>
                  <LazyAiPanel />
                </Suspense>
              )}
            </div>
          </div>
        </Activity>
        {/* Resize Handle */}
        {leftSidebarOpen && (
          <div
            data-resize-handle
            onMouseDown={handleResizeStart}
            className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/50 active:bg-primary/50 transition-colors z-10"
          />
        )}
      </div>
    </div>
  )
})
