/**
 * Keyframe graph panel — DopesheetEditor wiring.
 *
 * Builds the (large) prop object the docked dopesheet/graph editor is rendered
 * with. Every value is injected: the panel's derived maps, the callbacks owned
 * by its collaborating hooks, and the raw switches (`surface`, editor mode,
 * clipboard state) the conditional props are resolved from.
 *
 * Pure on purpose — the panel keeps the memos and the subscriptions, this
 * module only decides what the editor receives.
 */

import type { ComponentProps, Dispatch, SetStateAction } from 'react'
import type { RefObject } from 'react'
import { DopesheetEditor } from '@/features/timeline/deps/keyframe-editors'
import { getDirectPropertyLinks } from '@/types/keyframe'
import {
  supportsVectorTransform,
  type KeyframeEditorSurface,
  type VectorEditorRow,
} from './keyframe-graph-panel-model'
import type { KeyframeEditorMode } from './keyframe-graph-panel'
import type {
  AnimatableProperty,
  EasingType,
  ItemKeyframes,
  Keyframe,
  KeyframeClipboard,
  KeyframeRef,
} from '@/types/keyframe'
import type { CanvasSettings } from '@/types/transform'
import type { TimelineItem } from '@/types/timeline'

type DopesheetProps = ComponentProps<typeof DopesheetEditor>

/** The `inlinePropertyGroupIds` this panel's Animate workspace shows inline. */
const MOTION_INLINE_PROPERTY_GROUP_IDS = ['transform'] as const

interface DopesheetEditorPropsInput {
  /** Where the panel is docked; drives the classic/split presentation. */
  surface: KeyframeEditorSurface
  selectedItemForEditor: TimelineItem
  containerWidth: number
  resolvedContentHeight: number
  maxItemEndFrame: number
  canvas: CanvasSettings
  /** Absolute playhead frame. */
  currentFrame: number
  /** Playhead frame relative to the selected item's start. */
  relativeFrame: number

  effectiveEditorMode: KeyframeEditorMode
  effectiveSelectedProperty: AnimatableProperty | null
  keyframesByProperty: DopesheetProps['keyframesByProperty']
  selectedItemKeyframes: ItemKeyframes | null
  propertyValues: DopesheetProps['propertyValues']
  preExpressionPropertyValues: DopesheetProps['preExpressionPropertyValues']
  selectedKeyframeIds: DopesheetProps['selectedKeyframeIds']
  selectedEditorKeyframes: Array<{ ref: KeyframeRef; keyframe: Keyframe }>
  selectedEditorEasing: EasingType | undefined
  easingOptions: Array<{ value: EasingType; label: string }>
  trimmedKeyframeCount: number
  transitionBlockedRanges: DopesheetProps['transitionBlockedRanges']
  proceduralPreview: DopesheetProps['proceduralPreview']
  canBakeProceduralMotion: boolean

  propertyLinkSourceLabels: DopesheetProps['propertyLinkSourceLabels']
  handlePropertyLinkPointerDown: DopesheetProps['onPropertyLinkPointerDown']
  handleRemovePropertyLink: DopesheetProps['onRemovePropertyLink']
  resolveExpressionReference: DopesheetProps['resolveExpressionReference']
  handleSetPropertyExpression: DopesheetProps['onSetPropertyExpression']
  handleRemovePropertyExpression: DopesheetProps['onRemovePropertyExpression']

  hiddenVectorPropertyRows: DopesheetProps['hiddenPropertyRows']
  compoundPropertyRows: DopesheetProps['compoundPropertyRows']
  compoundSecondaryProperties: DopesheetProps['compoundSecondaryProperties']
  dimensionSeparationByProperty: DopesheetProps['dimensionSeparationByProperty']
  classicAxisConstraints: DopesheetProps['axisConstraintByProperty']
  activeVectorRow: VectorEditorRow | null
  vectorGraphMode: 'value' | 'speed'
  setVectorGraphMode: Dispatch<SetStateAction<'value' | 'speed'>>
  vectorSpeedGraphContent: DopesheetProps['speedGraphContent']

  editTextMotionBands: DopesheetProps['textMotionBands']
  handleTextMotionDurationDragStart: DopesheetProps['onTextMotionDurationDragStart']
  handleTextMotionDurationCommit: DopesheetProps['onTextMotionDurationCommit']
  handleTextMotionDurationCancel: DopesheetProps['onTextMotionDurationCancel']
  handleTextMotionOffsetDragStart: DopesheetProps['onTextMotionOffsetDragStart']
  handleTextMotionOffsetCommit: DopesheetProps['onTextMotionOffsetCommit']
  handleTextMotionOffsetCancel: DopesheetProps['onTextMotionOffsetCancel']
  handleTextMotionBandClick: DopesheetProps['onTextMotionBandClick']

  editTimelineFps: number
  editTimelineFrameViewport: DopesheetProps['frameViewport']
  editTimelineGlobalFrameToPixels: DopesheetProps['globalFrameToPixels']
  editTimelineScrollLeft: DopesheetProps['timelinePanBaseScrollLeft']
  editTimelinePixelsPerSecond: DopesheetProps['timelinePanBasePixelsPerSecond']
  editTimelineViewportWidth: DopesheetProps['linkedTimelineViewportWidth']
  getEditTimelineLivePixelsPerSecond: DopesheetProps['getTimelineLivePixelsPerSecond']
  handleEditTimelineEdgeScroll: DopesheetProps['onRulerEdgeScroll']
  timelineScrollContainerRef: RefObject<HTMLDivElement | null> | undefined

  handleTrimAnimation: DopesheetProps['onTrimAnimation']
  handleKeyframeMove: DopesheetProps['onKeyframeMove']
  handleKeyframesMove: DopesheetProps['onKeyframesMove']
  handleBezierHandleMove: DopesheetProps['onBezierHandleMove']
  handleSegmentEasingChange: DopesheetProps['onSegmentEasingChange']
  handleSelectionChange: DopesheetProps['onSelectionChange']
  handlePropertyChange: DopesheetProps['onPropertyChange']
  setSelectedProperty: Dispatch<SetStateAction<AnimatableProperty | null>>

  handleScrub: DopesheetProps['onScrub']
  handleSkim: DopesheetProps['onSkim']
  handleScrubStart: DopesheetProps['onScrubStart']
  handleScrubEnd: DopesheetProps['onScrubEnd']
  handleDragStart: DopesheetProps['onDragStart']
  handleDragEnd: DopesheetProps['onDragEnd']
  handleDragCancel: DopesheetProps['onDragCancel']
  handleAddKeyframe: DopesheetProps['onAddKeyframe']
  handleDuplicateKeyframes: DopesheetProps['onDuplicateKeyframes']
  handlePropertyValueCommit: DopesheetProps['onPropertyValueCommit']
  handlePropertyValuePreview: DopesheetProps['onPropertyValuePreview']
  handleResetPropertiesToDefault: DopesheetProps['onResetPropertiesToDefault']
  handleRemoveKeyframes: DopesheetProps['onRemoveKeyframes']
  handleCopyKeyframes: DopesheetProps['onCopyKeyframes']
  handleCutKeyframes: DopesheetProps['onCutKeyframes']
  handlePasteKeyframes: DopesheetProps['onPasteKeyframes']
  handleSelectedKeyframeEasingChange: DopesheetProps['onInterpolationChange']
  handleNavigateToKeyframe: DopesheetProps['onNavigateToKeyframe']

  keyframeClipboard: KeyframeClipboard | null
  isKeyframeClipboardCut: boolean
  setBakeDialogOpen: Dispatch<SetStateAction<boolean>>

  splitView: boolean
  initialVisibleGroupIds: readonly string[] | undefined
  propertyColumnWidth: number | undefined
  isPointerWithinEditor: boolean
  isFocusWithinEditor: boolean
  hotkeys: {
    EDIT_KEYFRAME_ADD: string
    KEYFRAME_PREVIOUS: string
    KEYFRAME_NEXT: string
    KEYFRAME_TOGGLE_AUTO: string
    KEYFRAME_FIT: string
  }
}

export function buildDopesheetEditorProps({
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
}: DopesheetEditorPropsInput): DopesheetProps {
  const itemFrom = selectedItemForEditor.from
  const totalFrames = selectedItemForEditor.durationInFrames
  const editorInset = surface === 'edit' ? 0 : 16
  // The docked editor spans the full timeline row. Its own 12px custom
  // scrollbar then occupies the same right-edge column as the main timeline's
  // scrollbar instead of subtracting a second gutter from the shared axis.
  const editorWidth = Math.max(0, containerWidth - editorInset)
  const editorHeight = Math.max(0, resolvedContentHeight - editorInset)

  return {
    itemId: selectedItemForEditor.id,
    motionModifiers: selectedItemForEditor.motionModifiers,
    textMotionBands: editTextMotionBands,
    onTextMotionDurationDragStart: handleTextMotionDurationDragStart,
    onTextMotionDurationCommit: handleTextMotionDurationCommit,
    onTextMotionDurationCancel: handleTextMotionDurationCancel,
    onTextMotionOffsetDragStart: handleTextMotionOffsetDragStart,
    onTextMotionOffsetCommit: handleTextMotionOffsetCommit,
    onTextMotionOffsetCancel: handleTextMotionOffsetCancel,
    onTextMotionBandClick: handleTextMotionBandClick,
    hasProceduralMotion: canBakeProceduralMotion,
    frameViewport: editTimelineFrameViewport,
    clampViewportToContent: surface !== 'edit',
    viewportInteractionEnabled: surface !== 'edit',
    keyframesByProperty,
    propertyValues,
    preExpressionPropertyValues,
    propertyLinks: getDirectPropertyLinks(selectedItemKeyframes ?? undefined),
    propertyExpressions: selectedItemKeyframes?.expressions?.filter(
      (expression) => expression.type === 'expression',
    ),
    propertyLinkSourceLabels,
    onPropertyLinkPointerDown: handlePropertyLinkPointerDown,
    onRemovePropertyLink: handleRemovePropertyLink,
    resolveExpressionReference,
    onSetPropertyExpression: handleSetPropertyExpression,
    onRemovePropertyExpression: handleRemovePropertyExpression,
    hiddenPropertyRows: supportsVectorTransform(selectedItemForEditor)
      ? hiddenVectorPropertyRows
      : undefined,
    compoundPropertyRows,
    compoundSecondaryProperties,
    dimensionSeparationByProperty,
    axisConstraintByProperty: surface === 'edit' ? classicAxisConstraints : undefined,
    selectedProperty: effectiveSelectedProperty,
    selectedKeyframeIds,
    currentFrame: relativeFrame,
    playheadFrame: surface === 'edit' ? currentFrame - itemFrom : undefined,
    playheadClampToItemBounds: surface !== 'edit',
    globalFrame: currentFrame,
    itemFrom,
    totalFrames,
    affectedFrameRange:
      surface === 'edit' ? { fromFrame: 0, toFrame: totalFrames } : undefined,
    trimmedKeyframeCount: surface === 'edit' ? trimmedKeyframeCount : 0,
    onTrimAnimation: surface === 'edit' ? handleTrimAnimation : undefined,
    fps: surface === 'edit' ? editTimelineFps : canvas.fps,
    width: editorWidth,
    height: editorHeight,
    onKeyframeMove: handleKeyframeMove,
    onKeyframesMove: handleKeyframesMove,
    onBezierHandleMove: handleBezierHandleMove,
    onSegmentEasingChange: handleSegmentEasingChange,
    onSelectionChange: handleSelectionChange,
    onPropertyChange: handlePropertyChange,
    onActivePropertyChange: setSelectedProperty,
    onScrub: handleScrub,
    onSkim: surface === 'edit' ? handleSkim : undefined,
    globalFrameToPixels: surface === 'edit' ? editTimelineGlobalFrameToPixels : undefined,
    timelineScrollContainerRef: surface === 'edit' ? timelineScrollContainerRef : undefined,
    timelinePanBaseScrollLeft: surface === 'edit' ? editTimelineScrollLeft : undefined,
    timelinePanBasePixelsPerSecond:
      surface === 'edit' ? editTimelinePixelsPerSecond : undefined,
    linkedTimelineViewportWidth: surface === 'edit' ? editTimelineViewportWidth : undefined,
    getTimelineLivePixelsPerSecond:
      surface === 'edit' ? getEditTimelineLivePixelsPerSecond : undefined,
    onRulerEdgeScroll: surface === 'edit' ? handleEditTimelineEdgeScroll : undefined,
    scrubClampToItemBounds: surface !== 'edit',
    scrubFrameBounds:
      surface === 'edit'
        ? {
            minFrame: -itemFrom,
            maxFrame:
              Math.floor(Math.max(maxItemEndFrame / editTimelineFps, 10) * editTimelineFps) -
              itemFrom,
          }
        : undefined,
    onScrubStart: handleScrubStart,
    onScrubEnd: handleScrubEnd,
    onDragStart: handleDragStart,
    onDragEnd: handleDragEnd,
    onDragCancel: handleDragCancel,
    onAddKeyframe: handleAddKeyframe,
    onDuplicateKeyframes: handleDuplicateKeyframes,
    onPropertyValueCommit: handlePropertyValueCommit,
    onPropertyValuePreview: handlePropertyValuePreview,
    onResetPropertiesToDefault: handleResetPropertiesToDefault,
    onRemoveKeyframes: handleRemoveKeyframes,
    onCopyKeyframes: handleCopyKeyframes,
    onCutKeyframes: handleCutKeyframes,
    onPasteKeyframes: handlePasteKeyframes,
    hasKeyframeClipboard: Boolean(keyframeClipboard?.keyframes.length),
    isKeyframeClipboardCut,
    selectedInterpolation: selectedEditorEasing,
    interpolationOptions: easingOptions,
    onInterpolationChange: handleSelectedKeyframeEasingChange,
    interpolationDisabled: selectedEditorKeyframes.length === 0,
    onNavigateToKeyframe: handleNavigateToKeyframe,
    transitionBlockedRanges,
    proceduralPreview,
    canBakeMotion: canBakeProceduralMotion,
    onBakeMotion: () => setBakeDialogOpen(true),
    visualizationMode: effectiveEditorMode,
    presentation: surface === 'edit' ? 'classic' : undefined,
    graphMode: vectorGraphMode,
    onGraphModeChange: activeVectorRow ? setVectorGraphMode : undefined,
    speedGraphContent: vectorSpeedGraphContent,
    spacious: splitView || surface === 'motion',
    inlinePropertyGroupIds: surface === 'motion' ? MOTION_INLINE_PROPERTY_GROUP_IDS : undefined,
    initialVisibleGroupIds,
    propertyColumnWidth,
    shortcutsEnabled: isPointerWithinEditor || isFocusWithinEditor,
    addKeyframeShortcutEnabled: surface === 'edit',
    shortcuts: {
      addKeyframe: surface === 'edit' ? hotkeys.EDIT_KEYFRAME_ADD : '',
      previousKeyframe: hotkeys.KEYFRAME_PREVIOUS,
      nextKeyframe: hotkeys.KEYFRAME_NEXT,
      toggleAutoKey: hotkeys.KEYFRAME_TOGGLE_AUTO,
      fitKeyframes: hotkeys.KEYFRAME_FIT,
    },
  }
}
