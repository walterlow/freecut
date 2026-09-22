// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import {
  buildDopesheetEditorProps,
  type DopesheetEditorPropsInput,
} from './build-dopesheet-editor-props'
import type { TimelineItem } from '@/types/timeline'

function makeItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: 'item-1',
    type: 'video',
    label: 'clip',
    src: '',
    trackId: 'track-1',
    from: 30,
    durationInFrames: 120,
    ...overrides,
  } as TimelineItem
}

const noop = () => {}

function makeInput(overrides: Partial<DopesheetEditorPropsInput> = {}): DopesheetEditorPropsInput {
  const item = makeItem()
  return {
    surface: 'edit',
    selectedItemForEditor: item,
    containerWidth: 800,
    resolvedContentHeight: 300,
    maxItemEndFrame: 240,
    canvas: { width: 1920, height: 1080, fps: 30 },
    currentFrame: 50,
    relativeFrame: 20,
    effectiveEditorMode: 'dopesheet',
    effectiveSelectedProperty: null,
    keyframesByProperty: {},
    selectedItemKeyframes: null,
    propertyValues: {},
    preExpressionPropertyValues: {},
    selectedKeyframeIds: new Set<string>(),
    selectedEditorKeyframes: [],
    selectedEditorEasing: undefined,
    easingOptions: [],
    trimmedKeyframeCount: 0,
    transitionBlockedRanges: [],
    proceduralPreview: undefined,
    canBakeProceduralMotion: false,
    propertyLinkSourceLabels: {},
    handlePropertyLinkPointerDown: noop,
    handleRemovePropertyLink: noop,
    resolveExpressionReference: () => null,
    handleSetPropertyExpression: noop,
    handleRemovePropertyExpression: noop,
    hiddenVectorPropertyRows: undefined,
    compoundPropertyRows: {},
    compoundSecondaryProperties: {},
    dimensionSeparationByProperty: {},
    classicAxisConstraints: undefined,
    activeVectorRow: null,
    vectorGraphMode: 'value',
    setVectorGraphMode: noop,
    vectorSpeedGraphContent: undefined,
    editTextMotionBands: [],
    handleTextMotionDurationDragStart: noop,
    handleTextMotionDurationCommit: noop,
    handleTextMotionDurationCancel: noop,
    handleTextMotionOffsetDragStart: noop,
    handleTextMotionOffsetCommit: noop,
    handleTextMotionOffsetCancel: noop,
    handleTextMotionBandClick: noop,
    editTimelineFps: 30,
    editTimelineFrameViewport: undefined,
    editTimelineGlobalFrameToPixels: undefined,
    editTimelineScrollLeft: undefined,
    editTimelinePixelsPerSecond: undefined,
    editTimelineViewportWidth: undefined,
    getEditTimelineLivePixelsPerSecond: undefined,
    handleEditTimelineEdgeScroll: undefined,
    timelineScrollContainerRef: undefined,
    handleTrimAnimation: noop,
    handleKeyframeMove: noop,
    handleKeyframesMove: noop,
    handleBezierHandleMove: noop,
    handleSegmentEasingChange: noop,
    handleSelectionChange: noop,
    handlePropertyChange: noop,
    setSelectedProperty: noop,
    handleScrub: noop,
    handleSkim: noop,
    handleScrubStart: noop,
    handleScrubEnd: noop,
    handleDragStart: noop,
    handleDragEnd: noop,
    handleDragCancel: noop,
    handleAddKeyframe: noop,
    handleDuplicateKeyframes: noop,
    handlePropertyValueCommit: noop,
    handlePropertyValuePreview: noop,
    handleResetPropertiesToDefault: noop,
    handleRemoveKeyframes: noop,
    handleCopyKeyframes: noop,
    handleCutKeyframes: noop,
    handlePasteKeyframes: noop,
    handleSelectedKeyframeEasingChange: noop,
    handleNavigateToKeyframe: noop,
    keyframeClipboard: null,
    isKeyframeClipboardCut: false,
    setBakeDialogOpen: noop,
    splitView: true,
    initialVisibleGroupIds: undefined,
    propertyColumnWidth: undefined,
    isPointerWithinEditor: false,
    isFocusWithinEditor: false,
    hotkeys: { EDIT_KEYFRAME_ADD: 'a', KEYFRAME_PREVIOUS: 'p', KEYFRAME_NEXT: 'n', KEYFRAME_TOGGLE_AUTO: 't', KEYFRAME_FIT: 'f' },
    ...overrides,
  }
}

describe('buildDopesheetEditorProps', () => {
  it('sizes the docked editor from the container, without the floating inset', () => {
    const props = buildDopesheetEditorProps(makeInput({ containerWidth: 800, resolvedContentHeight: 300 }) )

    expect(props.width).toBe(800)
    expect(props.height).toBe(300)
  })

  it('insets the floating editor by its own gutter', () => {
    const props = buildDopesheetEditorProps(
      makeInput({ surface: 'default', containerWidth: 800, resolvedContentHeight: 300 }),
    )

    expect(props.width).toBe(784)
    expect(props.height).toBe(284)
  })

  it('links the docked Edit sheet to the shared timeline ruler', () => {
    const globalFrameToPixels = vi.fn()
    const onRulerEdgeScroll = vi.fn()
    const props = buildDopesheetEditorProps(
      makeInput({
        surface: 'edit',
        editTimelineFps: 60,
        editTimelineGlobalFrameToPixels: globalFrameToPixels,
        handleEditTimelineEdgeScroll: onRulerEdgeScroll,
      }),
    )

    expect(props.presentation).toBe('classic')
    expect(props.clampViewportToContent).toBe(false)
    expect(props.viewportInteractionEnabled).toBe(false)
    expect(props.globalFrameToPixels).toBe(globalFrameToPixels)
    expect(props.onRulerEdgeScroll).toBe(onRulerEdgeScroll)
    expect(props.fps).toBe(60)
  })

  it('keeps the value-graph workspaces floating and clamped to the item bounds', () => {
    const props = buildDopesheetEditorProps(
      makeInput({ surface: 'default', editTimelineFps: 60 }),
    )

    expect(props.presentation).toBeUndefined()
    expect(props.clampViewportToContent).toBe(true)
    expect(props.viewportInteractionEnabled).toBe(true)
    expect(props.globalFrameToPixels).toBeUndefined()
    expect(props.onRulerEdgeScroll).toBeUndefined()
    expect(props.fps).toBe(30)
    expect(props.playheadClampToItemBounds).toBe(true)
    expect(props.scrubClampToItemBounds).toBe(true)
    expect(props.playheadFrame).toBeUndefined()
  })

  it('scrubs the docked sheet over the shared timeline span', () => {
    const props = buildDopesheetEditorProps(
      makeInput({ surface: 'edit', maxItemEndFrame: 240, editTimelineFps: 30 }),
    )

    expect(props.playheadFrame).toBe(20)
    expect(props.playheadClampToItemBounds).toBe(false)
    expect(props.scrubClampToItemBounds).toBe(false)
    // The scrubbable span never shrinks below the ten-second floor.
    expect(props.scrubFrameBounds).toEqual({ minFrame: -30, maxFrame: 300 - 30 })
    expect(props.affectedFrameRange).toEqual({ fromFrame: 0, toFrame: 120 })
    expect(props.itemFrom).toBe(30)
    expect(props.totalFrames).toBe(120)
  })

  it('maps the current frame to the item-local frame the editor scrolls by', () => {
    const props = buildDopesheetEditorProps(makeInput({ currentFrame: 50, relativeFrame: 20 }) )

    expect(props.currentFrame).toBe(20)
    expect(props.globalFrame).toBe(50)
  })

  it('hides the compound rows unless the clip can be transformed as a vector', () => {
    const rows = ['y'] as const
    const video = buildDopesheetEditorProps(makeInput({ hiddenVectorPropertyRows: rows }) )
    const audio = buildDopesheetEditorProps(
      makeInput({ selectedItemForEditor: makeItem({ type: 'audio' }), hiddenVectorPropertyRows: rows }),
    )

    expect(video.hiddenPropertyRows).toBe(rows)
    expect(audio.hiddenPropertyRows).toBeUndefined()
  })

  it('offers the add-keyframe shortcut only where the docked sheet owns it', () => {
    const onEdit = buildDopesheetEditorProps(makeInput({ surface: 'edit' }) )
    const onGraph = buildDopesheetEditorProps(makeInput({ surface: 'default' }) )

    expect(onEdit.shortcuts?.addKeyframe).toBe('a')
    expect(onEdit.addKeyframeShortcutEnabled).toBe(true)
    expect(onGraph.shortcuts?.addKeyframe).toBe('')
    expect(onGraph.addKeyframeShortcutEnabled).toBe(false)
  })

  it('reports the clipboard state the toolbar buttons bind to', () => {
    const empty = buildDopesheetEditorProps(makeInput() )
    const filled = buildDopesheetEditorProps(
      makeInput({
        keyframeClipboard: {
          keyframes: [{ property: 'x', frame: 0, value: 1, easing: 'linear' }],
          originFrame: 10,
          sourceRefs: [{ itemId: 'a', property: 'x', keyframeId: 'k1' }],
        },
        isKeyframeClipboardCut: true,
      }),
    )

    expect(empty.hasKeyframeClipboard).toBe(false)
    expect(filled.hasKeyframeClipboard).toBe(true)
    expect(filled.isKeyframeClipboardCut).toBe(true)
  })
})
