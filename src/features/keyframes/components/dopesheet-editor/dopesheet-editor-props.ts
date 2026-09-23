import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import type {
  AnimatableProperty,
  BezierControlPoints,
  DirectLinkableProperty,
  DirectPropertyLink,
  EasingType,
  Keyframe,
  KeyframeRef,
  PropertyExpression,
} from '@/types/keyframe'
import type { MotionModifier } from '@/types/motion'
import type { TextMotionSlot } from '@/types/text-motion'
import type { TextMotionTimelineBand } from '@/shared/timeline/text-motion-timeline'
import type { BlockedFrameRange } from '../../utils/transition-region'
import type { ExpressionValue } from '@/features/keyframes/utils/property-expression'
import type { ProceduralPreviewInput } from '@/features/keyframes/utils/procedural-preview'
import type { CompoundPropertyInputConfig } from './compound-property-inputs'
import type { DopesheetDimensionSeparationControl } from './dopesheet-group-options-menu'
import type { SegmentEasingChange } from './segment-easing-popover'
import type { Viewport } from './dopesheet-types'

export interface DopesheetEditorProps {
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
