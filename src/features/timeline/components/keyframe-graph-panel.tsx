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
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/shared/ui/cn'
import { MotionBakeConfirmationDialog } from '@/shared/ui/motion-bake-confirmation-dialog'
import { hasEnabledProceduralMotion } from '@/shared/timeline/procedural-motion'
import { ErrorBoundary } from '@/components/error-boundary'
import {
  getAnimatablePropertyBaseValue,
  getTransitionBlockedRanges,
  interpolatePropertyValue,
  buildEasingConfig,
  buildVectorPromotionPlan,
  countTrimmedKeyframes,
  resolveAnimatedTransform,
  resolveExpressionReferenceValue,
} from '@/features/timeline/deps/keyframes'
import {
  DopesheetEditor,
  PropertyLinkPickWhipOverlay,
  getAnimatablePropertiesForItem,
  buildBakeMotionPlan,
  type ProceduralPreviewInput,
} from '@/features/timeline/deps/keyframe-editors'
import { usePropertyLinkPickWhip } from '@/features/timeline/hooks/use-property-link-pick-whip'
import { bakeMotionToKeyframes } from '../stores/actions/motion-modifier-actions'
import { resolveTransform, getSourceDimensions } from '@/features/timeline/deps/composition-runtime'
import { useProjectStore } from '@/features/timeline/deps/projects'
import {
  DEFAULT_PROJECT_FPS,
  DEFAULT_PROJECT_HEIGHT,
  DEFAULT_PROJECT_WIDTH,
} from '@/shared/projects/defaults'
import { useSelectionStore } from '@/shared/state/selection'
import { useItemsStore } from '../stores/items-store'
import { useKeyframesStore } from '../stores/keyframes-store'
import { useTransitionsStore } from '../stores/transitions-store'
import { useKeyframeSelectionStore } from '../stores/keyframe-selection-store'
import { useTimelineCommandStore } from '../stores/timeline-command-store'
import { captureSnapshot, restoreSnapshot, snapshotsEqual } from '../stores/commands/snapshot'
import type { TimelineSnapshot } from '../stores/commands/types'
import { usePlaybackStore } from '@/shared/state/playback'
import { useEditorStore } from '@/shared/state/editor'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { perfMarkRender } from '@/shared/logging/perf-marks'
import { useKeyframeEditorPlaybackFrame } from './use-keyframe-editor-playback-frame'
import {
  MIN_CONTENT_HEIGHT,
  RESIZE_HANDLE_HEIGHT,
  useKeyframeGraphPanelChrome,
} from './use-keyframe-graph-panel-chrome'
import { useEditTimelineKeyframeGeometry } from './use-edit-timeline-keyframe-geometry'
import { useKeyframeGraphTextMotion } from './use-keyframe-graph-text-motion'
import { useVectorKeyframeEditing } from './use-vector-keyframe-editing'
import type {
  AnimatableProperty,
  BezierControlPoints,
  EasingConfig,
  EasingType,
  Keyframe,
  KeyframeRef,
  DirectLinkableProperty,
  VectorAnimatableProperty,
} from '@/types/keyframe'
import type { CanvasSettings } from '@/types/transform'
import * as timelineActions from '../stores/timeline-actions'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import { useResolvedHotkeys } from '@/features/timeline/deps/settings'
import {
  getEditorVectorKeyframeId,
  toVectorScalePercent,
} from '@/features/timeline/deps/keyframes-contract'
import { getDirectPropertyLinks, isTransformAnimatableProperty } from '@/types/keyframe'
import { buildEffectPropertyResetPlan } from '@/features/timeline/utils/effect-property-reset'
import { shouldShowSeparatedPosition } from './edit-keyframe-panel-model'
import {
  applyKeyframeMoveEntry,
  buildCurrentPropertyValues,
  buildEditorKeyframesByProperty,
  buildKeyframePastePlan,
  buildPasteSkipReasons,
  buildVectorControlRows,
  clampFrameToBlockedRanges,
  commitScalarPropertyValue,
  duplicateVectorKeyframeEntry,
  filterVectorControlRows,
  getBezierEditorEasing,
  getEditableVectorProxy,
  pasteVectorKeyframePayload,
  promoteAndRemoveLegacyVectorRef,
  promoteLegacyVectorEntryForMove,
  removeStoredVectorRef,
  supportsVectorTransform,
  type KeyframeEditorSurface,
  type KeyframeMoveEntry,
  type PendingVectorMove,
  type VectorEditorRow,
} from './keyframe-graph-panel-model'

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

export type KeyframeEditorMode = 'graph' | 'dopesheet' | 'split'
const KEYFRAME_EDITOR_MODE_STORAGE_KEY = 'timeline:keyframeEditorMode'
const MOTION_INLINE_PROPERTY_GROUP_IDS = ['transform'] as const
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

function loadKeyframeEditorMode(): KeyframeEditorMode {
  try {
    const value = localStorage.getItem(KEYFRAME_EDITOR_MODE_STORAGE_KEY)
    if (value === 'graph' || value === 'dopesheet' || value === 'split') {
      return value
    }
  } catch {
    // ignore localStorage read errors
  }
  // Default to the stacked split (dopesheet on top, value graph on bottom) for
  // split-capable surfaces; non-split placements fall back to dopesheet via
  // `effectiveEditorMode`.
  return 'split'
}

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

  // Selected items
  const selectedItemIds = useSelectionStore((s) => s.selectedItemIds)

  const selectedItemForEditor = useItemsStore(
    useCallback(
      (s) => {
        for (const itemId of selectedItemIds) {
          const item = s.itemById[itemId]
          if (item) {
            return item
          }
        }

        return null
      },
      [selectedItemIds],
    ),
  )
  const selectedItemKeyframes = useKeyframesStore(
    useCallback(
      (s) =>
        selectedItemForEditor ? (s.keyframesByItemId[selectedItemForEditor.id] ?? null) : null,
      [selectedItemForEditor],
    ),
  )
  const allItemsById = useItemsStore((s) => s.itemById)
  const maxItemEndFrame = useItemsStore((s) => s.maxItemEndFrame)
  const allKeyframesByItemId = useKeyframesStore((s) => s.keyframesByItemId)
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
  const selectedItemTransitions = useTransitionsStore(
    useShallow(
      useCallback(
        (s) => {
          if (!selectedItemForEditor) return []

          return s.transitions.filter(
            (transition) =>
              transition.leftClipId === selectedItemForEditor.id ||
              transition.rightClipId === selectedItemForEditor.id,
          )
        },
        [selectedItemForEditor],
      ),
    ),
  )

  // Use _updateKeyframe directly (no undo per call) for dragging
  const _updateKeyframe = useKeyframesStore((s) => s._updateKeyframe)
  const _addKeyframe = useKeyframesStore((s) => s._addKeyframe)
  const _removeKeyframesForProperty = useKeyframesStore((s) => s._removeKeyframesForProperty)
  const currentProject = useProjectStore((s) => s.currentProject)
  const setKeyframeEditorShortcutScopeActive = useEditorStore(
    (s) => s.setKeyframeEditorShortcutScopeActive,
  )

  // Ref to store snapshot captured on drag start for undo batching
  const dragSnapshotRef = useRef<TimelineSnapshot | null>(null)
  const dragSelectionSnapshotRef = useRef<KeyframeRef[] | null>(null)
  const valueScrubCreatedKeyframesRef = useRef(new Map<AnimatableProperty, string>())
  const promotedVectorDragIdsRef = useRef(new Map<string, string>())
  const [isPointerWithinEditor, setIsPointerWithinEditor] = useState(false)
  const [isFocusWithinEditor, setIsFocusWithinEditor] = useState(false)

  // Keyframe selection
  const selectedKeyframes = useKeyframeSelectionStore((s) => s.selectedKeyframes)
  const selectKeyframe = useKeyframeSelectionStore((s) => s.selectKeyframe)
  const selectKeyframes = useKeyframeSelectionStore((s) => s.selectKeyframes)
  const clearKeyframeSelection = useKeyframeSelectionStore((s) => s.clearSelection)
  const keyframeClipboard = useKeyframeSelectionStore((s) => s.clipboard)
  const isKeyframeClipboardCut = useKeyframeSelectionStore((s) => s.isCut)
  const copySelectedKeyframes = useKeyframeSelectionStore((s) => s.copySelectedKeyframes)
  const cutSelectedKeyframes = useKeyframeSelectionStore((s) => s.cutSelectedKeyframes)
  const clearKeyframeClipboard = useKeyframeSelectionStore((s) => s.clearClipboard)

  const keyframeEditorScrubbingRef = useRef(false)
  const currentFrame = useKeyframeEditorPlaybackFrame(
    selectedItemForEditor?.id ?? null,
    keyframeEditorScrubbingRef,
  )

  // Track selected property for graph editor
  const [selectedProperty, setSelectedProperty] = useState<AnimatableProperty | null>(null)
  const [editorMode, setEditorMode] = useState<KeyframeEditorMode>(() => loadKeyframeEditorMode())
  const [vectorGraphMode, setVectorGraphMode] = useState<'value' | 'speed'>('value')

  useEffect(() => {
    try {
      localStorage.setItem(KEYFRAME_EDITOR_MODE_STORAGE_KEY, editorMode)
    } catch {
      // ignore localStorage write errors
    }
  }, [editorMode])

  // "split" is only offered in the Animate workspace (`splitView`); the docked
  // panel is too short to stack both panes, so a persisted "split" falls back
  // to the dopesheet there.
  const effectiveEditorMode: KeyframeEditorMode =
    surface === 'motion'
      ? 'graph'
      : surface === 'edit'
        ? 'dopesheet'
        : !splitView && editorMode === 'split'
          ? 'dopesheet'
          : editorMode

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

  const canvas = useMemo<CanvasSettings>(
    () => ({
      width: currentProject?.metadata.width ?? DEFAULT_PROJECT_WIDTH,
      height: currentProject?.metadata.height ?? DEFAULT_PROJECT_HEIGHT,
      fps: currentProject?.metadata.fps ?? DEFAULT_PROJECT_FPS,
    }),
    [currentProject],
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
  const allAvailableProperties = useMemo(() => {
    if (!selectedItemForEditor) return []
    return getAnimatablePropertiesForItem(selectedItemForEditor)
  }, [selectedItemForEditor])
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
  const availableProperties = useMemo(
    () =>
      surface !== 'edit' && supportsVectorTransform(selectedItemForEditor)
        ? allAvailableProperties.filter((property) => property !== 'y' && property !== 'height')
        : allAvailableProperties,
    [allAvailableProperties, selectedItemForEditor, surface],
  )

  // Inputs for the dopesheet/graph to draw procedural generators (dashed ghost
  // curves) before they're baked — base transform + active modifiers + canvas.
  const proceduralPreview = useMemo<ProceduralPreviewInput | undefined>(() => {
    if (!selectedItemForEditor) return undefined
    const modifiers =
      selectedItemForEditor.motionModifiers?.filter(
        (modifier) => modifier.enabled && modifier.amplitude > 0,
      ) ?? []
    const layers = selectedItemForEditor.motionLayers?.filter((layer) => layer.enabled) ?? []
    if (modifiers.length === 0 && layers.length === 0) return undefined
    return {
      base: resolveTransform(
        selectedItemForEditor,
        canvas,
        getSourceDimensions(selectedItemForEditor),
      ),
      keyframes: allKeyframesByItemId[selectedItemForEditor.id],
      modifiers,
      layers,
      frameWidth: canvas.width,
      frameHeight: canvas.height,
    }
  }, [selectedItemForEditor, canvas, allKeyframesByItemId])

  // The edited clip can be baked when it carries any procedural motion.
  const canBakeProceduralMotion =
    !!selectedItemForEditor && hasEnabledProceduralMotion(selectedItemForEditor)
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
  const effectiveSelectedProperty = useMemo(() => {
    if (surface === 'edit') {
      return selectedProperty && availableProperties.includes(selectedProperty)
        ? selectedProperty
        : null
    }
    const compoundPrimary =
      selectedProperty === 'y'
        ? 'x'
        : selectedProperty === 'height'
          ? 'width'
          : selectedProperty === 'anchorY'
            ? 'anchorX'
            : selectedProperty
    return compoundPrimary && availableProperties.includes(compoundPrimary) ? compoundPrimary : null
  }, [availableProperties, selectedProperty, surface])

  // Build keyframes by property for the graph editor
  const keyframesByProperty = useMemo(
    () =>
      buildEditorKeyframesByProperty({
        properties: allAvailableProperties,
        item: selectedItemForEditor,
        itemKeyframes: selectedItemKeyframes,
        canvas,
        trimToItemBounds: surface === 'edit',
      }),
    [allAvailableProperties, canvas, selectedItemForEditor, selectedItemKeyframes, surface],
  )

  const trimmedKeyframeCount = useMemo(
    () =>
      selectedItemForEditor
        ? countTrimmedKeyframes(selectedItemKeyframes, selectedItemForEditor.durationInFrames)
        : 0,
    [selectedItemForEditor, selectedItemKeyframes],
  )

  const handleTrimAnimation = useCallback(() => {
    if (!selectedItemForEditor) return
    const itemId = selectedItemForEditor.id
    const removedCount = timelineActions.trimAnimationToItemBounds(itemId)
    if (removedCount === 0) return
    toast.success(
      t('timeline.keyframeEditor.trimAnimationToast', {
        count: removedCount,
      }),
      {
        action: {
          label: t('timeline.header.undo'),
          onClick: () => {
            const commandStore = useTimelineCommandStore.getState()
            const latest = commandStore.undoStack.at(-1)
            if (
              latest?.command.type === 'TRIM_ANIMATION_TO_BOUNDS' &&
              latest.command.payload?.itemId === itemId
            ) {
              commandStore.undo()
            }
          },
        },
      },
    )
  }, [selectedItemForEditor, t])

  // Selected keyframe IDs for the current item
  const selectedKeyframeIds = useMemo(() => {
    if (!selectedItemForEditor) return new Set<string>()

    const ids = new Set<string>()
    for (const ref of selectedKeyframes) {
      if (ref.itemId === selectedItemForEditor.id) {
        ids.add(ref.keyframeId)
      }
    }
    return ids
  }, [selectedKeyframes, selectedItemForEditor])

  const selectedEditorKeyframes = useMemo(() => {
    if (!selectedItemForEditor) return []

    const entries: Array<{ ref: KeyframeRef; keyframe: Keyframe }> = []
    for (const ref of selectedKeyframes) {
      if (ref.itemId !== selectedItemForEditor.id) continue

      const keyframe = keyframesByProperty[ref.property]?.find(
        (candidate) => candidate.id === ref.keyframeId,
      )

      if (keyframe) {
        entries.push({ ref, keyframe })
      }
    }

    return entries
  }, [keyframesByProperty, selectedItemForEditor, selectedKeyframes])

  const selectedEditorEasing = useMemo(() => {
    if (selectedEditorKeyframes.length === 0) return undefined

    const firstEasing = selectedEditorKeyframes[0]?.keyframe.easing
    if (!firstEasing) return undefined

    return selectedEditorKeyframes.every(({ keyframe }) => keyframe.easing === firstEasing)
      ? firstEasing
      : undefined
  }, [selectedEditorKeyframes])

  // Calculate relative frame for the current item
  const relativeFrame = useMemo(() => {
    if (!selectedItemForEditor) return 0
    return Math.max(0, currentFrame - selectedItemForEditor.from)
  }, [currentFrame, selectedItemForEditor])

  // Calculate transition-blocked frame ranges for the selected item
  const transitionBlockedRanges = useMemo(() => {
    if (!selectedItemForEditor) return []
    return getTransitionBlockedRanges(
      selectedItemForEditor.id,
      selectedItemForEditor,
      selectedItemTransitions,
    )
  }, [selectedItemForEditor, selectedItemTransitions])

  const vectorBaseTransform = useMemo(() => {
    if (!supportsVectorTransform(selectedItemForEditor)) return null
    return resolveTransform(
      selectedItemForEditor,
      canvas,
      getSourceDimensions(selectedItemForEditor),
    )
  }, [canvas, selectedItemForEditor])

  const vectorResolvedTransform = useMemo(() => {
    if (!selectedItemForEditor || !vectorBaseTransform) return null
    return resolveAnimatedTransform(
      vectorBaseTransform,
      selectedItemKeyframes ?? undefined,
      relativeFrame,
      {
        globalFrame: currentFrame,
        canvas,
        getItem: (itemId) => allItemsById[itemId],
        getKeyframes: (itemId) => allKeyframesByItemId[itemId],
      },
    )
  }, [
    allItemsById,
    allKeyframesByItemId,
    canvas,
    currentFrame,
    relativeFrame,
    selectedItemForEditor,
    selectedItemKeyframes,
    vectorBaseTransform,
  ])
  const vectorPreExpressionTransform = useMemo(() => {
    if (!selectedItemForEditor || !vectorBaseTransform) return null
    const keyframesWithoutExpressions = selectedItemKeyframes
      ? {
          ...selectedItemKeyframes,
          propertyLinks: [...getDirectPropertyLinks(selectedItemKeyframes)],
          expressions: [],
        }
      : undefined
    return resolveAnimatedTransform(
      vectorBaseTransform,
      keyframesWithoutExpressions,
      relativeFrame,
      {
        globalFrame: currentFrame,
        canvas,
        getItem: (itemId) => allItemsById[itemId],
        getKeyframes: (itemId) => allKeyframesByItemId[itemId],
      },
    )
  }, [
    allItemsById,
    allKeyframesByItemId,
    canvas,
    currentFrame,
    relativeFrame,
    selectedItemForEditor,
    selectedItemKeyframes,
    vectorBaseTransform,
  ])
  const positionDimensionsSeparated = shouldShowSeparatedPosition(selectedItemKeyframes)

  const vectorControlRows = useMemo<VectorEditorRow[]>(() => {
    if (!vectorBaseTransform || !vectorResolvedTransform || !vectorPreExpressionTransform) return []
    return filterVectorControlRows(
      buildVectorControlRows({
        itemKeyframes: selectedItemKeyframes,
        base: vectorBaseTransform,
        resolved: vectorResolvedTransform,
        preExpression: vectorPreExpressionTransform,
        relativeFrame,
        t,
      }),
      selectedItemKeyframes,
      surface,
      positionDimensionsSeparated,
    )
  }, [
    positionDimensionsSeparated,
    relativeFrame,
    selectedItemKeyframes,
    surface,
    t,
    vectorBaseTransform,
    vectorPreExpressionTransform,
    vectorResolvedTransform,
  ])
  const scaleAxesConstrained = selectedItemForEditor?.transform?.aspectRatioLocked !== false
  const getNextVectorAxisValue = useCallback(
    (
      property: VectorAnimatableProperty,
      currentValue: { x: number; y: number },
      axis: 'x' | 'y',
      value: number,
    ) => {
      const nextValue = { ...currentValue, [axis]: value }
      if (property !== 'scale' || !scaleAxesConstrained) return nextValue

      const otherAxis = axis === 'x' ? 'y' : 'x'
      const ratio = Math.abs(currentValue[axis]) <= Number.EPSILON ? 1 : value / currentValue[axis]
      nextValue[otherAxis] = currentValue[otherAxis] * ratio
      return nextValue
    },
    [scaleAxesConstrained],
  )

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

  // Handle drag start - capture snapshot for undo batching
  const handleDragStart = useCallback(() => {
    valueScrubCreatedKeyframesRef.current.clear()
    promotedVectorDragIdsRef.current.clear()
    dragSnapshotRef.current = captureSnapshot()
    dragSelectionSnapshotRef.current = [...useKeyframeSelectionStore.getState().selectedKeyframes]
  }, [])

  // Handle drag end - commit undo entry with pre-captured snapshot
  const handleDragEnd = useCallback(() => {
    const beforeSnapshot = dragSnapshotRef.current
    if (beforeSnapshot) {
      if (!snapshotsEqual(beforeSnapshot, captureSnapshot())) {
        useTimelineCommandStore
          .getState()
          .addUndoEntry({ type: 'MOVE_KEYFRAME_GRAPH', payload: {} }, beforeSnapshot)
        useTimelineSettingsStore.getState().markDirty()
      }
      dragSnapshotRef.current = null
      valueScrubCreatedKeyframesRef.current.clear()
      promotedVectorDragIdsRef.current.clear()
    }
    dragSelectionSnapshotRef.current = null
  }, [])

  // Pointer cancellation is not a commit: restore the exact pre-drag data and
  // ephemeral keyframe selection without adding an undo entry.
  const handleDragCancel = useCallback(() => {
    const beforeSnapshot = dragSnapshotRef.current
    const beforeSelection = dragSelectionSnapshotRef.current
    if (beforeSnapshot) restoreSnapshot(beforeSnapshot)
    if (beforeSelection) selectKeyframes(beforeSelection)
    dragSnapshotRef.current = null
    dragSelectionSnapshotRef.current = null
    valueScrubCreatedKeyframesRef.current.clear()
    promotedVectorDragIdsRef.current.clear()
  }, [selectKeyframes])

  // Handle keyframe move in graph editor (no undo per call - batched via drag start/end)
  const handleKeyframeMove = useCallback(
    (ref: KeyframeRef, newFrame: number, newValue: number) => {
      const vector = ensureVectorKeyframeForLiveEdit(ref)
      if (vector) {
        const clampedFrame = clampFrameToBlockedRanges(
          Math.max(0, Math.round(newFrame)),
          vector.keyframe.frame,
          transitionBlockedRanges,
        )
        useKeyframesStore
          .getState()
          ._updateVectorKeyframe(ref.itemId, vector.property, vector.keyframe.id, {
            frame: clampedFrame,
            value: { ...vector.keyframe.value, [vector.axis]: newValue },
          })
        return
      }

      const existingKeyframe = selectedItemKeyframes?.properties
        .find((property) => property.property === ref.property)
        ?.keyframes.find((keyframe) => keyframe.id === ref.keyframeId)
      const initialFrame = existingKeyframe?.frame ?? newFrame
      const clampedFrame = clampFrameToBlockedRanges(
        Math.max(0, Math.round(newFrame)),
        initialFrame,
        transitionBlockedRanges,
      )

      _updateKeyframe(ref.itemId, ref.property, ref.keyframeId, {
        frame: clampedFrame,
        value: newValue,
      })
    },
    [
      _updateKeyframe,
      ensureVectorKeyframeForLiveEdit,
      selectedItemKeyframes,
      transitionBlockedRanges,
    ],
  )

  const handleKeyframesMove = useCallback(
    (entries: KeyframeMoveEntry[]) => {
      if (!selectedItemForEditor || !vectorBaseTransform || entries.length === 0) return

      const storedIdByDragKey = new Map(promotedVectorDragIdsRef.current)
      let remappedSelection = useKeyframeSelectionStore.getState().selectedKeyframes
      let selectionChanged = false

      // Promote every legacy vector lane before applying any frame updates.
      // Otherwise promoting the next selected legacy key replaces the lane and
      // resets the key that was just moved earlier in the same drag commit.
      for (const entry of entries) {
        const identityRemap = promoteLegacyVectorEntryForMove({
          entry,
          itemId: selectedItemForEditor.id,
          itemKeyframes: selectedItemKeyframes,
          baseTransform: vectorBaseTransform,
          keyframesByProperty,
          selectedKeyframes: remappedSelection,
          storedIdByDragKey,
          promotedDragIds: promotedVectorDragIdsRef.current,
        })
        if (!identityRemap) continue
        remappedSelection = identityRemap.selectedKeyframes
        selectionChanged = true
      }

      if (selectionChanged) selectKeyframes(remappedSelection)

      const vectorUpdates = new Map<string, PendingVectorMove>()
      const currentItemKeyframes =
        useKeyframesStore.getState().keyframesByItemId[selectedItemForEditor.id]

      for (const entry of entries) {
        applyKeyframeMoveEntry({
          entry,
          itemKeyframes: currentItemKeyframes,
          selectedItemKeyframes,
          blockedRanges: transitionBlockedRanges,
          storedIdByDragKey,
          pendingMoves: vectorUpdates,
          updateKeyframe: _updateKeyframe,
        })
      }

      for (const update of vectorUpdates.values()) {
        useKeyframesStore
          .getState()
          ._updateVectorKeyframe(selectedItemForEditor.id, update.property, update.keyframeId, {
            frame: update.frame,
            value: update.value,
          })
      }
    },
    [
      _updateKeyframe,
      keyframesByProperty,
      selectKeyframes,
      selectedItemKeyframes,
      selectedItemForEditor,
      transitionBlockedRanges,
      vectorBaseTransform,
    ],
  )

  const handleBezierHandleMove = useCallback(
    (ref: KeyframeRef, bezier: BezierControlPoints) => {
      const vector = ensureVectorKeyframeForLiveEdit(ref)
      if (vector) {
        const nextEasing = vector.keyframe.easing
        useKeyframesStore
          .getState()
          ._updateVectorKeyframe(ref.itemId, vector.property, vector.keyframe.id, {
            easing: getBezierEditorEasing(nextEasing),
            easingConfig: { type: 'cubic-bezier', bezier },
          })
        return
      }

      const existingKeyframe = selectedItemKeyframes?.properties
        .find((property) => property.property === ref.property)
        ?.keyframes.find((keyframe) => keyframe.id === ref.keyframeId)
      const nextEasing = existingKeyframe?.easing

      _updateKeyframe(ref.itemId, ref.property, ref.keyframeId, {
        easing: getBezierEditorEasing(nextEasing),
        easingConfig: {
          type: 'cubic-bezier',
          bezier,
        },
      })
    },
    [_updateKeyframe, ensureVectorKeyframeForLiveEdit, selectedItemKeyframes],
  )

  // Apply an easing change from the dopesheet's per-segment popover to explicit
  // keyframe refs. Live drag frames (`commit: false`) go through the no-undo
  // path and are bracketed by handleDragStart/handleDragEnd; everything else
  // commits its own undo entry.
  const handleSegmentEasingChange = useCallback(
    (
      refs: KeyframeRef[],
      updates: { easing: EasingType; easingConfig?: EasingConfig },
      options?: { commit?: boolean },
    ) => {
      if (refs.length === 0) return

      if (options?.commit === false) {
        for (const ref of refs) {
          if (applyVectorKeyframeUpdates(ref, updates, false)) continue
          _updateKeyframe(ref.itemId, ref.property, ref.keyframeId, updates)
        }
        return
      }

      const scalarRefs = refs.filter((ref) => !applyVectorKeyframeUpdates(ref, updates, true))
      if (scalarRefs.length === 0) return
      timelineActions.updateKeyframes(
        scalarRefs.map((ref) => ({
          itemId: ref.itemId,
          property: ref.property,
          keyframeId: ref.keyframeId,
          updates,
        })),
      )
    },
    // `timelineActions` is an `import * as` module namespace — a stable, immutable
    // reference, so it's intentionally not a dependency (consistent with the
    // other keyframe handlers in this file).
    [_updateKeyframe, applyVectorKeyframeUpdates],
  )

  // Handle selection change in graph editor
  const handleSelectionChange = useCallback(
    (keyframeIds: Set<string>) => {
      if (!selectedItemForEditor) return

      const refs: KeyframeRef[] = []
      for (const id of keyframeIds) {
        for (const property of allAvailableProperties) {
          if (keyframesByProperty[property]?.some((keyframe) => keyframe.id === id)) {
            refs.push({
              itemId: selectedItemForEditor.id,
              property,
              keyframeId: id,
            })
            break
          }
        }
      }

      if (refs.length === 0) {
        clearKeyframeSelection()
      } else if (refs.length === 1 && refs[0]) {
        selectKeyframe(refs[0])
      } else if (refs.length > 1) {
        selectKeyframes(refs)
      }
    },
    [
      selectedItemForEditor,
      allAvailableProperties,
      keyframesByProperty,
      clearKeyframeSelection,
      selectKeyframe,
      selectKeyframes,
    ],
  )

  // Handle property change in graph editor
  const handlePropertyChange = useCallback((property: AnimatableProperty | null) => {
    setSelectedProperty(property)
  }, [])

  const handleCopyKeyframes = useCallback(() => {
    if (selectedEditorKeyframes.length === 0) return
    copySelectedKeyframes()
  }, [copySelectedKeyframes, selectedEditorKeyframes.length])

  const handleCutKeyframes = useCallback(() => {
    if (selectedEditorKeyframes.length === 0) return
    cutSelectedKeyframes()
  }, [cutSelectedKeyframes, selectedEditorKeyframes.length])

  const handleSelectedKeyframeEasingChange = useCallback(
    (value: string, easingConfig?: EasingConfig) => {
      if (selectedEditorKeyframes.length === 0) return

      const easing = value as EasingType
      const scalarUpdates = selectedEditorKeyframes.flatMap(({ ref, keyframe }) => {
        const updates = {
          easing,
          easingConfig: easingConfig ?? buildEasingConfig(easing, keyframe.easingConfig),
        }
        if (applyVectorKeyframeUpdates(ref, updates, true)) return []
        return [
          {
            itemId: ref.itemId,
            property: ref.property,
            keyframeId: ref.keyframeId,
            updates,
          },
        ]
      })
      if (scalarUpdates.length > 0) timelineActions.updateKeyframes(scalarUpdates)
    },
    [applyVectorKeyframeUpdates, selectedEditorKeyframes],
  )

  const handlePasteKeyframes = useCallback(() => {
    if (!selectedItemForEditor) return
    if (!keyframeClipboard?.keyframes.length) return

    const anchorFrame = Math.max(
      0,
      Math.min(selectedItemForEditor.durationInFrames - 1, relativeFrame),
    )
    const pastePlan = buildKeyframePastePlan({
      clipboard: keyframeClipboard,
      item: selectedItemForEditor,
      anchorFrame,
      availableProperties,
      blockedRanges: transitionBlockedRanges,
      supportsVectors: Boolean(vectorBaseTransform),
      itemKeyframes: selectedItemKeyframes,
    })
    const skippedCount = pastePlan.skippedUnsupported + pastePlan.skippedBlocked
    const skipReasons = buildPasteSkipReasons(
      t,
      pastePlan.skippedUnsupported,
      pastePlan.skippedBlocked,
    )

    if (isKeyframeClipboardCut && skippedCount > 0) {
      toast.warning(t('timeline.keyframeEditor.unableToPasteCut'), {
        description: t('timeline.keyframeEditor.unableToPasteCutDescription', {
          reasons: skipReasons.join('. '),
        }),
      })
      return
    }

    if (pastePlan.scalarPayloads.length + pastePlan.vectorPayloads.length === 0) {
      toast.warning(t('timeline.keyframeEditor.noKeyframesPasted'), {
        description: skipReasons.join('. '),
      })
      return
    }

    const insertedVectorRefs: KeyframeRef[] = []
    for (const payload of pastePlan.vectorPayloads) {
      if (!vectorBaseTransform) continue
      const insertedRef = pasteVectorKeyframePayload({
        payload,
        item: selectedItemForEditor,
        baseTransform: vectorBaseTransform,
        canvas,
        getItem: (itemId) => allItemsById[itemId],
        getKeyframes: (itemId) => allKeyframesByItemId[itemId],
      })
      if (insertedRef) insertedVectorRefs.push(insertedRef)
    }

    const insertedIds = timelineActions.addKeyframes(pastePlan.scalarPayloads)
    const insertedRefs = insertedIds.map((keyframeId, index) => ({
      itemId: selectedItemForEditor.id,
      property: pastePlan.scalarPayloads[index]!.property,
      keyframeId,
    }))

    const nextSelection = [...insertedVectorRefs, ...insertedRefs]
    if (nextSelection.length > 0) {
      selectKeyframes(nextSelection)
    } else {
      clearKeyframeSelection()
    }

    if (isKeyframeClipboardCut) {
      clearKeyframeClipboard()
    }

    const pastedCount = nextSelection.length
    const summaryText = isKeyframeClipboardCut
      ? t('timeline.keyframeEditor.movedKeyframes', { count: pastedCount })
      : t('timeline.keyframeEditor.pastedKeyframes', { count: pastedCount })

    if (skippedCount > 0) {
      toast.warning(summaryText, {
        description: t('timeline.keyframeEditor.skippedDescription', {
          count: skippedCount,
          reasons: skipReasons.join('. '),
        }),
      })
      return
    }

    toast.success(summaryText)
  }, [
    availableProperties,
    allItemsById,
    allKeyframesByItemId,
    canvas,
    clearKeyframeClipboard,
    clearKeyframeSelection,
    isKeyframeClipboardCut,
    keyframeClipboard,
    relativeFrame,
    selectKeyframes,
    selectedItemKeyframes,
    selectedItemForEditor,
    transitionBlockedRanges,
    t,
    vectorBaseTransform,
  ])

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

  // Handle scrubbing in graph editor - convert clip-relative frame to absolute frame
  const handleScrub = useCallback(
    (clipRelativeFrame: number) => {
      if (!selectedItemForEditor) return

      // Convert clip-relative frame to absolute frame
      const absoluteFrame = selectedItemForEditor.from + clipRelativeFrame

      // Route editor scrubbing through the preview scrub path so the preview
      // can stay on its fast-scrub presentation instead of doing full seeks.
      usePlaybackStore.getState().setScrubFrame(absoluteFrame, selectedItemForEditor.id)
    },
    [selectedItemForEditor],
  )
  const handleSkim = useCallback(
    (clipRelativeFrame: number | null) => {
      const playback = usePlaybackStore.getState()
      if (clipRelativeFrame === null) {
        if (!keyframeEditorScrubbingRef.current) playback.setPreviewFrame(null)
        return
      }
      if (!selectedItemForEditor || playback.isPlaying || keyframeEditorScrubbingRef.current) return
      playback.setPreviewFrame(
        selectedItemForEditor.from + clipRelativeFrame,
        selectedItemForEditor.id,
      )
    },
    [selectedItemForEditor],
  )
  const handleScrubStart = useCallback(() => {
    keyframeEditorScrubbingRef.current = true
    usePlaybackStore.getState().pause()
  }, [])

  const handleScrubEnd = useCallback(() => {
    keyframeEditorScrubbingRef.current = false
    usePlaybackStore.getState().setPreviewFrame(null)
  }, [])

  const addVectorKeyframe = useCallback(
    (property: AnimatableProperty, frame: number): boolean => {
      const proxy = getEditableVectorProxy(property, selectedItemKeyframes)
      if (!proxy || !selectedItemForEditor || !vectorBaseTransform) return false
      const lane = useKeyframesStore
        .getState()
        .keyframesByItemId[selectedItemForEditor.id]?.vectorProperties?.find(
          (candidate) => candidate.property === proxy.property,
        )
      if (!lane || lane.keyframes.length === 0) {
        promoteVectorProperty(proxy.property, undefined, frame)
        return true
      }
      if (isVectorFrameBlocked(frame)) {
        toast.error(t('timeline.keyframeEditor.transitionBlocked'))
        return true
      }

      const resolved = resolveAnimatedTransform(
        vectorBaseTransform,
        useKeyframesStore.getState().keyframesByItemId[selectedItemForEditor.id],
        frame,
        {
          globalFrame: selectedItemForEditor.from + frame,
          canvas,
          getItem: (itemId) => allItemsById[itemId],
          getKeyframes: (itemId) => allKeyframesByItemId[itemId],
        },
      )
      const value =
        proxy.property === 'position'
          ? { x: resolved.x, y: resolved.y }
          : proxy.property === 'scale'
            ? {
                x: toVectorScalePercent(resolved.width, vectorBaseTransform.width),
                y: toVectorScalePercent(resolved.height, vectorBaseTransform.height),
              }
            : { x: resolved.anchorX, y: resolved.anchorY }
      timelineActions.upsertVectorKeyframe(selectedItemForEditor.id, proxy.property, {
        frame,
        value,
        easing: 'linear',
      })
      return true
    },
    [
      allItemsById,
      allKeyframesByItemId,
      canvas,
      isVectorFrameBlocked,
      promoteVectorProperty,
      selectedItemKeyframes,
      selectedItemForEditor,
      t,
      vectorBaseTransform,
    ],
  )

  // Handle adding a keyframe at the current frame
  const handleAddKeyframe = useCallback(
    (property: AnimatableProperty, frame: number) => {
      if (!selectedItemForEditor) return
      if (addVectorKeyframe(property, frame)) return

      const propKeyframes = keyframesByProperty[property] ?? []
      const baseValue = getAnimatablePropertyBaseValue(selectedItemForEditor, property, canvas)
      const value = interpolatePropertyValue(propKeyframes, frame, baseValue)

      timelineActions.addKeyframe(selectedItemForEditor.id, property, frame, value)
    },
    [addVectorKeyframe, canvas, keyframesByProperty, selectedItemForEditor],
  )
  const handleDuplicateKeyframes = useCallback(
    (entries: Array<{ ref: KeyframeRef; frame: number; value: number }>) => {
      if (!selectedItemForEditor || entries.length === 0) return

      const insertedVectorRefs: KeyframeRef[] = []
      const duplicatedVectorKeys = new Set<string>()
      const payloads = entries.flatMap(({ ref, frame, value }) => {
        const proxy = getEditableVectorProxy(ref.property, selectedItemKeyframes)
        if (proxy && vectorBaseTransform) {
          const insertedRef = duplicateVectorKeyframeEntry({
            ref,
            frame,
            value,
            proxy,
            itemId: selectedItemForEditor.id,
            itemKeyframes: selectedItemKeyframes ?? undefined,
            baseTransform: vectorBaseTransform,
            duplicatedKeys: duplicatedVectorKeys,
          })
          if (insertedRef) insertedVectorRefs.push(insertedRef)
          return []
        }

        const sourceKeyframe = keyframesByProperty[ref.property]?.find(
          (keyframe) => keyframe.id === ref.keyframeId,
        )
        if (!sourceKeyframe) {
          return []
        }

        return [
          {
            itemId: selectedItemForEditor.id,
            property: ref.property,
            frame,
            value,
            easing: sourceKeyframe.easing,
            easingConfig: sourceKeyframe.easingConfig,
          },
        ]
      })

      const insertedIds = payloads.length > 0 ? timelineActions.addKeyframes(payloads) : []
      const insertedRefs = insertedIds.map((keyframeId, index) => ({
        itemId: selectedItemForEditor.id,
        property: payloads[index]!.property,
        keyframeId,
      }))

      const nextSelection = [...insertedVectorRefs, ...insertedRefs]
      if (nextSelection.length > 0) {
        selectKeyframes(nextSelection)
      }
    },
    [
      keyframesByProperty,
      selectKeyframes,
      selectedItemForEditor,
      selectedItemKeyframes,
      vectorBaseTransform,
    ],
  )

  const propertyValues = useMemo(() => {
    if (!selectedItemForEditor) return {}
    const values = buildCurrentPropertyValues({
      item: selectedItemForEditor,
      properties: availableProperties,
      keyframesByProperty,
      selectedKeyframes: selectedEditorKeyframes,
      resolvedTransform: vectorResolvedTransform,
      relativeFrame,
      canvas,
    })
    if (surface === 'edit') {
      for (const row of vectorControlRows) {
        values[row.proxyProperty] = row.value.x
        values[row.secondaryProxyProperty] = row.value.y
      }
    }
    return values
  }, [
    availableProperties,
    canvas,
    keyframesByProperty,
    relativeFrame,
    selectedEditorKeyframes,
    selectedItemForEditor,
    surface,
    vectorControlRows,
    vectorResolvedTransform,
  ])
  const preExpressionPropertyValues = useMemo(() => {
    if (!selectedItemForEditor) return {}
    const values: Partial<Record<AnimatableProperty, number>> = {}
    for (const property of availableProperties) {
      const vectorRow =
        surface === 'edit'
          ? vectorControlRows.find(
              (candidate) =>
                candidate.proxyProperty === property ||
                candidate.secondaryProxyProperty === property,
            )
          : undefined
      if (vectorRow) {
        values[property] =
          vectorRow.proxyProperty === property
            ? vectorRow.preExpressionValue.x
            : vectorRow.preExpressionValue.y
      } else if (vectorPreExpressionTransform && isTransformAnimatableProperty(property)) {
        values[property] = vectorPreExpressionTransform[property]
      } else {
        values[property] = propertyValues[property]
      }
    }
    return values
  }, [
    availableProperties,
    propertyValues,
    selectedItemForEditor,
    surface,
    vectorControlRows,
    vectorPreExpressionTransform,
  ])
  const resolveExpressionReference = useCallback(
    (itemId: string, property: DirectLinkableProperty) =>
      resolveExpressionReferenceValue(itemId, property, {
        globalFrame: currentFrame,
        canvas,
        getItem: (candidateId) => allItemsById[candidateId],
        getKeyframes: (candidateId) => allKeyframesByItemId[candidateId],
      }),
    [allItemsById, allKeyframesByItemId, canvas, currentFrame],
  )
  const handleSetPropertyExpression = useCallback(
    (property: DirectLinkableProperty, source: string, enabled: boolean) => {
      if (!selectedItemForEditor) return
      timelineActions.setPropertyExpression(selectedItemForEditor.id, {
        type: 'expression',
        targetProperty: property,
        source,
        enabled,
      })
    },
    [selectedItemForEditor],
  )
  const handleRemovePropertyExpression = useCallback(
    (property: DirectLinkableProperty) => {
      if (!selectedItemForEditor) return
      timelineActions.removePropertyExpression(selectedItemForEditor.id, property)
    },
    [selectedItemForEditor],
  )

  const handlePropertyValueCommit = useCallback(
    (property: AnimatableProperty, value: number, options?: { allowCreate?: boolean }) => {
      if (!selectedItemForEditor) return
      const vectorProxy = getEditableVectorProxy(property, selectedItemKeyframes)
      if (surface === 'edit' && vectorProxy) {
        handleVectorValueCommit(vectorProxy.property, vectorProxy.axis, value, {
          allowCreate: options?.allowCreate !== false,
        })
        return
      }

      commitScalarPropertyValue({
        itemId: selectedItemForEditor.id,
        property,
        value,
        relativeFrame,
        allowCreate: options?.allowCreate !== false,
        selectedKeyframes: selectedEditorKeyframes,
        propertyKeyframes: keyframesByProperty[property],
        selectKeyframe,
      })
    },
    [
      keyframesByProperty,
      handleVectorValueCommit,
      relativeFrame,
      selectKeyframe,
      selectedEditorKeyframes,
      selectedItemKeyframes,
      selectedItemForEditor,
      surface,
    ],
  )

  const previewVectorPropertyValue = useCallback(
    (property: AnimatableProperty, value: number): boolean => {
      const proxy = getEditableVectorProxy(property, selectedItemKeyframes)
      if (!proxy || !selectedItemForEditor || !vectorBaseTransform) return false
      if (isVectorFrameBlocked(relativeFrame)) return true

      const editorKeyframe = keyframesByProperty[property]?.find(
        (keyframe) => keyframe.frame === relativeFrame,
      )
      if (editorKeyframe) {
        const vector = ensureVectorKeyframeForLiveEdit({
          itemId: selectedItemForEditor.id,
          property,
          keyframeId: editorKeyframe.id,
        })
        if (!vector) return true
        useKeyframesStore
          .getState()
          ._updateVectorKeyframe(selectedItemForEditor.id, vector.property, vector.keyframe.id, {
            value: getNextVectorAxisValue(
              vector.property,
              vector.keyframe.value,
              vector.axis,
              value,
            ),
          })
        return true
      }

      const plan = buildVectorPromotionPlan({
        property: proxy.property,
        itemKeyframes: selectedItemKeyframes ?? undefined,
        baseTransform: vectorBaseTransform,
        includeFrame: relativeFrame,
      })
      const insertedKeyframe = plan.vectorProperty.keyframes.find(
        (keyframe) => keyframe.frame === relativeFrame,
      )
      if (!insertedKeyframe) return true
      plan.vectorProperty = {
        ...plan.vectorProperty,
        keyframes: plan.vectorProperty.keyframes.map((keyframe) =>
          keyframe.id === insertedKeyframe.id
            ? {
                ...keyframe,
                value: getNextVectorAxisValue(proxy.property, keyframe.value, proxy.axis, value),
              }
            : keyframe,
        ),
      }
      useKeyframesStore
        .getState()
        ._replaceScalarPropertiesWithVectorProperty(
          selectedItemForEditor.id,
          plan.vectorProperty,
          plan.removeScalarProperties,
        )
      selectKeyframe({
        itemId: selectedItemForEditor.id,
        property,
        keyframeId: getEditorVectorKeyframeId(insertedKeyframe.id, proxy.axis),
      })
      return true
    },
    [
      ensureVectorKeyframeForLiveEdit,
      getNextVectorAxisValue,
      isVectorFrameBlocked,
      keyframesByProperty,
      relativeFrame,
      selectKeyframe,
      selectedItemForEditor,
      selectedItemKeyframes,
      vectorBaseTransform,
    ],
  )

  const handlePropertyValuePreview = useCallback(
    (property: AnimatableProperty, value: number) => {
      if (!selectedItemForEditor) return
      if (surface === 'edit' && previewVectorPropertyValue(property, value)) return

      const selectedRefs = selectedEditorKeyframes
        .filter(({ ref }) => ref.property === property)
        .map(({ ref }) => ref)
      if (selectedRefs.length > 0) {
        for (const ref of selectedRefs) {
          _updateKeyframe(ref.itemId, ref.property, ref.keyframeId, { value })
        }
        return
      }

      const existing = keyframesByProperty[property]?.find(
        (keyframe) => keyframe.frame === relativeFrame,
      )
      let keyframeId = existing?.id ?? valueScrubCreatedKeyframesRef.current.get(property)
      if (!keyframeId) {
        keyframeId = _addKeyframe(selectedItemForEditor.id, property, relativeFrame, value)
        valueScrubCreatedKeyframesRef.current.set(property, keyframeId)
        selectKeyframe({ itemId: selectedItemForEditor.id, property, keyframeId })
      } else {
        _updateKeyframe(selectedItemForEditor.id, property, keyframeId, { value })
      }
    },
    [
      _addKeyframe,
      _updateKeyframe,
      keyframesByProperty,
      previewVectorPropertyValue,
      relativeFrame,
      selectKeyframe,
      selectedEditorKeyframes,
      selectedItemForEditor,
      surface,
    ],
  )

  const handleResetPropertiesToDefault = useCallback(
    (properties: AnimatableProperty[]) => {
      if (!selectedItemForEditor || properties.length === 0) return
      const effects = useItemsStore.getState().itemById[selectedItemForEditor.id]?.effects ?? []
      const resetPlan = buildEffectPropertyResetPlan(effects, properties)
      if (resetPlan.resettableProperties.length === 0) return
      const propertySet = new Set(resetPlan.resettableProperties)

      const keyframeState = useKeyframesStore.getState().keyframesByItemId[selectedItemForEditor.id]
      const hasKeyframes = properties.some(
        (property) =>
          (keyframeState?.properties.find((entry) => entry.property === property)?.keyframes
            .length ?? 0) > 0,
      )
      const hasValueChanges = resetPlan.effectUpdates.length > 0
      if (!hasKeyframes && !hasValueChanges) return

      const beforeSnapshot = captureSnapshot()
      for (const property of resetPlan.resettableProperties) {
        _removeKeyframesForProperty(selectedItemForEditor.id, property)
      }
      for (const update of resetPlan.effectUpdates) {
        useItemsStore.getState()._updateEffect(selectedItemForEditor.id, update.effectId, {
          effect: update.effect,
        })
      }
      selectKeyframes(selectedKeyframes.filter((ref) => !propertySet.has(ref.property)))
      useTimelineCommandStore.getState().addUndoEntry(
        {
          type: 'RESET_EFFECT_PROPERTIES',
          payload: { count: resetPlan.resettableProperties.length },
        },
        beforeSnapshot,
      )
      useTimelineSettingsStore.getState().markDirty()
    },
    [_removeKeyframesForProperty, selectKeyframes, selectedItemForEditor, selectedKeyframes],
  )

  // Handle removing keyframes
  const handleRemoveKeyframes = useCallback(
    (refs: KeyframeRef[]) => {
      if (!selectedItemForEditor) {
        timelineActions.removeKeyframes(refs)
        return
      }
      if (!vectorBaseTransform) {
        timelineActions.removeKeyframes(refs)
        return
      }
      const scalarRefs: KeyframeRef[] = []
      const removedVectorKeys = new Set<string>()
      for (const ref of refs) {
        const proxy = getEditableVectorProxy(ref.property, selectedItemKeyframes)
        if (!proxy) {
          scalarRefs.push(ref)
          continue
        }
        const removalContext = {
          ref,
          proxy,
          itemKeyframes: selectedItemKeyframes ?? undefined,
          removedKeys: removedVectorKeys,
        }
        if (removeStoredVectorRef(removalContext)) continue
        if (
          promoteAndRemoveLegacyVectorRef({
            ...removalContext,
            keyframesByProperty,
            baseTransform: vectorBaseTransform,
          })
        )
          continue
        scalarRefs.push(ref)
      }
      if (scalarRefs.length > 0) timelineActions.removeKeyframes(scalarRefs)
    },
    [keyframesByProperty, selectedItemForEditor, selectedItemKeyframes, vectorBaseTransform],
  )

  // Handle navigation to a keyframe - convert clip-relative frame to absolute
  const handleNavigateToKeyframe = useCallback(
    (clipRelativeFrame: number) => {
      if (!selectedItemForEditor) return
      const absoluteFrame = selectedItemForEditor.from + clipRelativeFrame
      usePlaybackStore.getState().setCurrentFrame(absoluteFrame)
    },
    [selectedItemForEditor],
  )

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

  const editorInset = surface === 'edit' ? 0 : 16
  // The docked editor spans the full timeline row. Its own 12px custom
  // scrollbar then occupies the same right-edge column as the main timeline's
  // scrollbar instead of subtracting a second gutter from the shared axis.
  const editorWidth = Math.max(0, containerWidth - editorInset)
  const editorHeight = Math.max(0, resolvedContentHeight - editorInset)
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
          {selectedItemForEditor && containerWidth > 0 ? (
            <>
              <ErrorBoundary level="component">
                <DopesheetEditor
                  itemId={selectedItemForEditor.id}
                  motionModifiers={selectedItemForEditor.motionModifiers}
                  textMotionBands={editTextMotionBands}
                  onTextMotionDurationDragStart={handleTextMotionDurationDragStart}
                  onTextMotionDurationCommit={handleTextMotionDurationCommit}
                  onTextMotionDurationCancel={handleTextMotionDurationCancel}
                  onTextMotionOffsetDragStart={handleTextMotionOffsetDragStart}
                  onTextMotionOffsetCommit={handleTextMotionOffsetCommit}
                  onTextMotionOffsetCancel={handleTextMotionOffsetCancel}
                  onTextMotionBandClick={handleTextMotionBandClick}
                  hasProceduralMotion={canBakeProceduralMotion}
                  frameViewport={editTimelineFrameViewport}
                  clampViewportToContent={surface !== 'edit'}
                  viewportInteractionEnabled={surface !== 'edit'}
                  keyframesByProperty={keyframesByProperty}
                  propertyValues={propertyValues}
                  preExpressionPropertyValues={preExpressionPropertyValues}
                  propertyLinks={getDirectPropertyLinks(selectedItemKeyframes ?? undefined)}
                  propertyExpressions={selectedItemKeyframes?.expressions?.filter(
                    (expression) => expression.type === 'expression',
                  )}
                  propertyLinkSourceLabels={propertyLinkSourceLabels}
                  onPropertyLinkPointerDown={handlePropertyLinkPointerDown}
                  onRemovePropertyLink={handleRemovePropertyLink}
                  resolveExpressionReference={resolveExpressionReference}
                  onSetPropertyExpression={handleSetPropertyExpression}
                  onRemovePropertyExpression={handleRemovePropertyExpression}
                  hiddenPropertyRows={
                    supportsVectorTransform(selectedItemForEditor)
                      ? hiddenVectorPropertyRows
                      : undefined
                  }
                  compoundPropertyRows={compoundPropertyRows}
                  compoundSecondaryProperties={compoundSecondaryProperties}
                  dimensionSeparationByProperty={dimensionSeparationByProperty}
                  axisConstraintByProperty={surface === 'edit' ? classicAxisConstraints : undefined}
                  selectedProperty={effectiveSelectedProperty}
                  selectedKeyframeIds={selectedKeyframeIds}
                  currentFrame={relativeFrame}
                  playheadFrame={
                    surface === 'edit' ? currentFrame - selectedItemForEditor.from : undefined
                  }
                  playheadClampToItemBounds={surface !== 'edit'}
                  globalFrame={currentFrame}
                  itemFrom={selectedItemForEditor.from}
                  totalFrames={selectedItemForEditor.durationInFrames}
                  affectedFrameRange={
                    surface === 'edit'
                      ? { fromFrame: 0, toFrame: selectedItemForEditor.durationInFrames }
                      : undefined
                  }
                  trimmedKeyframeCount={surface === 'edit' ? trimmedKeyframeCount : 0}
                  onTrimAnimation={surface === 'edit' ? handleTrimAnimation : undefined}
                  fps={surface === 'edit' ? editTimelineFps : canvas.fps}
                  width={editorWidth}
                  height={editorHeight}
                  onKeyframeMove={handleKeyframeMove}
                  onKeyframesMove={handleKeyframesMove}
                  onBezierHandleMove={handleBezierHandleMove}
                  onSegmentEasingChange={handleSegmentEasingChange}
                  onSelectionChange={handleSelectionChange}
                  onPropertyChange={handlePropertyChange}
                  onActivePropertyChange={setSelectedProperty}
                  onScrub={handleScrub}
                  onSkim={surface === 'edit' ? handleSkim : undefined}
                  globalFrameToPixels={
                    surface === 'edit' ? editTimelineGlobalFrameToPixels : undefined
                  }
                  timelineScrollContainerRef={
                    surface === 'edit' ? timelineScrollContainerRef : undefined
                  }
                  timelinePanBaseScrollLeft={
                    surface === 'edit' ? editTimelineScrollLeft : undefined
                  }
                  timelinePanBasePixelsPerSecond={
                    surface === 'edit' ? editTimelinePixelsPerSecond : undefined
                  }
                  linkedTimelineViewportWidth={
                    surface === 'edit' ? editTimelineViewportWidth : undefined
                  }
                  getTimelineLivePixelsPerSecond={
                    surface === 'edit' ? getEditTimelineLivePixelsPerSecond : undefined
                  }
                  onRulerEdgeScroll={surface === 'edit' ? handleEditTimelineEdgeScroll : undefined}
                  scrubClampToItemBounds={surface !== 'edit'}
                  scrubFrameBounds={
                    surface === 'edit'
                      ? {
                          minFrame: -selectedItemForEditor.from,
                          maxFrame:
                            Math.floor(
                              Math.max(maxItemEndFrame / editTimelineFps, 10) * editTimelineFps,
                            ) - selectedItemForEditor.from,
                        }
                      : undefined
                  }
                  onScrubStart={handleScrubStart}
                  onScrubEnd={handleScrubEnd}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragCancel={handleDragCancel}
                  onAddKeyframe={handleAddKeyframe}
                  onDuplicateKeyframes={handleDuplicateKeyframes}
                  onPropertyValueCommit={handlePropertyValueCommit}
                  onPropertyValuePreview={handlePropertyValuePreview}
                  onResetPropertiesToDefault={handleResetPropertiesToDefault}
                  onRemoveKeyframes={handleRemoveKeyframes}
                  onCopyKeyframes={handleCopyKeyframes}
                  onCutKeyframes={handleCutKeyframes}
                  onPasteKeyframes={handlePasteKeyframes}
                  hasKeyframeClipboard={Boolean(keyframeClipboard?.keyframes.length)}
                  isKeyframeClipboardCut={isKeyframeClipboardCut}
                  selectedInterpolation={selectedEditorEasing}
                  interpolationOptions={easingOptions}
                  onInterpolationChange={handleSelectedKeyframeEasingChange}
                  interpolationDisabled={selectedEditorKeyframes.length === 0}
                  onNavigateToKeyframe={handleNavigateToKeyframe}
                  transitionBlockedRanges={transitionBlockedRanges}
                  proceduralPreview={proceduralPreview}
                  canBakeMotion={canBakeProceduralMotion}
                  onBakeMotion={() => setBakeDialogOpen(true)}
                  visualizationMode={effectiveEditorMode}
                  presentation={surface === 'edit' ? 'classic' : undefined}
                  graphMode={vectorGraphMode}
                  onGraphModeChange={activeVectorRow ? setVectorGraphMode : undefined}
                  speedGraphContent={vectorSpeedGraphContent}
                  spacious={splitView || surface === 'motion'}
                  inlinePropertyGroupIds={
                    surface === 'motion' ? MOTION_INLINE_PROPERTY_GROUP_IDS : undefined
                  }
                  initialVisibleGroupIds={initialVisibleGroupIds}
                  propertyColumnWidth={propertyColumnWidth}
                  shortcutsEnabled={isPointerWithinEditor || isFocusWithinEditor}
                  addKeyframeShortcutEnabled={surface === 'edit'}
                  shortcuts={{
                    addKeyframe: surface === 'edit' ? hotkeys.EDIT_KEYFRAME_ADD : '',
                    previousKeyframe: hotkeys.KEYFRAME_PREVIOUS,
                    nextKeyframe: hotkeys.KEYFRAME_NEXT,
                    toggleAutoKey: hotkeys.KEYFRAME_TOGGLE_AUTO,
                    fitKeyframes: hotkeys.KEYFRAME_FIT,
                  }}
                />
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
