/**
 * Dopesheet Editor - timeline-style keyframe editor.
 * Shows keyframes across properties as draggable diamonds on a frame grid.
 */

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  Scissors,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/shared/ui/cn'
import { Button } from '@/components/ui/button'
import type {
  AnimatableProperty,
  BezierControlPoints,
  EasingType,
  Keyframe,
  KeyframeRef,
  DirectLinkableProperty,
  DirectPropertyLink,
  PropertyExpression,
} from '@/types/keyframe'
import type { MotionModifier } from '@/types/motion'
import type { TextMotionSlot } from '@/types/text-motion'
import type { TextMotionTimelineBand } from '@/shared/timeline/text-motion-timeline'
import type { BlockedFrameRange } from '../../utils/transition-region'
import { HOTKEY_OPTIONS } from '@/config/hotkeys'
import { getFrameAxisX, getFrameFromAxisX, getVisibleKeyframeX } from './layout'
import { CompactNavigator } from './compact-navigator'

import { DopesheetGraphPane } from './dopesheet-graph-pane'
import { useGraphViewState } from './use-graph-view-state'
import { useGroupExpansion } from './use-group-expansion'
import { useHeaderFrameInputs } from './use-header-frame-inputs'
import { usePropertyFilters } from './use-property-filters'
import { useRulerScrub } from './use-ruler-scrub'
import { useDopesheetMarquee } from './use-dopesheet-marquee'
import { useTimingStripDrag } from './use-timing-strip-drag'
import { useDopesheetViewport } from './use-dopesheet-viewport'
import { useDopesheetNavigation } from './use-dopesheet-navigation'
import { useSelectionFrameActions } from './use-selection-frame-actions'
import { usePropertyValueEditing } from './use-property-value-editing'
import { useElementSize } from './use-element-size'
import { useKeyframeDrag } from './use-keyframe-drag'
import {
  getDopesheetDragPixelsPerFrame,
} from './dopesheet-drag-math'
import { DopesheetHeaderFrameInputs } from './dopesheet-header-frame-inputs'
import { DopesheetRulerHeader } from './dopesheet-ruler-header'
import { DopesheetLiveRulerCanvas } from './dopesheet-live-ruler-canvas'
import { syncDopesheetLivePixelGeometry } from './dopesheet-live-pixel-geometry'

import { perfMarkRender } from '@/shared/logging/perf-marks'
import {
  TIMELINE_LIVE_SCROLL_EVENT,
} from '@/shared/timeline/live-scroll-sync'
import {
} from '@/shared/timeline/main-timeline-scrub'
import { DopesheetSheetBody } from './dopesheet-sheet-body'

import { DopesheetToolbar } from './dopesheet-toolbar'
import { DopesheetPlayheadOverlay } from './dopesheet-playhead-overlays'
import {
  handleAddKeyframeHotkey,
  handleDeleteHotkey,
  handleFitKeyframesHotkey,
  handleNavigateHotkey,
  handleNudgeHotkey,
  handleToggleAutoKeyHotkey,
  resolveDopesheetHotkeys,
} from './dopesheet-hotkeys'
import { usePropertyExpressionEditor } from './use-property-expression-editor'
import { buildExpressionDockContext, formatExpressionValue } from './expression-dock-context'
import {
  GroupCurvesButton,
  GroupExpandButton,
  GroupKeyframeNavButton,
  GroupLockButton,
  GroupReset,
} from './property-group-controls'
import { PropertyRowKeyframeNav } from './property-row-keyframe-nav'
import { resolveGroupHeaderState } from './property-group-view-model'
import {
  resolvePropertyRowExpressionError,
  resolvePropertyRowLabels,
  resolvePropertyRowLinkable,
  resolvePropertyRowPreExpressionValue,
  resolvePropertyRowResetState,
  resolvePropertyRowShellClassName,
} from './property-row-view-model'
import {
  PropertyRowAutoKeyButton,
  PropertyRowAxisConstraintButton,
  PropertyRowCompoundInput,
  PropertyRowCurveButton,
  PropertyRowExpressionButton,
  PropertyRowLinkButton,
  PropertyRowLockButton,
  PropertyRowReset,
  PropertyRowValueInput,
} from './property-row-controls'

import { DopesheetExpressionDock } from './dopesheet-expression-dock'
import {
  DopesheetGroupOptionsMenu,
  type DopesheetDimensionSeparationControl,
  type DopesheetDimensionSeparationEntry,
} from './dopesheet-group-options-menu'
import type { CompoundPropertyInputConfig } from './compound-property-inputs'
import { KeyframeTimingStrip } from './keyframe-timing-strip'
import { setPointerCaptureSafely } from './dopesheet-utils'
import { PickWhipOverlay } from '@/shared/ui/pick-whip-overlay'
import type { ExpressionValue } from '@/features/keyframes/utils/property-expression'
import {
  arePreviewFramesEqual,
  buildGroupedPropertyRows,
  buildGroupedPropertyStructure,
  getNiceTickStep,
} from './dopesheet-helpers'
import type { DopesheetPropertyGroupStructure } from './dopesheet-helpers'
import { GroupTimelineCell, PropertyTimelineCell } from './dopesheet-timeline-cells'
import type { SegmentEasingChange } from './segment-easing-popover'

import {
} from '@/features/keyframes/deps/timeline-playhead'
import {
  EMPTY_AUTO_KEY_ENABLED_BY_PROPERTY,
  GROUP_HEADER_HEIGHT,
  PROPERTY_COLUMN_WIDTH,
  SPACIOUS_PROPERTY_COLUMN_WIDTH,
  ROW_HEIGHT,
  RULER_HEIGHT,
  SNAP_THRESHOLD_PX,
} from './dopesheet-constants'
import type {
  DopesheetPropertyGroup,
  DopesheetPropertyRow,
  DragState,
  KeyframeMeta,
  RenderedSheetEntry,
  Viewport,
} from './dopesheet-types'
import { getDopesheetRowControlState } from './row-controls'
import { getPropertyAccordionGroups } from './property-groups'
import { getCombinedGraphValueRange } from '../value-graph-editor/value-range-utils'
import {
  PROPERTY_VALUE_RANGES,
  isColorAnimatableProperty,
} from '@/features/keyframes/property-value-ranges'
import { keyframeValueToHexColor } from '@/features/keyframes/utils/color-keyframes'
import { constrainSelectedKeyframeDelta } from '@/features/keyframes/utils/frame-move-constraints'
import { useAutoKeyframeStore } from '../../stores/auto-keyframe-store'
import {
  getProceduralBands,
  type ProceduralPreviewInput,
} from '@/features/keyframes/utils/procedural-preview'
import { clampFrame } from './frame-utils'
import {
  buildPropertyKeyframeRefs,
  buildRowKeyframeRefs,
  removeSelectionIds,
} from './row-action-helpers'
import {
  getKeyframeGroupLabel,
  getKeyframePropertyLabel,
} from '@/features/keyframes/utils/property-i18n'

import { TextMotionTimelineRows } from './text-motion-timeline-rows'

interface DopesheetEditorProps {
  /** Shared time viewport when split mode needs synchronized frame zoom/pan */
  frameViewport?: Viewport
  /** Callback when the shared time viewport changes */
  onFrameViewportChange?: (viewport: Viewport) => void
  /** Keep an external viewport outside clip bounds when sharing the Edit timeline axis. */
  clampViewportToContent?: boolean
  /** Allow this editor to change its viewport with wheel/zoom controls. */
  viewportInteractionEnabled?: boolean
  /** Item ID to show keyframes for */
  itemId: string
  /** Keyframes organized by property */
  keyframesByProperty: Partial<Record<AnimatableProperty, Keyframe[]>>
  /** Currently selected property (or null to show all) */
  selectedProperty?: AnimatableProperty | null
  /** Selected keyframe IDs */
  selectedKeyframeIds?: Set<string>
  /** Current playhead frame */
  currentFrame?: number
  /** Display-only playhead frame when it may sit outside the edited clip. */
  playheadFrame?: number
  /** Clamp live playhead movement to the edited clip. */
  playheadClampToItemBounds?: boolean
  /** Global timeline frame for the same playhead position */
  globalFrame?: number | null
  /** Absolute timeline frame where the edited item starts (for live playhead) */
  itemFrom?: number
  /** Total duration in frames */
  totalFrames?: number
  /** Optional span in the editor's frame space, subtly highlighted behind the sheet lanes. */
  affectedFrameRange?: { fromFrame: number; toFrame: number }
  /** Stored keyframes currently parked beyond the item's visible out point. */
  trimmedKeyframeCount?: number
  /** Destructively consolidate parked keyframes to the visible item bounds. */
  onTrimAnimation?: () => void
  /** Timeline FPS used for ruler display */
  fps?: number
  /** Width of the editor */
  width?: number
  /** Height of the editor */
  height?: number
  /** Callback when keyframe is moved */
  onKeyframeMove?: (ref: KeyframeRef, newFrame: number, newValue: number) => void
  /** Commit a multi-key retime atomically when lane identities may change. */
  onKeyframesMove?: (
    entries: Array<{ ref: KeyframeRef; newFrame: number; newValue: number }>,
  ) => void
  /** Callback when bezier handles are moved in graph view */
  onBezierHandleMove?: (ref: KeyframeRef, bezier: BezierControlPoints) => void
  /**
   * Apply an easing change to explicit keyframe refs from the sheet's per-segment
   * easing popover. `commit: false` = live (no undo) drag frame; the default
   * commits with undo. Live drags are bracketed by `onDragStart`/`onDragEnd`.
   */
  onSegmentEasingChange?: SegmentEasingChange
  /** Callback when selection changes */
  onSelectionChange?: (
    keyframeIds: Set<string>,
    options?: { preserveExternalSelection?: boolean },
  ) => void
  /** Additional absolute composition frames considered by keyframe snapping. */
  additionalSnapFrames?: readonly number[]
  /**
   * Lets an embedding composition surface move a selection spanning multiple
   * items as one transaction. Return true when the embedding surface handled
   * the preview or commit.
   */
  onSelectionFrameDelta?: (deltaFrames: number, phase: 'preview' | 'commit' | 'cancel') => boolean
  /** Callback when property selection changes */
  onPropertyChange?: (property: AnimatableProperty | null) => void
  /** Notify an embedding surface when a property's inline curve is shown or hidden. */
  onCurveVisibilityChange?: (property: AnimatableProperty, visible: boolean) => void
  /** Callback when a property row becomes the active interaction target */
  onActivePropertyChange?: (property: AnimatableProperty) => void
  /** Callback when playhead is scrubbed (frame is clip-relative) */
  onScrub?: (frame: number) => void
  /** Callback when the ruler's skim frame changes (frame is clip-relative). */
  onSkim?: (frame: number | null) => void
  /** Exact shared-axis mapper for an absolute timeline frame. */
  globalFrameToPixels?: (globalFrame: number) => number
  /** Main Edit timeline scroll surface used for same-frame playhead positioning. */
  timelineScrollContainerRef?: RefObject<HTMLDivElement | null>
  /** Scroll position used to render the current keyframe geometry snapshot. */
  timelinePanBaseScrollLeft?: number
  /** Pixels-per-second used to render the current keyframe geometry snapshot. */
  timelinePanBasePixelsPerSecond?: number
  /** Exact drawable width of the linked main timeline viewport. */
  linkedTimelineViewportWidth?: number
  /** Read the linked timeline's live scale without subscribing this editor tree. */
  getTimelineLivePixelsPerSecond?: () => number
  /** Pan a linked timeline during stationary-pointer ruler edge scrubbing. */
  onRulerEdgeScroll?: (deltaPixels: number) => number
  /** Clamp ruler scrubbing to the edited item's local frame range. */
  scrubClampToItemBounds?: boolean
  /** Optional clip-relative bounds supplied by a shared composition timeline. */
  scrubFrameBounds?: { minFrame: number; maxFrame: number }
  /** Callback when scrubbing starts */
  onScrubStart?: () => void
  /** Callback when scrubbing ends */
  onScrubEnd?: () => void
  /** Callback when drag starts (for undo batching) */
  onDragStart?: () => void
  /** Callback when drag ends (for undo batching) */
  onDragEnd?: () => void
  /** Callback when pointer cancellation discards an in-progress drag. */
  onDragCancel?: () => void
  /** Callback to add a keyframe at the current frame */
  onAddKeyframe?: (property: AnimatableProperty, frame: number) => void
  /** Callback to duplicate keyframes to explicit target frames */
  onDuplicateKeyframes?: (
    entries: Array<{ ref: KeyframeRef; frame: number; value: number }>,
  ) => void
  /** Current property values at the playhead */
  propertyValues?: Partial<Record<AnimatableProperty, number>>
  /** Scalar source rows hidden because a compound row represents them together. */
  hiddenPropertyRows?: readonly AnimatableProperty[]
  /** Integrated two-axis row configuration keyed by its primary timeline property. */
  compoundPropertyRows?: Partial<Record<AnimatableProperty, CompoundPropertyInputConfig>>
  /** Secondary value curve rendered with its compound primary row in Value mode. */
  compoundSecondaryProperties?: Partial<Record<AnimatableProperty, AnimatableProperty>>
  /** Coupled/separated authoring controls shown in the owning property-group menu. */
  dimensionSeparationByProperty?: Partial<
    Record<AnimatableProperty, DopesheetDimensionSeparationControl>
  >
  /** Callback to commit a property value at the playhead */
  onPropertyValueCommit?: (
    property: AnimatableProperty,
    value: number,
    options?: { allowCreate?: boolean },
  ) => void
  /** Live no-undo value updates used while horizontally scrubbing an input. */
  onPropertyValuePreview?: (property: AnimatableProperty, value: number) => void
  /** Existing post-keyframe direct property links for this item. */
  propertyLinks?: readonly DirectPropertyLink[]
  /** Human-readable source labels keyed by target property. */
  propertyLinkSourceLabels?: Partial<Record<DirectLinkableProperty, string>>
  /** Begin an AE-style pick-whip drag from a target property. */
  onPropertyLinkPointerDown?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    property: DirectLinkableProperty,
  ) => void
  /** Remove a direct property link while preserving authored keyframes. */
  onRemovePropertyLink?: (property: DirectLinkableProperty) => void
  /** @deprecated Use propertyLinks. */
  linkedTransformExpressions?: readonly DirectPropertyLink[]
  /** @deprecated Use propertyLinkSourceLabels. */
  linkedTransformSourceLabels?: Partial<Record<DirectLinkableProperty, string>>
  /** @deprecated Use onPropertyLinkPointerDown. */
  onLinkedTransformPointerDown?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    property: DirectLinkableProperty,
  ) => void
  /** @deprecated Use onRemovePropertyLink. */
  onRemoveLinkedTransform?: (property: DirectLinkableProperty) => void
  /** Sandboxed expressions keyed by their target property. */
  propertyExpressions?: readonly PropertyExpression[]
  /** Values after keyframes/direct links but before expressions. */
  preExpressionPropertyValues?: Partial<Record<AnimatableProperty, number>>
  /** Resolve references used by expression previews and error reporting. */
  resolveExpressionReference?: (
    itemId: string,
    property: DirectLinkableProperty,
  ) => ExpressionValue | null
  /** Create or update a sandboxed property expression. */
  onSetPropertyExpression?: (
    property: DirectLinkableProperty,
    source: string,
    enabled: boolean,
  ) => void
  /** Remove a sandboxed property expression. */
  onRemovePropertyExpression?: (property: DirectLinkableProperty) => void
  /** Reports dock height so embedded Motion lanes can expand without overlapping siblings. */
  onExpressionDockHeightChange?: (height: number) => void
  /** Reports visible row height so embedded Motion lanes shrink when groups collapse. */
  onLaneContentHeightChange?: (height: number) => void
  /** Restores accordion state when a virtualized editor remounts. */
  initialExpandedGroups?: Readonly<Record<string, boolean>>
  /** Persists accordion state outside a virtualized editor before it unmounts. */
  onExpandedGroupsChange?: (expandedGroups: Record<string, boolean>) => void
  /** Reset effect parameters to their definition defaults and clear their keyframes. */
  onResetPropertiesToDefault?: (properties: AnimatableProperty[]) => void
  /** Callback to remove selected keyframes */
  onRemoveKeyframes?: (refs: KeyframeRef[]) => void
  /** Copy selected keyframes */
  onCopyKeyframes?: () => void
  /** Cut selected keyframes */
  onCutKeyframes?: () => void
  /** Paste keyframes from clipboard */
  onPasteKeyframes?: () => void
  /** Whether clipboard currently contains keyframes */
  hasKeyframeClipboard?: boolean
  /** Whether clipboard represents a cut operation */
  isKeyframeClipboardCut?: boolean
  /** Selected interpolation/easing for the current editor selection */
  selectedInterpolation?: EasingType
  /** Available interpolation options */
  interpolationOptions?: ReadonlyArray<{ value: EasingType; label: string }>
  /** Callback when the selection interpolation changes */
  onInterpolationChange?: (easing: EasingType) => void
  /** Disable interpolation control */
  interpolationDisabled?: boolean
  /** Callback to navigate to a keyframe */
  onNavigateToKeyframe?: (frame: number) => void
  /** Transition-blocked frame ranges (keyframes cannot be placed here) */
  transitionBlockedRanges?: BlockedFrameRange[]
  /** Procedural generator inputs for dashed ghost curves in the graph. */
  proceduralPreview?: ProceduralPreviewInput
  /** Motion modifiers used to render procedural bands in the sheet. */
  motionModifiers?: MotionModifier[]
  /** Procedural text-animation spans shown above Edit's authored keyframe rows. */
  textMotionBands?: readonly TextMotionTimelineBand[]
  /** Capture state before an Edit text-animation duration drag. */
  onTextMotionDurationDragStart?: () => void
  /** Commit a text-animation duration after an Edit band drag. */
  onTextMotionDurationCommit?: (slot: TextMotionSlot, durationFrames: number) => void
  /** Discard an interrupted Edit text-animation duration drag. */
  onTextMotionDurationCancel?: () => void
  /** Capture state before moving an Edit text-animation away from its clip edge. */
  onTextMotionOffsetDragStart?: () => void
  /** Commit an IN/OUT text-animation clip-edge offset. */
  onTextMotionOffsetCommit?: (slot: TextMotionSlot, offsetFrames: number) => void
  /** Discard an interrupted Edit text-animation offset drag. */
  onTextMotionOffsetCancel?: () => void
  /** Open the selected text animation in the inspector. */
  onTextMotionBandClick?: (slot: TextMotionSlot) => void
  /** Whether the edited clip has any enabled procedural motion source. */
  hasProceduralMotion?: boolean
  /** Whether the edited clip carries bakeable procedural motion. */
  canBakeMotion?: boolean
  /** Flatten the clip's procedural motion into editable keyframes. */
  onBakeMotion?: () => void
  /** Whether the editor is disabled */
  disabled?: boolean
  /** Which visualization to render on the right side. `split` shows both the
   *  sheet body and the curve/graph pane at once (Animate workspace placement),
   *  sharing a single frame viewport and playhead so they cannot desync. */
  visualizationMode?: 'dopesheet' | 'graph' | 'split'
  /** Main graph semantics for compound vector properties. */
  graphMode?: 'value' | 'speed'
  /** Switch the main graph between authored values and temporal velocity. */
  onGraphModeChange?: (mode: 'value' | 'speed') => void
  /** Replaces the value graph canvas when graphMode is speed. */
  speedGraphContent?: ReactNode
  /** Use the wider property column + value inputs (Animate workspace, where
   *  there is room). Defaults to the compact sidebar sizing. */
  spacious?: boolean
  /** Render selected property groups as direct rows in the graph property column. */
  inlinePropertyGroupIds?: readonly string[]
  /** Workspace-specific row labels used by compact/classic presentations. */
  propertyLabels?: Partial<Record<AnimatableProperty, string>>
  /** Optional axis constraint shown on a primary scalar row (for example Scale X). */
  axisConstraintByProperty?: Partial<
    Record<
      AnimatableProperty,
      {
        label: string
        constrained: boolean
        onChange: (constrained: boolean) => void
      }
    >
  >
  /**
   * `classic` is the compact Edit-workspace sheet: plain property rows, ruler,
   * playhead, and timing controls without Motion's grouping/link/curve chrome.
   * `lanes` embeds only rows beneath the Motion layer header.
   */
  presentation?: 'editor' | 'classic' | 'lanes'
  /** Override the property column width when embedding lane rows. */
  propertyColumnWidth?: number
  /** Match an owning timeline ruler with evenly spaced grid divisions. */
  timelineGridDivisions?: number
  /** Show one selected property curve at a time instead of layered graph curves. */
  singleCurveMode?: boolean
  /** Keep the selected curve toggle visually active when its graph is rendered
   *  by an external pane rather than this editor's own right side. */
  selectedCurveVisibleExternally?: boolean
  /** Optional controlled property filter for embedded lane presentations. */
  propertyFilter?: 'all' | 'keyframed'
  /** Absolute frame where a generated procedural band begins. */
  proceduralFrameOffset?: number
  /** Duration used for generated procedural bands. Defaults to the editor range. */
  proceduralDurationInFrames?: number
  /** Parameter groups visible when this editor instance first opens. */
  initialVisibleGroupIds?: readonly string[]
  /** Render the playhead. Disable it when the parent owns one shared overlay. */
  showPlayhead?: boolean
  /** Activate editor-only shortcuts when this surface owns pointer or keyboard focus. */
  shortcutsEnabled?: boolean
  /** Keep the Edit add-keyframe shortcut active while its dock is open. */
  addKeyframeShortcutEnabled?: boolean
  /** User-configurable bindings for high-frequency keyframe actions. */
  shortcuts?: {
    addKeyframe: string
    previousKeyframe: string
    nextKeyframe: string
    toggleAutoKey: string
    fitKeyframes: string
  }
  /** Additional class name */
  className?: string
}

type StructureRow = { property: AnimatableProperty; keyframes: Keyframe[] }

// Stable empty fallbacks so memoized timeline cells don't see fresh `[]` refs.
const EMPTY_KEYFRAMES: Keyframe[] = []
const EMPTY_STRUCTURE_ROWS: StructureRow[] = []
const EMPTY_PROPERTY_GROUP_IDS: readonly string[] = []
const EMPTY_HIDDEN_PROPERTIES: readonly AnimatableProperty[] = []
const EMPTY_COMPOUND_ROWS: Partial<Record<AnimatableProperty, CompoundPropertyInputConfig>> = {}
const EMPTY_COMPOUND_SECONDARIES: Partial<Record<AnimatableProperty, AnimatableProperty>> = {}
const EMPTY_DIMENSION_SEPARATION: NonNullable<
  DopesheetEditorProps['dimensionSeparationByProperty']
> = {}

function findGroupDimensionSeparation(
  rows: readonly DopesheetPropertyRow[],
  controls: NonNullable<DopesheetEditorProps['dimensionSeparationByProperty']>,
): DopesheetDimensionSeparationEntry | null {
  for (const row of rows) {
    const control = controls[row.property]
    if (control) return { property: row.property, control }
  }
  return null
}

/**
 * Properties shown in the graph pane: in single-curve mode only the selected
 * property (plus its compound secondary), otherwise all visible properties.
 */
function resolveGraphVisiblePropertyList(
  singleCurveMode: boolean | undefined,
  graphDisplayProperty: AnimatableProperty | null,
  compoundSecondaryProperties: Partial<Record<AnimatableProperty, AnimatableProperty>>,
  visibleGraphProperties: AnimatableProperty[],
): AnimatableProperty[] {
  return singleCurveMode && graphDisplayProperty
    ? [
        graphDisplayProperty,
        ...(compoundSecondaryProperties[graphDisplayProperty]
          ? [compoundSecondaryProperties[graphDisplayProperty]!]
          : []),
      ]
    : visibleGraphProperties
}

/** Whether the sheet body has rows to show (classic also shows text-motion bands). */
function hasSheetBodyRows(rowCount: number, presentation: string, bandCount: number): boolean {
  return rowCount > 0 || (presentation === 'classic' && bandCount > 0)
}


const EMPTY_FRAME_GROUPS: DopesheetPropertyGroupStructure<StructureRow>['frameGroups'] = []




const TimelineViewportCuller = memo(function TimelineViewportCuller({
  children,
}: {
  children: React.ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [isNearViewport, setIsNearViewport] = useState(true)

  useEffect(() => {
    const node = rootRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    // Classic Edit has its own scroller. Observing against the browser viewport
    // can report every row as hidden while the panel is opening and stay stale.
    const scrollRoot =
      node.closest('[data-dopesheet-scroll-viewport]') ??
      node.closest('[data-testid="motion-layer-scroll-area"]')
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        if (!entry.isIntersecting && node.contains(document.activeElement)) return
        setIsNearViewport(entry.isIntersecting)
      },
      {
        root: scrollRoot,
        rootMargin: '96px 0px',
      },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={rootRef} className="min-w-0 overflow-hidden">
      {isNearViewport ? children : null}
    </div>
  )
})

export const DopesheetEditor = memo(function DopesheetEditor({
  frameViewport,
  onFrameViewportChange,
  clampViewportToContent = true,
  viewportInteractionEnabled = true,
  itemId,
  keyframesByProperty,
  selectedProperty = null,
  selectedKeyframeIds = new Set(),
  currentFrame = 0,
  playheadFrame,
  playheadClampToItemBounds = true,
  globalFrame = null,
  itemFrom = 0,
  totalFrames = 300,
  affectedFrameRange,
  trimmedKeyframeCount = 0,
  onTrimAnimation,
  fps = 30,
  width = 600,
  height = 260,
  onKeyframeMove,
  onKeyframesMove,
  onBezierHandleMove,
  onSegmentEasingChange,
  onSelectionChange,
  additionalSnapFrames = [],
  onSelectionFrameDelta,
  onPropertyChange,
  onCurveVisibilityChange,
  onActivePropertyChange,
  onScrub,
  onSkim,
  globalFrameToPixels,
  timelineScrollContainerRef,
  timelinePanBaseScrollLeft,
  timelinePanBasePixelsPerSecond,
  linkedTimelineViewportWidth,
  getTimelineLivePixelsPerSecond,
  onRulerEdgeScroll,
  scrubClampToItemBounds = true,
  scrubFrameBounds,
  onScrubStart,
  onScrubEnd,
  onDragStart,
  onDragEnd,
  onDragCancel,
  onAddKeyframe,
  onDuplicateKeyframes,
  propertyValues = {},
  hiddenPropertyRows = EMPTY_HIDDEN_PROPERTIES,
  compoundPropertyRows = EMPTY_COMPOUND_ROWS,
  compoundSecondaryProperties = EMPTY_COMPOUND_SECONDARIES,
  dimensionSeparationByProperty = EMPTY_DIMENSION_SEPARATION,
  onPropertyValueCommit,
  onPropertyValuePreview,
  propertyLinks,
  propertyLinkSourceLabels,
  onPropertyLinkPointerDown,
  onRemovePropertyLink,
  linkedTransformExpressions = [],
  linkedTransformSourceLabels = {},
  onLinkedTransformPointerDown,
  onRemoveLinkedTransform,
  propertyExpressions = [],
  preExpressionPropertyValues = {},
  resolveExpressionReference,
  onSetPropertyExpression,
  onRemovePropertyExpression,
  onExpressionDockHeightChange,
  onLaneContentHeightChange,
  initialExpandedGroups,
  onExpandedGroupsChange,
  onResetPropertiesToDefault,
  onRemoveKeyframes,
  onCopyKeyframes,
  onCutKeyframes,
  onPasteKeyframes,
  hasKeyframeClipboard = false,
  isKeyframeClipboardCut = false,
  selectedInterpolation,
  interpolationOptions = [],
  onInterpolationChange,
  interpolationDisabled = false,
  onNavigateToKeyframe,
  transitionBlockedRanges = [],
  proceduralPreview,
  motionModifiers,
  textMotionBands = [],
  onTextMotionDurationDragStart,
  onTextMotionDurationCommit,
  onTextMotionDurationCancel,
  onTextMotionOffsetDragStart,
  onTextMotionOffsetCommit,
  onTextMotionOffsetCancel,
  onTextMotionBandClick,
  hasProceduralMotion = false,
  canBakeMotion = false,
  onBakeMotion,
  disabled = false,
  visualizationMode = 'dopesheet',
  graphMode = 'value',
  onGraphModeChange,
  speedGraphContent,
  spacious = false,
  inlinePropertyGroupIds = EMPTY_PROPERTY_GROUP_IDS,
  propertyLabels = {},
  axisConstraintByProperty = {},
  presentation = 'editor',
  propertyColumnWidth,
  timelineGridDivisions,
  singleCurveMode = false,
  selectedCurveVisibleExternally = false,
  propertyFilter,
  proceduralFrameOffset = 0,
  proceduralDurationInFrames = totalFrames,
  initialVisibleGroupIds,
  showPlayhead = true,
  shortcutsEnabled = false,
  addKeyframeShortcutEnabled = false,
  shortcuts,
  className,
}: DopesheetEditorProps) {
  perfMarkRender('DopesheetEditor')
  const { t } = useTranslation()
  const resolvedPropertyLinks = propertyLinks ?? linkedTransformExpressions
  const resolvedPropertyLinkSourceLabels = propertyLinkSourceLabels ?? linkedTransformSourceLabels
  const beginPropertyLink = onPropertyLinkPointerDown ?? onLinkedTransformPointerDown
  const removePropertyLink = onRemovePropertyLink ?? onRemoveLinkedTransform
  // `split` shows both panes at once. Derive per-pane visibility so the many
  // mode branches below read intent ("is the graph showing?") rather than an
  // exact mode, and the exclusive `dopesheet`/`graph` modes stay unchanged.
  const showSheetPane = visualizationMode !== 'graph'
  const showGraphPane = visualizationMode !== 'dopesheet'
  const isSplitView = visualizationMode === 'split'
  // Wider property column + value inputs when there is room (Animate workspace).
  const columnWidth =
    propertyColumnWidth ?? (spacious ? SPACIOUS_PROPERTY_COLUMN_WIDTH : PROPERTY_COLUMN_WIDTH)
  const timelineRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const graphPaneRef = useRef<HTMLDivElement>(null)
  const keyframeButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const committedKeyframeSelectionRef = useRef(selectedKeyframeIds)
  const marqueePreviewSelectionRef = useRef<Set<string> | null>(null)
  const marqueePreviewTouchedIdsRef = useRef(new Set<string>())
  committedKeyframeSelectionRef.current = selectedKeyframeIds
  const snapEnabled = true
  const pickWhipRootRef = useRef<HTMLDivElement>(null)
  const syncLivePixelGeometryRef = useRef<() => void>(() => {})
  const {
    expressionEditor,
    setExpressionEditor,
    expressionReferencePick,
    setExpressionReferencePick,
    expressionReferenceDrag,
    beginExpressionReferenceDrag,
    expressionDockRef,
    expressionTextareaRef,
    openPropertyExpressionEditor,
    applyExpressionPreset,
  } = usePropertyExpressionEditor({ onExpressionDockHeightChange, pickWhipRootRef })
  const autoKeyEnabledByProperty = useAutoKeyframeStore(
    useCallback(
      (state) => state.enabledByItem[itemId] ?? EMPTY_AUTO_KEY_ENABLED_BY_PROPERTY,
      [itemId],
    ),
  )
  const toggleAutoKeyframeEnabled = useAutoKeyframeStore((state) => state.toggleAutoKeyframeEnabled)
  const appliedDragPreviewFramesRef = useRef<Record<string, number> | null>(null)
  const [sheetPreviewFrames, setSheetPreviewFrames] = useState<Record<string, number> | null>(null)
  const [sheetPreviewDuplicateKeyframeIds, setSheetPreviewDuplicateKeyframeIds] = useState<
    string[] | null
  >(null)

  const keyframeFrameBounds = useMemo(() => {
    let min = Infinity
    let max = -Infinity
    for (const list of Object.values(keyframesByProperty)) {
      for (const keyframe of list ?? []) {
        if (keyframe.frame < min) min = keyframe.frame
        if (keyframe.frame > max) max = keyframe.frame
      }
    }
    return max >= min ? { min, max } : null
  }, [keyframesByProperty])

  const { viewport, updateViewport, normalizeViewport, contentFrameMax, minViewportFrames } =
    useDopesheetViewport({
      itemId,
      totalFrames,
      keyframeFrameBounds,
      frameViewport,
      onFrameViewportChange,
      clampToContent: clampViewportToContent,
    })

  const { width: timelineWidth } = useElementSize(timelineRef, {
    deps: [visualizationMode],
  })
  const { width: sheetScrollWidth } = useElementSize(scrollAreaRef, {
    enabled: showSheetPane,
    deps: [visualizationMode],
  })

  const availableProperties = useMemo(
    () => Object.keys(keyframesByProperty) as AnimatableProperty[],
    [keyframesByProperty],
  )
  const hiddenPropertyRowSet = useMemo(
    () => new Set<AnimatableProperty>(hiddenPropertyRows),
    [hiddenPropertyRows],
  )
  // Properties with an actual curve to draw (>= 2 keyframes). The graph picks a
  // default from these so it isn't blank when the selected/first property only
  // has a single keyframe.
  const graphableProperties = useMemo(
    () =>
      availableProperties.filter(
        (property) =>
          !isColorAnimatableProperty(property) && (keyframesByProperty[property]?.length ?? 0) >= 2,
      ),
    [availableProperties, keyframesByProperty],
  )
  const allPropertyGroups = useMemo(
    () => getPropertyAccordionGroups(availableProperties),
    [availableProperties],
  )
  const inlinePropertyGroupIdSet = useMemo(
    () => new Set(inlinePropertyGroupIds),
    [inlinePropertyGroupIds],
  )
  const propertyGroupIdByProperty = useMemo(() => {
    const map = new Map<AnimatableProperty, string>()
    for (const group of allPropertyGroups) {
      for (const property of group.properties) {
        map.set(property, group.id)
      }
    }
    return map
  }, [allPropertyGroups])
  const keyframedPropertyIds = useMemo(
    () =>
      new Set(
        availableProperties.filter((property) => (keyframesByProperty[property] ?? []).length > 0),
      ),
    [availableProperties, keyframesByProperty],
  )
  const proceduralBandByProperty = useMemo(
    () => getProceduralBands(motionModifiers, proceduralDurationInFrames, proceduralFrameOffset),
    [motionModifiers, proceduralDurationInFrames, proceduralFrameOffset],
  )
  const {
    graphVisibleProperties,
    setGraphVisibleProperties,
    graphRulerUnit,
    setGraphRulerUnit,
    showAllGraphHandles,
    setShowAllGraphHandles,
    autoZoomGraphHeight,
    setAutoZoomGraphHeight,
    graphVerticalZoomValue,
    setGraphVerticalZoomValue,
    togglePropertyCurve,
    toggleGroupCurves,
  } = useGraphViewState({
    itemId,
    availableProperties,
    graphableProperties,
    selectedProperty,
    onPropertyChange,
    onActivePropertyChange,
  })

  const {
    visibleGroups,
    setVisibleGroups,
    showKeyframedOnly,
    setShowKeyframedOnly,
    toggleVisibleGroup,
    isPropertyLocked,
    toggleLockedProperty,
    setGroupLocked,
  } = usePropertyFilters({
    allPropertyGroups,
    availableProperties,
    initialVisibleGroupIds,
  })
  const filterKeyframedOnly =
    propertyFilter === undefined ? showKeyframedOnly : propertyFilter === 'keyframed'
  const linkedTransformPropertyIds = useMemo(
    () =>
      new Set<string>(
        resolvedPropertyLinks.map((link) => {
          if (link.targetProperty === 'position') return 'x'
          if (link.targetProperty === 'scale') return 'width'
          if (link.targetProperty === 'anchor') return 'anchorX'
          return link.targetProperty
        }),
      ),
    [resolvedPropertyLinks],
  )

  const filteredProperties = useMemo(
    () =>
      availableProperties
        .filter((property) => !hiddenPropertyRowSet.has(property))
        .filter((property) => {
          const groupId = propertyGroupIdByProperty.get(property)
          const groupVisible = groupId ? (visibleGroups[groupId] ?? true) : true
          if (!groupVisible) return false
          if (
            filterKeyframedOnly &&
            !keyframedPropertyIds.has(property) &&
            !linkedTransformPropertyIds.has(property) &&
            !proceduralBandByProperty.has(property)
          )
            return false
          return true
        }),
    [
      availableProperties,
      hiddenPropertyRowSet,
      keyframedPropertyIds,
      linkedTransformPropertyIds,
      proceduralBandByProperty,
      propertyGroupIdByProperty,
      filterKeyframedOnly,
      visibleGroups,
    ],
  )
  const activeSelectedProperty =
    selectedProperty && filteredProperties.includes(selectedProperty) ? selectedProperty : null
  const visibleProperties = filteredProperties
  const propertyColumnProperties = filteredProperties
  const hasPropertyFilters =
    filterKeyframedOnly || allPropertyGroups.some((group) => visibleGroups[group.id] === false)

  // Frame-independent keyframe data. These references only change when the
  // properties or keyframes change — NOT when the playhead moves — so the
  // memoized timeline grid cells can skip re-rendering during scrubs.
  const sheetKeyframesByProperty = useMemo(() => {
    const map = new Map<AnimatableProperty, Keyframe[]>()
    for (const property of visibleProperties) {
      map.set(
        property,
        (keyframesByProperty[property] ?? []).toSorted((a, b) => a.frame - b.frame),
      )
    }
    return map
  }, [visibleProperties, keyframesByProperty])

  const sheetRowsStructure = useMemo(
    () =>
      visibleProperties.map((property) => ({
        property,
        keyframes: sheetKeyframesByProperty.get(property) ?? [],
      })),
    [visibleProperties, sheetKeyframesByProperty],
  )

  // Stable, frame-independent group structure keyed by group id — used to feed
  // the memoized group timeline cells.
  const groupTimelineById = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildGroupedPropertyStructure>[number]>()
    for (const group of buildGroupedPropertyStructure(sheetRowsStructure)) {
      map.set(group.id, group)
    }
    return map
  }, [sheetRowsStructure])

  // Playhead-dependent rows (carry the per-frame `controls`). `propertyColumnProperties`
  // is the same list as `visibleProperties`, so the column/sheet rows are identical.
  const sheetRows = useMemo<DopesheetPropertyRow[]>(
    () =>
      sheetRowsStructure.map((row) => ({
        ...row,
        controls: getDopesheetRowControlState(row.keyframes, currentFrame),
      })),
    [sheetRowsStructure, currentFrame],
  )

  const propertyRows = sheetRows
  const groupedSheetRows = useMemo(
    () => buildGroupedPropertyRows(sheetRows, currentFrame),
    [currentFrame, sheetRows],
  )
  const groupedPropertyRows = groupedSheetRows
  const propertyRowByProperty = useMemo(
    () => new Map(propertyRows.map((row) => [row.property, row])),
    [propertyRows],
  )
  const { expandedGroups, toggleGroup, setAllGroupsExpanded } = useGroupExpansion({
    allPropertyGroups,
    groupedSheetRows,
    groupedPropertyRows,
    activeSelectedProperty,
    initialExpandedGroups,
    onExpandedGroupsChange,
  })

  // Shift-clicking any row's lock icon applies that row's next lock state to
  // every visible row, so "lock everything except this one" is two clicks.
  const setAllRowsLocked = useCallback(
    (locked: boolean) => {
      setGroupLocked(visibleProperties, locked)
    },
    [setGroupLocked, visibleProperties],
  )

  const resetParameterView = useCallback(() => {
    setShowKeyframedOnly(false)
    setVisibleGroups(
      Object.fromEntries(allPropertyGroups.map((group) => [group.id, true])) as Record<
        string,
        boolean
      >,
    )
    setAllGroupsExpanded(true)
  }, [allPropertyGroups, setAllGroupsExpanded, setShowKeyframedOnly, setVisibleGroups])

  const graphPaneSize = useElementSize(graphPaneRef, {
    enabled: showGraphPane,
    deps: [visualizationMode, propertyRows.length],
  })

  const formatPropertyValue = useCallback(
    (property: AnimatableProperty, value: number | undefined) => {
      if (value === undefined || Number.isNaN(value)) return ''
      if (isColorAnimatableProperty(property)) return keyframeValueToHexColor(value)
      const decimals = PROPERTY_VALUE_RANGES[property]?.decimals ?? 2
      return decimals === 0 ? String(Math.round(value)) : value.toFixed(decimals)
    },
    [],
  )

  const rowKeyframesByProperty = sheetKeyframesByProperty

  const keyframeMetaById = useMemo(() => {
    const map = new Map<string, KeyframeMeta>()
    for (const row of sheetRowsStructure) {
      for (const keyframe of row.keyframes) {
        map.set(keyframe.id, { property: row.property, keyframe })
      }
    }
    return map
  }, [sheetRowsStructure])

  const keyframeMetaByIdRef = useRef(keyframeMetaById)
  keyframeMetaByIdRef.current = keyframeMetaById

  const selectedFrameSummary = useMemo(() => {
    const selectedFrames: number[] = []
    for (const keyframeId of selectedKeyframeIds) {
      const meta = keyframeMetaById.get(keyframeId)
      if (meta) {
        selectedFrames.push(meta.keyframe.frame)
      }
    }

    if (selectedFrames.length === 0) {
      return {
        hasSelection: false,
        hasMixedFrames: false,
        localFrame: null as number | null,
        globalFrame: null as number | null,
      }
    }

    const firstFrame = selectedFrames[0] ?? null
    const hasMixedFrames = selectedFrames.some((frame) => frame !== firstFrame)
    const frameOffset = globalFrame === null ? null : globalFrame - currentFrame

    return {
      hasSelection: true,
      hasMixedFrames,
      localFrame: hasMixedFrames ? null : firstFrame,
      globalFrame:
        hasMixedFrames || firstFrame === null || frameOffset === null
          ? null
          : firstFrame + frameOffset,
    }
  }, [currentFrame, globalFrame, keyframeMetaById, selectedKeyframeIds])
  const selectedCurveProperty = useMemo(() => {
    let property: AnimatableProperty | null = null

    for (const keyframeId of selectedKeyframeIds) {
      const meta = keyframeMetaById.get(keyframeId)
      if (!meta) {
        continue
      }

      if (property === null) {
        property = meta.property
        continue
      }

      if (property !== meta.property) {
        return null
      }
    }

    return property
  }, [keyframeMetaById, selectedKeyframeIds])

  useEffect(() => {
    if (!showGraphPane || !selectedCurveProperty) {
      return
    }

    if (selectedProperty !== selectedCurveProperty) {
      onPropertyChange?.(selectedCurveProperty)
    }
    onActivePropertyChange?.(selectedCurveProperty)
  }, [
    onActivePropertyChange,
    onPropertyChange,
    selectedCurveProperty,
    selectedProperty,
    showGraphPane,
  ])

  const visibleKeyframes = useMemo(
    () =>
      sheetRows.flatMap((row) =>
        row.keyframes.map((keyframe) => ({
          property: row.property,
          keyframe,
        })),
      ),
    [sheetRows],
  )

  const frameRange = Math.max(1, viewport.endFrame - viewport.startFrame)
  const horizontalZoomRatioBase = useMemo(
    () => Math.max(1, contentFrameMax / Math.max(1, minViewportFrames)),
    [contentFrameMax, minViewportFrames],
  )
  const horizontalZoomValue = useMemo(() => {
    if (horizontalZoomRatioBase <= 1) {
      return 0
    }

    const normalized =
      Math.log(contentFrameMax / Math.max(1, frameRange)) / Math.log(horizontalZoomRatioBase)
    return Math.max(0, Math.min(100, normalized * 100))
  }, [contentFrameMax, frameRange, horizontalZoomRatioBase])
  const visibleGraphProperties = useMemo(() => {
    const properties = new Set(graphVisibleProperties)
    for (const property of graphVisibleProperties) {
      const secondary = compoundSecondaryProperties[property]
      if (secondary) properties.add(secondary)
    }
    return [...properties]
  }, [compoundSecondaryProperties, graphVisibleProperties])
  const graphBaseValueRange = useMemo(
    () =>
      getCombinedGraphValueRange(
        visibleGraphProperties.map((property) => PROPERTY_VALUE_RANGES[property] ?? null),
        visibleGraphProperties.map((property) => keyframesByProperty[property] ?? []),
        autoZoomGraphHeight,
      ),
    [autoZoomGraphHeight, keyframesByProperty, visibleGraphProperties],
  )
  const graphBaseValueSpan = useMemo(
    () => Math.max(0.0001, graphBaseValueRange.max - graphBaseValueRange.min),
    [graphBaseValueRange],
  )
  const graphMinZoomValueSpan = useMemo(
    () => Math.max(graphBaseValueSpan * 0.02, 0.0001),
    [graphBaseValueSpan],
  )
  const verticalZoomRatioBase = useMemo(
    () => Math.max(1, graphBaseValueSpan / graphMinZoomValueSpan),
    [graphBaseValueSpan, graphMinZoomValueSpan],
  )
  const fallbackTimelineWidth = Math.max(width - columnWidth, 1)
  const fullTimelineWidth = timelineWidth || fallbackTimelineWidth
  const sheetTimelineWidth = Math.max(0, sheetScrollWidth - columnWidth)
  const alignedTimelineWidth =
    showSheetPane && sheetTimelineWidth > 0
      ? Math.min(fullTimelineWidth, sheetTimelineWidth)
      : fullTimelineWidth
  const reservedScrollbarGutterWidth = Math.max(0, fullTimelineWidth - alignedTimelineWidth)
  // The Edit lane shares the main timeline's axis. Its own grid is a couple of
  // pixels narrower because of a border and scrollbar gutter, so using its
  // measured width introduces a small but persistent time-to-pixel drift. Let
  // the main viewport be authoritative whenever it is linked.
  const hasLinkedTimelineAxis =
    presentation === 'classic' &&
    linkedTimelineViewportWidth !== undefined &&
    linkedTimelineViewportWidth > 0
  const timelineCellBorderWidth =
    presentation === 'classic'
      ? hasLinkedTimelineAxis
        ? 0
        : 1
      : presentation === 'lanes'
        ? 1
        : 0
  const effectiveTimelineWidth = Math.max(
    hasLinkedTimelineAxis
      ? linkedTimelineViewportWidth
      : alignedTimelineWidth - timelineCellBorderWidth,
    1,
  )
  const timelineEdgeInset = presentation === 'classic' ? 0 : undefined
  const timelinePixelsPerSecond = useMemo(
    () => (effectiveTimelineWidth / frameRange) * fps,
    [effectiveTimelineWidth, frameRange, fps],
  )
  const getLiveDragPixelsPerFrame = useCallback(
    () =>
      getDopesheetDragPixelsPerFrame(getTimelineLivePixelsPerSecond, timelinePixelsPerSecond, fps),
    [fps, getTimelineLivePixelsPerSecond, timelinePixelsPerSecond],
  )

  useLayoutEffect(() => {
    const scrollContainer = timelineScrollContainerRef?.current
    const root = pickWhipRootRef.current
    if (!scrollContainer || !root || timelinePanBaseScrollLeft === undefined) {
      syncLivePixelGeometryRef.current = () => {}
      return
    }

    let scrollFrame: number | null = null
    const syncLiveGeometry = () => {
      const pixelsPerSecond =
        getTimelineLivePixelsPerSecond?.() ??
        timelinePanBasePixelsPerSecond ??
        timelinePixelsPerSecond
      syncDopesheetLivePixelGeometry({
        root,
        pixelsPerSecond,
        fps,
        scrollLeft: scrollContainer.scrollLeft,
        itemFrom,
        // Linked Edit cells retain a one-pixel left border. Their absolutely
        // positioned contents begin just inside it, so compensate without
        // transforming or scaling the surface.
        originOffset: hasLinkedTimelineAxis ? -1 : 0,
      })
    }
    const scheduleScrollSync = () => {
      if (scrollFrame !== null) return
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null
        syncLiveGeometry()
      })
    }
    const syncLiveEvent = () => {
      if (scrollFrame !== null) {
        cancelAnimationFrame(scrollFrame)
        scrollFrame = null
      }
      syncLiveGeometry()
    }

    syncLivePixelGeometryRef.current = syncLiveGeometry
    syncLiveGeometry()
    scrollContainer.addEventListener('scroll', scheduleScrollSync, { passive: true })
    scrollContainer.addEventListener(TIMELINE_LIVE_SCROLL_EVENT, syncLiveEvent)
    return () => {
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
      scrollContainer.removeEventListener('scroll', scheduleScrollSync)
      scrollContainer.removeEventListener(TIMELINE_LIVE_SCROLL_EVENT, syncLiveEvent)
      syncLivePixelGeometryRef.current = () => {}
    }
  }, [
    fps,
    getTimelineLivePixelsPerSecond,
    hasLinkedTimelineAxis,
    itemFrom,
    timelinePanBasePixelsPerSecond,
    timelinePanBaseScrollLeft,
    timelinePixelsPerSecond,
    timelineScrollContainerRef,
  ])
  useLayoutEffect(() => {
    // React may add drag previews or filtered rows without changing the live
    // axis inputs. Bring those new nodes onto the same current pixel axis before
    // the browser paints them.
    syncLivePixelGeometryRef.current()
  })

  const frameToX = useCallback(
    (frame: number) => getFrameAxisX(frame, viewport, effectiveTimelineWidth, timelineEdgeInset),
    [effectiveTimelineWidth, timelineEdgeInset, viewport],
  )
  const affectedFrameRangeGeometry = useMemo(() => {
    if (!affectedFrameRange || affectedFrameRange.toFrame <= affectedFrameRange.fromFrame) {
      return null
    }
    const rawLeft = frameToX(affectedFrameRange.fromFrame)
    const rawRight = frameToX(affectedFrameRange.toFrame)
    const left = Math.max(0, Math.min(effectiveTimelineWidth, rawLeft))
    const right = Math.max(0, Math.min(effectiveTimelineWidth, rawRight))
    if (right <= left) return null
    return { left, width: right - left }
  }, [affectedFrameRange, effectiveTimelineWidth, frameToX])
  const sharedGridFrameToX = useCallback(
    (frame: number) =>
      getFrameAxisX(
        frame,
        viewport,
        effectiveTimelineWidth + timelineCellBorderWidth,
        0,
      ) - timelineCellBorderWidth,
    [effectiveTimelineWidth, timelineCellBorderWidth, viewport],
  )
  const getRenderedKeyframeX = useCallback(
    (frame: number) =>
      getVisibleKeyframeX(frame, viewport, effectiveTimelineWidth, timelineEdgeInset),
    [effectiveTimelineWidth, timelineEdgeInset, viewport],
  )
  const setKeyframeButtonRef = useCallback((keyframeId: string, node: HTMLButtonElement | null) => {
    if (node) {
      keyframeButtonRefs.current.set(keyframeId, node)
      const previewSelection = marqueePreviewSelectionRef.current
      if (previewSelection) {
        const previewSelected = previewSelection.has(keyframeId)
        if (previewSelected !== committedKeyframeSelectionRef.current.has(keyframeId)) {
          node.dataset.marqueeSelected = String(previewSelected)
          marqueePreviewTouchedIdsRef.current.add(keyframeId)
        }
      }
    } else {
      keyframeButtonRefs.current.delete(keyframeId)
    }
  }, [])
  const handleMarqueeSelectionPreviewChange = useCallback((nextSelection: Set<string> | null) => {
    const touchedIds = new Set(marqueePreviewTouchedIdsRef.current)
    for (const keyframeId of committedKeyframeSelectionRef.current) touchedIds.add(keyframeId)
    if (nextSelection) {
      for (const keyframeId of nextSelection) touchedIds.add(keyframeId)
    }

    const nextTouchedIds = new Set<string>()
    for (const keyframeId of touchedIds) {
      const button = keyframeButtonRefs.current.get(keyframeId)
      if (!button) continue
      if (!nextSelection) {
        delete button.dataset.marqueeSelected
        continue
      }

      const previewSelected = nextSelection.has(keyframeId)
      const committedSelected = committedKeyframeSelectionRef.current.has(keyframeId)
      if (previewSelected === committedSelected) {
        delete button.dataset.marqueeSelected
      } else {
        button.dataset.marqueeSelected = String(previewSelected)
        nextTouchedIds.add(keyframeId)
      }
    }

    marqueePreviewSelectionRef.current = nextSelection
    marqueePreviewTouchedIdsRef.current = nextTouchedIds
  }, [])
  const applyDragPreviewFrames = useCallback(
    (nextPreviewFrames: Record<string, number> | null) => {
      const previousPreviewFrames = appliedDragPreviewFramesRef.current
      if (arePreviewFramesEqual(previousPreviewFrames, nextPreviewFrames)) {
        return
      }

      const duplicatePreviewIds =
        dragStateRef.current?.duplicateOnCommit && nextPreviewFrames
          ? dragStateRef.current.selectedKeyframeIds
          : null

      flushSync(() => {
        setSheetPreviewFrames(nextPreviewFrames)
        setSheetPreviewDuplicateKeyframeIds(duplicatePreviewIds)
      })

      const keyframeIds = new Set([
        ...Object.keys(previousPreviewFrames ?? {}),
        ...Object.keys(nextPreviewFrames ?? {}),
      ])

      if (duplicatePreviewIds) {
        appliedDragPreviewFramesRef.current = nextPreviewFrames
        return
      }

      for (const keyframeId of keyframeIds) {
        const button = keyframeButtonRefs.current.get(keyframeId)
        if (!button) continue

        const previewFrame = nextPreviewFrames?.[keyframeId]
        const frame = previewFrame ?? keyframeMetaByIdRef.current.get(keyframeId)?.keyframe.frame
        if (frame === undefined) continue

        const renderedX = getRenderedKeyframeX(frame)
        if (renderedX === null) {
          button.style.visibility = 'hidden'
          continue
        }

        button.style.left = `${renderedX}px`
        button.style.visibility = 'visible'
      }

      appliedDragPreviewFramesRef.current = nextPreviewFrames
    },
    [getRenderedKeyframeX],
  )
  const scheduleDragPreviewFrames = useCallback(
    (nextPreviewFrames: Record<string, number> | null) => {
      applyDragPreviewFrames(nextPreviewFrames)
    },
    [applyDragPreviewFrames],
  )
  const renderedKeyframeXById = useMemo(() => {
    const positions = new Map<string, number>()
    for (const row of sheetRowsStructure) {
      for (const keyframe of row.keyframes) {
        const x = getRenderedKeyframeX(keyframe.frame)
        if (x !== null) {
          positions.set(keyframe.id, x)
        }
      }
    }
    return positions
  }, [sheetRowsStructure, getRenderedKeyframeX])
  const renderedSheetEntries = useMemo(() => {
    const entries: RenderedSheetEntry[] = []
    const textMotionRowCount = presentation === 'classic' ? textMotionBands.length : 0
    let top = textMotionRowCount * ROW_HEIGHT

    for (const group of groupedSheetRows) {
      const inline = presentation === 'classic' || inlinePropertyGroupIdSet.has(group.id)
      if (!inline) {
        entries.push({ type: 'group', group, top })
        top += GROUP_HEADER_HEIGHT
      }

      if (!inline && !(expandedGroups[group.id] ?? true)) {
        continue
      }

      for (const row of group.rows) {
        entries.push({ type: 'row', row, top, indented: !inline })
        top += ROW_HEIGHT
      }
    }

    return {
      entries,
      contentHeight: top,
    }
  }, [
    expandedGroups,
    groupedSheetRows,
    inlinePropertyGroupIdSet,
    presentation,
    textMotionBands.length,
  ])
  useLayoutEffect(() => {
    if (presentation !== 'lanes') return
    onLaneContentHeightChange?.(renderedSheetEntries.contentHeight)
  }, [onLaneContentHeightChange, presentation, renderedSheetEntries.contentHeight])
  // Marquee points are only needed while a selection marquee is moving.
  // Building them eagerly duplicated the viewport-sensitive keyframe position
  // pass on every zoom frame, even when no marquee interaction was active.
  const getKeyframePoints = useCallback(
    () =>
      renderedSheetEntries.entries.flatMap((entry) => {
        if (entry.type === 'group') {
          return entry.group.frameGroups.flatMap((frameGroup) => {
            const x = getRenderedKeyframeX(frameGroup.frame)
            if (x === null) return []

            return frameGroup.keyframes
              .filter(({ property }) => !isPropertyLocked(property))
              .map(({ keyframe }) => ({
                keyframeId: keyframe.id,
                x,
                y: entry.top + GROUP_HEADER_HEIGHT / 2,
              }))
          })
        }

        if (isPropertyLocked(entry.row.property)) {
          return []
        }

        return entry.row.keyframes.flatMap((keyframe) => {
          const x = renderedKeyframeXById.get(keyframe.id)
          if (x === undefined) return []
          return [
            {
              keyframeId: keyframe.id,
              x,
              y: entry.top + ROW_HEIGHT / 2,
            },
          ]
        })
      }),
    [getRenderedKeyframeX, isPropertyLocked, renderedKeyframeXById, renderedSheetEntries.entries],
  )

  const xToFrame = useCallback(
    (x: number) => getFrameFromAxisX(x, viewport, effectiveTimelineWidth, timelineEdgeInset),
    [effectiveTimelineWidth, timelineEdgeInset, viewport],
  )

  const getFrameFromClientX = useCallback(
    (clientX: number) => {
      const node = timelineRef.current
      if (!node) return currentFrame
      const rect = node.getBoundingClientRect()
      const frame = xToFrame(clientX - rect.left - timelineCellBorderWidth)
      if (scrubClampToItemBounds) return clampFrame(frame, totalFrames)
      if (!scrubFrameBounds) return frame
      return Math.max(scrubFrameBounds.minFrame, Math.min(scrubFrameBounds.maxFrame, frame))
    },
    [
      currentFrame,
      scrubClampToItemBounds,
      scrubFrameBounds,
      timelineCellBorderWidth,
      totalFrames,
      xToFrame,
    ],
  )

  const getTimelineXFromClientX = useCallback(
    (clientX: number) => {
      const node = timelineRef.current
      if (!node) return 0
      const rect = node.getBoundingClientRect()
      return Math.max(
        0,
        Math.min(effectiveTimelineWidth - 1, clientX - rect.left - timelineCellBorderWidth),
      )
    },
    [effectiveTimelineWidth, timelineCellBorderWidth],
  )

  const getContentYFromClientY = useCallback(
    (clientY: number) => {
      const node = scrollAreaRef.current
      if (!node) return 0
      const rect = node.getBoundingClientRect()
      const y = clientY - rect.top + node.scrollTop
      const maxY = Math.max(0, renderedSheetEntries.contentHeight)
      return Math.max(0, Math.min(maxY, y))
    },
    [renderedSheetEntries.contentHeight],
  )

  const ticks = useMemo(() => {
    if (timelineGridDivisions && timelineGridDivisions > 0) {
      return Array.from(
        { length: timelineGridDivisions + 1 },
        (_, index) =>
          viewport.startFrame + (index / timelineGridDivisions) * frameRange,
      )
    }
    const step = getNiceTickStep(frameRange)
    // Edit pans the already-rendered sheet on the compositor while expensive
    // keyframe rows settle less frequently. Keep a generous ruler-only buffer
    // on both sides so incoming tick marks are already present and move with
    // the main ruler instead of appearing at the next settled React update.
    const rulerOverscanFrames = timelineScrollContainerRef ? frameRange * 2 : 0
    const first = Math.floor((viewport.startFrame - rulerOverscanFrames) / step) * step
    const last = viewport.endFrame + rulerOverscanFrames
    const result: number[] = []
    for (let frame = first; frame <= last; frame += step) {
      result.push(frame)
    }
    return result
  }, [
    viewport.startFrame,
    viewport.endFrame,
    frameRange,
    timelineGridDivisions,
    timelineScrollContainerRef,
  ])

  const propertyGridStyle = useMemo(() => {
    return { gridTemplateColumns: `${columnWidth}px 1fr` }
  }, [columnWidth])

  const selectedRefs = useMemo(() => {
    const refs: KeyframeRef[] = []
    for (const keyframeId of selectedKeyframeIds) {
      const meta = keyframeMetaById.get(keyframeId)
      if (!meta) continue
      if (isPropertyLocked(meta.property)) continue
      refs.push({
        itemId,
        property: meta.property,
        keyframeId,
      })
    }
    return refs
  }, [selectedKeyframeIds, keyframeMetaById, isPropertyLocked, itemId])
  const selectedRefIds = useMemo(() => selectedRefs.map((ref) => ref.keyframeId), [selectedRefs])

  const isCurrentFrameBlocked = useMemo(
    () =>
      transitionBlockedRanges.some(
        (range) => currentFrame >= range.start && currentFrame < range.end,
      ),
    [transitionBlockedRanges, currentFrame],
  )

  // Adds inside a transition region are rejected by the action layer; surface
  // that instead of failing silently. A fixed toast id prevents stacking on
  // repeated clicks.
  const notifyKeyframeBlocked = useCallback(() => {
    toast.warning(t('timeline.keyframeEditor.transitionBlocked'), {
      id: 'keyframe-transition-blocked',
    })
  }, [t])

  const snapFrameTargets = useMemo(() => {
    const targets: number[] = [0, currentFrame, ...additionalSnapFrames]
    for (const { keyframe } of visibleKeyframes) {
      if (!selectedKeyframeIds.has(keyframe.id)) {
        targets.push(keyframe.frame)
      }
    }
    return [...new Set(targets)]
  }, [additionalSnapFrames, visibleKeyframes, selectedKeyframeIds, currentFrame])

  const snapThresholdFrames = useMemo(
    () => (SNAP_THRESHOLD_PX / effectiveTimelineWidth) * frameRange,
    [effectiveTimelineWidth, frameRange],
  )

  const snapFrame = useCallback(
    (frame: number) => {
      let closest = frame
      let minDistance = Infinity
      for (const target of snapFrameTargets) {
        const distance = Math.abs(frame - target)
        if (distance <= snapThresholdFrames && distance < minDistance) {
          minDistance = distance
          closest = target
        }
      }
      return closest
    },
    [snapFrameTargets, snapThresholdFrames],
  )

  const { setHorizontalZoomValue, resetViewport, fitKeyframesInView, handleWheel } =
    useDopesheetNavigation({
      updateViewport,
      normalizeViewport,
      contentFrameMax,
      minViewportFrames,
      horizontalZoomRatioBase,
      selectedKeyframeIds,
      keyframeMetaById,
      disabled,
      getFrameFromClientX,
      effectiveTimelineWidth,
      frameRange,
    })

  const {
    handleRemoveKeyframes,
    buildSelectionFramePreview,
    commitSelectionFramePreview,
    duplicateSelectionFramePreview,
    moveSelectedKeyframesByDelta,
  } = useSelectionFrameActions({
    selectedRefs,
    selectedRefIds,
    keyframeMetaByIdRef,
    isPropertyLocked,
    keyframesByProperty,
    totalFrames,
    transitionBlockedRanges,
    itemId,
    disabled,
    onRemoveKeyframes,
    onKeyframeMove,
    onKeyframesMove,
    onDuplicateKeyframes,
    onDragStart,
    onDragEnd,
  })


  const canClearRow = useCallback(
    (row: DopesheetPropertyRow) => {
      if (disabled || !onRemoveKeyframes) return false
      if (isPropertyLocked(row.property)) return false
      return row.keyframes.length > 0
    },
    [disabled, isPropertyLocked, onRemoveKeyframes],
  )


  const {
    localFrameInputValue,
    globalFrameInputValue,
    setLocalFrameInputValue,
    setGlobalFrameInputValue,
    skipNextHeaderFrameBlurRef,
    commitLocalFrameInput,
    commitGlobalFrameInput,
    handleHeaderFrameInputKeyDown,
  } = useHeaderFrameInputs({
    selectedFrameSummary,
    currentFrame,
    globalFrame,
    totalFrames,
    transitionBlockedRanges,
    onKeyframeMove,
    onNavigateToKeyframe,
    moveSelectedKeyframesByDelta,
  })

  const activateProperty = useCallback(
    (property: AnimatableProperty) => {
      if (showGraphPane) {
        if (singleCurveMode) {
          setGraphVisibleProperties(new Set([property]))
          onCurveVisibilityChange?.(property, true)
        }
        onPropertyChange?.(property)
      }
      onActivePropertyChange?.(property)
    },
    [
      onActivePropertyChange,
      onCurveVisibilityChange,
      onPropertyChange,
      setGraphVisibleProperties,
      showGraphPane,
      singleCurveMode,
    ],
  )

  const showSinglePropertyCurve = useCallback(
    (property: AnimatableProperty) => {
      setGraphVisibleProperties(new Set([property]))
      onPropertyChange?.(property)
      onActivePropertyChange?.(property)
      onCurveVisibilityChange?.(property, true)
    },
    [onActivePropertyChange, onCurveVisibilityChange, onPropertyChange, setGraphVisibleProperties],
  )

  const removeKeyframesForRows = useCallback(
    (rows: DopesheetPropertyRow[]) => {
      if (!onRemoveKeyframes) return

      const refs = buildRowKeyframeRefs(itemId, rows)

      if (refs.length === 0) return

      onRemoveKeyframes(refs)

      if (onSelectionChange) {
        onSelectionChange(
          removeSelectionIds(
            selectedKeyframeIds,
            refs.map((ref) => ref.keyframeId),
          ),
          { preserveExternalSelection: true },
        )
      }
    },
    [itemId, onRemoveKeyframes, onSelectionChange, selectedKeyframeIds],
  )

  const handleClearProperty = useCallback(
    (property: AnimatableProperty) => {
      const row = propertyRowByProperty.get(property)
      if (!row || !canClearRow(row)) return

      activateProperty(property)
      removeKeyframesForRows([row])
    },
    [activateProperty, canClearRow, propertyRowByProperty, removeKeyframesForRows],
  )

  const handleClearGroup = useCallback(
    (group: DopesheetPropertyGroup) => {
      removeKeyframesForRows(group.rows.filter((row) => canClearRow(row)))
    },
    [canClearRow, removeKeyframesForRows],
  )

  const handleRowNavigate = useCallback(
    (property: AnimatableProperty, keyframe: Keyframe | null) => {
      if (!keyframe || !onNavigateToKeyframe) return
      activateProperty(property)
      onNavigateToKeyframe(keyframe.frame)
      onSelectionChange?.(new Set([keyframe.id]))
      selectionAnchorByPropertyRef.current.set(property, keyframe.id)
    },
    [activateProperty, onNavigateToKeyframe, onSelectionChange],
  )

  const handleRowToggleKeyframe = useCallback(
    (property: AnimatableProperty, currentKeyframes: Keyframe[]) => {
      if (isPropertyLocked(property)) return
      activateProperty(property)
      if (currentKeyframes.length > 0) {
        if (!onRemoveKeyframes) return
        const refs = buildPropertyKeyframeRefs(itemId, property, currentKeyframes)
        onRemoveKeyframes(refs)
        if (onSelectionChange) {
          onSelectionChange(
            removeSelectionIds(
              selectedKeyframeIds,
              currentKeyframes.map((keyframe) => keyframe.id),
            ),
            { preserveExternalSelection: true },
          )
        }
        return
      }

      if (isCurrentFrameBlocked) {
        notifyKeyframeBlocked()
        return
      }
      if (!onAddKeyframe) return
      onAddKeyframe(property, currentFrame)
    },
    [
      currentFrame,
      isCurrentFrameBlocked,
      notifyKeyframeBlocked,
      itemId,
      onAddKeyframe,
      onRemoveKeyframes,
      onSelectionChange,
      selectedKeyframeIds,
      activateProperty,
      isPropertyLocked,
    ],
  )

  const handleRowAddKeyframe = useCallback(
    (property: AnimatableProperty, currentKeyframes: Keyframe[]) => {
      if (isPropertyLocked(property)) return
      activateProperty(property)
      if (currentKeyframes.length > 0) return
      if (isCurrentFrameBlocked) {
        notifyKeyframeBlocked()
        return
      }
      onAddKeyframe?.(property, currentFrame)
    },
    [
      activateProperty,
      currentFrame,
      isCurrentFrameBlocked,
      isPropertyLocked,
      notifyKeyframeBlocked,
      onAddKeyframe,
    ],
  )

  const {
    valueDrafts,
    setValueDrafts,
    setEditingValueProperty,
    valueDraftAtFocusRef,
    skipNextBlurCommitPropertyRef,
    handleRowValueChange,
    handleRowValueCommit,
    handleValueScrubStart,
    handleValueScrubMove,
    handleValueScrubEnd,
    handleValueScrubCancel,
  } = usePropertyValueEditing({
    propertyColumnProperties,
    propertyValues,
    formatPropertyValue,
    isPropertyLocked,
    activateProperty,
    onPropertyValueCommit,
    onPropertyValuePreview,
    onDragStart,
    onDragEnd,
    onDragCancel,
  })

  const handleRowAutoKeyToggle = useCallback(
    (property: AnimatableProperty) => {
      if (isPropertyLocked(property)) return
      activateProperty(property)
      toggleAutoKeyframeEnabled(itemId, property)
    },
    [activateProperty, isPropertyLocked, itemId, toggleAutoKeyframeEnabled],
  )


  const nudgeSelectedKeyframes = useCallback(
    (deltaFrames: number) => {
      moveSelectedKeyframesByDelta(deltaFrames)
    },
    [moveSelectedKeyframesByDelta],
  )

  const activePropertyRow = selectedProperty
    ? propertyRowByProperty.get(selectedProperty)
    : undefined
  const hotkeyBindings = resolveDopesheetHotkeys({
    shortcutsEnabled,
    addKeyframeShortcutEnabled,
    disabled,
    shortcuts,
    hasActivePropertyRow: !!activePropertyRow,
    hasSelection: selectedRefs.length > 0,
    canCommitValues: !!onPropertyValueCommit,
  })

  useHotkeys(
    hotkeyBindings.keys.add,
    (event) => handleAddKeyframeHotkey(event, activePropertyRow, handleRowAddKeyframe),
    {
      ...HOTKEY_OPTIONS,
      enabled: hotkeyBindings.enabled.add,
    },
    [
      hotkeyBindings.keys.add,
      hotkeyBindings.enabled.add,
      activePropertyRow,
      handleRowAddKeyframe,
    ],
  )

  useHotkeys(
    hotkeyBindings.keys.prev,
    (event) =>
      handleNavigateHotkey(
        event,
        activePropertyRow,
        activePropertyRow?.controls.prevKeyframe ?? null,
        handleRowNavigate,
      ),
    {
      ...HOTKEY_OPTIONS,
      enabled: hotkeyBindings.enabled.prev,
    },
    [
      hotkeyBindings.keys.prev,
      hotkeyBindings.enabled.prev,
      activePropertyRow,
      handleRowNavigate,
    ],
  )

  useHotkeys(
    hotkeyBindings.keys.next,
    (event) =>
      handleNavigateHotkey(
        event,
        activePropertyRow,
        activePropertyRow?.controls.nextKeyframe ?? null,
        handleRowNavigate,
      ),
    {
      ...HOTKEY_OPTIONS,
      enabled: hotkeyBindings.enabled.next,
    },
    [
      hotkeyBindings.keys.next,
      hotkeyBindings.enabled.next,
      activePropertyRow,
      handleRowNavigate,
    ],
  )

  useHotkeys(
    hotkeyBindings.keys.toggleAutoKey,
    (event) => handleToggleAutoKeyHotkey(event, activePropertyRow, handleRowAutoKeyToggle),
    {
      ...HOTKEY_OPTIONS,
      enabled: hotkeyBindings.enabled.toggleAutoKey,
    },
    [
      hotkeyBindings.keys.toggleAutoKey,
      hotkeyBindings.enabled.toggleAutoKey,
      activePropertyRow,
      handleRowAutoKeyToggle,
    ],
  )

  useHotkeys(
    hotkeyBindings.keys.fit,
    (event) => handleFitKeyframesHotkey(event, fitKeyframesInView),
    {
      ...HOTKEY_OPTIONS,
      enabled: hotkeyBindings.enabled.fit,
    },
    [hotkeyBindings.keys.fit, hotkeyBindings.enabled.fit, fitKeyframesInView],
  )

  useHotkeys(
    'delete,backspace',
    (event) => handleDeleteHotkey(event, selectedRefs, onRemoveKeyframes),
    { ...HOTKEY_OPTIONS, enabled: hotkeyBindings.enabled.edit },
    [hotkeyBindings.enabled.edit, selectedRefs, onRemoveKeyframes],
  )

  useHotkeys(
    'left',
    (event) => handleNudgeHotkey(event, -1, nudgeSelectedKeyframes),
    { ...HOTKEY_OPTIONS, enabled: hotkeyBindings.enabled.edit },
    [hotkeyBindings.enabled.edit, nudgeSelectedKeyframes],
  )

  useHotkeys(
    'right',
    (event) => handleNudgeHotkey(event, 1, nudgeSelectedKeyframes),
    { ...HOTKEY_OPTIONS, enabled: hotkeyBindings.enabled.edit },
    [hotkeyBindings.enabled.edit, nudgeSelectedKeyframes],
  )

  useHotkeys(
    'shift+left',
    (event) => handleNudgeHotkey(event, -10, nudgeSelectedKeyframes),
    { ...HOTKEY_OPTIONS, enabled: hotkeyBindings.enabled.edit },
    [hotkeyBindings.enabled.edit, nudgeSelectedKeyframes],
  )

  useHotkeys(
    'shift+right',
    (event) => handleNudgeHotkey(event, 10, nudgeSelectedKeyframes),
    { ...HOTKEY_OPTIONS, enabled: hotkeyBindings.enabled.edit },
    [hotkeyBindings.enabled.edit, nudgeSelectedKeyframes],
  )

  const dragStateRef = useRef<DragState | null>(null)
  const selectionAnchorByPropertyRef = useRef(new Map<AnimatableProperty, string>())

  const { marqueeOverlayRef, getMarqueeModeFromPointerEvent, beginMarqueeSelection } =
    useDopesheetMarquee({
      getKeyframePoints,
      scrollAreaRef,
      getTimelineXFromClientX,
      getContentYFromClientY,
      onSelectionChange,
      onSelectionPreviewChange: handleMarqueeSelectionPreviewChange,
    })

  const keyframeDrag = useKeyframeDrag({
    disabled,
    totalFrames,
    snapEnabled,
    snapFrame,
    isPropertyLocked,
    selectedKeyframeIds,
    rowKeyframesByProperty,
    keyframeMetaByIdRef,
    dragStateRef,
    selectionAnchorByPropertyRef,
    scheduleDragPreviewFrames,
    buildSelectionFramePreview,
    commitSelectionFramePreview,
    duplicateSelectionFramePreview,
    getLiveDragPixelsPerFrame,
    onSelectionChange,
    onActivePropertyChange,
    onDragStart,
    onDragEnd,
    onDragCancel,
    onSelectionFrameDelta,
    onKeyframeMove,
    onDuplicateKeyframes,
  })
  const handleKeyframePointerDown = keyframeDrag.handleKeyframePointerDown
  const handleGroupKeyframePointerDown = keyframeDrag.handleGroupKeyframePointerDown


  const handleRowPointerDown = useCallback(
    (property: AnimatableProperty, event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return
      if (isPropertyLocked(property)) return
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      onActivePropertyChange?.(property)

      beginMarqueeSelection(
        event.pointerId,
        event.clientX,
        event.clientY,
        getMarqueeModeFromPointerEvent(event),
        new Set(selectedKeyframeIds),
      )

      setPointerCaptureSafely(event.currentTarget, event.pointerId)
    },
    [
      beginMarqueeSelection,
      disabled,
      getMarqueeModeFromPointerEvent,
      isPropertyLocked,
      onActivePropertyChange,
      selectedKeyframeIds,
    ],
  )

  const handleTimelineBackgroundPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()

      beginMarqueeSelection(
        event.pointerId,
        event.clientX,
        event.clientY,
        getMarqueeModeFromPointerEvent(event),
        new Set(selectedKeyframeIds),
      )

      setPointerCaptureSafely(event.currentTarget, event.pointerId)
    },
    [beginMarqueeSelection, disabled, getMarqueeModeFromPointerEvent, selectedKeyframeIds],
  )


  const rulerScrub = useRulerScrub({
    disabled,
    viewport,
    effectiveTimelineWidth,
    timelinePixelsPerSecond,
    fps,
    itemFrom,
    totalFrames,
    timelineEdgeInset,
    timelineCellBorderWidth,
    scrubClampToItemBounds,
    scrubFrameBounds,
    frameToX,
    globalFrameToPixels,
    getTimelineXFromClientX,
    getFrameFromClientX,
    getLiveDragPixelsPerFrame,
    getTimelineLivePixelsPerSecond,
    timelineRef,
    timelineScrollContainerRef,
    onScrub,
    onScrubStart,
    onScrubEnd,
    onSkim,
    onRulerEdgeScroll,
  })
  const isRulerScrubbing = rulerScrub.isRulerScrubbing
  const rulerScrubActiveRef = rulerScrub.rulerScrubActiveRef
  const rulerScrubHandoffFrameRef = rulerScrub.rulerScrubHandoffFrameRef
  const handleRulerPointerDown = rulerScrub.handleRulerPointerDown
  const handleRulerPointerMove = rulerScrub.handleRulerPointerMove
  const handleRulerPointerLeave = rulerScrub.handleRulerPointerLeave
  const handleRulerPointerUp = rulerScrub.handleRulerPointerUp


  // Edit shares the main timeline axis and deliberately disables the local
  // viewport mutators. Forward its navigation gestures to the main timeline's
  // non-passive wheel listener so momentum, bounds, cursor anchoring, live DOM
  // geometry, and store throttling remain one implementation.
  useEffect(() => {
    const root = pickWhipRootRef.current
    const timeline = timelineScrollContainerRef?.current
    if (!root || !timeline || viewportInteractionEnabled) return

    const forwardLinkedTimelineWheel = (event: WheelEvent) => {
      const isZoomGesture = event.ctrlKey || event.metaKey
      // App.tsx prevents native browser zoom during document capture, so a
      // Ctrl/Cmd-wheel event arrives here with defaultPrevented already set.
      // It still needs to reach the main timeline's anchored zoom handler.
      if ((!isZoomGesture && event.defaultPrevented) || event.shiftKey || event.altKey) return
      event.preventDefault()
      event.stopPropagation()
      timeline.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: event.clientX,
          clientY: event.clientY,
          screenX: event.screenX,
          screenY: event.screenY,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaZ: event.deltaZ,
          deltaMode: event.deltaMode,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          button: event.button,
          buttons: event.buttons,
        }),
      )
    }

    root.addEventListener('wheel', forwardLinkedTimelineWheel, {
      passive: false,
    })
    return () => root.removeEventListener('wheel', forwardLinkedTimelineWheel)
  }, [timelineScrollContainerRef, viewportInteractionEnabled])

  const graphDisplayProperty = useMemo(() => {
    if (graphVisibleProperties.size === 0) return null
    const graphableSet = new Set(graphableProperties)
    // Honour the selection when it has a drawable curve.
    if (
      activeSelectedProperty &&
      graphVisibleProperties.has(activeSelectedProperty) &&
      graphableSet.has(activeSelectedProperty)
    ) {
      return activeSelectedProperty
    }
    // Otherwise show the first visible property that actually has a curve, so the
    // graph isn't blank when the selection is a single-keyframe property.
    const graphableVisible = [...graphVisibleProperties].find((property) =>
      graphableSet.has(property),
    )
    if (graphableVisible) return graphableVisible
    // Fall back to the selection even without a full curve.
    if (activeSelectedProperty && graphVisibleProperties.has(activeSelectedProperty)) {
      return activeSelectedProperty
    }
    return null
  }, [activeSelectedProperty, graphVisibleProperties, graphableProperties])
  const graphDisplayPropertyLocked = graphDisplayProperty
    ? isPropertyLocked(graphDisplayProperty)
    : false
  const focusGraphPane = useCallback(() => {
    // `preventScroll` is essential: focusing a tabIndex={-1} element inside a
    // scrollable container makes the browser scroll it into view. Without this,
    // pressing a keyframe (which focuses the pane via onPointerDownCapture)
    // shifts the entire dopesheet scroll.
    graphPaneRef.current?.focus({ preventScroll: true })
  }, [])
  const handleGraphPaneKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled || graphDisplayPropertyLocked || selectedRefs.length === 0) {
        return
      }

      const hasModifier = event.ctrlKey || event.metaKey || event.altKey

      if (!hasModifier && (event.key === 'Delete' || event.key === 'Backspace')) {
        if (!onRemoveKeyframes) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        onRemoveKeyframes(selectedRefs)
        return
      }

      if (!hasModifier && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault()
        event.stopPropagation()
        nudgeSelectedKeyframes(
          event.key === 'ArrowLeft' ? (event.shiftKey ? -10 : -1) : event.shiftKey ? 10 : 1,
        )
      }
    },
    [disabled, graphDisplayPropertyLocked, nudgeSelectedKeyframes, onRemoveKeyframes, selectedRefs],
  )
  const timingStripMarkers = useMemo(() => {
    if (showGraphPane) {
      if (!activeSelectedProperty) {
        return []
      }

      return (keyframesByProperty[activeSelectedProperty] ?? []).map((keyframe) => ({
        id: keyframe.id,
        frame: keyframe.frame,
        selected: selectedKeyframeIds.has(keyframe.id),
        draggable: !!onKeyframeMove && selectedRefIds.includes(keyframe.id),
      }))
    }

    return visibleKeyframes
      .filter(({ keyframe }) => selectedKeyframeIds.has(keyframe.id))
      .map(({ property, keyframe }) => ({
        id: keyframe.id,
        frame: keyframe.frame,
        selected: true,
        draggable: !!onKeyframeMove && !isPropertyLocked(property),
      }))
  }, [
    activeSelectedProperty,
    isPropertyLocked,
    keyframesByProperty,
    onKeyframeMove,
    selectedKeyframeIds,
    selectedRefIds,
    visibleKeyframes,
    showGraphPane,
  ])
  const constrainGraphFrameDelta = useCallback(
    (deltaFrames: number, draggedKeyframeIds: string[]) =>
      constrainSelectedKeyframeDelta({
        keyframesByProperty,
        selectedKeyframeIds: new Set(draggedKeyframeIds),
        totalFrames,
        deltaFrames,
      }),
    [keyframesByProperty, totalFrames],
  )
  const {
    timingStripPreviewFrames,
    handleTimingStripSelectionChange,
    handleTimingStripSlideStart,
    handleTimingStripSlideChange,
    handleTimingStripSlideEnd,
  } = useTimingStripDrag({
    disabled,
    onKeyframeMove,
    onSelectionChange,
    onDragStart,
    onDragEnd,
    buildSelectionFramePreview,
    commitSelectionFramePreview,
  })

  // Mirror timing-strip preview into the sheet drag preview. The sheet shows in
  // both `dopesheet` and `split`, so mirror whenever the sheet pane is visible.
  useEffect(() => {
    if (!showSheetPane) {
      scheduleDragPreviewFrames(null)
      return
    }

    scheduleDragPreviewFrames(timingStripPreviewFrames)
  }, [scheduleDragPreviewFrames, timingStripPreviewFrames, showSheetPane])
  const rulerLabelFrameOffset = timelineScrollContainerRef ? itemFrom : 0
  const formatRulerTick = useCallback(
    (frame: number): string => {
      const displayFrame = frame + rulerLabelFrameOffset
      if (graphRulerUnit === 'frames' || !fps || fps <= 0) {
        return String(displayFrame)
      }
      const seconds = displayFrame / fps
      if (seconds >= 60) {
        const minutes = Math.floor(seconds / 60)
        const remainder = seconds - minutes * 60
        return `${minutes}:${remainder.toFixed(1).padStart(4, '0')}`
      }
      return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`
    },
    [graphRulerUnit, fps, rulerLabelFrameOffset],
  )

  const rulerTickElements = useMemo(() => {
    if (hasLinkedTimelineAxis) return null

    const firstTick = ticks[0]
    const lastTick = ticks[ticks.length - 1]
    const minorTickLayer =
      firstTick !== undefined && lastTick !== undefined && ticks.length > 1
        ? (() => {
            const firstX = frameToX(firstTick)
            const majorSpacing = Math.abs(frameToX(ticks[1]!) - firstX)
            const minorSpacing = majorSpacing / 4
            return (
              <div
                data-dopesheet-ruler-minor-ticks
                className="pointer-events-none absolute bottom-0 h-1"
                style={{
                  left: Math.round(firstX),
                  width: Math.ceil(frameToX(lastTick) - firstX + majorSpacing),
                  backgroundImage:
                    'linear-gradient(to right, rgba(255, 255, 255, 0.14) 1px, transparent 1px)',
                  backgroundSize: `${minorSpacing}px 100%`,
                }}
              />
            )
          })()
        : null

    return (
      <>
        {minorTickLayer}
        {ticks.map((frame) => (
          <div
            key={frame}
            data-dopesheet-ruler-major-tick
            className="pointer-events-none absolute bottom-0 h-2 border-l border-white/30"
            style={{ left: Math.round(frameToX(frame)) }}
          >
            <span className="absolute bottom-[7px] left-1 whitespace-nowrap text-[10px] text-muted-foreground">
              {formatRulerTick(frame)}
            </span>
          </div>
        ))}
      </>
    )
  }, [hasLinkedTimelineAxis, ticks, frameToX, formatRulerTick])
  const liveRulerCanvas =
    hasLinkedTimelineAxis && timelineScrollContainerRef ? (
      <DopesheetLiveRulerCanvas
        scrollContainerRef={timelineScrollContainerRef}
        getLivePixelsPerSecond={getTimelineLivePixelsPerSecond}
        fallbackPixelsPerSecond={timelinePixelsPerSecond}
        fps={fps}
        rulerUnit={graphRulerUnit}
      />
    ) : null
  const renderPropertyRowContent = useCallback(
    (row: DopesheetPropertyRow, options?: { classic?: boolean; indented?: boolean }) => {
      const classic = options?.classic ?? false
      const rowLocked = isPropertyLocked(row.property)
      const axisConstraint = axisConstraintByProperty[row.property]
      const compoundRow = compoundPropertyRows[row.property]
      const { rowLabel, rowDisplayLabel } = resolvePropertyRowLabels(
        row.property,
        propertyLabels,
        compoundRow,
        t,
      )
      const linkableProperty = resolvePropertyRowLinkable(row.property, compoundRow)
      const propertyLink = linkableProperty
        ? resolvedPropertyLinks.find((link) => link.targetProperty === linkableProperty)
        : undefined
      const propertyExpression = linkableProperty
        ? propertyExpressions.find((expression) => expression.targetProperty === linkableProperty)
        : undefined
      const preExpressionValue = resolvePropertyRowPreExpressionValue(
        row.property,
        compoundRow,
        preExpressionPropertyValues,
        propertyValues,
      )
      const expressionError = resolvePropertyRowExpressionError({
        linkableProperty,
        preExpressionValue,
        expressionEditor,
        propertyExpression,
        globalFrame,
        itemFrom,
        currentFrame,
        fps,
        resolveExpressionReference,
      })
      const { canResetEffectProperty, canResetRow, resetRowLabel } = resolvePropertyRowResetState({
        property: row.property,
        rowLabel,
        hasResetToDefault: !!onResetPropertiesToDefault,
        disabled,
        rowLocked,
        canClear: canClearRow(row),
        t,
      })

      return (
        <div
          className={resolvePropertyRowShellClassName({
            isLanes: presentation === 'lanes',
            rowOptions: options,
            hasKeyframeAtCurrentFrame: row.controls.hasKeyframeAtCurrentFrame,
            showGraphPane,
            selectedProperty,
            property: row.property,
            graphProperties: graphVisibleProperties,
            rowLocked,
          })}
          data-expression-item-id={linkableProperty ? itemId : undefined}
          data-expression-property={linkableProperty ?? undefined}
          data-selected={selectedProperty === row.property ? 'true' : undefined}
          aria-current={selectedProperty === row.property ? 'true' : undefined}
          onClick={!rowLocked ? () => activateProperty(row.property) : undefined}
        >
          <div className="flex items-center gap-px self-stretch">
              <PropertyRowCurveButton
                property={row.property}
                rowLabel={rowLabel}
                singleCurveMode={singleCurveMode ?? false}
                showGraphPane={showGraphPane}
                selectedCurveVisibleExternally={selectedCurveVisibleExternally}
                selectedProperty={selectedProperty}
                graphProperties={graphVisibleProperties}
                visible={!classic}
                onCurveVisibilityChange={onCurveVisibilityChange}
                showSinglePropertyCurve={showSinglePropertyCurve}
                togglePropertyCurve={togglePropertyCurve}
                t={t}
              />
            <PropertyRowLockButton
              rowLocked={rowLocked}
              property={row.property}
              rowLabel={rowLabel}
              visible={!classic}
              setAllRowsLocked={setAllRowsLocked}
              toggleLockedProperty={toggleLockedProperty}
              t={t}
            />
            <PropertyRowAutoKeyButton
              property={row.property}
              rowLabel={rowLabel}
              autoKeyEnabled={autoKeyEnabledByProperty[row.property]}
              disabled={disabled}
              rowLocked={rowLocked}
              canCommit={!!onPropertyValueCommit}
              onToggleAutoKey={handleRowAutoKeyToggle}
              t={t}
            />
              <PropertyRowLinkButton
                linkableProperty={linkableProperty}
                rowLabel={rowLabel}
                visible={!classic}
                hasPropertyLink={!!propertyLink}
                sourceLabels={resolvedPropertyLinkSourceLabels}
                linkSource={propertyLink}
                onBeginLink={beginPropertyLink}
                onRemoveLink={removePropertyLink}
                t={t}
              />
            <PropertyRowExpressionButton
              linkableProperty={linkableProperty}
              rowLabel={rowLabel}
              visible={!classic}
              canEdit={!!onSetPropertyExpression}
                expressionError={expressionError}
                disabled={disabled}
              rowLocked={rowLocked}
              propertyExpression={propertyExpression}
              onOpenExpression={openPropertyExpressionEditor}
            />
          </div>
          <div
            className={cn(
              'flex h-full min-w-0 items-center overflow-hidden pr-1 text-[9px] font-medium leading-none text-foreground/90',
              compoundRow ? 'w-[54px] shrink-0 pl-1' : classic ? 'flex-1 pl-1' : 'flex-1 pl-[10px]',
            )}
            title={rowLabel}
          >
            <span className="min-w-0 truncate">{rowDisplayLabel}</span>
            <PropertyRowAxisConstraintButton
              axisConstraint={axisConstraint}
              visible={classic}
              disabled={disabled}
              rowLocked={rowLocked}
            />
          </div>
          <div className="ml-auto flex items-center gap-0">
            {compoundRow ? (
              <PropertyRowCompoundInput
                property={row.property}
                compoundRow={compoundRow}
                compoundSecondaryProperties={compoundSecondaryProperties}
                spacious={spacious}
                disabled={disabled}
                rowLocked={rowLocked}
                hasPropertyLink={!!propertyLink}
                hasKeyframeAtCurrentFrame={row.controls.hasKeyframeAtCurrentFrame}
                isCurrentFrameBlocked={isCurrentFrameBlocked}
                autoKeyEnabled={autoKeyEnabledByProperty[row.property] ?? false}
                activateProperty={activateProperty}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragCancel={onDragCancel}
                onPropertyValuePreview={onPropertyValuePreview}
              />
            ) : (
              <PropertyRowValueInput
                property={row.property}
                rowLabel={rowLabel}
                spacious={spacious}
                hasPropertyLink={!!propertyLink}
                disabled={disabled}
                rowLocked={rowLocked}
                canCommit={!!onPropertyValueCommit}
                hasKeyframeAtCurrentFrame={row.controls.hasKeyframeAtCurrentFrame}
                isCurrentFrameBlocked={isCurrentFrameBlocked}
                autoKeyEnabled={autoKeyEnabledByProperty[row.property] ?? false}
                propertyValues={propertyValues}
                valueDrafts={valueDrafts}
                valueDraftAtFocusRef={valueDraftAtFocusRef}
                skipNextBlurCommitPropertyRef={skipNextBlurCommitPropertyRef}
                onValueChange={handleRowValueChange}
                onScrubStart={handleValueScrubStart}
                onScrubMove={handleValueScrubMove}
                onScrubEnd={handleValueScrubEnd}
                onScrubCancel={handleValueScrubCancel}
                onValueCommit={handleRowValueCommit}
                onFocusProperty={activateProperty}
                onEditingChange={setEditingValueProperty}
                onDraftsChange={setValueDrafts}
                formatDisplayValue={formatPropertyValue}
                t={t}
              />
            )}
            <PropertyRowKeyframeNav
              property={row.property}
              rowLabel={rowLabel}
              prevKeyframe={row.controls.prevKeyframe}
              nextKeyframe={row.controls.nextKeyframe}
              currentKeyframes={row.controls.currentKeyframes}
              hasKeyframeAtCurrentFrame={row.controls.hasKeyframeAtCurrentFrame}
              disabled={disabled}
              rowLocked={rowLocked}
              isCurrentFrameBlocked={isCurrentFrameBlocked}
              canNavigate={!!onNavigateToKeyframe}
              canAddKeyframe={!!onAddKeyframe}
              onNavigate={handleRowNavigate}
              onToggleKeyframe={handleRowToggleKeyframe}
              t={t}
            />
            <PropertyRowReset
              classic={classic}
              canResetRow={canResetRow}
              resetRowLabel={resetRowLabel}
              canResetEffectProperty={canResetEffectProperty}
              property={row.property}
              onResetToDefault={onResetPropertiesToDefault}
              onClearProperty={handleClearProperty}
            />
          </div>
        </div>
      )
    },
    [
      activateProperty,
      axisConstraintByProperty,
      canClearRow,
      compoundPropertyRows,
      compoundSecondaryProperties,
      autoKeyEnabledByProperty,
      disabled,
      formatPropertyValue,
      graphVisibleProperties,
      handleClearProperty,
      handleRowAutoKeyToggle,
      handleRowNavigate,
      handleRowToggleKeyframe,
      handleRowValueChange,
      handleRowValueCommit,
      handleValueScrubEnd,
      handleValueScrubCancel,
      handleValueScrubMove,
      handleValueScrubStart,
      itemId,
      isPropertyLocked,
      isCurrentFrameBlocked,
      onAddKeyframe,
      onNavigateToKeyframe,
      onCurveVisibilityChange,
      onDragCancel,
      onDragEnd,
      onDragStart,
      onPropertyValueCommit,
      onPropertyValuePreview,
      resolvedPropertyLinks,
      resolvedPropertyLinkSourceLabels,
      beginPropertyLink,
      removePropertyLink,
      propertyExpressions,
      propertyLabels,
      preExpressionPropertyValues,
      expressionEditor,
      resolveExpressionReference,
      globalFrame,
      itemFrom,
      currentFrame,
      fps,
      onSetPropertyExpression,
      openPropertyExpressionEditor,
      onResetPropertiesToDefault,
      propertyValues,
      presentation,
      selectedProperty,
      selectedCurveVisibleExternally,
      setAllRowsLocked,
      setEditingValueProperty,
      setValueDrafts,
      skipNextBlurCommitPropertyRef,
      t,
      togglePropertyCurve,
      toggleLockedProperty,
      valueDraftAtFocusRef,
      valueDrafts,
      showGraphPane,
      showSinglePropertyCurve,
      singleCurveMode,
      spacious,
    ],
  )
  const renderGroupHeaderContent = useCallback(
    (group: DopesheetPropertyGroup) => {
      const groupLabel = getKeyframeGroupLabel(t, group.id, group.label)
      const {
        groupProperties,
        curveVisible,
        allRowsLocked,
        canResetEffectGroup,
        canResetGroup,
        resetGroupLabel,
      } = resolveGroupHeaderState({
        group,
        graphProperties: graphVisibleProperties,
        isPropertyLocked,
        canClearRow,
        hasResetToDefault: !!onResetPropertiesToDefault,
        disabled,
        groupLabel,
        t,
      })
      const isOpen = expandedGroups[group.id] ?? true
      const dimensionSeparation = findGroupDimensionSeparation(
        group.rows,
        dimensionSeparationByProperty,
      )

      return (
        <div
          className={cn(
            'group flex h-full items-center gap-px border-y border-border/60 bg-muted/70 pl-3 pr-0.5',
            presentation === 'lanes' &&
              "relative pl-6 before:absolute before:inset-y-0 before:left-3 before:w-px before:bg-border/40 before:content-['']",
          )}
        >
          <div className="flex items-center gap-px self-stretch">
            <GroupCurvesButton
              groupProperties={groupProperties}
              groupLabel={groupLabel}
              curveVisible={curveVisible}
              onToggleGroupCurves={toggleGroupCurves}
              t={t}
            />
            <GroupLockButton
              groupProperties={groupProperties}
              groupLabel={groupLabel}
              allRowsLocked={allRowsLocked}
              setAllRowsLocked={setAllRowsLocked}
              setGroupLocked={setGroupLocked}
              t={t}
            />
          </div>
          <GroupExpandButton
            groupId={group.id}
            groupLabel={groupLabel}
            isOpen={isOpen}
            setAllGroupsExpanded={setAllGroupsExpanded}
            toggleGroup={toggleGroup}
            t={t}
          />
          <div className="ml-auto flex items-center gap-0 rounded-sm border border-border/70 bg-background/90 px-px shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <DopesheetGroupOptionsMenu
              groupLabel={groupLabel}
              dimensionSeparation={dimensionSeparation}
              disabled={disabled}
              isPropertyLocked={isPropertyLocked}
            />
            <GroupKeyframeNavButton
              direction="prev"
              entry={group.prevKeyframe}
              fallbackProperty={group.rows[0]?.property ?? 'x'}
              groupLabel={groupLabel}
              disabled={disabled}
              canNavigate={!!onNavigateToKeyframe}
              onNavigate={handleRowNavigate}
              t={t}
            />
            <GroupKeyframeNavButton
              direction="next"
              entry={group.nextKeyframe}
              fallbackProperty={group.rows[0]?.property ?? 'x'}
              groupLabel={groupLabel}
              disabled={disabled}
              canNavigate={!!onNavigateToKeyframe}
              onNavigate={handleRowNavigate}
              t={t}
            />
            <GroupReset
              groupId={group.id}
              canResetGroup={canResetGroup}
              resetGroupLabel={resetGroupLabel}
              canResetEffectGroup={canResetEffectGroup}
              groupProperties={groupProperties}
              onResetToDefault={onResetPropertiesToDefault}
              onClearGroup={() => handleClearGroup(group)}
            />
          </div>
        </div>
      )
    },
    [
      canClearRow,
      dimensionSeparationByProperty,
      disabled,
      expandedGroups,
      handleClearGroup,
      handleRowNavigate,
      graphVisibleProperties,
      isPropertyLocked,
      onNavigateToKeyframe,
      onResetPropertiesToDefault,
      presentation,
      setAllGroupsExpanded,
      setAllRowsLocked,
      setGroupLocked,
      t,
      toggleGroupCurves,
      toggleGroup,
    ],
  )
  const expressionDockContext = useMemo(() => {
    if (!expressionEditor) return null
    return buildExpressionDockContext({
      editor: expressionEditor,
      rows: propertyRows,
      compoundRows: compoundPropertyRows,
      preExpressionValues: preExpressionPropertyValues,
      propertyValues,
      expressions: propertyExpressions,
      currentGlobalFrame: globalFrame ?? itemFrom + currentFrame,
      fps,
      resolveExpressionReference,
      getPropertyLabel: (property) => getKeyframePropertyLabel(t, property),
    })
  }, [
    compoundPropertyRows,
    currentFrame,
    expressionEditor,
    fps,
    globalFrame,
    itemFrom,
    preExpressionPropertyValues,
    propertyExpressions,
    propertyRows,
    propertyValues,
    resolveExpressionReference,
    t,
  ])
  useEffect(() => {
    if (expressionEditor && !expressionDockContext) {
      setExpressionReferencePick(null)
      setExpressionEditor(null)
    }
  }, [expressionDockContext, expressionEditor, setExpressionEditor, setExpressionReferencePick])

  const expressionDockElement =
    expressionEditor && expressionDockContext ? (
      <DopesheetExpressionDock
        property={expressionDockContext.property}
        propertyLabel={expressionDockContext.propertyLabel}
        source={expressionEditor.source}
        enabled={expressionEditor.enabled}
        preExpressionDisplay={formatExpressionValue(expressionDockContext.preExpressionValue)}
        postExpressionDisplay={formatExpressionValue(expressionDockContext.postExpressionValue)}
        error={expressionDockContext.error}
        hasStoredExpression={expressionDockContext.hasStoredExpression}
        pickingReference={expressionReferencePick?.property === expressionDockContext.property}
        rootRef={expressionDockRef}
        textareaRef={expressionTextareaRef}
        onSourceChange={(source, selectionStart, selectionEnd) =>
          setExpressionEditor((current) =>
            current?.property === expressionDockContext.property
              ? { ...current, source, selectionStart, selectionEnd }
              : current,
          )
        }
        onSelectionChange={(selectionStart, selectionEnd) =>
          setExpressionEditor((current) =>
            current?.property === expressionDockContext.property
              ? { ...current, selectionStart, selectionEnd }
              : current,
          )
        }
        onToggleEnabled={() =>
          setExpressionEditor((current) =>
            current?.property === expressionDockContext.property
              ? { ...current, enabled: !current.enabled }
              : current,
          )
        }
        onApplyPreset={(source) => applyExpressionPreset(expressionDockContext.property, source)}
        onReferencePointerDown={(event, selectionStart, selectionEnd) => {
          setExpressionReferencePick(null)
          beginExpressionReferenceDrag(event, {
            itemId,
            property: expressionDockContext.property,
            selectionStart,
            selectionEnd,
          })
        }}
        onToggleReferencePicking={(selectionStart, selectionEnd) =>
          setExpressionReferencePick((current) =>
            current?.property === expressionDockContext.property
              ? null
              : {
                  itemId,
                  property: expressionDockContext.property,
                  selectionStart,
                  selectionEnd,
                },
          )
        }
        onRemove={() => {
          onRemovePropertyExpression?.(expressionDockContext.property)
          setExpressionReferencePick(null)
          setExpressionEditor(null)
        }}
        onCancel={() => {
          setExpressionReferencePick(null)
          setExpressionEditor(null)
        }}
        onApply={() => {
          if (expressionDockContext.error) return
          onSetPropertyExpression?.(
            expressionDockContext.property,
            expressionEditor.source,
            expressionEditor.enabled,
          )
          setExpressionReferencePick(null)
          setExpressionEditor(null)
        }}
      />
    ) : null

  // The property controls are substantially heavier than the timeline cells,
  // but their output does not depend on the time viewport. Cache those React
  // nodes separately so zooming only reconciles keyframe/tick geometry.
  const sheetPropertyContentByProperty = useMemo(() => {
    const content = new Map<AnimatableProperty, React.ReactNode>()
    for (const entry of renderedSheetEntries.entries) {
      if (entry.type !== 'row') continue
      content.set(
        entry.row.property,
        renderPropertyRowContent(entry.row, {
          classic: presentation === 'classic',
          indented: entry.indented,
        }),
      )
    }
    return content
  }, [presentation, renderPropertyRowContent, renderedSheetEntries.entries])
  const sheetGroupContentById = useMemo(() => {
    const content = new Map<string, React.ReactNode>()
    for (const entry of renderedSheetEntries.entries) {
      if (entry.type !== 'group') continue
      content.set(entry.group.id, renderGroupHeaderContent(entry.group))
    }
    return content
  }, [renderGroupHeaderContent, renderedSheetEntries.entries])
  const groupTimelineRowStyle = useMemo(
    () => ({
      ...propertyGridStyle,
      height: GROUP_HEADER_HEIGHT,
      contentVisibility: presentation === 'lanes' ? ('auto' as const) : undefined,
      containIntrinsicSize: presentation === 'lanes' ? `auto ${GROUP_HEADER_HEIGHT}px` : undefined,
    }),
    [presentation, propertyGridStyle],
  )
  const propertyTimelineRowStyle = useMemo(
    () => ({
      ...propertyGridStyle,
      height: ROW_HEIGHT,
      contentVisibility: presentation === 'lanes' ? ('auto' as const) : undefined,
      containIntrinsicSize: presentation === 'lanes' ? `auto ${ROW_HEIGHT}px` : undefined,
    }),
    [presentation, propertyGridStyle],
  )
  const rowElements = useMemo(
    () => [
      ...(presentation === 'classic' && textMotionBands.length > 0
        ? [
            <TextMotionTimelineRows
              key="text-motion"
              bands={textMotionBands}
              gridStyle={propertyTimelineRowStyle}
              ticks={ticks}
              axisWidth={effectiveTimelineWidth}
              frameToX={frameToX}
              getPixelsPerFrame={getLiveDragPixelsPerFrame}
              disabled={disabled}
              onBackgroundPointerDown={handleTimelineBackgroundPointerDown}
              onDurationDragStart={onTextMotionDurationDragStart}
              onDurationCommit={onTextMotionDurationCommit}
              onDurationCancel={onTextMotionDurationCancel}
              onOffsetDragStart={onTextMotionOffsetDragStart}
              onOffsetCommit={onTextMotionOffsetCommit}
              onOffsetCancel={onTextMotionOffsetCancel}
              onBandClick={onTextMotionBandClick}
            />,
          ]
        : []),
      ...renderedSheetEntries.entries.map((entry) => {
        if (entry.type === 'group') {
          return (
            <div
              key={entry.group.id}
              className="grid w-full border-b border-border/60"
              style={groupTimelineRowStyle}
            >
              {sheetGroupContentById.get(entry.group.id)}
              <TimelineViewportCuller>
                <GroupTimelineCell
                  groupId={entry.group.id}
                  groupLabel={entry.group.label}
                  expanded={expandedGroups[entry.group.id] ?? true}
                  frameGroups={
                    groupTimelineById.get(entry.group.id)?.frameGroups ?? EMPTY_FRAME_GROUPS
                  }
                  rows={groupTimelineById.get(entry.group.id)?.rows ?? EMPTY_STRUCTURE_ROWS}
                  ticks={ticks}
                  axisWidth={effectiveTimelineWidth}
                  frameToX={frameToX}
                  gridFrameToX={timelineGridDivisions ? sharedGridFrameToX : undefined}
                  getRenderedKeyframeX={getRenderedKeyframeX}
                  selectedKeyframeIds={selectedKeyframeIds}
                  disabled={disabled}
                  isPropertyLocked={isPropertyLocked}
                  onGroupKeyframePointerDown={handleGroupKeyframePointerDown}
                  onBackgroundPointerDown={handleTimelineBackgroundPointerDown}
                  sheetPreviewFrames={sheetPreviewFrames}
                  sheetPreviewDuplicateKeyframeIds={sheetPreviewDuplicateKeyframeIds}
                />
              </TimelineViewportCuller>
            </div>
          )
        }

        const { row } = entry
        const rowLocked = isPropertyLocked(row.property)
        return (
          <div
            key={row.property}
            className="grid border-b border-border/60"
            style={propertyTimelineRowStyle}
          >
            {sheetPropertyContentByProperty.get(row.property)}
            <TimelineViewportCuller>
              <PropertyTimelineCell
                itemId={itemId}
                property={row.property}
                keyframes={rowKeyframesByProperty.get(row.property) ?? EMPTY_KEYFRAMES}
                locked={rowLocked}
                ticks={ticks}
                axisWidth={effectiveTimelineWidth}
                frameToX={frameToX}
                gridFrameToX={timelineGridDivisions ? sharedGridFrameToX : undefined}
                getRenderedKeyframeX={getRenderedKeyframeX}
                renderedKeyframeXById={renderedKeyframeXById}
                transitionBlockedRanges={transitionBlockedRanges}
                proceduralBand={proceduralBandByProperty.get(row.property)}
                selectedKeyframeIds={selectedKeyframeIds}
                disabled={disabled}
                onRowPointerDown={handleRowPointerDown}
                onKeyframePointerDown={handleKeyframePointerDown}
                onSegmentEasingChange={onSegmentEasingChange}
                onSegmentDragStart={onDragStart}
                onSegmentDragEnd={onDragEnd}
                setKeyframeButtonRef={setKeyframeButtonRef}
                keyframeMetaByIdRef={keyframeMetaByIdRef}
                sheetPreviewFrames={sheetPreviewFrames}
                sheetPreviewDuplicateKeyframeIds={sheetPreviewDuplicateKeyframeIds}
              />
            </TimelineViewportCuller>
          </div>
        )
      }),
    ],
    [
      renderedSheetEntries.entries,
      expandedGroups,
      groupTimelineRowStyle,
      propertyTimelineRowStyle,
      groupTimelineById,
      rowKeyframesByProperty,
      handleRowPointerDown,
      handleTimelineBackgroundPointerDown,
      handleGroupKeyframePointerDown,
      sheetGroupContentById,
      sheetPropertyContentByProperty,
      getRenderedKeyframeX,
      isPropertyLocked,
      disabled,
      ticks,
      effectiveTimelineWidth,
      frameToX,
      sharedGridFrameToX,
      timelineGridDivisions,
      transitionBlockedRanges,
      proceduralBandByProperty,
      renderedKeyframeXById,
      selectedKeyframeIds,
      sheetPreviewDuplicateKeyframeIds,
      sheetPreviewFrames,
      handleKeyframePointerDown,
      setKeyframeButtonRef,
      keyframeMetaByIdRef,
      itemId,
      onSegmentEasingChange,
      onDragStart,
      onDragEnd,
      presentation,
      textMotionBands,
      getLiveDragPixelsPerFrame,
      onTextMotionDurationDragStart,
      onTextMotionDurationCommit,
      onTextMotionDurationCancel,
      onTextMotionOffsetDragStart,
      onTextMotionOffsetCommit,
      onTextMotionOffsetCancel,
      onTextMotionBandClick,
    ],
  )
  const propertyColumnElements = useMemo(
    () =>
      groupedPropertyRows.flatMap<React.ReactNode>((group): React.ReactNode[] => {
        const inline = inlinePropertyGroupIdSet.has(group.id)
        const propertyElements = group.rows.map((row) => (
          <div
            key={row.property}
            className="border-b border-border/60"
            style={{ height: ROW_HEIGHT }}
          >
            {renderPropertyRowContent(row, { indented: !inline })}
          </div>
        ))
        if (inline) {
          return propertyElements
        }

        const groupOpen = expandedGroups[group.id] ?? true
        const elements: React.ReactNode[] = [
          <div
            key={group.id}
            className="border-b border-border/60"
            style={{ height: GROUP_HEADER_HEIGHT }}
          >
            {renderGroupHeaderContent(group)}
          </div>,
        ]

        if (!groupOpen) {
          return elements
        }

        return elements.concat(propertyElements)
      }),
    [
      expandedGroups,
      groupedPropertyRows,
      inlinePropertyGroupIdSet,
      renderGroupHeaderContent,
      renderPropertyRowContent,
    ],
  )
  const emptyStateMessage = hasPropertyFilters
    ? t('timeline.keyframeEditor.noParametersMatch')
    : t('timeline.keyframeEditor.noKeyframesToDisplay')
  const showEmptyGuidance = !hasPropertyFilters
  // A clip can be animated by procedural modulators / audio pulse yet have no
  // keyframes — the sheet would otherwise look empty and "unanimated".
  const proceduralHint =
    showEmptyGuidance && hasProceduralMotion
      ? t('timeline.keyframeEditor.proceduralMotionHint')
      : undefined

  // Hoisted so the graph pane and sheet body can be composed once and reused
  // across the exclusive (`graph`/`dopesheet`) and the `split` placements.
  const rulerHeaderElement = (
    <DopesheetRulerHeader
      propertyGridStyle={propertyGridStyle}
      timelineRef={timelineRef}
      onRulerPointerDown={handleRulerPointerDown}
      onRulerPointerMove={handleRulerPointerMove}
      onRulerPointerUp={handleRulerPointerUp}
      onRulerPointerLeave={handleRulerPointerLeave}
      rulerTickElements={rulerTickElements}
      liveRulerCanvas={liveRulerCanvas}
      reservedRightGutterWidth={reservedScrollbarGutterWidth}
      propertyFilter={filterKeyframedOnly ? 'keyframed' : 'all'}
      onPropertyFilterChange={
        presentation === 'classic' && propertyFilter === undefined
          ? (filter) => setShowKeyframedOnly(filter === 'keyframed')
          : undefined
      }
    />
  )
  // Standalone cells begin after their 1px border. A linked Edit axis pulls its
  // cell surfaces over that border, so its playhead must begin at the shared
  // main-timeline origin too.
  const timelineContentLeft = columnWidth + (hasLinkedTimelineAxis ? 0 : 1)
  const playheadOverlayElement = showPlayhead ? (
    <DopesheetPlayheadOverlay
      variant="sheet"
      left={timelineContentLeft}
      playheadFrame={playheadFrame}
      currentFrame={currentFrame}
      itemFrom={itemFrom}
      totalFrames={totalFrames}
      clampToItemBounds={playheadClampToItemBounds}
      followPreviewFrame={!onSkim}
      localScrubActiveRef={rulerScrubActiveRef}
      localScrubHandoffFrameRef={rulerScrubHandoffFrameRef}
      frameToX={frameToX}
      globalFrameToX={globalFrameToPixels}
      positionSyncTargetRef={timelineScrollContainerRef}
      maxLeft={effectiveTimelineWidth - 1}
      fps={fps}
      isRulerScrubbing={isRulerScrubbing}
    />
  ) : null
  // Split view: one playhead element spans the ruler, sheet, and graph panes.
  // The graph's own line is hidden via `hidePlayhead`.
  const splitPlayheadOverlayElement = showPlayhead ? (
    <DopesheetPlayheadOverlay
      variant="split"
      left={timelineContentLeft}
      playheadFrame={playheadFrame}
      currentFrame={currentFrame}
      itemFrom={itemFrom}
      totalFrames={totalFrames}
      clampToItemBounds={playheadClampToItemBounds}
      followPreviewFrame={!onSkim}
      localScrubActiveRef={rulerScrubActiveRef}
      localScrubHandoffFrameRef={rulerScrubHandoffFrameRef}
      frameToX={frameToX}
      globalFrameToX={globalFrameToPixels}
      positionSyncTargetRef={timelineScrollContainerRef}
      maxLeft={effectiveTimelineWidth - 1}
      fps={fps}
      isRulerScrubbing={isRulerScrubbing}
    />
  ) : null
  const skimPlayheadOverlayElement = onSkim ? (
    <DopesheetPlayheadOverlay
      variant="skim"
      left={timelineContentLeft}
      currentFrame={currentFrame}
      itemFrom={itemFrom}
      totalFrames={totalFrames}
      clampToItemBounds={playheadClampToItemBounds}
      followPreviewFrame={!onSkim}
      localScrubActiveRef={rulerScrubActiveRef}
      localScrubHandoffFrameRef={rulerScrubHandoffFrameRef}
      frameToX={frameToX}
      globalFrameToX={globalFrameToPixels}
      positionSyncTargetRef={timelineScrollContainerRef}
      maxLeft={effectiveTimelineWidth - 1}
      fps={fps}
      isRulerScrubbing={isRulerScrubbing}
    />
  ) : null
  const sheetBodyElement = (
    <DopesheetSheetBody
      scrollAreaRef={scrollAreaRef}
      hasRows={hasSheetBodyRows(sheetRows.length, presentation, textMotionBands.length)}
      emptyStateMessage={emptyStateMessage}
      showEmptyGuidance={showEmptyGuidance}
      proceduralHint={proceduralHint}
      rowElements={rowElements}
      marqueeOverlayRef={marqueeOverlayRef}
      propertyColumnWidth={columnWidth}
      subtractRulerHeight={presentation !== 'lanes'}
      onTimelineBackgroundPointerDown={handleTimelineBackgroundPointerDown}
    />
  )
  const graphPaneElement = (
    <DopesheetGraphPane
      hasRows={propertyRows.length > 0}
      emptyStateMessage={emptyStateMessage}
      showEmptyGuidance={showEmptyGuidance}
      proceduralHint={proceduralHint}
      propertyColumnElements={propertyColumnElements}
      propertyColumnWidth={columnWidth}
      graphPaneRef={graphPaneRef}
      disabled={disabled}
      graphDisplayPropertyLocked={graphDisplayPropertyLocked}
      focusGraphPane={focusGraphPane}
      handleGraphPaneKeyDown={handleGraphPaneKeyDown}
      graphPaneSize={graphPaneSize}
      graphVisiblePropertiesSize={visibleGraphProperties.length}
      viewport={viewport}
      updateViewport={updateViewport}
      itemId={itemId}
      keyframesByProperty={keyframesByProperty}
      graphDisplayProperty={graphDisplayProperty}
      graphVisibleProperties={resolveGraphVisiblePropertyList(
        singleCurveMode,
        graphDisplayProperty,
        compoundSecondaryProperties,
        visibleGraphProperties,
      )}
      selectedKeyframeIds={selectedKeyframeIds}
      currentFrame={currentFrame}
      itemFrom={itemFrom}
      totalFrames={totalFrames}
      fps={fps}
      onKeyframeMove={onKeyframeMove}
      timingStripPreviewFrames={timingStripPreviewFrames}
      constrainGraphFrameDelta={constrainGraphFrameDelta}
      onBezierHandleMove={onBezierHandleMove}
      onSelectionChange={onSelectionChange}
      onPropertyChange={onPropertyChange}
      onScrub={onScrub}
      onScrubStart={onScrubStart}
      onScrubEnd={onScrubEnd}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onAddKeyframe={onAddKeyframe}
      onRemoveKeyframes={onRemoveKeyframes}
      onNavigateToKeyframe={onNavigateToKeyframe}
      transitionBlockedRanges={transitionBlockedRanges}
      proceduralPreview={proceduralPreview}
      snapEnabled={snapEnabled}
      graphHandleVisibility={showAllGraphHandles ? 'all' : 'selected'}
      graphRulerUnit={graphRulerUnit}
      autoZoomGraphHeight={autoZoomGraphHeight}
      graphVerticalZoomValue={graphVerticalZoomValue}
      hidePlayhead={!showPlayhead || isSplitView}
      subtractRulerHeight={presentation !== 'lanes'}
      customGraphContent={graphMode === 'speed' ? speedGraphContent : undefined}
    />
  )
  const affectedFrameRangeOverlayElement =
    affectedFrameRange && affectedFrameRangeGeometry ? (
      <div
        data-testid="dopesheet-affected-frame-range"
        data-from-frame={affectedFrameRange.fromFrame}
        data-to-frame={affectedFrameRange.toFrame}
        data-dopesheet-from-frame={affectedFrameRange.fromFrame}
        data-dopesheet-to-frame={affectedFrameRange.toFrame}
        className="absolute inset-y-0 border-x border-foreground/[0.10] bg-foreground/[0.035]"
        style={affectedFrameRangeGeometry}
      />
    ) : null

  if (presentation === 'lanes') {
    return (
      <div
        ref={pickWhipRootRef}
        data-testid="dopesheet-editor-root"
        data-motion-shared-grid-divisions={timelineGridDivisions}
        data-motion-shared-grid-border-width={
          timelineGridDivisions ? timelineCellBorderWidth : undefined
        }
        className={cn(
          'relative flex flex-col overflow-hidden',
          disabled && 'opacity-60 pointer-events-none',
          className,
        )}
        style={{ height, width: '100%' }}
        onKeyDown={handleGraphPaneKeyDown}
      >
        <div className="relative min-h-0 flex-1 overflow-hidden" onWheel={handleWheel}>
          <div
            ref={timelineRef}
            className="pointer-events-none absolute inset-y-0 right-0"
            style={{ left: columnWidth }}
          />
          {showGraphPane ? graphPaneElement : sheetBodyElement}
          {showSheetPane ? skimPlayheadOverlayElement : null}
          {showSheetPane ? playheadOverlayElement : null}
        </div>
        {expressionDockElement}
        {expressionReferenceDrag ? (
          <PickWhipOverlay
            presentation={expressionReferenceDrag.presentation}
            testId="expression-reference-pick-whip"
          />
        ) : null}
      </div>
    )
  }

  if (presentation === 'classic') {
    return (
      <div
        ref={pickWhipRootRef}
        data-testid="dopesheet-editor-root"
        className={cn('flex h-full flex-col gap-0.5 overflow-hidden', className)}
        style={{ height, width }}
      >
        <div className="flex min-h-7 flex-shrink-0 items-center justify-between gap-2 px-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {t('timeline.keyframeEditor.keyframes', {
                count: visibleKeyframes.length,
              })}
            </span>
            {trimmedKeyframeCount > 0 && onTrimAnimation ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[10px] text-amber-300 hover:text-amber-200"
                onClick={onTrimAnimation}
                title={t('timeline.keyframeEditor.trimAnimationHint', {
                  count: trimmedKeyframeCount,
                })}
              >
                <Scissors className="h-3 w-3" />
                {t('timeline.keyframeEditor.trimmedKeyframes', {
                  count: trimmedKeyframeCount,
                })}
              </Button>
            ) : null}
            <DopesheetHeaderFrameInputs
              disabled={disabled}
              inputsEnabled={
                Boolean(onKeyframeMove) &&
                selectedFrameSummary.hasSelection &&
                !selectedFrameSummary.hasMixedFrames
              }
              totalFrames={totalFrames}
              globalFrame={globalFrame}
              localFrameInputValue={localFrameInputValue}
              globalFrameInputValue={globalFrameInputValue}
              setLocalFrameInputValue={setLocalFrameInputValue}
              setGlobalFrameInputValue={setGlobalFrameInputValue}
              skipNextHeaderFrameBlurRef={skipNextHeaderFrameBlurRef}
              commitLocalFrameInput={commitLocalFrameInput}
              commitGlobalFrameInput={commitGlobalFrameInput}
              handleHeaderFrameInputKeyDown={handleHeaderFrameInputKeyDown}
            />
          </div>
        </div>

        <div
          className={cn(
            'relative min-h-0 flex-1 overflow-hidden border border-border',
            disabled && 'pointer-events-none opacity-60',
          )}
          onWheel={viewportInteractionEnabled ? handleWheel : undefined}
        >
          {affectedFrameRangeOverlayElement ? (
            <div
              data-motion-viewport-surface
              data-motion-viewport-axis-width={effectiveTimelineWidth}
              className="pointer-events-none absolute bottom-0 right-0 z-[5] overflow-hidden"
              style={{ left: columnWidth, top: RULER_HEIGHT }}
            >
              {affectedFrameRangeOverlayElement}
            </div>
          ) : null}
          {skimPlayheadOverlayElement}
          {playheadOverlayElement}
          {rulerHeaderElement}
          {sheetBodyElement}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={pickWhipRootRef}
      data-testid="dopesheet-editor-root"
      className={cn('flex h-full flex-col gap-0.5 overflow-hidden', className)}
      style={{ height, width }}
    >
      <DopesheetToolbar
        disabled={disabled}
        hasAvailableProperties={availableProperties.length > 0}
        filterKeyframedOnly={filterKeyframedOnly}
        onToggleKeyframedOnly={() => setShowKeyframedOnly((prev) => !prev)}
        allPropertyGroups={allPropertyGroups}
        visibleGroups={visibleGroups}
        onToggleVisibleGroup={toggleVisibleGroup}
        onExpandAllGroups={() => setAllGroupsExpanded(true)}
        onCollapseAllGroups={() => setAllGroupsExpanded(false)}
        onResetParameterView={resetParameterView}
        hasPropertyFilters={hasPropertyFilters}
        showGraphPane={showGraphPane}
        graphDisplayProperty={graphDisplayProperty}
        compoundPropertyRows={compoundPropertyRows}
        speedGraphContent={speedGraphContent}
        onGraphModeChange={onGraphModeChange}
        graphMode={graphMode}
        keyframeCount={visibleKeyframes.length}
        isCurrentFrameBlocked={isCurrentFrameBlocked}
        canBakeMotion={canBakeMotion}
        onBakeMotion={onBakeMotion}
        headerFrameInputsEnabled={
          Boolean(onKeyframeMove) &&
          selectedFrameSummary.hasSelection &&
          !selectedFrameSummary.hasMixedFrames
        }
        totalFrames={totalFrames}
        globalFrame={globalFrame}
        localFrameInputValue={localFrameInputValue}
        globalFrameInputValue={globalFrameInputValue}
        setLocalFrameInputValue={setLocalFrameInputValue}
        setGlobalFrameInputValue={setGlobalFrameInputValue}
        skipNextHeaderFrameBlurRef={skipNextHeaderFrameBlurRef}
        commitLocalFrameInput={commitLocalFrameInput}
        commitGlobalFrameInput={commitGlobalFrameInput}
        handleHeaderFrameInputKeyDown={handleHeaderFrameInputKeyDown}
        interpolationOptions={interpolationOptions}
        selectedInterpolation={selectedInterpolation}
        interpolationDisabled={interpolationDisabled}
        onInterpolationChange={onInterpolationChange}
        hasSelection={selectedRefs.length > 0}
        hasKeyframeClipboard={hasKeyframeClipboard}
        isKeyframeClipboardCut={isKeyframeClipboardCut}
        onCopyKeyframes={onCopyKeyframes}
        onCutKeyframes={onCutKeyframes}
        onPasteKeyframes={onPasteKeyframes}
        removeKeyframesAvailable={Boolean(onRemoveKeyframes)}
        handleRemoveKeyframes={handleRemoveKeyframes}
        horizontalZoomValue={horizontalZoomValue}
        horizontalZoomRatioBase={horizontalZoomRatioBase}
        setHorizontalZoomValue={setHorizontalZoomValue}
        resetViewport={resetViewport}
        graphVerticalZoomValue={graphVerticalZoomValue}
        graphPropertyCount={visibleGraphProperties.length}
        verticalZoomRatioBase={verticalZoomRatioBase}
        setGraphVerticalZoomValue={setGraphVerticalZoomValue}
        graphRulerUnit={graphRulerUnit}
        onChangeRulerUnit={setGraphRulerUnit}
        showAllGraphHandles={showAllGraphHandles}
        onToggleGraphHandleVisibility={() => setShowAllGraphHandles((prev) => !prev)}
        autoZoomGraphHeight={autoZoomGraphHeight}
        onToggleAutoZoomGraphHeight={() => setAutoZoomGraphHeight((prev) => !prev)}
      />

      <div
        className={cn(
          'border border-border rounded-md flex-1 min-h-0 overflow-hidden relative',
          disabled && 'opacity-60 pointer-events-none',
          isSplitView && 'flex flex-col',
        )}
        onWheel={visualizationMode === 'dopesheet' ? handleWheel : undefined}
      >
        {isSplitView ? (
          <>
            {rulerHeaderElement}
            {/* Sheet on top, curve/graph below, with ONE shared playhead line
                ({splitPlayheadOverlayElement}) drawn over both panes so they
                stay identical in position and appearance. */}
            <div
              className="relative min-h-0 flex-1 overflow-hidden"
              role="region"
              aria-label={t('timeline.keyframeEditor.sheet')}
              onWheel={handleWheel}
            >
              {sheetBodyElement}
            </div>
            <div
              className="min-h-0 flex-1 overflow-hidden border-t border-border/60"
              role="region"
              aria-label={t('timeline.keyframeEditor.graph')}
            >
              {graphPaneElement}
            </div>
            {skimPlayheadOverlayElement}
            {splitPlayheadOverlayElement}
          </>
        ) : (
          <>
            {/* Sheet mode only: the graph renders its own aligned playhead
                (GraphPlayhead) using the graph's coordinate space. */}
            {showSheetPane && skimPlayheadOverlayElement}
            {showSheetPane && playheadOverlayElement}
            {rulerHeaderElement}
            {showGraphPane ? graphPaneElement : sheetBodyElement}
          </>
        )}
      </div>
      {expressionDockElement}
      {showGraphPane && (
        <div className="grid" style={propertyGridStyle}>
          <div className="h-4 border-t border-r border-border/60 bg-background/80" />
          <div data-testid="keyframe-timing-strip-viewport-column">
            <KeyframeTimingStrip
              viewport={viewport}
              contentFrameMax={contentFrameMax}
              markers={timingStripMarkers}
              previewFrames={timingStripPreviewFrames}
              disabled={disabled || timingStripMarkers.length === 0}
              onSelectionChange={handleTimingStripSelectionChange}
              onSlideStart={handleTimingStripSlideStart}
              onSlideChange={handleTimingStripSlideChange}
              onSlideEnd={handleTimingStripSlideEnd}
            />
          </div>
        </div>
      )}
      <div className="grid" style={propertyGridStyle}>
        <div
          data-testid="keyframe-navigator-property-column"
          className="h-5 border-t border-r border-border/60 bg-background/80"
        />
        <div data-testid="keyframe-navigator-viewport-column">
          <CompactNavigator
            viewport={viewport}
            currentFrame={currentFrame}
            contentFrameMax={contentFrameMax}
            minVisibleFrames={minViewportFrames}
            disabled={disabled}
            onViewportChange={updateViewport}
          />
        </div>
      </div>
      {expressionReferenceDrag ? (
        <PickWhipOverlay
          presentation={expressionReferenceDrag.presentation}
          testId="expression-reference-pick-whip"
        />
      ) : null}
    </div>
  )
})
