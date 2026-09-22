import { type MotionSelectionDragState, buildMotionSelectionDragState, buildMotionSelectionFrameUpdates, getMotionCompositionSnapFrames, mergeMotionKeyframeSelection } from './motion-keyframe-selection'
import type { MotionTimeViewport } from './motion-time-viewport-controller'
import { LAYER_COLUMN_WIDTH, MOTION_INLINE_PROPERTY_GROUP_IDS, RULER_DIVISIONS, useSettledMotionFrame } from './motion-timeline-primitives'
import { MOTION_VECTOR_ROW_DEFINITIONS, buildMotionVectorSeparationProperties, canCombineMotionVectorRowWithoutBake, isMotionVectorRowSeparated, motionVectorSeparationNeedsBake, shouldUseMotionVectorRow, toMotionVectorProxyKeyframes } from './motion-vector-rows'
import { getSourceDimensions, resolveItemTransformAtFrame, resolveTransform } from '@/features/editor/deps/composition-runtime'
import { getAnimatablePropertyBaseValue } from '@/features/editor/deps/keyframes'
import { findStoredVectorKeyframe, getStoredVectorKeyframeId, getVectorPropertyProxy, toVectorScalePercent } from '@/features/editor/deps/keyframes-contract'
import { type ItemPreview, useGizmoStore } from '@/features/editor/deps/preview'
import { DopesheetEditor, GROUP_HEADER_HEIGHT, ROW_HEIGHT, addKeyframe, buildVectorPromotionPlan, captureSnapshot, getProceduralBands, getPropertyAccordionGroups, getPropertyDisplayGroups, getShapeAnimatableBaseValue, interpolatePropertyValue, promoteTransformToVector, removeKeyframes, removeVectorKeyframe, resolveAnimatedShapeItem, resolveAnimatedTransform, resolveExpressionReferenceValue, setVectorDimensionsSeparated, updateItem, updateKeyframe, updateKeyframes, updateVectorKeyframe, upsertVectorKeyframe, useItemsStore, useKeyframeSelectionStore, useKeyframesStore, useRafCoalescedValue, useTimelineCommandStore, useTimelineSettingsStore } from '@/features/editor/deps/timeline-motion'
import { useEditorStore } from '@/shared/state/editor'
import { hasEnabledProceduralMotion } from '@/shared/timeline/procedural-motion'
import { cn } from '@/shared/ui/cn'
import { worldToLocalTransform } from '@/shared/utils/transform-parenting'
import { type AnimatableProperty, type DirectLinkableProperty, type ItemKeyframes, type Keyframe, type KeyframeRef, type VectorAnimatableProperty, type VectorKeyframe, getDirectPropertyLinks, isShapeAnimatableProperty, isTransformAnimatableProperty } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import type { ResolvedTransform } from '@/types/transform'
import {memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { toast } from 'sonner'

// The embedded dopesheet: the row/property model, the content tree and the
// classic lanes view that the timeline core renders.

const POSITION_VECTOR_ROW = MOTION_VECTOR_ROW_DEFINITIONS.find(
  (row) => row.property === 'position',
)!

const MAX_DIMENSION_BAKE_FRAMES = 10_000

const MOTION_GRAPH_INLINE_PROPERTY_GROUP_IDS = [
  'transform',
  ...MOTION_INLINE_PROPERTY_GROUP_IDS,
] as const

const MOTION_INLINE_PROPERTY_GROUP_ID_SET: ReadonlySet<string> = new Set(
  MOTION_INLINE_PROPERTY_GROUP_IDS,
)

interface MotionDopesheetLanesProps {
  item: TimelineItem
  itemById: Record<string, TimelineItem>
  itemKeyframes: ItemKeyframes | undefined
  properties: AnimatableProperty[]
  compositionDurationInFrames: number
  fps: number
  canvas: { width: number; height: number }
  propertyFilter: 'all' | 'keyframed'
  timeViewport: MotionTimeViewport
  inlineCurveProperty: AnimatableProperty | null
  paneMode?: 'lanes' | 'graph'
  disabled?: boolean
  onSelectItem: (itemId: string) => void
  onInlineCurveChange: (property: AnimatableProperty | null) => void
  onScrub: (frame: number) => void
  onTimeViewportChange: (viewport: MotionTimeViewport) => void
  onPropertyLinkPointerDown?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    itemId: string,
    property: DirectLinkableProperty,
  ) => void
  onRemovePropertyLink?: (itemId: string, property: DirectLinkableProperty) => void
  onSetPropertyExpression?: (
    itemId: string,
    property: DirectLinkableProperty,
    source: string,
    enabled: boolean,
  ) => void
  onRemovePropertyExpression?: (itemId: string, property: DirectLinkableProperty) => void
}

function areItemsEqualForMotionDopesheet(previous: TimelineItem, next: TimelineItem): boolean {
  if (previous === next) return true

  const previousRecord = previous as unknown as Record<string, unknown>
  const nextRecord = next as unknown as Record<string, unknown>
  const keys = new Set([...Object.keys(previousRecord), ...Object.keys(nextRecord)])
  for (const key of keys) {
    // Text-motion bands are rendered by TextMotionTimelineLanes. Their live
    // duration edits do not affect keyframes or base property values, so they
    // must not invalidate the much heavier dopesheet subtree.
    if (key === 'textMotion') continue
    if (previousRecord[key] !== nextRecord[key]) return false
  }
  return true
}

// fallow-ignore-next-line complexity
function areMotionDopesheetLanesPropsEqual(
  previous: MotionDopesheetLanesProps,
  next: MotionDopesheetLanesProps,
): boolean {
  return (
    areItemsEqualForMotionDopesheet(previous.item, next.item) &&
    previous.compositionDurationInFrames === next.compositionDurationInFrames &&
    previous.fps === next.fps &&
    previous.canvas.width === next.canvas.width &&
    previous.canvas.height === next.canvas.height &&
    previous.propertyFilter === next.propertyFilter &&
    previous.timeViewport.startFrame === next.timeViewport.startFrame &&
    previous.timeViewport.endFrame === next.timeViewport.endFrame &&
    previous.inlineCurveProperty === next.inlineCurveProperty &&
    previous.paneMode === next.paneMode &&
    previous.disabled === next.disabled &&
    previous.onPropertyLinkPointerDown === next.onPropertyLinkPointerDown &&
    previous.onRemovePropertyLink === next.onRemovePropertyLink &&
    previous.onSetPropertyExpression === next.onSetPropertyExpression &&
    previous.onRemovePropertyExpression === next.onRemovePropertyExpression &&
    previous.itemById === next.itemById &&
    previous.itemKeyframes === next.itemKeyframes &&
    previous.properties.length === next.properties.length &&
    previous.properties.every((property, index) => property === next.properties[index])
  )
}

function useNearMotionScrollViewport(
  rootRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
): boolean {
  const [isNearScrollViewport, setIsNearScrollViewport] = useState(
    () => !enabled || typeof IntersectionObserver === 'undefined',
  )
  useEffect(() => {
    if (!enabled) {
      setIsNearScrollViewport(true)
      return
    }
    const node = rootRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const motionScrollRoot = node.closest('[data-testid="motion-layer-scroll-area"]')
    let isIntersecting = true
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        isIntersecting = entry.isIntersecting
        if (!entry.isIntersecting && node.contains(document.activeElement)) return
        setIsNearScrollViewport(entry.isIntersecting)
      },
      {
        root: motionScrollRoot,
        rootMargin: '160px 0px',
      },
    )
    const handleFocusOut = (event: FocusEvent) => {
      if (isIntersecting || node.contains(event.relatedTarget as Node | null)) return
      setIsNearScrollViewport(false)
    }
    observer.observe(node)
    node.addEventListener('focusout', handleFocusOut)
    return () => {
      observer.disconnect()
      node.removeEventListener('focusout', handleFocusOut)
    }
  }, [enabled, rootRef])
  return isNearScrollViewport
}

function getEstimatedMotionDopesheetLaneHeight({
  item,
  itemKeyframes,
  properties,
  propertyFilter,
  expandedGroups,
}: Pick<MotionDopesheetLanesProps, 'item' | 'itemKeyframes' | 'properties' | 'propertyFilter'> & {
  expandedGroups?: Readonly<Record<string, boolean>>
}): number {
  const supportsVectorTransform = item.type !== 'audio' && item.type !== 'adjustment'
  const hiddenPropertyRows = new Set<AnimatableProperty>(
    supportsVectorTransform
      ? MOTION_VECTOR_ROW_DEFINITIONS.filter(
          (row) =>
            properties.includes(row.primary) &&
            properties.includes(row.secondary) &&
            shouldUseMotionVectorRow(itemKeyframes, row),
        ).map((row) => row.secondary)
      : [],
  )
  const scalarKeyframesByProperty = new Map(
    (itemKeyframes?.properties ?? []).map((entry) => [entry.property, entry.keyframes] as const),
  )
  const keyframesByProperty = Object.fromEntries(
    properties.map((property) => [property, scalarKeyframesByProperty.get(property) ?? []]),
  ) as Partial<Record<AnimatableProperty, Keyframe[]>>
  const proceduralPropertyIds = new Set(
    getProceduralBands(item.motionModifiers, item.durationInFrames, item.from).keys(),
  )
  const visibleProperties =
    propertyFilter === 'keyframed'
      ? properties.filter((property) =>
          isMotionPropertyVisible(
            property,
            keyframesByProperty,
            itemKeyframes,
            proceduralPropertyIds,
          ),
        )
      : properties
  const renderedVisibleProperties = visibleProperties.filter(
    (property) => !hiddenPropertyRows.has(property),
  )
  if (propertyFilter === 'keyframed' && renderedVisibleProperties.length === 0) return ROW_HEIGHT
  const displayGroups = getPropertyDisplayGroups(renderedVisibleProperties)
  const nonInlineGroups = displayGroups.filter(
    (group) => !MOTION_INLINE_PROPERTY_GROUP_ID_SET.has(group.id),
  )
  const visiblePropertyCount = displayGroups.reduce(
    (count, group) =>
      MOTION_INLINE_PROPERTY_GROUP_ID_SET.has(group.id) || expandedGroups?.[group.id] !== false
        ? count + group.properties.length
        : count,
    0,
  )
  return Math.max(
    ROW_HEIGHT,
    visiblePropertyCount * ROW_HEIGHT + nonInlineGroups.length * GROUP_HEADER_HEIGHT,
  )
}

function getMotionDopesheetLaneHeight(
  paneMode: 'lanes' | 'graph',
  laneContentHeight: number,
): number | undefined {
  return paneMode === 'lanes' ? Math.max(ROW_HEIGHT, laneContentHeight) : undefined
}

function withoutPropertyExpressions(itemKeyframes: ItemKeyframes | undefined) {
  if (!itemKeyframes) return undefined
  return {
    ...itemKeyframes,
    propertyLinks: [...getDirectPropertyLinks(itemKeyframes)],
    expressions: [],
  }
}

function getMotionVectorValue(
  property: VectorAnimatableProperty,
  transform: ReturnType<typeof resolveTransform>,
  baseTransform: ReturnType<typeof resolveTransform>,
): { x: number; y: number } {
  if (property === 'position') return { x: transform.x, y: transform.y }
  if (property === 'scale') {
    return {
      x: toVectorScalePercent(transform.width, baseTransform.width),
      y: toVectorScalePercent(transform.height, baseTransform.height),
    }
  }
  return { x: transform.anchorX, y: transform.anchorY }
}

type GizmoPositionPreview = { x: number; y: number } | null

interface MotionPositionValueSource {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => GizmoPositionPreview
}

interface MotionScaleValueSource {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => { x: number; y: number } | null
  setSnapshot: (value: { x: number; y: number }) => void
  clear: () => void
}

function useMotionScaleValueSource(): MotionScaleValueSource {
  return useMemo(() => {
    const listeners = new Set<() => void>()
    let snapshot: { x: number; y: number } | null = null
    const emit = () => {
      for (const listener of listeners) listener()
    }
    return {
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      getSnapshot: () => snapshot,
      setSnapshot: (value: { x: number; y: number }) => {
        if (snapshot?.x === value.x && snapshot.y === value.y) return
        snapshot = value
        emit()
      },
      clear: () => {
        if (snapshot === null) return
        snapshot = null
        emit()
      },
    }
  }, [])
}

interface MotionPositionValueContext {
  item: TimelineItem
  resolvedTransform: ResolvedTransform | null
  committedValue: { x: number; y: number } | null
  itemById: Record<string, TimelineItem>
  allKeyframesByItemId: Record<string, ItemKeyframes>
  canvas: { width: number; height: number }
  fps: number
  currentFrame: number
}

function areMotionPositionsEqual(
  previous: GizmoPositionPreview,
  next: GizmoPositionPreview,
): boolean {
  return (
    previous === next ||
    (previous !== null && next !== null && previous.x === next.x && previous.y === next.y)
  )
}

function createMotionPositionValueSource(
  getContext: () => MotionPositionValueContext,
): MotionPositionValueSource {
  const listeners = new Set<() => void>()
  let unsubscribeFromGizmo: (() => void) | null = null
  let animationFrameId: number | null = null
  let cachedSnapshot: GizmoPositionPreview = null
  let emittedSnapshot: GizmoPositionPreview = null
  let acknowledgedHandoffId: number | null = null

  const cacheSnapshot = (next: GizmoPositionPreview): GizmoPositionPreview => {
    if (areMotionPositionsEqual(cachedSnapshot, next)) return cachedSnapshot
    cachedSnapshot = next
    return cachedSnapshot
  }

  const getSnapshot = (): GizmoPositionPreview => {
    const context = getContext()
    const gizmoState = useGizmoStore.getState()
    const active =
      gizmoState.activeGizmo?.itemId === context.item.id && gizmoState.previewTransform
        ? {
            interactionId: gizmoState.activeGizmo.interactionId,
            transform: gizmoState.previewTransform,
          }
        : null
    const handoff =
      !active && gizmoState.presentationHandoff?.itemId === context.item.id
        ? gizmoState.presentationHandoff
        : null

    if (!active && (!handoff || acknowledgedHandoffId === handoff.interactionId)) {
      return cacheSnapshot(null)
    }
    if (!context.resolvedTransform) return cacheSnapshot(null)
    if (active) acknowledgedHandoffId = null

    const target = active?.transform ?? handoff!.finalTransform
    const previewWorldTransform = {
      ...context.resolvedTransform,
      x: target.x,
      y: target.y,
    }
    const parentId = context.item.transformParent?.parentItemId
    const parent = parentId ? context.itemById[parentId] : undefined
    const parentWorldTransform = parent
      ? resolveItemTransformAtFrame(parent, {
          canvas: { ...context.canvas, fps: context.fps },
          frame: context.currentFrame,
          keyframes: context.allKeyframesByItemId[parent.id],
          getItem: (candidateId) => context.itemById[candidateId],
          getKeyframes: (candidateId) => context.allKeyframesByItemId[candidateId],
        })
      : undefined
    const local = worldToLocalTransform(
      previewWorldTransform,
      context.item.transformParent,
      parentWorldTransform,
    )

    if (
      handoff &&
      context.committedValue &&
      Math.abs(local.x - context.committedValue.x) < 0.001 &&
      Math.abs(local.y - context.committedValue.y) < 0.001
    ) {
      acknowledgedHandoffId = handoff.interactionId
      return cacheSnapshot(null)
    }

    return cacheSnapshot({ x: local.x, y: local.y })
  }

  const flush = () => {
    animationFrameId = null
    const next = getSnapshot()
    if (next === emittedSnapshot) return
    emittedSnapshot = next
    for (const listener of listeners) listener()
  }

  const schedule = () => {
    if (animationFrameId !== null) return
    animationFrameId = requestAnimationFrame(flush)
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      if (listeners.size === 1) {
        emittedSnapshot = getSnapshot()
        unsubscribeFromGizmo = useGizmoStore.subscribe(schedule)
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size > 0) return
        unsubscribeFromGizmo?.()
        unsubscribeFromGizmo = null
        if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
        animationFrameId = null
      }
    },
    getSnapshot,
  }
}

function useMotionPositionValueSource(
  context: MotionPositionValueContext,
): MotionPositionValueSource {
  const contextRef = useRef(context)
  contextRef.current = context
  return useMemo(() => createMotionPositionValueSource(() => contextRef.current), [])
}

interface ResolvedMotionVectorReference {
  reference: KeyframeRef
  proxy: { property: VectorAnimatableProperty; axis: 'x' | 'y' }
  keyframe: VectorKeyframe
}

function resolveMotionVectorReference(
  itemKeyframes: ItemKeyframes | undefined,
  reference: KeyframeRef,
): ResolvedMotionVectorReference | null {
  const proxy = getVectorPropertyProxy(reference.property)
  if (!proxy) return null
  const keyframe = findStoredVectorKeyframe(
    itemKeyframes,
    proxy.property,
    getStoredVectorKeyframeId(reference.keyframeId, proxy.axis),
  )
  return keyframe ? { reference, proxy, keyframe } : null
}

function partitionMotionVectorReferences(
  itemKeyframes: ItemKeyframes | undefined,
  references: readonly KeyframeRef[],
): { scalar: KeyframeRef[]; vector: ResolvedMotionVectorReference[] } {
  const scalar: KeyframeRef[] = []
  const vector: ResolvedMotionVectorReference[] = []
  const seenVectorKeys = new Set<string>()
  for (const reference of references) {
    const resolved = resolveMotionVectorReference(itemKeyframes, reference)
    if (!resolved) {
      scalar.push(reference)
      continue
    }
    const vectorKey = `${resolved.proxy.property}:${resolved.keyframe.id}`
    if (seenVectorKeys.has(vectorKey)) continue
    seenVectorKeys.add(vectorKey)
    vector.push(resolved)
  }
  return { scalar, vector }
}

function getSelectedMotionVectorKeyframes(
  itemKeyframes: ItemKeyframes | undefined,
  selectedKeyframes: readonly KeyframeRef[],
  itemId: string,
  property: VectorAnimatableProperty,
): VectorKeyframe[] {
  return partitionMotionVectorReferences(
    itemKeyframes,
    selectedKeyframes.filter((reference) => reference.itemId === itemId),
  ).vector.flatMap((entry) => (entry.proxy.property === property ? [entry.keyframe] : []))
}

function useMotionPropertySystems(params: {
  item: TimelineItem
  itemKeyframes: ItemKeyframes | undefined
  properties: AnimatableProperty[]
  canvas: { width: number; height: number }
  fps: number
  currentFrame: number
  relativeFrame: number
  itemById: Record<string, TimelineItem>
  allKeyframesByItemId: Record<string, ItemKeyframes>
  originalKeyframesByProperty: Partial<Record<AnimatableProperty, Keyframe[]>>
  selectedKeyframeValueByProperty: Partial<Record<AnimatableProperty, number>>
  paneMode: 'lanes' | 'graph'
  onPropertyLinkPointerDown: MotionDopesheetLanesProps['onPropertyLinkPointerDown']
  onRemovePropertyLink: MotionDopesheetLanesProps['onRemovePropertyLink']
}) {
  const {
    item,
    itemKeyframes,
    properties,
    canvas,
    fps,
    currentFrame,
    relativeFrame,
    itemById,
    allKeyframesByItemId,
    originalKeyframesByProperty,
    selectedKeyframeValueByProperty,
    paneMode,
    onPropertyLinkPointerDown,
    onRemovePropertyLink,
  } = params
  const buildValues = useCallback(
    (keyframes: ItemKeyframes | undefined) =>
      buildMotionPropertyValues({
        item,
        itemKeyframes: keyframes,
        properties,
        canvas,
        fps,
        currentFrame,
        relativeFrame,
        itemById,
        allKeyframesByItemId,
        originalKeyframesByProperty,
        selectedKeyframeValueByProperty,
      }),
    [
      allKeyframesByItemId,
      canvas,
      currentFrame,
      fps,
      item,
      itemById,
      originalKeyframesByProperty,
      properties,
      relativeFrame,
      selectedKeyframeValueByProperty,
    ],
  )
  const propertyValues = useMemo(() => buildValues(itemKeyframes), [buildValues, itemKeyframes])
  const preExpressionPropertyValues = useMemo(
    () => buildValues(withoutPropertyExpressions(itemKeyframes)),
    [buildValues, itemKeyframes],
  )
  const resolveExpressionReference = useCallback(
    (sourceItemId: string, sourceProperty: DirectLinkableProperty) =>
      resolveExpressionReferenceValue(sourceItemId, sourceProperty, {
        globalFrame: currentFrame,
        canvas: { ...canvas, fps },
        getItem: (candidateId) => itemById[candidateId],
        getKeyframes: (candidateId) => allKeyframesByItemId[candidateId],
      }),
    [allKeyframesByItemId, canvas, currentFrame, fps, itemById],
  )
  const propertyLinkSourceLabels = useMemo(
    () => buildPropertyLinkSourceLabels(itemKeyframes, itemById),
    [itemById, itemKeyframes],
  )
  const propertyLinkHandlers = useMemo(
    () =>
      buildPropertyLinkHandlers({
        itemId: item.id,
        paneMode,
        onPointerDown: onPropertyLinkPointerDown,
        onRemove: onRemovePropertyLink,
      }),
    [item.id, onPropertyLinkPointerDown, onRemovePropertyLink, paneMode],
  )
  return {
    propertyValues,
    preExpressionPropertyValues,
    resolveExpressionReference,
    propertyLinkSourceLabels,
    propertyLinkHandlers,
  }
}

interface MotionDopesheetContentProps extends MotionDopesheetLanesProps {
  initialExpandedGroups?: Readonly<Record<string, boolean>>
  onExpandedGroupsChange?: (expandedGroups: Record<string, boolean>) => void
  onRenderedHeightChange?: (height: number) => void
}

// This orchestration component coordinates independent memoized lane interactions.
// It is mounted only by the near-viewport shell below so its store subscriptions
// and property derivations never run for distant expanded rows.
// fallow-ignore-next-line complexity
const MotionDopesheetContent = memo(function MotionDopesheetContent({
  item,
  itemKeyframes,
  properties,
  compositionDurationInFrames,
  fps,
  canvas,
  propertyFilter,
  timeViewport,
  inlineCurveProperty,
  paneMode = 'lanes',
  disabled = false,
  onSelectItem,
  onInlineCurveChange,
  onScrub,
  onTimeViewportChange,
  onPropertyLinkPointerDown,
  onRemovePropertyLink,
  onSetPropertyExpression,
  onRemovePropertyExpression,
  initialExpandedGroups,
  onExpandedGroupsChange,
  onRenderedHeightChange,
  itemById,
}: MotionDopesheetContentProps) {
  const currentFrame = useSettledMotionFrame()
  const rootRef = useRef<HTMLDivElement>(null)
  const dragSnapshotRef = useRef<ReturnType<typeof captureSnapshot> | null>(null)
  const crossLayerDragRef = useRef<MotionSelectionDragState | null>(null)
  const pendingCrossLayerDeltaRef = useRef<number | null>(null)
  const crossLayerPreviewFrameRef = useRef<number | null>(null)
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 })
  const [expressionDockHeight, setExpressionDockHeight] = useState(0)
  const allKeyframesByItemId = useKeyframesStore((state) => state.keyframesByItemId)
  const _updateKeyframe = useKeyframesStore((state) => state._updateKeyframe)
  const _updateKeyframes = useKeyframesStore((state) => state._updateKeyframes)
  const _updateVectorKeyframe = useKeyframesStore((state) => state._updateVectorKeyframe)
  const selectedKeyframes = useKeyframeSelectionStore((state) => state.selectedKeyframes)
  const selectKeyframes = useKeyframeSelectionStore((state) => state.selectKeyframes)
  const clearKeyframeSelection = useKeyframeSelectionStore((state) => state.clearSelection)
  const setKeyframeEditorShortcutScopeActive = useEditorStore(
    (state) => state.setKeyframeEditorShortcutScopeActive,
  )

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const updateSize = () => {
      const rect = root.getBoundingClientRect()
      setPaneSize({ width: rect.width || 820, height: rect.height })
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useEffect(
    () => () => setKeyframeEditorShortcutScopeActive(false),
    [setKeyframeEditorShortcutScopeActive],
  )

  const scalarKeyframesByProperty = useMemo(() => {
    const byProperty = new Map(
      (itemKeyframes?.properties ?? []).map((entry) => [entry.property, entry.keyframes] as const),
    )
    return Object.fromEntries(
      properties.map((property) => [property, byProperty.get(property) ?? []]),
    ) as Partial<Record<AnimatableProperty, Keyframe[]>>
  }, [itemKeyframes, properties])

  const supportsVectorTransform = item.type !== 'audio' && item.type !== 'adjustment'
  const vectorBaseTransform = useMemo(
    () =>
      supportsVectorTransform
        ? resolveTransform(item, { ...canvas, fps }, getSourceDimensions(item))
        : null,
    [canvas, fps, item, supportsVectorTransform],
  )
  const motionVectorRows = useMemo(
    () =>
      supportsVectorTransform
        ? MOTION_VECTOR_ROW_DEFINITIONS.filter(
            (row) =>
              properties.includes(row.primary) &&
              properties.includes(row.secondary) &&
              shouldUseMotionVectorRow(itemKeyframes, row),
          )
        : [],
    [itemKeyframes, properties, supportsVectorTransform],
  )
  const positionDimensionsSeparated = isMotionVectorRowSeparated(itemKeyframes, POSITION_VECTOR_ROW)
  const hiddenPropertyRows = useMemo<AnimatableProperty[]>(
    () => motionVectorRows.map((row) => row.secondary),
    [motionVectorRows],
  )
  const originalKeyframesByProperty = useMemo(() => {
    const result = { ...scalarKeyframesByProperty }
    if (!vectorBaseTransform) return result
    for (const row of motionVectorRows) {
      const lane =
        itemKeyframes?.vectorProperties?.find((candidate) => candidate.property === row.property) ??
        buildVectorPromotionPlan({
          property: row.property,
          itemKeyframes,
          baseTransform: vectorBaseTransform,
          createId: (frame) => `motion-${row.property}-${frame}`,
        }).vectorProperty
      result[row.primary] = toMotionVectorProxyKeyframes(lane.keyframes, 'x')
      result[row.secondary] = toMotionVectorProxyKeyframes(lane.keyframes, 'y')
    }
    return result
  }, [itemKeyframes, motionVectorRows, scalarKeyframesByProperty, vectorBaseTransform])

  const keyframesByProperty = useMemo(
    () =>
      Object.fromEntries(
        properties.map((property) => [
          property,
          (originalKeyframesByProperty[property] ?? []).map((keyframe) => ({
            ...keyframe,
            frame: item.from + keyframe.frame,
          })),
        ]),
      ),
    [item.from, originalKeyframesByProperty, properties],
  )

  const relativeFrame = Math.max(0, Math.min(item.durationInFrames - 1, currentFrame - item.from))
  const selectedKeyframeValueByProperty = useMemo(() => {
    const values: Partial<Record<AnimatableProperty, number>> = {}
    for (let index = selectedKeyframes.length - 1; index >= 0; index -= 1) {
      const reference = selectedKeyframes[index]!
      if (reference.itemId !== item.id || values[reference.property] !== undefined) continue
      const keyframe = (originalKeyframesByProperty[reference.property] ?? []).find(
        (candidate) => candidate.id === reference.keyframeId,
      )
      if (keyframe) values[reference.property] = keyframe.value
    }
    return values
  }, [item.id, originalKeyframesByProperty, selectedKeyframes])
  const {
    propertyValues,
    preExpressionPropertyValues,
    resolveExpressionReference,
    propertyLinkSourceLabels,
    propertyLinkHandlers,
  } = useMotionPropertySystems({
    item,
    itemKeyframes,
    properties,
    canvas,
    fps,
    currentFrame,
    relativeFrame,
    itemById,
    allKeyframesByItemId,
    originalKeyframesByProperty,
    selectedKeyframeValueByProperty,
    paneMode,
    onPropertyLinkPointerDown,
    onRemovePropertyLink,
  })
  const vectorResolvedTransform = useMemo(
    () =>
      vectorBaseTransform
        ? resolveAnimatedTransform(vectorBaseTransform, itemKeyframes, relativeFrame, {
            globalFrame: currentFrame,
            canvas: { ...canvas, fps },
            getItem: (candidateId) => itemById[candidateId],
            getKeyframes: (candidateId) => allKeyframesByItemId[candidateId],
          })
        : null,
    [
      allKeyframesByItemId,
      canvas,
      currentFrame,
      fps,
      itemById,
      itemKeyframes,
      relativeFrame,
      vectorBaseTransform,
    ],
  )
  const vectorPreExpressionTransform = useMemo(
    () =>
      vectorBaseTransform
        ? resolveAnimatedTransform(
            vectorBaseTransform,
            withoutPropertyExpressions(itemKeyframes),
            relativeFrame,
            {
              globalFrame: currentFrame,
              canvas: { ...canvas, fps },
              getItem: (candidateId) => itemById[candidateId],
              getKeyframes: (candidateId) => allKeyframesByItemId[candidateId],
            },
          )
        : null,
    [
      allKeyframesByItemId,
      canvas,
      currentFrame,
      fps,
      itemById,
      itemKeyframes,
      relativeFrame,
      vectorBaseTransform,
    ],
  )
  const selectedVectorValues = useMemo(() => {
    const values = new Map<VectorAnimatableProperty, VectorKeyframe['value']>()
    for (let index = selectedKeyframes.length - 1; index >= 0; index -= 1) {
      const reference = selectedKeyframes[index]!
      if (reference.itemId !== item.id) continue
      const proxy = getVectorPropertyProxy(reference.property)
      if (!proxy || values.has(proxy.property)) continue
      const keyframe = findStoredVectorKeyframe(
        itemKeyframes,
        proxy.property,
        getStoredVectorKeyframeId(reference.keyframeId, proxy.axis),
      )
      if (keyframe) values.set(proxy.property, keyframe.value)
    }
    return values
  }, [item.id, itemKeyframes, selectedKeyframes])
  const resolvedPositionValue =
    vectorBaseTransform && vectorResolvedTransform
      ? getMotionVectorValue('position', vectorResolvedTransform, vectorBaseTransform)
      : null
  const resolvedScaleValue =
    vectorBaseTransform && vectorResolvedTransform
      ? getMotionVectorValue('scale', vectorResolvedTransform, vectorBaseTransform)
      : null
  const positionValueSource = useMotionPositionValueSource({
    item,
    resolvedTransform: vectorResolvedTransform,
    committedValue: selectedVectorValues.get('position') ?? resolvedPositionValue,
    itemById,
    allKeyframesByItemId,
    canvas,
    fps,
    currentFrame,
  })
  const scaleValueSource = useMotionScaleValueSource()
  const committedScaleValue = selectedVectorValues.get('scale') ?? resolvedScaleValue
  useEffect(() => {
    const preview = scaleValueSource.getSnapshot()
    if (
      preview &&
      committedScaleValue &&
      Math.abs(preview.x - committedScaleValue.x) < 0.001 &&
      Math.abs(preview.y - committedScaleValue.y) < 0.001
    ) {
      scaleValueSource.clear()
    }
  }, [committedScaleValue, scaleValueSource])
  const resolveMotionVectorValueAtFrame = useCallback(
    (property: VectorAnimatableProperty, frame: number) => {
      if (!vectorBaseTransform) return null
      const resolved = resolveAnimatedTransform(vectorBaseTransform, itemKeyframes, frame, {
        globalFrame: item.from + frame,
        canvas: { ...canvas, fps },
        getItem: (candidateId) => itemById[candidateId],
        getKeyframes: (candidateId) => allKeyframesByItemId[candidateId],
      })
      return getMotionVectorValue(property, resolved, vectorBaseTransform)
    },
    [allKeyframesByItemId, canvas, fps, item.from, itemById, itemKeyframes, vectorBaseTransform],
  )
  const commitPositionDimensionMode = useCallback(
    (separated: boolean, bake: boolean) => {
      if (!vectorBaseTransform) return
      const frameCount = Math.max(1, item.durationInFrames)
      if (bake && frameCount > MAX_DIMENSION_BAKE_FRAMES) {
        toast.error('Position animation is too long to bake safely', {
          description: `This conversion would create ${frameCount.toLocaleString()} keyframes per lane.`,
        })
        return
      }

      const vectorProperty = itemKeyframes?.vectorProperties?.find(
        (candidate) => candidate.property === 'position',
      )
      const samples = bake
        ? Array.from({ length: frameCount }, (_, frame) => ({
            frame,
            value: resolveMotionVectorValueAtFrame('position', frame),
          })).filter(
            (sample): sample is { frame: number; value: { x: number; y: number } } =>
              sample.value !== null,
          )
        : []

      if (separated) {
        const scalarProperties = bake
          ? (['x', 'y'] as const).map((property) => ({
              property,
              keyframes: samples.map((sample) => ({
                id: crypto.randomUUID(),
                frame: sample.frame,
                value: sample.value[property],
                easing: 'linear' as const,
              })),
            }))
          : buildMotionVectorSeparationProperties({
              row: POSITION_VECTOR_ROW,
              vectorProperty,
              baseTransform: vectorBaseTransform,
            })
        clearKeyframeSelection()
        setVectorDimensionsSeparated(item.id, 'position', true, { scalarProperties })
        return
      }

      const nextVectorProperty = bake
        ? {
            property: 'position' as const,
            keyframes: samples.map((sample) => ({
              id: crypto.randomUUID(),
              frame: sample.frame,
              value: sample.value,
              easing: 'linear' as const,
            })),
          }
        : buildVectorPromotionPlan({
            property: 'position',
            itemKeyframes,
            baseTransform: vectorBaseTransform,
          }).vectorProperty
      clearKeyframeSelection()
      setVectorDimensionsSeparated(item.id, 'position', false, {
        vectorProperty: nextVectorProperty.keyframes.length > 0 ? nextVectorProperty : undefined,
      })
    },
    [
      clearKeyframeSelection,
      item.durationInFrames,
      item.id,
      itemKeyframes,
      resolveMotionVectorValueAtFrame,
      vectorBaseTransform,
    ],
  )
  const handlePositionDimensionModeChange = useCallback(
    (separated: boolean) => {
      const blockedTargets = separated
        ? new Set<DirectLinkableProperty>(['position'])
        : new Set<DirectLinkableProperty>(['x', 'y'])
      const hasLink = getDirectPropertyLinks(itemKeyframes).some((link) =>
        blockedTargets.has(link.targetProperty),
      )
      const hasExpression = itemKeyframes?.expressions?.some(
        (expression) =>
          expression.type === 'expression' && blockedTargets.has(expression.targetProperty),
      )
      if (hasLink || hasExpression) {
        toast.error(
          separated
            ? 'Remove the Position link or expression before separating dimensions'
            : 'Remove the X/Y links or expressions before combining dimensions',
        )
        return
      }

      const needsBake = separated
        ? motionVectorSeparationNeedsBake(
            itemKeyframes?.vectorProperties?.find((candidate) => candidate.property === 'position'),
          )
        : !canCombineMotionVectorRowWithoutBake(itemKeyframes, POSITION_VECTOR_ROW)
      if (!needsBake) {
        commitPositionDimensionMode(separated, false)
        return
      }

      toast.warning(
        separated
          ? 'Separating Position removes spatial or velocity handles'
          : 'X and Y use different timing and cannot be combined directly',
        {
          description: 'Bake the visible motion to frame-aligned keys before converting?',
          duration: Infinity,
          action: {
            label: separated ? 'Bake & separate' : 'Bake & combine',
            onClick: () => commitPositionDimensionMode(separated, true),
          },
          cancel: { label: 'Cancel', onClick: () => undefined },
        },
      )
    },
    [commitPositionDimensionMode, itemKeyframes],
  )
  const dimensionSeparationByProperty = useMemo(
    () =>
      supportsVectorTransform && properties.includes('x') && properties.includes('y')
        ? {
            x: {
              label: 'Position',
              separated: positionDimensionsSeparated,
              onChange: handlePositionDimensionModeChange,
            },
          }
        : {},
    [
      handlePositionDimensionModeChange,
      positionDimensionsSeparated,
      properties,
      supportsVectorTransform,
    ],
  )
  const scaleAxesLinked = item.transform?.aspectRatioLocked !== false
  const applyMotionVectorAxisValue = useCallback(
    (
      property: VectorAnimatableProperty,
      currentValue: { x: number; y: number },
      axis: 'x' | 'y',
      value: number,
    ) => {
      const nextValue = { ...currentValue, [axis]: value }
      if (property !== 'scale' || !scaleAxesLinked) return nextValue
      const otherAxis = axis === 'x' ? 'y' : 'x'
      const ratio = Math.abs(currentValue[axis]) <= Number.EPSILON ? 1 : value / currentValue[axis]
      nextValue[otherAxis] = currentValue[otherAxis] * ratio
      return nextValue
    },
    [scaleAxesLinked],
  )
  const positionScrubPreviewRef = useRef<ItemPreview | null>(null)
  const positionScrubActiveRef = useRef(false)
  const {
    queue: queuePositionScrubPreview,
    flushNow: flushPositionScrubPreview,
    cancel: cancelPositionScrubPreview,
  } = useRafCoalescedValue(
    useCallback(
      (position: { x: number; y: number }) => {
        useGizmoStore.getState().setTransformPreview({
          [item.id]: position,
        })
      },
      [item.id],
    ),
  )
  const startPositionScrubPreview = useCallback(() => {
    if (positionScrubActiveRef.current) return
    positionScrubPreviewRef.current = useGizmoStore.getState().preview?.[item.id] ?? null
    positionScrubActiveRef.current = true
  }, [item.id])
  const restorePositionScrubPreview = useCallback(() => {
    if (!positionScrubActiveRef.current) return
    useGizmoStore.getState().replaceItemPreview(item.id, positionScrubPreviewRef.current)
    positionScrubPreviewRef.current = null
    positionScrubActiveRef.current = false
  }, [item.id])
  const previewPositionScrub = useCallback(
    (axis: 'x' | 'y', value: number) => {
      if (!vectorBaseTransform || !vectorResolvedTransform) return
      const currentValue = getMotionVectorValue(
        'position',
        vectorResolvedTransform,
        vectorBaseTransform,
      )
      queuePositionScrubPreview(applyMotionVectorAxisValue('position', currentValue, axis, value))
    },
    [
      applyMotionVectorAxisValue,
      queuePositionScrubPreview,
      vectorBaseTransform,
      vectorResolvedTransform,
    ],
  )
  const cancelPositionScrub = useCallback(() => {
    cancelPositionScrubPreview()
    restorePositionScrubPreview()
  }, [cancelPositionScrubPreview, restorePositionScrubPreview])
  const scaleScrubPreviewRef = useRef<ItemPreview | null>(null)
  const scaleScrubActiveRef = useRef(false)
  const {
    queue: queueScaleScrubPreview,
    flushNow: flushScaleScrubPreview,
    cancel: cancelScaleScrubPreview,
  } = useRafCoalescedValue(
    useCallback(
      (scale: { x: number; y: number }) => {
        scaleValueSource.setSnapshot(scale)
        if (!vectorBaseTransform) return
        useGizmoStore.getState().setTransformPreview({
          [item.id]: {
            width: vectorBaseTransform.width * (scale.x / 100),
            height: vectorBaseTransform.height * (scale.y / 100),
          },
        })
      },
      [item.id, scaleValueSource, vectorBaseTransform],
    ),
  )
  const startScaleScrubPreview = useCallback(() => {
    if (scaleScrubActiveRef.current) return
    scaleScrubPreviewRef.current = useGizmoStore.getState().preview?.[item.id] ?? null
    scaleScrubActiveRef.current = true
  }, [item.id])
  const restoreScaleScrubPreview = useCallback(() => {
    if (!scaleScrubActiveRef.current) return
    useGizmoStore.getState().replaceItemPreview(item.id, scaleScrubPreviewRef.current)
    scaleScrubPreviewRef.current = null
    scaleScrubActiveRef.current = false
  }, [item.id])
  const previewScaleScrub = useCallback(
    (axis: 'x' | 'y', value: number) => {
      if (!committedScaleValue) return
      queueScaleScrubPreview(applyMotionVectorAxisValue('scale', committedScaleValue, axis, value))
    },
    [applyMotionVectorAxisValue, committedScaleValue, queueScaleScrubPreview],
  )
  const cancelScaleScrub = useCallback(() => {
    cancelScaleScrubPreview()
    restoreScaleScrubPreview()
    scaleValueSource.clear()
  }, [cancelScaleScrubPreview, restoreScaleScrubPreview, scaleValueSource])
  useEffect(
    () => () => {
      cancelPositionScrubPreview()
      restorePositionScrubPreview()
      cancelScaleScrubPreview()
      restoreScaleScrubPreview()
      scaleValueSource.clear()
    },
    [
      cancelPositionScrubPreview,
      cancelScaleScrubPreview,
      restorePositionScrubPreview,
      restoreScaleScrubPreview,
      scaleValueSource,
    ],
  )
  const promoteMotionVectorProperty = useCallback(
    (
      property: VectorAnimatableProperty,
      frame: number,
      override?: { axis: 'x' | 'y'; value: number },
    ) => {
      if (!vectorBaseTransform) return
      const plan = buildVectorPromotionPlan({
        property,
        itemKeyframes,
        baseTransform: vectorBaseTransform,
        includeFrame: frame,
      })
      if (override) {
        plan.vectorProperty = {
          ...plan.vectorProperty,
          keyframes: plan.vectorProperty.keyframes.map((keyframe) =>
            keyframe.frame === frame
              ? {
                  ...keyframe,
                  value: applyMotionVectorAxisValue(
                    property,
                    keyframe.value,
                    override.axis,
                    override.value,
                  ),
                }
              : keyframe,
          ),
        }
      }
      promoteTransformToVector(item.id, plan.vectorProperty, plan.removeScalarProperties)
    },
    [applyMotionVectorAxisValue, item.id, itemKeyframes, vectorBaseTransform],
  )
  const handleMotionVectorValueCommit = useCallback(
    (
      property: VectorAnimatableProperty,
      axis: 'x' | 'y',
      value: number,
      options: { allowCreate: boolean },
    ) => {
      const selectedStoredKeyframes = getSelectedMotionVectorKeyframes(
        itemKeyframes,
        selectedKeyframes,
        item.id,
        property,
      )
      if (selectedStoredKeyframes.length > 0) {
        for (const keyframe of selectedStoredKeyframes) {
          updateVectorKeyframe(item.id, property, keyframe.id, {
            value: applyMotionVectorAxisValue(property, keyframe.value, axis, value),
          })
        }
        return true
      }

      const lane = itemKeyframes?.vectorProperties?.find(
        (candidate) => candidate.property === property,
      )
      const currentKeyframe = lane?.keyframes.find((keyframe) => keyframe.frame === relativeFrame)
      if (currentKeyframe) {
        updateVectorKeyframe(item.id, property, currentKeyframe.id, {
          value: applyMotionVectorAxisValue(property, currentKeyframe.value, axis, value),
        })
        return true
      }
      if (!options.allowCreate) return false
      if (!lane || lane.keyframes.length === 0) {
        promoteMotionVectorProperty(property, relativeFrame, { axis, value })
        return true
      }
      const currentValue = resolveMotionVectorValueAtFrame(property, relativeFrame)
      if (!currentValue) return false
      upsertVectorKeyframe(item.id, property, {
        frame: relativeFrame,
        value: applyMotionVectorAxisValue(property, currentValue, axis, value),
        easing: 'linear',
      })
      return true
    },
    [
      applyMotionVectorAxisValue,
      item.id,
      itemKeyframes,
      promoteMotionVectorProperty,
      relativeFrame,
      resolveMotionVectorValueAtFrame,
      selectedKeyframes,
    ],
  )
  const finishPositionScrub = useCallback(
    (axis: 'x' | 'y', value: number) => {
      previewPositionScrub(axis, value)
      flushPositionScrubPreview()
      handleMotionVectorValueCommit('position', axis, value, { allowCreate: true })
      restorePositionScrubPreview()
    },
    [
      flushPositionScrubPreview,
      handleMotionVectorValueCommit,
      previewPositionScrub,
      restorePositionScrubPreview,
    ],
  )
  const finishScaleScrub = useCallback(
    (axis: 'x' | 'y', value: number) => {
      previewScaleScrub(axis, value)
      flushScaleScrubPreview()
      handleMotionVectorValueCommit('scale', axis, value, { allowCreate: true })
      restoreScaleScrubPreview()
    },
    [
      flushScaleScrubPreview,
      handleMotionVectorValueCommit,
      previewScaleScrub,
      restoreScaleScrubPreview,
    ],
  )
  const compoundPropertyRows = useMemo(() => {
    if (!vectorBaseTransform || !vectorResolvedTransform || !vectorPreExpressionTransform) return {}
    return Object.fromEntries(
      motionVectorRows.map((row) => {
        const resolvedValue = getMotionVectorValue(
          row.property,
          vectorResolvedTransform,
          vectorBaseTransform,
        )
        const value = selectedVectorValues.get(row.property) ?? resolvedValue
        return [
          row.primary,
          {
            label: row.label,
            value,
            preExpressionValue: getMotionVectorValue(
              row.property,
              vectorPreExpressionTransform,
              vectorBaseTransform,
            ),
            unit: row.unit,
            showAxisLabels: row.property !== 'position' && row.property !== 'scale',
            linkProperty: row.property,
            liveValueSource:
              row.property === 'position'
                ? positionValueSource
                : row.property === 'scale'
                  ? scaleValueSource
                  : undefined,
            ...(row.property === 'position'
              ? {
                  onScrubStart: startPositionScrubPreview,
                  onScrubPreview: previewPositionScrub,
                  onScrubEnd: finishPositionScrub,
                  onScrubCancel: cancelPositionScrub,
                }
              : row.property === 'scale'
                ? {
                    onScrubStart: startScaleScrubPreview,
                    onScrubPreview: previewScaleScrub,
                    onScrubEnd: finishScaleScrub,
                    onScrubCancel: cancelScaleScrub,
                  }
                : {}),
            axisLink:
              row.property === 'scale'
                ? {
                    linked: scaleAxesLinked,
                    onChange: (linked: boolean) =>
                      updateItem(item.id, {
                        transform: { ...item.transform, aspectRatioLocked: linked },
                      }),
                  }
                : undefined,
            onCommit: (axis: 'x' | 'y', nextValue: number, options: { allowCreate: boolean }) =>
              handleMotionVectorValueCommit(row.property, axis, nextValue, options),
          },
        ]
      }),
    )
  }, [
    handleMotionVectorValueCommit,
    cancelPositionScrub,
    finishPositionScrub,
    finishScaleScrub,
    item.id,
    item.transform,
    motionVectorRows,
    positionValueSource,
    previewPositionScrub,
    previewScaleScrub,
    cancelScaleScrub,
    scaleAxesLinked,
    scaleValueSource,
    selectedVectorValues,
    startPositionScrubPreview,
    startScaleScrubPreview,
    vectorBaseTransform,
    vectorPreExpressionTransform,
    vectorResolvedTransform,
  ])
  const compoundSecondaryProperties = useMemo(
    () => Object.fromEntries(motionVectorRows.map((row) => [row.primary, row.secondary])),
    [motionVectorRows],
  )
  const selectedKeyframeIds = useMemo(
    () =>
      new Set(
        selectedKeyframes
          .filter((reference) => reference.itemId === item.id)
          .map((reference) => reference.keyframeId),
      ),
    [item.id, selectedKeyframes],
  )
  const compositionSnapFrames = useMemo(
    () => getMotionCompositionSnapFrames(allKeyframesByItemId, itemById, selectedKeyframes),
    [allKeyframesByItemId, itemById, selectedKeyframes],
  )
  const proceduralPropertyIds = useMemo(
    () =>
      new Set(getProceduralBands(item.motionModifiers, item.durationInFrames, item.from).keys()),
    [item.durationInFrames, item.from, item.motionModifiers],
  )
  const visibleProperties =
    propertyFilter === 'keyframed'
      ? properties.filter((property) =>
          isMotionPropertyVisible(
            property,
            originalKeyframesByProperty,
            itemKeyframes,
            proceduralPropertyIds,
          ),
        )
      : properties
  const renderedVisibleProperties = visibleProperties.filter(
    (property) => !hiddenPropertyRows.includes(property),
  )
  const visiblePropertyCount = renderedVisibleProperties.length
  const visiblePropertyGroupHeaderCount = getPropertyAccordionGroups(
    renderedVisibleProperties,
  ).filter((group) => !MOTION_INLINE_PROPERTY_GROUP_ID_SET.has(group.id)).length
  const laneContentHeight =
    visiblePropertyCount * ROW_HEIGHT + visiblePropertyGroupHeaderCount * GROUP_HEADER_HEIGHT
  const laneContentStructureKey = `${paneMode}:${renderedVisibleProperties.join('|')}`
  const [reportedLaneContent, setReportedLaneContent] = useState<{
    structureKey: string
    height: number
  } | null>(null)
  const renderedLaneContentHeight =
    reportedLaneContent?.structureKey === laneContentStructureKey
      ? reportedLaneContent.height
      : laneContentHeight
  const renderedLaneHeight = getMotionDopesheetLaneHeight(
    paneMode,
    renderedLaneContentHeight + expressionDockHeight,
  )
  useLayoutEffect(() => {
    if (renderedLaneHeight !== undefined) onRenderedHeightChange?.(renderedLaneHeight)
  }, [onRenderedHeightChange, renderedLaneHeight])
  const handleLaneContentHeightChange = useCallback(
    (height: number) => {
      setReportedLaneContent((current) => {
        if (current?.structureKey === laneContentStructureKey && current.height === height) {
          return current
        }
        return { structureKey: laneContentStructureKey, height }
      })
    },
    [laneContentStructureKey],
  )

  const handleSelectionChange = useCallback(
    (keyframeIds: Set<string>, options?: { preserveExternalSelection?: boolean }) => {
      const references: KeyframeRef[] = []
      for (const property of properties) {
        for (const keyframe of originalKeyframesByProperty[property] ?? []) {
          if (keyframeIds.has(keyframe.id)) {
            references.push({ itemId: item.id, property, keyframeId: keyframe.id })
          }
        }
      }
      const nextSelection = mergeMotionKeyframeSelection(
        useKeyframeSelectionStore.getState().selectedKeyframes,
        item.id,
        references,
        options?.preserveExternalSelection === true,
      )
      if (nextSelection.length === 0) clearKeyframeSelection()
      else selectKeyframes(nextSelection)
    },
    [clearKeyframeSelection, item.id, originalKeyframesByProperty, properties, selectKeyframes],
  )

  const applyCrossLayerPreview = useCallback(() => {
    crossLayerPreviewFrameRef.current = null
    const dragState = crossLayerDragRef.current
    const requestedDeltaFrames = pendingCrossLayerDeltaRef.current
    pendingCrossLayerDeltaRef.current = null
    if (!dragState || requestedDeltaFrames === null) return

    const updates = buildMotionSelectionFrameUpdates(dragState, requestedDeltaFrames)
    if (updates.scalar.length > 0) {
      _updateKeyframes(
        updates.scalar.map((update) => ({
          itemId: update.itemId,
          property: update.property,
          keyframeId: update.keyframeId,
          updates: { frame: update.frame },
        })),
      )
    }
    for (const update of updates.vector) {
      _updateVectorKeyframe(update.itemId, update.property, update.keyframeId, {
        frame: update.frame,
      })
    }
  }, [_updateKeyframes, _updateVectorKeyframe])

  const handleSelectionFrameDelta = useCallback(
    (deltaFrames: number, phase: 'preview' | 'commit' | 'cancel') => {
      if (!crossLayerDragRef.current?.spansMultipleItems) return false
      pendingCrossLayerDeltaRef.current = phase === 'cancel' ? 0 : deltaFrames
      if (phase !== 'preview') {
        if (crossLayerPreviewFrameRef.current !== null) {
          cancelAnimationFrame(crossLayerPreviewFrameRef.current)
        }
        applyCrossLayerPreview()
        if (phase === 'cancel') {
          dragSnapshotRef.current = null
          crossLayerDragRef.current = null
        }
        return true
      }
      if (crossLayerPreviewFrameRef.current === null) {
        crossLayerPreviewFrameRef.current = requestAnimationFrame(applyCrossLayerPreview)
      }
      return true
    },
    [applyCrossLayerPreview],
  )

  const handleDragStart = useCallback(() => {
    dragSnapshotRef.current = captureSnapshot()
    const keyframesState = useKeyframesStore.getState()
    crossLayerDragRef.current = buildMotionSelectionDragState(
      useKeyframeSelectionStore.getState().selectedKeyframes,
      keyframesState.keyframesByItemId,
      useItemsStore.getState().itemById,
    )
  }, [])
  const handleDragEnd = useCallback(() => {
    const snapshot = dragSnapshotRef.current
    if (!snapshot) return
    useTimelineCommandStore
      .getState()
      .addUndoEntry({ type: 'MOVE_KEYFRAME_GRAPH', payload: {} }, snapshot)
    useTimelineSettingsStore.getState().markDirty()
    dragSnapshotRef.current = null
    crossLayerDragRef.current = null
    pendingCrossLayerDeltaRef.current = null
  }, [])
  const handleDragCancel = useCallback(() => {
    if (crossLayerPreviewFrameRef.current !== null) {
      cancelAnimationFrame(crossLayerPreviewFrameRef.current)
      crossLayerPreviewFrameRef.current = null
    }
    dragSnapshotRef.current = null
    crossLayerDragRef.current = null
    pendingCrossLayerDeltaRef.current = null
  }, [])

  useEffect(
    () => () => {
      if (crossLayerPreviewFrameRef.current !== null) {
        cancelAnimationFrame(crossLayerPreviewFrameRef.current)
      }
    },
    [],
  )

  const clampAbsoluteFrame = useCallback(
    (frame: number) =>
      Math.max(item.from, Math.min(item.from + item.durationInFrames - 1, Math.round(frame))),
    [item.durationInFrames, item.from],
  )
  const handleMotionKeyframeMove = useCallback(
    (reference: KeyframeRef, nextFrame: number, nextValue: number) => {
      const vectorReference = resolveMotionVectorReference(itemKeyframes, reference)
      if (vectorReference) {
        _updateVectorKeyframe(
          reference.itemId,
          vectorReference.proxy.property,
          vectorReference.keyframe.id,
          {
            frame: clampAbsoluteFrame(nextFrame) - item.from,
            value: {
              ...vectorReference.keyframe.value,
              [vectorReference.proxy.axis]: nextValue,
            },
          },
        )
        return
      }
      _updateKeyframe(reference.itemId, reference.property, reference.keyframeId, {
        frame: clampAbsoluteFrame(nextFrame) - item.from,
        value: nextValue,
      })
    },
    [_updateKeyframe, _updateVectorKeyframe, clampAbsoluteFrame, item.from, itemKeyframes],
  )
  const handleMotionSegmentEasingChange = useCallback(
    (
      references: KeyframeRef[],
      updates: Pick<Keyframe, 'easing'> & Partial<Pick<Keyframe, 'easingConfig'>>,
      options?: { commit?: boolean },
    ) => {
      const partitioned = partitionMotionVectorReferences(itemKeyframes, references)
      for (const vector of partitioned.vector) {
        if (options?.commit === false) {
          _updateVectorKeyframe(
            vector.reference.itemId,
            vector.proxy.property,
            vector.keyframe.id,
            updates,
          )
        } else {
          updateVectorKeyframe(
            vector.reference.itemId,
            vector.proxy.property,
            vector.keyframe.id,
            updates,
          )
        }
      }
      if (partitioned.scalar.length === 0) return
      if (options?.commit === false) {
        for (const reference of partitioned.scalar) {
          _updateKeyframe(reference.itemId, reference.property, reference.keyframeId, updates)
        }
        return
      }
      updateKeyframes(
        partitioned.scalar.map((reference) => ({
          itemId: reference.itemId,
          property: reference.property,
          keyframeId: reference.keyframeId,
          updates,
        })),
      )
    },
    [_updateKeyframe, _updateVectorKeyframe, itemKeyframes],
  )
  const handleRemoveMotionKeyframes = useCallback(
    (references: KeyframeRef[]) => {
      const partitioned = partitionMotionVectorReferences(itemKeyframes, references)
      for (const vector of partitioned.vector) {
        removeVectorKeyframe(item.id, vector.proxy.property, vector.keyframe.id)
      }
      if (partitioned.scalar.length > 0) removeKeyframes(partitioned.scalar)
      clearKeyframeSelection()
    },
    [clearKeyframeSelection, item.id, itemKeyframes],
  )

  // In Motion's embedded lane view, an animated-only filter with no keyed
  // properties should consume no vertical space beneath the layer header.
  // The full graph editor keeps its empty guidance because it owns the pane.
  if (paneMode === 'lanes' && propertyFilter === 'keyframed' && visiblePropertyCount === 0) {
    return null
  }

  return (
    <div
      ref={rootRef}
      inert={disabled ? true : undefined}
      aria-disabled={disabled}
      className={cn(
        'w-full bg-background/35',
        paneMode === 'graph' && 'h-full',
        disabled && 'opacity-60',
      )}
      style={{
        height: renderedLaneHeight,
      }}
      onPointerEnter={() => setKeyframeEditorShortcutScopeActive(true)}
      onPointerLeave={() => setKeyframeEditorShortcutScopeActive(false)}
      onFocusCapture={() => setKeyframeEditorShortcutScopeActive(true)}
      onBlurCapture={(event) => {
        const nextFocused = event.relatedTarget as Node | null
        if (!event.currentTarget.contains(nextFocused)) {
          setKeyframeEditorShortcutScopeActive(false)
        }
      }}
    >
      {paneSize.width > 0 ? (
        <DopesheetEditor
          itemId={item.id}
          motionModifiers={item.motionModifiers}
          hasProceduralMotion={hasEnabledProceduralMotion(item)}
          keyframesByProperty={keyframesByProperty}
          propertyValues={propertyValues}
          preExpressionPropertyValues={preExpressionPropertyValues}
          hiddenPropertyRows={hiddenPropertyRows}
          compoundPropertyRows={compoundPropertyRows}
          compoundSecondaryProperties={compoundSecondaryProperties}
          dimensionSeparationByProperty={dimensionSeparationByProperty}
          propertyLinks={getDirectPropertyLinks(itemKeyframes)}
          propertyExpressions={itemKeyframes?.expressions?.filter(
            (expression) => expression.type === 'expression',
          )}
          resolveExpressionReference={resolveExpressionReference}
          onSetPropertyExpression={
            onSetPropertyExpression
              ? (property, source, enabled) =>
                  onSetPropertyExpression(item.id, property, source, enabled)
              : undefined
          }
          onRemovePropertyExpression={
            onRemovePropertyExpression
              ? (property) => onRemovePropertyExpression(item.id, property)
              : undefined
          }
          onExpressionDockHeightChange={paneMode === 'lanes' ? setExpressionDockHeight : undefined}
          onLaneContentHeightChange={
            paneMode === 'lanes' ? handleLaneContentHeightChange : undefined
          }
          initialExpandedGroups={initialExpandedGroups}
          onExpandedGroupsChange={onExpandedGroupsChange}
          propertyLinkSourceLabels={propertyLinkSourceLabels}
          onPropertyLinkPointerDown={propertyLinkHandlers.onPointerDown}
          onRemovePropertyLink={propertyLinkHandlers.onRemove}
          selectedProperty={inlineCurveProperty}
          selectedKeyframeIds={selectedKeyframeIds}
          currentFrame={currentFrame}
          globalFrame={currentFrame}
          itemFrom={0}
          totalFrames={compositionDurationInFrames}
          fps={fps}
          width={paneSize.width}
          height={
            paneMode === 'graph'
              ? Math.max(120, paneSize.height)
              : Math.max(ROW_HEIGHT, renderedLaneContentHeight + expressionDockHeight)
          }
          frameViewport={timeViewport}
          onFrameViewportChange={onTimeViewportChange}
          onSelectionChange={handleSelectionChange}
          additionalSnapFrames={compositionSnapFrames}
          onSelectionFrameDelta={handleSelectionFrameDelta}
          onKeyframeMove={handleMotionKeyframeMove}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
          onSegmentEasingChange={handleMotionSegmentEasingChange}
          onAddKeyframe={(property, frame) => {
            const absoluteFrame = clampAbsoluteFrame(frame)
            const propertyRelativeFrame = absoluteFrame - item.from
            const vectorProxy = getVectorPropertyProxy(property)
            if (
              vectorProxy &&
              motionVectorRows.some((row) => row.property === vectorProxy.property)
            ) {
              const lane = itemKeyframes?.vectorProperties?.find(
                (candidate) => candidate.property === vectorProxy.property,
              )
              if (!lane || lane.keyframes.length === 0) {
                promoteMotionVectorProperty(vectorProxy.property, propertyRelativeFrame)
                return
              }
              const value = resolveMotionVectorValueAtFrame(
                vectorProxy.property,
                propertyRelativeFrame,
              )
              if (!value) return
              upsertVectorKeyframe(item.id, vectorProxy.property, {
                frame: propertyRelativeFrame,
                value,
                easing: 'linear',
              })
              return
            }
            const keyframes = originalKeyframesByProperty[property] ?? []
            addKeyframe(
              item.id,
              property,
              propertyRelativeFrame,
              interpolatePropertyValue(
                keyframes,
                propertyRelativeFrame,
                getAnimatablePropertyBaseValue(item, property, { ...canvas, fps }),
              ),
            )
          }}
          onPropertyValueCommit={(property, value, options) => {
            const propertyKeyframes = originalKeyframesByProperty[property] ?? []
            const selectedPropertyKeyframes = propertyKeyframes.filter((keyframe) =>
              selectedKeyframeIds.has(keyframe.id),
            )
            if (selectedPropertyKeyframes.length > 0) {
              updateKeyframes(
                selectedPropertyKeyframes.map((keyframe) => ({
                  itemId: item.id,
                  property,
                  keyframeId: keyframe.id,
                  updates: { value },
                })),
              )
              return
            }

            const existing = propertyKeyframes.find((keyframe) => keyframe.frame === relativeFrame)
            if (existing) updateKeyframe(item.id, property, existing.id, { value })
            else if (options?.allowCreate !== false) {
              addKeyframe(item.id, property, relativeFrame, value)
            }
          }}
          onRemoveKeyframes={handleRemoveMotionKeyframes}
          onNavigateToKeyframe={(frame) => onScrub(clampAbsoluteFrame(frame))}
          onScrub={(frame) =>
            onScrub(Math.max(0, Math.min(compositionDurationInFrames - 1, frame)))
          }
          onScrubStart={() => onSelectItem(item.id)}
          onActivePropertyChange={() => onSelectItem(item.id)}
          onPropertyChange={(property) => {
            if (!property) return
            onSelectItem(item.id)
            onInlineCurveChange(property)
          }}
          onCurveVisibilityChange={(property, visible) => {
            onSelectItem(item.id)
            onInlineCurveChange(visible ? property : null)
          }}
          visualizationMode={paneMode === 'graph' ? 'graph' : 'dopesheet'}
          presentation="lanes"
          propertyColumnWidth={paneMode === 'graph' ? 0 : LAYER_COLUMN_WIDTH}
          timelineGridDivisions={paneMode === 'lanes' ? RULER_DIVISIONS : undefined}
          singleCurveMode
          selectedCurveVisibleExternally={paneMode === 'lanes' && inlineCurveProperty !== null}
          propertyFilter={propertyFilter}
          proceduralFrameOffset={item.from}
          proceduralDurationInFrames={item.durationInFrames}
          showPlayhead={false}
          inlinePropertyGroupIds={
            paneMode === 'graph'
              ? MOTION_GRAPH_INLINE_PROPERTY_GROUP_IDS
              : MOTION_INLINE_PROPERTY_GROUP_IDS
          }
          spacious
        />
      ) : null}
    </div>
  )
}, areMotionDopesheetLanesPropsEqual)

export const MotionDopesheetLanes = memo(function MotionDopesheetLanes(props: MotionDopesheetLanesProps) {
  const { item, itemKeyframes, properties, propertyFilter, paneMode = 'lanes' } = props
  const shellRef = useRef<HTMLDivElement>(null)
  const isNearScrollViewport = useNearMotionScrollViewport(shellRef, paneMode === 'lanes')
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const estimatedHeight = useMemo(
    () =>
      getEstimatedMotionDopesheetLaneHeight({
        item,
        itemKeyframes,
        properties,
        propertyFilter,
        expandedGroups,
      }),
    [expandedGroups, item, itemKeyframes, properties, propertyFilter],
  )
  const heightStructureKey = `${propertyFilter}:${properties.join('|')}:${estimatedHeight}`
  const [reportedHeight, setReportedHeight] = useState<{
    structureKey: string
    height: number
  } | null>(null)
  const renderedHeight =
    reportedHeight?.structureKey === heightStructureKey ? reportedHeight.height : estimatedHeight
  const handleRenderedHeightChange = useCallback(
    (height: number) => {
      setReportedHeight((current) => {
        if (current?.structureKey === heightStructureKey && current.height === height)
          return current
        return { structureKey: heightStructureKey, height }
      })
    },
    [heightStructureKey],
  )
  const shouldRenderContent = paneMode === 'graph' || isNearScrollViewport

  return (
    <div
      ref={shellRef}
      data-testid={`motion-dopesheet-shell-${item.id}`}
      data-motion-dopesheet-near-viewport={isNearScrollViewport ? 'true' : 'false'}
      className={cn('w-full bg-background/35', paneMode === 'graph' && 'h-full')}
      style={{ height: getMotionDopesheetLaneHeight(paneMode, renderedHeight) }}
    >
      {shouldRenderContent ? (
        <MotionDopesheetContent
          {...props}
          initialExpandedGroups={expandedGroups}
          onExpandedGroupsChange={setExpandedGroups}
          onRenderedHeightChange={handleRenderedHeightChange}
        />
      ) : null}
    </div>
  )
}, areMotionDopesheetLanesPropsEqual)

function buildMotionPropertyValues(params: {
  item: TimelineItem
  itemKeyframes: ItemKeyframes | undefined
  properties: AnimatableProperty[]
  canvas: { width: number; height: number }
  fps: number
  currentFrame: number
  relativeFrame: number
  itemById: Record<string, TimelineItem>
  allKeyframesByItemId: Record<string, ItemKeyframes>
  originalKeyframesByProperty: Partial<Record<AnimatableProperty, Keyframe[]>>
  selectedKeyframeValueByProperty: Partial<Record<AnimatableProperty, number>>
}): Partial<Record<AnimatableProperty, number>> {
  const resolvedTransform = resolveItemTransformAtFrame(params.item, {
    canvas: { ...params.canvas, fps: params.fps },
    frame: params.currentFrame,
    keyframes: params.itemKeyframes,
    getItem: (itemId) => params.itemById[itemId],
    getKeyframes: (itemId) => params.allKeyframesByItemId[itemId],
  })
  const resolvedShape =
    params.item.type === 'shape'
      ? resolveAnimatedShapeItem(params.item, params.itemKeyframes, params.relativeFrame, {
          globalFrame: params.currentFrame,
          canvas: { ...params.canvas, fps: params.fps },
          getItem: (itemId) => params.itemById[itemId],
          getKeyframes: (itemId) => params.allKeyframesByItemId[itemId],
        })
      : null
  return Object.fromEntries(
    params.properties.map((property) => {
      const selectedValue = params.selectedKeyframeValueByProperty[property]
      const value = isTransformAnimatableProperty(property)
        ? resolvedTransform[property]
        : resolvedShape && isShapeAnimatableProperty(property)
          ? getShapeAnimatableBaseValue(resolvedShape, property)
          : interpolatePropertyValue(
              params.originalKeyframesByProperty[property] ?? [],
              params.relativeFrame,
              getAnimatablePropertyBaseValue(params.item, property, {
                ...params.canvas,
                fps: params.fps,
              }),
            )
      return [property, selectedValue ?? value]
    }),
  )
}

function buildPropertyLinkSourceLabels(
  itemKeyframes: ItemKeyframes | undefined,
  itemById: Record<string, TimelineItem>,
): Partial<Record<DirectLinkableProperty, string>> {
  return Object.fromEntries(
    getDirectPropertyLinks(itemKeyframes).map((link) => {
      const sourceItem = itemById[link.sourceItemId]
      const sourceLabel = sourceItem?.label || sourceItem?.type || link.sourceItemId
      return [link.targetProperty, `${sourceLabel} -> ${link.sourceProperty}`]
    }),
  )
}

function isMotionPropertyVisible(
  property: AnimatableProperty,
  keyframesByProperty: Partial<Record<AnimatableProperty, Keyframe[]>>,
  itemKeyframes: ItemKeyframes | undefined,
  proceduralPropertyIds: ReadonlySet<AnimatableProperty>,
): boolean {
  const hasKeys = (keyframesByProperty[property]?.length ?? 0) > 0
  const vectorProperty = getVectorPropertyProxy(property)?.property
  const hasLink = getDirectPropertyLinks(itemKeyframes).some(
    (link) => link.targetProperty === property || link.targetProperty === vectorProperty,
  )
  const hasExpression = itemKeyframes?.expressions?.some(
    (expression) =>
      expression.type === 'expression' &&
      (expression.targetProperty === property || expression.targetProperty === vectorProperty),
  )
  return hasKeys || !!hasLink || !!hasExpression || proceduralPropertyIds.has(property)
}

function buildPropertyLinkHandlers(params: {
  itemId: string
  paneMode: MotionDopesheetLanesProps['paneMode']
  onPointerDown: MotionDopesheetLanesProps['onPropertyLinkPointerDown']
  onRemove: MotionDopesheetLanesProps['onRemovePropertyLink']
}): {
  onPointerDown?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    property: DirectLinkableProperty,
  ) => void
  onRemove?: (property: DirectLinkableProperty) => void
} {
  const onPointerDown = params.onPointerDown
    ? (event: ReactPointerEvent<HTMLButtonElement>, property: DirectLinkableProperty) =>
        params.onPointerDown?.(event, params.itemId, property)
    : undefined
  const onRemove = params.onRemove
    ? (property: DirectLinkableProperty) => params.onRemove?.(params.itemId, property)
    : undefined
  return { onPointerDown, onRemove }
}