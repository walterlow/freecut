/**
 * Pen Path Render Plan
 *
 * The pen overlay paints a fixed sequence of canvas calls every frame. Every
 * decision behind that sequence — how many points to draw, where each vertex
 * and bezier handle lands, whether the path is previewing its closing segment,
 * whether the rubber band is a line or a curve, and which fill/stroke each
 * control point uses — is derived here as plain data.
 *
 * The overlay component only applies the plan, so its drawing loop stays a
 * flat, branch-free list of 2D-context calls and the geometry can be verified
 * without a canvas.
 */

import type { MaskVertex } from '@/types/masks'

/** Overlay-local screen bounds of the item being edited. */
export interface ItemScreenBounds {
  left: number
  top: number
  width: number
  height: number
}

/** A point in overlay-local screen pixels. */
export interface OverlayPoint {
  x: number
  y: number
}

export interface PenCursorHint {
  position: OverlayPoint
  radius: number
  fill: string
}

/** A bezier handle knob plus the stem that ties it to its anchor. */
export interface PenHandleMark {
  stemEnd: OverlayPoint
  fill: string
}

export interface PenVertexMark {
  position: OverlayPoint
  drawSelectionRing: boolean
  fill: string
  stroke: string
  lineWidth: number
  /** Painted before `inHandle`, matching the order the pen path was drawn in. */
  outHandle: PenHandleMark | null
  inHandle: PenHandleMark | null
}

export interface PenSegmentPair {
  from: MaskVertex
  to: MaskVertex
}

export interface PenSegmentGroup {
  moveTo: OverlayPoint
  pairs: PenSegmentPair[]
  stroke: string
  lineWidth: number
}

export interface PenClosingPreview {
  moveTo: OverlayPoint
  from: MaskVertex
  to: MaskVertex
  stroke: string
  lineWidth: number
  dash: [number, number]
}

export interface PenRubberBand {
  moveTo: OverlayPoint
  to: OverlayPoint
  /** Out-handle control point of the last vertex, or `null` for a straight line. */
  control: OverlayPoint | null
  stroke: string
  lineWidth: number
  dash: [number, number]
}

export interface PenPathRenderPlan {
  cursorHint: PenCursorHint | null
  segments: PenSegmentGroup | null
  closingPreview: PenClosingPreview | null
  rubberBand: PenRubberBand | null
  vertexMarks: PenVertexMark[]
}

export interface PenPathRenderState {
  bounds: ItemScreenBounds
  vertices: readonly MaskVertex[]
  cursorPos: readonly [number, number] | null
  penDraggingHandle: boolean
  draggingVertexIndex: number | null
  draggingHandle: 'in' | 'out' | null
  selectedVertexIndices: readonly number[]
  hoveredVertexIndex: number | null
  hoveredHandle: 'in' | 'out' | null
  /** Distance in screen pixels below which the first anchor reads as clickable to close. */
  closeRadius: number
}

const PEN_ACCENT = '#22d3ee'
const PEN_PLACED_STROKE = '#22d3ee'
const PEN_FADED_STROKE = 'rgba(34, 211, 238, 0.4)'
const PEN_CURSOR_HINT_FILL = 'rgba(34, 211, 238, 0.5)'
const PEN_CURSOR_HINT_RADIUS = 3
const PEN_DASH: [number, number] = [4, 4]

type PenHandleVisual = 'active' | 'hovered' | 'idle'

const PEN_HANDLE_FILL_BY_VISUAL: Record<PenHandleVisual, string> = {
  active: '#fff',
  hovered: PEN_ACCENT,
  idle: 'rgba(34, 211, 238, 0.6)',
}

type PenVertexVisual =
  | 'selectedActive'
  | 'selected'
  | 'active'
  | 'activeClose'
  | 'closeHovered'
  | 'hovered'
  | 'idle'

const PEN_VERTEX_FILL_BY_VISUAL: Record<PenVertexVisual, string> = {
  selectedActive: '#fde68a',
  selected: '#fef3c7',
  active: '#fff',
  activeClose: '#fff',
  closeHovered: PEN_ACCENT,
  hovered: PEN_ACCENT,
  idle: '#0e7490',
}

const PEN_VERTEX_STROKE_BY_VISUAL: Record<PenVertexVisual, string> = {
  selectedActive: '#f59e0b',
  selected: '#f59e0b',
  active: '#fff',
  activeClose: '#fff',
  closeHovered: '#fff',
  hovered: PEN_ACCENT,
  idle: PEN_ACCENT,
}

const PEN_VERTEX_LINE_WIDTH_BY_VISUAL: Record<PenVertexVisual, number> = {
  selectedActive: 2.5,
  selected: 2.5,
  active: 1.5,
  activeClose: 2.5,
  closeHovered: 2.5,
  hovered: 1.5,
  idle: 1.5,
}

/**
 * The one projection from normalized path coordinates to overlay-local screen
 * pixels. It has to stay in lockstep with the overlay's `vertexToScreen`, which
 * is what every hit test and drag delta is measured against.
 */
function projectOverlayPoint(
  bounds: ItemScreenBounds,
  position: readonly [number, number],
): OverlayPoint {
  return {
    x: bounds.left + position[0] * bounds.width,
    y: bounds.top + position[1] * bounds.height,
  }
}

/**
 * Handle positions are stored relative to their anchor (not absolute), so a
 * handle projects as anchor + offset — the same pairing `handleToScreen` uses.
 */
function projectOverlayHandlePoint(
  bounds: ItemScreenBounds,
  anchor: readonly [number, number],
  offset: readonly [number, number],
): OverlayPoint {
  return {
    x: bounds.left + (anchor[0] + offset[0]) * bounds.width,
    y: bounds.top + (anchor[1] + offset[1]) * bounds.height,
  }
}

function resolvePenHandleVisual(isActive: boolean, isHovered: boolean): PenHandleVisual {
  if (isActive) return 'active'
  return isHovered ? 'hovered' : 'idle'
}

function resolvePenVertexVisual(
  isSelected: boolean,
  isActive: boolean,
  isCloseHovered: boolean,
  isHovered: boolean,
): PenVertexVisual {
  if (isSelected) return isActive ? 'selectedActive' : 'selected'
  if (isActive) return isCloseHovered ? 'activeClose' : 'active'
  if (isCloseHovered) return 'closeHovered'
  return isHovered ? 'hovered' : 'idle'
}

/** Whether the cursor sits close enough to the first anchor to close the path. */
function isPenCloseHovered(
  state: PenPathRenderState,
  positions: readonly OverlayPoint[],
): boolean {
  if (positions.length < 3 || !state.cursorPos) return false
  const first = positions[0]!
  const cursor = projectOverlayPoint(state.bounds, state.cursorPos)
  return Math.hypot(cursor.x - first.x, cursor.y - first.y) < state.closeRadius
}

function buildPenSegmentGroup(
  state: PenPathRenderState,
  positions: readonly OverlayPoint[],
): PenSegmentGroup {
  const pairs: PenSegmentPair[] = []
  for (let i = 0; i < state.vertices.length - 1; i++) {
    pairs.push({ from: state.vertices[i]!, to: state.vertices[i + 1]! })
  }
  return { moveTo: positions[0]!, pairs, stroke: PEN_PLACED_STROKE, lineWidth: 1.5 }
}

function buildPenClosingPreview(
  state: PenPathRenderState,
  positions: readonly OverlayPoint[],
  isClosing: boolean,
): PenClosingPreview | null {
  if (!isClosing) return null
  const lastIndex = positions.length - 1
  return {
    moveTo: positions[lastIndex]!,
    from: state.vertices[lastIndex]!,
    to: state.vertices[0]!,
    stroke: PEN_FADED_STROKE,
    lineWidth: 1,
    dash: PEN_DASH,
  }
}

function buildPenRubberBand(
  state: PenPathRenderState,
  positions: readonly OverlayPoint[],
  isClosing: boolean,
): PenRubberBand | null {
  if (!state.cursorPos || state.penDraggingHandle || isClosing) return null
  const lastIndex = positions.length - 1
  const last = state.vertices[lastIndex]!
  const hasOutHandle = last.outHandle[0] !== 0 || last.outHandle[1] !== 0
  return {
    moveTo: positions[lastIndex]!,
    to: projectOverlayPoint(state.bounds, state.cursorPos),
    control: hasOutHandle
      ? projectOverlayHandlePoint(state.bounds, last.position, last.outHandle)
      : null,
    stroke: PEN_FADED_STROKE,
    lineWidth: 1,
    dash: PEN_DASH,
  }
}

function buildPenHandleMark(
  state: PenPathRenderState,
  vertex: MaskVertex,
  index: number,
  handleType: 'in' | 'out',
): PenHandleMark | null {
  const handle = handleType === 'in' ? vertex.inHandle : vertex.outHandle
  if (handle[0] === 0 && handle[1] === 0) return null

  const isActive = state.draggingVertexIndex === index && state.draggingHandle === handleType
  const isHovered = state.hoveredVertexIndex === index && state.hoveredHandle === handleType
  return {
    stemEnd: projectOverlayHandlePoint(state.bounds, vertex.position, handle),
    fill: PEN_HANDLE_FILL_BY_VISUAL[resolvePenHandleVisual(isActive, isHovered)],
  }
}

function buildPenVertexMark(
  state: PenPathRenderState,
  position: OverlayPoint,
  index: number,
  isCloseHovered: boolean,
): PenVertexMark {
  const vertex = state.vertices[index]!
  const isSelected = state.selectedVertexIndices.includes(index)
  const isActive = state.draggingVertexIndex === index && state.draggingHandle === null
  const isHovered = state.hoveredVertexIndex === index && state.hoveredHandle === null
  const visual = resolvePenVertexVisual(
    isSelected,
    isActive,
    index === 0 && isCloseHovered,
    isHovered,
  )

  return {
    position,
    drawSelectionRing: isSelected,
    fill: PEN_VERTEX_FILL_BY_VISUAL[visual],
    stroke: PEN_VERTEX_STROKE_BY_VISUAL[visual],
    lineWidth: PEN_VERTEX_LINE_WIDTH_BY_VISUAL[visual],
    outHandle: buildPenHandleMark(state, vertex, index, 'out'),
    inHandle: buildPenHandleMark(state, vertex, index, 'in'),
  }
}

function buildPenVertexMarks(
  state: PenPathRenderState,
  positions: readonly OverlayPoint[],
  isCloseHovered: boolean,
): PenVertexMark[] {
  const marks: PenVertexMark[] = []
  for (let index = 0; index < positions.length; index++) {
    marks.push(buildPenVertexMark(state, positions[index]!, index, isCloseHovered))
  }
  return marks
}

/** Everything the pen overlay draws this frame, with no canvas involved. */
export function planPenPathRender(state: PenPathRenderState): PenPathRenderPlan {
  const positions = state.vertices.map((vertex) =>
    projectOverlayPoint(state.bounds, vertex.position),
  )

  if (positions.length === 0) {
    return {
      cursorHint: state.cursorPos
        ? {
            position: projectOverlayPoint(state.bounds, state.cursorPos),
            radius: PEN_CURSOR_HINT_RADIUS,
            fill: PEN_CURSOR_HINT_FILL,
          }
        : null,
      segments: null,
      closingPreview: null,
      rubberBand: null,
      vertexMarks: [],
    }
  }

  const isClosing =
    state.vertices.length >= 3 && state.draggingVertexIndex === 0 && state.draggingHandle === 'out'
  const closeHovered = isPenCloseHovered(state, positions)

  return {
    cursorHint: null,
    segments: buildPenSegmentGroup(state, positions),
    closingPreview: buildPenClosingPreview(state, positions, isClosing),
    rubberBand: buildPenRubberBand(state, positions, isClosing),
    vertexMarks: buildPenVertexMarks(state, positions, closeHovered),
  }
}
