import {
  useMemo,
  useCallback,
  useDeferredValue,
  useEffect,
  useSyncExternalStore,
  memo,
  lazy,
  Suspense,
} from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  Crosshair,
  Film,
  Sparkles,
  SlidersHorizontal,
  Volume2,
  Type,
  WandSparkles,
  Shapes,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/shared/ui/cn'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { useEditorStore } from '@/shared/state/editor'
import { useSelectionStore } from '@/shared/state/selection'
import { useItemsStore, useTimelineStore } from '@/features/editor/deps/timeline-store'
import { useProjectStore } from '@/features/editor/deps/projects'
import { EffectsSection } from '@/features/editor/deps/effects-contract'
import {
  DEFAULT_PROJECT_FPS,
  DEFAULT_PROJECT_HEIGHT,
  DEFAULT_PROJECT_WIDTH,
} from '@/shared/projects/defaults'
import type { ClipInspectorTab } from '@/shared/state/editor'
import type { SelectionState, SelectionActions } from '@/shared/state/selection'
import type { TimelineState, TimelineActions } from '@/features/editor/deps/timeline-store'
import type { TransformProperties } from '@/types/transform'
import type { TimelineItem, VideoItem, CompositionItem } from '@/types/timeline'
import { getLinkedAudioCompanion } from '@/shared/utils/linked-media'
import { useGizmoStore } from '@/features/editor/deps/preview'

import { LayoutSection } from './layout-section'
import { FillSection } from './fill-section'
import { VideoSection } from './video-section'
import { GifSection } from './gif-section'
import { LottieSection } from './lottie-section'
import { ShapeSection } from './shape-section'
import { CornerPinSection } from './corner-pin-section'
import { Projection360Section } from './projection-360-section'
import { CompositionControlsSection } from './composition-controls-section'

const LazyAudioSection = lazy(() =>
  import('./audio-section').then((module) => ({ default: module.AudioSection })),
)
const LazySubtitleSection = lazy(() =>
  import('./subtitle-section').then((module) => ({ default: module.SubtitleSection })),
)
const LazyTextContentSection = lazy(() =>
  import('./text-section').then((module) => ({ default: module.TextContentSection })),
)
const LazyTextEffectsSection = lazy(() =>
  import('./text-section').then((module) => ({ default: module.TextEffectsSection })),
)
const LazyTextStyleSection = lazy(() =>
  import('./text-section').then((module) => ({ default: module.TextStyleSection })),
)
const LazyAnimationPresetLibrary = lazy(() =>
  import('../../animate-workspace/animation-preset-library').then((module) => ({
    default: module.AnimationPresetLibrary,
  })),
)

/**
 * Check if an item is a GIF (image with .gif extension)
 */
function isGifItem(item: TimelineItem): boolean {
  return item.type === 'image' && (item.label?.toLowerCase().endsWith('.gif') ?? false)
}

/**
 * Compute item type information in a single pass for efficiency.
 * Uses Set for O(1) type lookups instead of repeated array iterations.
 */
function computeItemTypeInfo(items: TimelineItem[]) {
  const types = new Set(items.map((item) => item.type))
  const hasGifItems = items.some(isGifItem)

  return {
    hasVisualItems:
      types.has('video') ||
      types.has('image') ||
      types.has('text') ||
      types.has('shape') ||
      types.has('adjustment') ||
      types.has('composition') ||
      types.has('subtitle') ||
      types.has('lottie') ||
      types.has('controller'),
    hasVideoItems: types.has('video'),
    hasCompositionItems: types.has('composition'),
    hasLottieItems: types.has('lottie'),
    hasGifItems,
    hasAudioItems: types.has('video') || types.has('audio'),
    hasTextItems: types.has('text'),
    hasShapeItems: types.has('shape'),
    hasAdjustmentItems: types.has('adjustment'),
    hasSubtitleItems: types.has('subtitle'),
    hasVirtualSubtitleItems: items.some(
      (item) =>
        (item.type === 'video' || item.type === 'audio') &&
        item.isReversed !== true &&
        item.transcriptCaptions?.type === 'transcript' &&
        item.transcriptCaptions.cues.length > 0,
    ),
    isOnlyTextOrShape:
      items.length > 0 && items.every((item) => item.type === 'text' || item.type === 'shape'),
    // Pure text selection gets a text-specific tab layout: Text / Animation /
    // Effects instead of Video / Audio / Effects.
    isOnlyText: items.length > 0 && items.every((item) => item.type === 'text'),
    // Pure shape selection gets a Shape tab (no audio) instead of Video.
    isOnlyShape: items.length > 0 && items.every((item) => item.type === 'shape'),
    isOnlyController: items.length > 0 && items.every((item) => item.type === 'controller'),
  }
}

export const ClipPanel = memo(function ClipPanel() {
  const selectedItemIds = useSelectionStore(
    (s: SelectionState & SelectionActions) => s.selectedItemIds,
  )
  const snapshotBridge = useMemo(
    () => createClipPanelSnapshotBridge(selectedItemIds),
    [selectedItemIds],
  )
  const snapshot = useSyncExternalStore(
    snapshotBridge.subscribe,
    snapshotBridge.getSnapshot,
    snapshotBridge.getSnapshot,
  )
  const selectionKey = selectedItemIds.join('\u001f')

  // A new selection must replace the inspector synchronously. Reusing the
  // deferred boundary here can leave its controls one selection behind while
  // playback keeps higher-priority preview work active. Remounting only when
  // the selected IDs change preserves deferred same-item store updates.
  return <DeferredClipPanel key={selectionKey} snapshot={snapshot} />
})

interface ClipPanelSnapshot {
  selectedItems: TimelineItem[]
  audioPanelItems: TimelineItem[]
}

type ItemsStoreState = ReturnType<typeof useItemsStore.getState>
type GizmoStoreState = ReturnType<typeof useGizmoStore.getState>

function readClipPanelSnapshot(
  state: ItemsStoreState,
  selectedItemIds: readonly string[],
): ClipPanelSnapshot {
  const selectedItems = selectedItemIds.flatMap((itemId) => {
    const item = state.itemById[itemId]
    return item ? [item] : []
  })
  const audioPanelItems = selectedItemIds.flatMap((itemId) => {
    const item = state.itemById[itemId]
    if (!item || (item.type !== 'video' && item.type !== 'audio')) return []
    if (item.type === 'audio') return [item]
    return [getLinkedAudioCompanion(state.items, item) ?? item]
  })
  return { selectedItems, audioPanelItems }
}

function areItemListsReferentiallyEqual(
  previous: readonly TimelineItem[],
  next: readonly TimelineItem[],
): boolean {
  return previous.length === next.length && previous.every((item, index) => item === next[index])
}

function areRecordsEqualExceptKeys(
  previous: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
  ignoredKeys: ReadonlySet<string>,
): boolean {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)])
  for (const key of keys) {
    if (!ignoredKeys.has(key) && previous[key] !== next[key]) return false
  }
  return true
}

const ITEM_TRANSFORM_KEY = new Set(['transform'])
const POSITION_TRANSFORM_KEYS = new Set(['x', 'y'])

function isTranslateOnlyItemChange(previous: TimelineItem, next: TimelineItem): boolean {
  if (previous.id !== next.id) return false
  if (previous === next) return true
  if (
    !areRecordsEqualExceptKeys(
      previous as unknown as Readonly<Record<string, unknown>>,
      next as unknown as Readonly<Record<string, unknown>>,
      ITEM_TRANSFORM_KEY,
    )
  ) {
    return false
  }

  return areRecordsEqualExceptKeys(
    (previous.transform ?? {}) as Readonly<Record<string, unknown>>,
    (next.transform ?? {}) as Readonly<Record<string, unknown>>,
    POSITION_TRANSFORM_KEYS,
  )
}

function isTranslateOnlyItemListChange(
  previous: readonly TimelineItem[],
  next: readonly TimelineItem[],
  activeItemId: string,
): { valid: boolean; changed: boolean } {
  if (previous.length !== next.length) return { valid: false, changed: false }

  let changed = false
  for (const [index, previousItem] of previous.entries()) {
    const nextItem = next[index]
    if (!nextItem || previousItem.id !== nextItem.id) {
      return { valid: false, changed: false }
    }
    if (previousItem === nextItem) continue
    if (previousItem.id !== activeItemId || !isTranslateOnlyItemChange(previousItem, nextItem)) {
      return { valid: false, changed: false }
    }
    changed = true
  }

  return { valid: true, changed }
}

function isTranslateOnlySnapshotChange(
  previous: ClipPanelSnapshot,
  next: ClipPanelSnapshot,
  activeItemId: string,
): boolean {
  const selectedChange = isTranslateOnlyItemListChange(
    previous.selectedItems,
    next.selectedItems,
    activeItemId,
  )
  if (!selectedChange.valid) return false

  const audioChange = isTranslateOnlyItemListChange(
    previous.audioPanelItems,
    next.audioPanelItems,
    activeItemId,
  )
  return audioChange.valid && (selectedChange.changed || audioChange.changed)
}

function areSnapshotsReferentiallyEqual(
  previous: ClipPanelSnapshot,
  next: ClipPanelSnapshot,
): boolean {
  return (
    areItemListsReferentiallyEqual(previous.selectedItems, next.selectedItems) &&
    areItemListsReferentiallyEqual(previous.audioPanelItems, next.audioPanelItems)
  )
}

function scheduleInspectorCatchUp(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const idleId = window.requestIdleCallback(callback, { timeout: 120 })
    return () => window.cancelIdleCallback(idleId)
  }

  const animationFrameId = window.requestAnimationFrame(callback)
  return () => window.cancelAnimationFrame(animationFrameId)
}

function createClipPanelSnapshotBridge(selectedIds: readonly string[]): {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => ClipPanelSnapshot
} {
  const selectedItemIds = [...selectedIds]
  let observedSnapshot = readClipPanelSnapshot(useItemsStore.getState(), selectedItemIds)
  let renderedSnapshot = observedSnapshot
  let lastRetainedTranslateInteractionId: number | null = null
  let lastObservedHandoffInteractionId: number | null = null
  let cancelScheduledCatchUp: (() => void) | null = null
  let unsubscribeItems: (() => void) | null = null
  let unsubscribeGizmo: (() => void) | null = null
  const listeners = new Set<() => void>()

  const emit = () => {
    for (const listener of listeners) listener()
  }
  const publishCanonicalSnapshot = () => {
    cancelScheduledCatchUp = null
    if (useGizmoStore.getState().activeGizmo) return

    const nextSnapshot = readClipPanelSnapshot(useItemsStore.getState(), selectedItemIds)
    observedSnapshot = nextSnapshot
    if (areSnapshotsReferentiallyEqual(renderedSnapshot, nextSnapshot)) return
    renderedSnapshot = nextSnapshot
    emit()
  }
  const handleItemsChange = (state: ItemsStoreState) => {
    const nextObserved = readClipPanelSnapshot(state, selectedItemIds)
    if (areSnapshotsReferentiallyEqual(observedSnapshot, nextObserved)) return

    const gizmoState = useGizmoStore.getState()
    const translateInteraction =
      gizmoState.activeGizmo?.mode === 'translate'
        ? gizmoState.activeGizmo
        : gizmoState.presentationHandoff?.mode === 'translate'
          ? gizmoState.presentationHandoff
          : null
    const shouldRetain =
      translateInteraction !== null &&
      translateInteraction.interactionId !== lastRetainedTranslateInteractionId &&
      isTranslateOnlySnapshotChange(observedSnapshot, nextObserved, translateInteraction.itemId)

    observedSnapshot = nextObserved
    if (shouldRetain) {
      lastRetainedTranslateInteractionId = translateInteraction.interactionId
      return
    }
    if (areSnapshotsReferentiallyEqual(renderedSnapshot, nextObserved)) return
    renderedSnapshot = nextObserved
    emit()
  }
  const handleGizmoChange = (state: GizmoStoreState) => {
    if (state.activeGizmo) {
      cancelScheduledCatchUp?.()
      cancelScheduledCatchUp = null
    }

    const handoffInteractionId =
      state.presentationHandoff?.mode === 'translate'
        ? state.presentationHandoff.interactionId
        : null
    if (handoffInteractionId === lastObservedHandoffInteractionId) return
    lastObservedHandoffInteractionId = handoffInteractionId
    // Canonical visual acknowledgement clears the handoff quickly. Keep the
    // already scheduled inspector catch-up alive; only a new interaction
    // should cancel it.
    if (handoffInteractionId === null) return

    cancelScheduledCatchUp?.()
    cancelScheduledCatchUp = null

    if (handoffInteractionId === lastRetainedTranslateInteractionId) {
      cancelScheduledCatchUp = scheduleInspectorCatchUp(publishCanonicalSnapshot)
    }
  }

  return {
    getSnapshot: () => renderedSnapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      if (listeners.size === 1) {
        unsubscribeItems = useItemsStore.subscribe(handleItemsChange)
        unsubscribeGizmo = useGizmoStore.subscribe(handleGizmoChange)
        handleItemsChange(useItemsStore.getState())
        handleGizmoChange(useGizmoStore.getState())
      }

      return () => {
        listeners.delete(listener)
        if (listeners.size > 0) return
        unsubscribeItems?.()
        unsubscribeItems = null
        unsubscribeGizmo?.()
        unsubscribeGizmo = null
        cancelScheduledCatchUp?.()
        cancelScheduledCatchUp = null
        lastObservedHandoffInteractionId = null
      }
    },
  }
}

/**
 * Keep transition state on a component that does not subscribe to the external
 * items store. Otherwise a later synchronous store notification can promote an
 * unfinished inspector render back into the canvas pointer-up task.
 */
const DeferredClipPanel = memo(function DeferredClipPanel({
  snapshot,
}: {
  snapshot: ClipPanelSnapshot
}) {
  const deferredSnapshot = useDeferredValue(snapshot)
  return (
    <ClipPanelCore
      selectedItems={deferredSnapshot.selectedItems}
      audioPanelItems={deferredSnapshot.audioPanelItems}
    />
  )
})

/**
 * Clip properties panel - shown when one or more clips are selected.
 * Displays and allows editing of clip visual, audio, and effect properties.
 *
 * The store bridge above defers transform-only snapshots so the large inspector
 * does not join the canvas mouseup commit. The final gizmo handoff keeps the
 * preview exact while these controls catch up.
 */
const ClipPanelCore = memo(function ClipPanelCore({
  selectedItems,
  audioPanelItems,
}: {
  selectedItems: TimelineItem[]
  audioPanelItems: TimelineItem[]
}) {
  const { t } = useTranslation()
  // Granular selectors with explicit types
  const clipInspectorTab = useEditorStore((s) => s.clipInspectorTab)
  const workspace = useEditorStore((s) => s.workspace)
  const setClipInspectorTab = useEditorStore((s) => s.setClipInspectorTab)
  const setWorkspace = useEditorStore((s) => s.setWorkspace)
  const handleEditInColor = useCallback(() => setWorkspace('color'), [setWorkspace])
  const updateItemsTransform = useTimelineStore(
    (s: TimelineState & TimelineActions) => s.updateItemsTransform,
  )
  const projectWidth = useProjectStore(
    (s) => s.currentProject?.metadata.width ?? DEFAULT_PROJECT_WIDTH,
  )
  const projectHeight = useProjectStore(
    (s) => s.currentProject?.metadata.height ?? DEFAULT_PROJECT_HEIGHT,
  )
  const projectFps = useProjectStore((s) => s.currentProject?.metadata.fps ?? DEFAULT_PROJECT_FPS)
  // Canvas settings
  const canvas = useMemo(
    () => ({
      width: projectWidth,
      height: projectHeight,
      fps: projectFps,
    }),
    [projectFps, projectHeight, projectWidth],
  )

  // CONSOLIDATED: Single pass for all item type checks
  const itemTypeInfo = useMemo(() => computeItemTypeInfo(selectedItems), [selectedItems])

  // Destructure for cleaner usage
  const {
    hasVisualItems,
    hasVideoItems,
    hasCompositionItems,
    hasLottieItems,
    hasGifItems,
    hasAudioItems,
    hasTextItems,
    hasShapeItems,
    hasAdjustmentItems,
    hasSubtitleItems,
    hasVirtualSubtitleItems,
    isOnlyTextOrShape,
    isOnlyText,
    isOnlyShape,
    isOnlyController,
  } = itemTypeInfo

  // Memoized filtered arrays for child components - prevents new array creation each render
  const layoutFillItems = useMemo(
    () =>
      selectedItems.filter(
        (item: TimelineItem) => item.type !== 'audio' && item.type !== 'adjustment',
      ),
    [selectedItems],
  )

  const mediaTransformItems = useMemo(
    () =>
      selectedItems.filter(
        (item): item is VideoItem | CompositionItem =>
          item.type === 'video' || item.type === 'composition',
      ),
    [selectedItems],
  )

  const visualItems = useMemo(
    () =>
      selectedItems.filter(
        (item: TimelineItem) => item.type !== 'audio' && item.type !== 'controller',
      ),
    [selectedItems],
  )
  const paintableLayoutItems = useMemo(
    () => layoutFillItems.filter((item) => item.type !== 'controller'),
    [layoutFillItems],
  )

  // Compute aspectLocked from items' transforms
  // If any item has explicit aspectRatioLocked, use that; otherwise use default based on type
  const aspectLocked = useMemo(() => {
    if (selectedItems.length === 0) return true

    // Check if any item has explicit aspectRatioLocked set
    const firstWithExplicit = selectedItems.find(
      (item: TimelineItem) => item.transform?.aspectRatioLocked !== undefined,
    )
    if (firstWithExplicit) {
      return firstWithExplicit.transform!.aspectRatioLocked!
    }

    // Default based on item types: text/shape = unlocked, others = locked
    return !isOnlyTextOrShape
  }, [selectedItems, isOnlyTextOrShape])

  // Toggle aspect lock - updates all selected items' transforms
  const handleAspectLockToggle = useCallback(() => {
    const newValue = !aspectLocked
    const itemIds = selectedItems.map((item: TimelineItem) => item.id)
    updateItemsTransform(itemIds, { aspectRatioLocked: newValue })
  }, [aspectLocked, selectedItems, updateItemsTransform])

  // Handle transform changes
  const handleTransformChange = useCallback(
    (ids: string[], updates: Partial<TransformProperties>) => {
      updateItemsTransform(ids, updates)
    },
    [updateItemsTransform],
  )

  // Edit always exposes one clip-level Animation surface. Motion uses the same
  // tab id for its full authoring library, preserving inspector state while the
  // user-facing concepts remain distinct.
  const showVideoTab = layoutFillItems.length > 0
  const showAudioTab = hasAudioItems
  const showFullMotionLibrary = workspace === 'motion' && hasVisualItems
  const showMotionTab = hasVisualItems
  const showSecondTab = showAudioTab
  const showEffectsTab = visualItems.length > 0
  const visualItemIds = useMemo(() => visualItems.map((item) => item.id), [visualItems])

  const availableTabs = useMemo(() => {
    const tabs: ClipInspectorTab[] = []
    if (showVideoTab) tabs.push('video')
    if (showSecondTab) tabs.push('audio')
    if (workspace === 'motion') {
      if (showMotionTab) tabs.push('motion')
      if (showEffectsTab) tabs.push('effects')
    } else {
      if (showEffectsTab) tabs.push('effects')
      if (showMotionTab) tabs.push('motion')
    }
    return tabs
  }, [showMotionTab, showSecondTab, showEffectsTab, showVideoTab, workspace])

  const fallbackTab = availableTabs[0] ?? 'video'
  const activeTab = availableTabs.includes(clipInspectorTab) ? clipInspectorTab : fallbackTab

  useEffect(() => {
    if (selectedItems.length === 0) return
    if (clipInspectorTab !== activeTab) {
      setClipInspectorTab(activeTab)
    }
  }, [activeTab, clipInspectorTab, selectedItems.length, setClipInspectorTab])

  const handleTabChange = useCallback(
    (value: string) => {
      // Playback can keep the main thread busy with synchronous GPU canvas
      // handoffs. Commit this discrete inspector interaction before returning
      // to that loop so the requested tab never sits blank until playback
      // pauses.
      flushSync(() => {
        setClipInspectorTab(value as ClipInspectorTab)
      })
    },
    [setClipInspectorTab],
  )

  // Per-tab label + icon. Motion presents base properties, animation authoring,
  // then effects; Edit retains its media-first inspector ordering.
  const getTabMeta = (value: ClipInspectorTab): { label: string; icon: LucideIcon } => {
    if (value === 'video') {
      if (workspace === 'motion') {
        return {
          label: t('editor.clipPanel.tabProperties', { defaultValue: 'Properties' }),
          icon: SlidersHorizontal,
        }
      }
      if (isOnlyText) return { label: t('editor.clipPanel.tabText'), icon: Type }
      if (isOnlyShape) return { label: t('editor.clipPanel.tabShape'), icon: Shapes }
      if (isOnlyController) {
        return {
          label: t('editor.clipPanel.tabController', { defaultValue: 'Null Object' }),
          icon: Crosshair,
        }
      }
      return { label: t('editor.clipPanel.tabVideo'), icon: Film }
    }
    if (value === 'audio') {
      return { label: t('editor.clipPanel.tabAudio'), icon: Volume2 }
    }
    if (value === 'motion') {
      return {
        label:
          workspace === 'motion'
            ? t('editor.clipPanel.tabAnimate', { defaultValue: 'Animate' })
            : t('editor.clipPanel.tabAnimation'),
        icon: WandSparkles,
      }
    }
    return { label: t('editor.clipPanel.tabEffects'), icon: Sparkles }
  }
  const tabGridColsClass =
    availableTabs.length <= 1
      ? 'grid-cols-1'
      : availableTabs.length === 2
        ? 'grid-cols-2'
        : availableTabs.length === 3
          ? 'grid-cols-3'
          : 'grid-cols-4'

  if (selectedItems.length === 0) {
    return null
  }

  const motionUsesFullHeight = activeTab === 'motion' && showFullMotionLibrary

  return (
    <div className={cn(motionUsesFullHeight ? 'h-full min-h-0' : 'space-y-3')}>
      {/* Tabbed sections */}
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className={cn('w-full', motionUsesFullHeight && 'flex h-full min-h-0 flex-col')}
      >
        <TabsList className={cn('grid h-8 w-full shrink-0', tabGridColsClass)}>
          {availableTabs.map((value) => {
            const { label, icon: Icon } = getTabMeta(value)
            return (
              <TabsTrigger key={value} value={value} className="text-xs gap-1 px-2">
                <Icon className="h-3 w-3" />
                {label}
              </TabsTrigger>
            )
          })}
        </TabsList>

        {/* Video Tab - visual layout, content, and clip-specific controls */}
        <TabsContent value="video" className="mt-3">
          {showVideoTab && (
            <div className="divide-y divide-border [&>*]:py-4 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
              {showVideoTab && (
                <LayoutSection
                  items={layoutFillItems}
                  mediaTransformItems={mediaTransformItems}
                  canvas={canvas}
                  onTransformChange={handleTransformChange}
                  aspectLocked={aspectLocked}
                  onAspectLockToggle={handleAspectLockToggle}
                />
              )}
              <CompositionControlsSection items={selectedItems} />
              {(hasVideoItems || hasCompositionItems) && <VideoSection items={selectedItems} />}
              {paintableLayoutItems.length > 0 && (
                <FillSection
                  items={paintableLayoutItems}
                  canvas={canvas}
                  onTransformChange={handleTransformChange}
                />
              )}
              {paintableLayoutItems.length > 0 && <CornerPinSection items={paintableLayoutItems} />}
              {paintableLayoutItems.length > 0 && <Projection360Section items={paintableLayoutItems} />}
              {hasTextItems && (
                <Suspense fallback={null}>
                  <LazyTextContentSection items={selectedItems} canvas={canvas} />
                </Suspense>
              )}
              {/* Text-only: Style (shadow/stroke) lives with the text, not on
                  the Effects tab. Mixed selections keep it under Effects. */}
              {isOnlyText && (
                <Suspense fallback={null}>
                  <LazyTextStyleSection items={selectedItems} canvas={canvas} />
                </Suspense>
              )}
              {hasShapeItems && <ShapeSection items={selectedItems} />}
              {(hasSubtitleItems || hasVirtualSubtitleItems) && (
                <Suspense fallback={null}>
                  <LazySubtitleSection items={selectedItems} canvas={canvas} />
                </Suspense>
              )}
              {hasGifItems && <GifSection items={selectedItems} />}
              {hasLottieItems && <LottieSection items={selectedItems} />}
            </div>
          )}
        </TabsContent>

        {/* Motion Tab — the composition's single preset, procedural, text
            motion, bake, and saved-animation surface. */}
        <TabsContent value="motion" className="mt-3 min-h-0 flex-1 data-[state=inactive]:hidden">
          {showMotionTab && activeTab === 'motion' ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="min-h-0 flex-1">
                {showFullMotionLibrary ? (
                  <Suspense fallback={<div className="h-full rounded-md bg-muted/20" />}>
                    <LazyAnimationPresetLibrary canvas={canvas} embedded />
                  </Suspense>
                ) : (
                  <Suspense fallback={<div className="h-24 rounded-md bg-muted/20" />}>
                    <LazyAnimationPresetLibrary
                      canvas={canvas}
                      embedded
                      variant="edit"
                      itemIds={visualItemIds}
                    />
                  </Suspense>
                )}
              </div>
            </div>
          ) : null}
        </TabsContent>

        {/* Audio stays media-specific; text animation lives in Animation. */}
        <TabsContent value="audio" className="space-y-4 mt-3">
          {hasAudioItems && activeTab === 'audio' && (
            <Suspense fallback={null}>
              <LazyAudioSection items={audioPanelItems} />
            </Suspense>
          )}
        </TabsContent>

        {/* Effects Tab - clip effects plus text styling and animation */}
        <TabsContent value="effects" className="space-y-4 mt-3">
          {hasVisualItems && (
            <>
              {/* Explanatory text for adjustment layers */}
              {hasAdjustmentItems && (
                <div className="px-2 py-2 text-xs text-muted-foreground bg-purple-500/10 rounded border border-purple-500/20">
                  {t('editor.clipPanel.adjustmentLayerHint')}
                </div>
              )}
              <EffectsSection items={visualItems} onEditInColor={handleEditInColor} />
              {/* Text style + animation only share the Effects tab for mixed
                  selections; a pure-text selection has dedicated Text /
                  Animation tabs. */}
              {hasTextItems && !isOnlyText && <Separator />}
              {hasTextItems && !isOnlyText && (
                <Suspense fallback={null}>
                  <LazyTextEffectsSection items={selectedItems} canvas={canvas} />
                </Suspense>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
})
