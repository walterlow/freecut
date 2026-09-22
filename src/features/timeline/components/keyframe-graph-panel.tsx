/**
 * Keyframe Graph Panel Component
 *
 * Panel that shows the value graph editor for selected items.
 * Integrates with the timeline to provide visual keyframe editing.
 */

import {
  memo,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useHotkeys } from 'react-hotkeys-hook'
import { KeyframeGraphPanelHeader } from './keyframe-graph-panel-header'
import { toast } from 'sonner'
import { cn } from '@/shared/ui/cn'
import { MotionBakeConfirmationDialog } from '@/shared/ui/motion-bake-confirmation-dialog'
import { ErrorBoundary } from '@/components/error-boundary'
import {
  DopesheetEditor,
  PropertyLinkPickWhipOverlay,
  buildBakeMotionPlan,
} from '@/features/timeline/deps/keyframe-editors'
import { usePropertyLinkPickWhip } from '@/features/timeline/hooks/use-property-link-pick-whip'
import { bakeMotionToKeyframes } from '../stores/actions/motion-modifier-actions'
import { resolveTransform, getSourceDimensions } from '@/features/timeline/deps/composition-runtime'
import { useKeyframesStore } from '../stores/keyframes-store'
import { useKeyframeSelectionStore } from '../stores/keyframe-selection-store'
import { useEditorStore } from '@/shared/state/editor'
import { perfMarkRender } from '@/shared/logging/perf-marks'
import {
  MIN_CONTENT_HEIGHT,
  RESIZE_HANDLE_HEIGHT,
  useKeyframeGraphPanelChrome,
} from './use-keyframe-graph-panel-chrome'
import { useKeyframeGraphPanelViewState } from './use-keyframe-graph-panel-view-state'
import { useKeyframeGraphPanelModel } from './use-keyframe-graph-panel-model'
import { useEditTimelineKeyframeGeometry } from './use-edit-timeline-keyframe-geometry'
import { useKeyframeGraphTextMotion } from './use-keyframe-graph-text-motion'
import { useVectorKeyframeEditing } from './use-vector-keyframe-editing'
import { useKeyframeDragCommands } from './use-keyframe-drag-commands'
import { useKeyframeScrubAdd } from './use-keyframe-scrub-add'
import { useKeyframePropertyValues } from './use-keyframe-property-values'
import { buildDopesheetEditorProps } from './build-dopesheet-editor-props'
import type { AnimatableProperty, DirectLinkableProperty, EasingType } from '@/types/keyframe'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import { useResolvedHotkeys } from '@/features/timeline/deps/settings'
import { getDirectPropertyLinks } from '@/types/keyframe'
import type { KeyframeEditorSurface } from './keyframe-graph-panel-model'

interface KeyframeGraphPanelProps {
  /** Whether the panel is open */
  isOpen: boolean
  /** Deprecated: panel no longer collapses from the header */
  onToggle?: () => void
  /** Callback to close the panel */
  onClose: () => void
  /** Where the panel is docked in the layout */
  placement?: 'bottom' | 'top' | 'side'
  /** Side-lane docks stay persistent and should not expose a close affordance. */
  showCloseButton?: boolean
  /**
   * Animate-workspace context: keeps the panel persistent/spacious and unlocks
   * the third "split" view-mode option (sheet + graph stacked) in the toggle.
   * The user still chooses sheet / graph / split; split is no longer forced.
   */
  splitView?: boolean
  /** Whether the Animate workspace has hidden preview chrome for focused editing. */
  isFocusMode?: boolean
  /** Toggle the Animate workspace's focused keyframe layout. */
  onFocusModeChange?: (isFocusMode: boolean) => void
  /** Motion workspace context: a dedicated selected-layer value-curve editor. */
  surface?: KeyframeEditorSurface
  /** Initial parameter groups shown by this workspace; users can change them from Parameters. */
  initialVisibleGroupIds?: readonly string[]
  /** Optional property-column width for workspace-specific layouts. */
  propertyColumnWidth?: number
  /** Main Edit timeline scroll surface shared by the docked keyframe ruler. */
  timelineScrollContainerRef?: RefObject<HTMLDivElement | null>
}

const EASING_OPTIONS: Array<{
  value: EasingType
  labelKey: string
  defaultLabel: string
}> = [
  {
    value: 'hold',
    labelKey: 'timeline.keyframeEditor.easing.hold',
    defaultLabel: 'Hold',
  },
  {
    value: 'linear',
    labelKey: 'timeline.keyframeEditor.easing.linear',
    defaultLabel: 'Linear',
  },
  {
    value: 'ease-in',
    labelKey: 'timeline.keyframeEditor.easing.easeIn',
    defaultLabel: 'Ease In',
  },
  {
    value: 'ease-in-out',
    labelKey: 'timeline.keyframeEditor.easing.easeInOut',
    defaultLabel: 'Ease In/Out',
  },
  {
    value: 'ease-out',
    labelKey: 'timeline.keyframeEditor.easing.easeOut',
    defaultLabel: 'Ease Out',
  },
]

/**
 * Panel showing the keyframe value graph editor.
 * Displays graph for the first selected item that has keyframes.
 * Automatically uses full width of container.
 */
export const KeyframeGraphPanel = memo(function KeyframeGraphPanel({
  isOpen,
  onClose,
  placement = 'bottom',
  showCloseButton = true,
  splitView = false,
  isFocusMode = false,
  onFocusModeChange,
  surface = 'default',
  initialVisibleGroupIds,
  propertyColumnWidth,
  timelineScrollContainerRef,
}: KeyframeGraphPanelProps) {
  perfMarkRender('KeyframeGraphPanel')
  const { t } = useTranslation()
  const easingOptions = useMemo(
    () =>
      EASING_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey, { defaultValue: option.defaultLabel }),
      })),
    [t],
  )
  const hotkeys = useResolvedHotkeys()
  const {
    containerRef,
    panelRef,
    containerWidth,
    clampedContentHeight,
    parentHeight,
    panelHeaderHeight,
    isResizing,
    handleResizeStart,
  } = useKeyframeGraphPanelChrome({ isOpen, placement, surface })

  const valueScrubCreatedKeyframesRef = useRef(new Map<AnimatableProperty, string>())
  const promotedVectorDragIdsRef = useRef(new Map<string, string>())
  const keyframeEditorScrubbingRef = useRef(false)
  const [isPointerWithinEditor, setIsPointerWithinEditor] = useState(false)
  const [isFocusWithinEditor, setIsFocusWithinEditor] = useState(false)

  // Use _updateKeyframe directly (no undo per call) for dragging
  const _updateKeyframe = useKeyframesStore((s) => s._updateKeyframe)
  const _addKeyframe = useKeyframesStore((s) => s._addKeyframe)
  const _removeKeyframesForProperty = useKeyframesStore((s) => s._removeKeyframesForProperty)
  const setKeyframeEditorShortcutScopeActive = useEditorStore(
    (s) => s.setKeyframeEditorShortcutScopeActive,
  )

  // Keyframe selection
  const selectKeyframe = useKeyframeSelectionStore((s) => s.selectKeyframe)
  const selectKeyframes = useKeyframeSelectionStore((s) => s.selectKeyframes)
  const clearKeyframeSelection = useKeyframeSelectionStore((s) => s.clearSelection)
  const keyframeClipboard = useKeyframeSelectionStore((s) => s.clipboard)
  const isKeyframeClipboardCut = useKeyframeSelectionStore((s) => s.isCut)
  const copySelectedKeyframes = useKeyframeSelectionStore((s) => s.copySelectedKeyframes)
  const cutSelectedKeyframes = useKeyframeSelectionStore((s) => s.cutSelectedKeyframes)
  const clearKeyframeClipboard = useKeyframeSelectionStore((s) => s.clearClipboard)

  // View-mode + canvas state, and the derived selection/keyframes model. Both
  // are called before every hook that consumes their values.
  const {
    canvas,
    selectedProperty,
    setSelectedProperty,
    setEditorMode,
    vectorGraphMode,
    setVectorGraphMode,
    effectiveEditorMode,
  } = useKeyframeGraphPanelViewState({ surface, splitView })

  const {
    selectedItemForEditor,
    selectedItemKeyframes,
    allItemsById,
    maxItemEndFrame,
    allKeyframesByItemId,
    selectedKeyframes,
    currentFrame,
    allAvailableProperties,
    availableProperties,
    effectiveSelectedProperty,
    keyframesByProperty,
    trimmedKeyframeCount,
    handleTrimAnimation,
    selectedKeyframeIds,
    selectedEditorKeyframes,
    selectedEditorEasing,
    relativeFrame,
    transitionBlockedRanges,
    vectorBaseTransform,
    vectorResolvedTransform,
    vectorPreExpressionTransform,
    positionDimensionsSeparated,
    vectorControlRows,
    scaleAxesConstrained,
    getNextVectorAxisValue,
    proceduralPreview,
    canBakeProceduralMotion,
  } = useKeyframeGraphPanelModel({
    surface,
    canvas,
    selectedProperty,
    t,
    keyframeEditorScrubbingRef,
  })

  const {
    drag: propertyLinkDrag,
    begin: beginPropertyLinkDrag,
    remove: removePropertyLink,
  } = usePropertyLinkPickWhip()
  const propertyLinkSourceLabels = useMemo(
    () =>
      Object.fromEntries(
        getDirectPropertyLinks(selectedItemKeyframes ?? undefined).map((link) => {
          const source = allItemsById[link.sourceItemId]
          const sourceLabel = source?.label || source?.type || link.sourceItemId
          return [link.targetProperty, `${sourceLabel} -> ${link.sourceProperty}`]
        }),
      ) as Partial<Record<DirectLinkableProperty, string>>,
    [allItemsById, selectedItemKeyframes],
  )
  const handlePropertyLinkPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, property: DirectLinkableProperty) => {
      if (!selectedItemForEditor) return
      beginPropertyLinkDrag(event, selectedItemForEditor.id, property)
    },
    [beginPropertyLinkDrag, selectedItemForEditor],
  )
  const handleRemovePropertyLink = useCallback(
    (property: DirectLinkableProperty) => {
      if (!selectedItemForEditor) return
      removePropertyLink(selectedItemForEditor.id, property)
    },
    [removePropertyLink, selectedItemForEditor],
  )

  useEffect(() => {
    if (!isOpen) {
      setIsPointerWithinEditor(false)
      setIsFocusWithinEditor(false)
      setKeyframeEditorShortcutScopeActive(false)
      return
    }

    setKeyframeEditorShortcutScopeActive(isPointerWithinEditor || isFocusWithinEditor)
  }, [isFocusWithinEditor, isOpen, isPointerWithinEditor, setKeyframeEditorShortcutScopeActive])

  useEffect(
    () => () => {
      setKeyframeEditorShortcutScopeActive(false)
    },
    [setKeyframeEditorShortcutScopeActive],
  )

  const {
    editTimelineViewportWidth,
    editTimelineFps,
    editTimelineScrollLeft,
    editTimelinePixelsPerSecond,
    editTimelineFrameViewport,
    editTimelineGlobalFrameToPixels,
    getEditTimelineLivePixelsPerSecond,
    handleEditTimelineEdgeScroll,
  } = useEditTimelineKeyframeGeometry({
    timelineScrollContainerRef,
    surface,
    isOpen,
    maxItemEndFrame,
    selectedItemForEditor,
  })

  const {
    editTextMotionBands,
    handleTextMotionDurationDragStart,
    handleTextMotionDurationCommit,
    handleTextMotionDurationCancel,
    handleTextMotionOffsetDragStart,
    handleTextMotionOffsetCommit,
    handleTextMotionOffsetCancel,
    handleTextMotionBandClick,
  } = useKeyframeGraphTextMotion({ selectedItemForEditor, surface })

  const [bakeDialogOpen, setBakeDialogOpen] = useState(false)

  const handleBakeProceduralMotion = useCallback(() => {
    if (!selectedItemForEditor) return
    const plan = buildBakeMotionPlan({
      items: [selectedItemForEditor],
      keyframesByItemId: useKeyframesStore.getState().keyframesByItemId,
      fps: canvas.fps,
      frameWidth: canvas.width,
      frameHeight: canvas.height,
      resolveBase: (item) => resolveTransform(item, canvas, getSourceDimensions(item)),
    })
    if (plan.length === 0) return
    const baked = bakeMotionToKeyframes(plan)
    setBakeDialogOpen(false)
    toast.success(t('timeline.keyframeEditor.motionBaked', { count: baked }))
  }, [selectedItemForEditor, canvas, t])

  const {
    isVectorFrameBlocked,
    promoteVectorProperty,
    ensureVectorKeyframeForLiveEdit,
    applyVectorKeyframeUpdates,
    handleVectorValueCommit,
    compoundPropertyRows,
    hiddenVectorPropertyRows,
    compoundSecondaryProperties,
    dimensionSeparationByProperty,
    classicAxisConstraints,
    activeVectorRow,
    vectorSpeedGraphContent,
  } = useVectorKeyframeEditing({
    selectedItemForEditor,
    selectedItemKeyframes,
    keyframesByProperty,
    vectorBaseTransform,
    relativeFrame,
    transitionBlockedRanges,
    canvas,
    t,
    surface,
    vectorControlRows,
    effectiveSelectedProperty,
    selectedKeyframeIds,
    positionDimensionsSeparated,
    scaleAxesConstrained,
    getNextVectorAxisValue,
    promotedVectorDragIdsRef,
    selectKeyframe,
    selectKeyframes,
    clearKeyframeSelection,
    vectorGraphMode,
    setVectorGraphMode,
  })

  const {
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
    handleKeyframeMove,
    handleKeyframesMove,
    handleBezierHandleMove,
    handleSegmentEasingChange,
    handleSelectionChange,
    handlePropertyChange,
    handleCopyKeyframes,
    handleCutKeyframes,
    handleSelectedKeyframeEasingChange,
    handlePasteKeyframes,
    handleRemoveKeyframes,
    handleNavigateToKeyframe,
  } = useKeyframeDragCommands({
    selectedItemForEditor,
    selectedItemKeyframes,
    selectedEditorKeyframes,
    keyframesByProperty,
    allAvailableProperties,
    availableProperties,
    transitionBlockedRanges,
    vectorBaseTransform,
    relativeFrame,
    canvas,
    allItemsById,
    allKeyframesByItemId,
    keyframeClipboard,
    isKeyframeClipboardCut,
    t,
    _updateKeyframe,
    ensureVectorKeyframeForLiveEdit,
    applyVectorKeyframeUpdates,
    selectKeyframe,
    selectKeyframes,
    clearKeyframeSelection,
    copySelectedKeyframes,
    cutSelectedKeyframes,
    clearKeyframeClipboard,
    setSelectedProperty,
    promotedVectorDragIdsRef,
    valueScrubCreatedKeyframesRef,
  })

  // The view-mode toggle is always visible now, so the hotkeys map to it in
  // every context (including the Animate workspace's split-capable toggle).
  useHotkeys(
    hotkeys.KEYFRAME_EDITOR_GRAPH,
    (event) => {
      event.preventDefault()
      setEditorMode('graph')
    },
    {
      ...HOTKEY_OPTIONS,
      enabled: isOpen && (isPointerWithinEditor || isFocusWithinEditor),
    },
    [isFocusWithinEditor, isOpen, isPointerWithinEditor],
  )

  useHotkeys(
    hotkeys.KEYFRAME_EDITOR_DOPESHEET,
    (event) => {
      event.preventDefault()
      setEditorMode('dopesheet')
    },
    {
      ...HOTKEY_OPTIONS,
      enabled: isOpen && (isPointerWithinEditor || isFocusWithinEditor),
    },
    [isFocusWithinEditor, isOpen, isPointerWithinEditor],
  )

  useHotkeys(
    hotkeys.KEYFRAME_EDITOR_SPLIT,
    (event) => {
      event.preventDefault()
      setEditorMode('split')
    },
    {
      ...HOTKEY_OPTIONS,
      enabled: isOpen && splitView && (isPointerWithinEditor || isFocusWithinEditor),
    },
    [isFocusWithinEditor, isOpen, isPointerWithinEditor, splitView],
  )

  useHotkeys(
    hotkeys.COPY,
    (event) => {
      event.preventDefault()
      handleCopyKeyframes()
    },
    {
      ...HOTKEY_OPTIONS,
      enabled: isOpen && selectedEditorKeyframes.length > 0,
    },
    [handleCopyKeyframes, isOpen, selectedEditorKeyframes.length],
  )

  useHotkeys(
    hotkeys.CUT,
    (event) => {
      event.preventDefault()
      handleCutKeyframes()
    },
    {
      ...HOTKEY_OPTIONS,
      enabled: isOpen && selectedEditorKeyframes.length > 0,
    },
    [handleCutKeyframes, isOpen, selectedEditorKeyframes.length],
  )

  useHotkeys(
    hotkeys.PASTE,
    (event) => {
      event.preventDefault()
      handlePasteKeyframes()
    },
    {
      ...HOTKEY_OPTIONS,
      enabled: isOpen && !!selectedItemForEditor && !!keyframeClipboard,
    },
    [handlePasteKeyframes, isOpen, keyframeClipboard, selectedItemForEditor],
  )

  const {
    handleScrub,
    handleSkim,
    handleScrubStart,
    handleScrubEnd,
    handleAddKeyframe,
    handleDuplicateKeyframes,
  } = useKeyframeScrubAdd({
    selectedItemForEditor,
    selectedItemKeyframes,
    keyframesByProperty,
    vectorBaseTransform,
    canvas,
    allItemsById,
    allKeyframesByItemId,
    t,
    isVectorFrameBlocked,
    promoteVectorProperty,
    selectKeyframes,
    keyframeEditorScrubbingRef,
  })

  const {
    propertyValues,
    preExpressionPropertyValues,
    resolveExpressionReference,
    handleSetPropertyExpression,
    handleRemovePropertyExpression,
    handlePropertyValueCommit,
    handlePropertyValuePreview,
    handleResetPropertiesToDefault,
  } = useKeyframePropertyValues({
    selectedItemForEditor,
    selectedItemKeyframes,
    selectedEditorKeyframes,
    keyframesByProperty,
    availableProperties,
    vectorControlRows,
    vectorResolvedTransform,
    vectorPreExpressionTransform,
    vectorBaseTransform,
    relativeFrame,
    currentFrame,
    canvas,
    surface,
    allItemsById,
    allKeyframesByItemId,
    selectedKeyframes,
    isVectorFrameBlocked,
    ensureVectorKeyframeForLiveEdit,
    getNextVectorAxisValue,
    handleVectorValueCommit,
    selectKeyframe,
    selectKeyframes,
    _updateKeyframe,
    _addKeyframe,
    _removeKeyframesForProperty,
    valueScrubCreatedKeyframesRef,
  })

  const isSidePlacement = placement === 'side'

  const sideContentHeight = Math.max(
    MIN_CONTENT_HEIGHT,
    parentHeight > 0 ? parentHeight - panelHeaderHeight : MIN_CONTENT_HEIGHT,
  )
  const resolvedContentHeight = isSidePlacement ? sideContentHeight : clampedContentHeight

  // Calculate total panel height for proper flex sizing
  // When closed, show just the header; when open, show header + resize handle + content
  const panelHeight = isOpen
    ? panelHeaderHeight + RESIZE_HANDLE_HEIGHT + clampedContentHeight
    : panelHeaderHeight

  // Only render the docked editor when explicitly opened from the toolbar/hotkey.
  // Selecting a clip should not surface the docked panel by itself.
  if (!isOpen) {
    return null
  }

  const resizeHandle = (
    <div
      data-resize-handle
      className={cn(
        'h-1.5 cursor-ns-resize flex items-center justify-center',
        'bg-secondary/30 hover:bg-primary/30 transition-colors',
        isResizing && 'bg-primary/50',
      )}
      onMouseDown={handleResizeStart}
    >
      <div className="w-8 h-0.5 rounded-full bg-muted-foreground/30" />
    </div>
  )

  // The editor only renders for a selected item once the container has a
  // measured width; the props it is passed are built under the same guard.
  const dopesheetEditorProps =
    selectedItemForEditor && containerWidth > 0
      ? buildDopesheetEditorProps({
          surface,
          selectedItemForEditor,
          containerWidth,
          resolvedContentHeight,
          maxItemEndFrame,
          canvas,
          currentFrame,
          relativeFrame,
          effectiveEditorMode,
          effectiveSelectedProperty,
          keyframesByProperty,
          selectedItemKeyframes,
          propertyValues,
          preExpressionPropertyValues,
          selectedKeyframeIds,
          selectedEditorKeyframes,
          selectedEditorEasing,
          easingOptions,
          trimmedKeyframeCount,
          transitionBlockedRanges,
          proceduralPreview,
          canBakeProceduralMotion,
          propertyLinkSourceLabels,
          handlePropertyLinkPointerDown,
          handleRemovePropertyLink,
          resolveExpressionReference,
          handleSetPropertyExpression,
          handleRemovePropertyExpression,
          hiddenVectorPropertyRows,
          compoundPropertyRows,
          compoundSecondaryProperties,
          dimensionSeparationByProperty,
          classicAxisConstraints,
          activeVectorRow,
          vectorGraphMode,
          setVectorGraphMode,
          vectorSpeedGraphContent,
          editTextMotionBands,
          handleTextMotionDurationDragStart,
          handleTextMotionDurationCommit,
          handleTextMotionDurationCancel,
          handleTextMotionOffsetDragStart,
          handleTextMotionOffsetCommit,
          handleTextMotionOffsetCancel,
          handleTextMotionBandClick,
          editTimelineFps,
          editTimelineFrameViewport,
          editTimelineGlobalFrameToPixels,
          editTimelineScrollLeft,
          editTimelinePixelsPerSecond,
          editTimelineViewportWidth,
          getEditTimelineLivePixelsPerSecond,
          handleEditTimelineEdgeScroll,
          timelineScrollContainerRef,
          handleTrimAnimation,
          handleKeyframeMove,
          handleKeyframesMove,
          handleBezierHandleMove,
          handleSegmentEasingChange,
          handleSelectionChange,
          handlePropertyChange,
          setSelectedProperty,
          handleScrub,
          handleSkim,
          handleScrubStart,
          handleScrubEnd,
          handleDragStart,
          handleDragEnd,
          handleDragCancel,
          handleAddKeyframe,
          handleDuplicateKeyframes,
          handlePropertyValueCommit,
          handlePropertyValuePreview,
          handleResetPropertiesToDefault,
          handleRemoveKeyframes,
          handleCopyKeyframes,
          handleCutKeyframes,
          handlePasteKeyframes,
          handleSelectedKeyframeEasingChange,
          handleNavigateToKeyframe,
          keyframeClipboard,
          isKeyframeClipboardCut,
          setBakeDialogOpen,
          splitView,
          initialVisibleGroupIds,
          propertyColumnWidth,
          isPointerWithinEditor,
          isFocusWithinEditor,
          hotkeys,
        })
      : null
  return (
    <div
      ref={panelRef}
      data-pick-whip-scroll-area
      tabIndex={-1}
      onPointerEnter={(event) => {
        setIsPointerWithinEditor(true)
        const target = event.currentTarget
        if (!target.contains(document.activeElement)) {
          target.focus({ preventScroll: true })
        }
      }}
      onPointerLeave={() => setIsPointerWithinEditor(false)}
      onFocusCapture={() => setIsFocusWithinEditor(true)}
      onBlurCapture={(event) => {
        const nextFocused = event.relatedTarget as Node | null
        if (event.currentTarget.contains(nextFocused)) {
          return
        }
        setIsFocusWithinEditor(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Delete' || event.key === 'Backspace') {
          if (selectedEditorKeyframes.length > 0) {
            event.preventDefault()
            event.stopPropagation()
            handleRemoveKeyframes(selectedEditorKeyframes.map(({ ref }) => ref))
          }
        }
      }}
      className={cn(
        'flex-shrink-0 bg-background overflow-hidden outline-none',
        isSidePlacement
          ? 'flex h-full min-h-0 flex-col border-0'
          : placement === 'top'
            ? 'border-b border-border'
            : 'border-t border-border',
        isOpen ? 'opacity-100' : 'opacity-90',
        !isSidePlacement && !isResizing && 'transition-all duration-200',
      )}
      style={isSidePlacement ? undefined : { height: panelHeight }}
    >
      {placement === 'bottom' && resizeHandle}

      <KeyframeGraphPanelHeader
        surface={surface}
        selectedItemForEditor={selectedItemForEditor}
        effectiveEditorMode={effectiveEditorMode}
        splitView={splitView}
        setEditorMode={setEditorMode}
        isFocusMode={isFocusMode}
        onFocusModeChange={onFocusModeChange}
        showCloseButton={showCloseButton}
        onClose={onClose}
      />

      {/* Keyframe editor content */}
      {isOpen && (
        <div
          ref={containerRef}
          className={cn('min-h-0', surface === 'edit' ? 'p-0' : 'p-2', isSidePlacement && 'flex-1')}
          style={isSidePlacement ? undefined : { height: clampedContentHeight }}
        >
          {dopesheetEditorProps ? (
            <>
              <ErrorBoundary level="component">
                <DopesheetEditor {...dopesheetEditorProps} />
              </ErrorBoundary>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              {selectedItemForEditor
                ? t('common.loading')
                : t('timeline.keyframeEditor.selectItem')}
            </div>
          )}
        </div>
      )}

      {placement === 'top' && resizeHandle}
      {propertyLinkDrag ? <PropertyLinkPickWhipOverlay drag={propertyLinkDrag} /> : null}
      <MotionBakeConfirmationDialog
        open={bakeDialogOpen}
        onOpenChange={setBakeDialogOpen}
        onConfirm={handleBakeProceduralMotion}
      />
    </div>
  )
})
