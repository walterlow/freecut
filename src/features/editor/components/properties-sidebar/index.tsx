import {
  Activity,
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { i18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Settings2 } from 'lucide-react'
import { useItemsStore } from '@/features/editor/deps/timeline-store'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import type { TimelineItem } from '@/types/timeline'
import { CanvasPanel } from './canvas-panel'
import { useSettingsStore } from '@/features/editor/deps/settings'
import {
  EDITOR_LAYOUT_CSS_VALUES,
  clampRightEditorSidebarWidth,
  getEditorLayout,
} from '@/config/editor-layout'

const LazyClipPanel = lazy(() =>
  import('./clip-panel').then((module) => ({ default: module.ClipPanel })),
)
const LazyMarkerPanel = lazy(() =>
  import('./marker-panel').then((module) => ({ default: module.MarkerPanel })),
)
const LazyTransitionPanel = lazy(() =>
  import('./transition-panel').then((module) => ({ default: module.TransitionPanel })),
)

type HeaderItem = Pick<TimelineItem, 'id' | 'label' | 'linkedGroupId' | 'type'>

function buildClipHeaderGroups(items: HeaderItem[]) {
  const groups = new Map<
    string,
    { displayLabel: string | null; labels: string[]; audioOnly: boolean }
  >()

  for (const item of items) {
    const key = item.linkedGroupId ?? item.id
    const label = item.label.trim() || null
    const existing = groups.get(key)

    if (!existing) {
      groups.set(key, {
        displayLabel: label,
        labels: label ? [label] : [],
        audioOnly: item.type === 'audio',
      })
      continue
    }

    if (label) {
      existing.labels.push(label)
      if (!existing.displayLabel || (existing.audioOnly && item.type !== 'audio')) {
        existing.displayLabel = label
      }
    }

    if (item.type !== 'audio') {
      existing.audioOnly = false
    }
  }

  return Array.from(groups.values(), (group) => ({
    displayLabel: group.displayLabel,
    title: group.labels
      .filter((label, index, labels) => labels.indexOf(label) === index)
      .join(', '),
  }))
}

function getClipHeader(items: HeaderItem[]) {
  const groups = buildClipHeaderGroups(items)
  const logicalCount = groups.length

  if (logicalCount === 0) return null

  if (logicalCount === 1 && groups[0]?.displayLabel) {
    return {
      text: groups[0].displayLabel,
      title: groups[0].title || groups[0].displayLabel,
    }
  }

  const fallbackLabel = i18n.t('editor.propertiesSidebar.clipsSelected', { count: logicalCount })

  return {
    text: fallbackLabel,
    title:
      groups
        .map((group) => group.title || group.displayLabel)
        .filter(Boolean)
        .join(', ') || fallbackLabel,
  }
}

/**
 * Properties sidebar - right panel for editing properties.
 * Shows TransitionPanel when a transition is selected, MarkerPanel when a marker
 * is selected, ClipPanel when clips are selected, CanvasPanel otherwise.
 */
export const PropertiesSidebar = memo(function PropertiesSidebar() {
  const { t } = useTranslation()
  const editorDensity = useSettingsStore((s) => s.editorDensity)
  const editorLayout = getEditorLayout(editorDensity)
  // Use granular selectors - Zustand v5 best practice
  const rightSidebarOpen = useEditorStore((s) => s.rightSidebarOpen)
  const toggleRightSidebar = useEditorStore((s) => s.toggleRightSidebar)
  const rightSidebarWidth = useEditorStore((s) => s.rightSidebarWidth)
  const setRightSidebarWidth = useEditorStore((s) => s.setRightSidebarWidth)
  const propertiesFullColumn = useEditorStore((s) => s.propertiesFullColumn)
  const togglePropertiesFullColumn = useEditorStore((s) => s.togglePropertiesFullColumn)
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)
  const selectedMarkerId = useSelectionStore((s) => s.selectedMarkerId)
  const selectedTransitionId = useSelectionStore((s) => s.selectedTransitionId)
  const prefersReducedMotion = useReducedMotion()
  const selectedItems = useItemsStore(
    useShallow(
      useCallback(
        (s) => {
          const items: HeaderItem[] = []

          for (const itemId of selectedItemIds) {
            const item = s.itemById[itemId]
            if (item) {
              items.push(item)
            }
          }

          return items
        },
        [selectedItemIds],
      ),
    ),
  )

  const hasClipSelection = selectedItemIds.length > 0
  const clipHeader = useMemo(() => getClipHeader(selectedItems), [selectedItems])
  const activeClipHeader = !selectedTransitionId && !selectedMarkerId ? clipHeader : null

  // Keep the panel content mounted + visible while the collapse animation plays
  // so it slides out smoothly instead of blinking away. Only switch Activity to
  // `hidden` (the perf win) once the close animation has actually settled.
  const [contentVisible, setContentVisible] = useState(rightSidebarOpen)
  useEffect(() => {
    if (rightSidebarOpen) setContentVisible(true)
  }, [rightSidebarOpen])

  // Resize handle logic
  const isResizingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isResizingRef.current = true
      startXRef.current = e.clientX
      startWidthRef.current = rightSidebarWidth
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [rightSidebarWidth],
  )

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return
      // Dragging left increases width for right sidebar
      const delta = startXRef.current - e.clientX
      const newWidth = clampRightEditorSidebarWidth(startWidthRef.current + delta, editorLayout)
      setRightSidebarWidth(newWidth)
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
  }, [editorLayout, setRightSidebarWidth])

  return (
    <>
      {/* Right Sidebar — width animated via motion for the open/close toggle.
          We intentionally animate `width` (a layout property, not the cheaper
          transform/opacity) because collapsing must reclaim layout space for the
          preview — transform can't do that. overflow-hidden clips the fixed-width
          inner content while the panel closes. Close is a touch faster than open
          (exit < entrance). During a resize-drag we snap (duration 0) so width
          tracks the pointer instead of easing behind it. */}
      <motion.div
        className="panel-bg border-l border-border shrink-0 relative h-full overflow-hidden"
        initial={false}
        animate={{ width: rightSidebarOpen ? rightSidebarWidth : 0 }}
        transition={
          isResizingRef.current || prefersReducedMotion
            ? { duration: 0 }
            : { type: 'tween', duration: rightSidebarOpen ? 0.26 : 0.2, ease: [0.32, 0.72, 0, 1] }
        }
        onAnimationComplete={() => {
          if (!rightSidebarOpen) setContentVisible(false)
        }}
      >
        {/* Use Activity for React 19 performance optimization */}
        <Activity mode={contentVisible ? 'visible' : 'hidden'}>
          <div className="h-full flex flex-col" style={{ width: rightSidebarWidth }}>
            {/* Sidebar Header */}
            <div
              className="flex items-center justify-between px-3 border-b border-border flex-shrink-0"
              style={{ height: EDITOR_LAYOUT_CSS_VALUES.sidebarHeaderHeight }}
            >
              <div className="min-w-0 flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  style={{
                    width: EDITOR_LAYOUT_CSS_VALUES.sidebarHeaderButtonSize,
                    height: EDITOR_LAYOUT_CSS_VALUES.sidebarHeaderButtonSize,
                  }}
                  onClick={togglePropertiesFullColumn}
                  aria-label={
                    propertiesFullColumn
                      ? t('editor.propertiesSidebar.dockToPreview')
                      : t('editor.propertiesSidebar.expandFullColumn')
                  }
                  data-tooltip={
                    propertiesFullColumn
                      ? t('editor.propertiesSidebar.dockToPreview')
                      : t('editor.propertiesSidebar.expandFullColumn')
                  }
                  data-tooltip-side="bottom"
                >
                  {propertiesFullColumn ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </Button>
                <Settings2 className="w-3 h-3 shrink-0 text-muted-foreground" />
                <h2 className="min-w-0 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <span className="shrink-0 uppercase tracking-wide">
                    {t('editor.propertiesSidebar.title')}
                  </span>
                  {activeClipHeader && (
                    <>
                      <span className="shrink-0">-</span>
                      <span
                        className="truncate normal-case tracking-normal"
                        title={activeClipHeader.title}
                      >
                        {activeClipHeader.text}
                      </span>
                    </>
                  )}
                </h2>
              </div>
              <Button
                variant="ghost"
                size="icon"
                style={{
                  width: EDITOR_LAYOUT_CSS_VALUES.sidebarHeaderButtonSize,
                  height: EDITOR_LAYOUT_CSS_VALUES.sidebarHeaderButtonSize,
                }}
                onClick={toggleRightSidebar}
                aria-label={t('editor.mediaSidebar.collapsePanel')}
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>

            {/* Properties Panel */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 [scrollbar-gutter:stable]">
              {selectedTransitionId ? (
                <Suspense fallback={null}>
                  <LazyTransitionPanel />
                </Suspense>
              ) : selectedMarkerId ? (
                <Suspense fallback={null}>
                  <LazyMarkerPanel />
                </Suspense>
              ) : hasClipSelection ? (
                <Suspense fallback={null}>
                  <LazyClipPanel />
                </Suspense>
              ) : (
                <CanvasPanel />
              )}
            </div>
          </div>
        </Activity>
        {/* Resize Handle */}
        {rightSidebarOpen && (
          <div
            onMouseDown={handleResizeStart}
            className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-primary/50 active:bg-primary/50 transition-colors z-10"
          />
        )}
      </motion.div>

      {/* Right Sidebar reveal toggle — matched to the in-header collapse button's
          size, chevron, and top alignment so the arrow stays in the same place
          and size when toggling (mirrors the always-present arrow on the left
          sidebar rail). Edge-attached rounded tab keeps it discoverable. */}
      {!rightSidebarOpen && (
        <button
          onClick={toggleRightSidebar}
          className="absolute right-0 top-2 z-10 flex items-center justify-center rounded-l-md border border-r-0 border-border bg-secondary/50 hover:bg-secondary transition-colors"
          style={{
            width: EDITOR_LAYOUT_CSS_VALUES.sidebarHeaderButtonSize,
            height: EDITOR_LAYOUT_CSS_VALUES.sidebarHeaderButtonSize,
          }}
          data-tooltip={t('editor.propertiesSidebar.showPanel')}
          data-tooltip-side="left"
          aria-label={t('editor.propertiesSidebar.showPanel')}
        >
          <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      )}
    </>
  )
})
