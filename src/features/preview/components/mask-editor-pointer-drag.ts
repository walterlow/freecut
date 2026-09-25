/**
 * Pure pointer-drag decisions for the mask editor overlay.
 *
 * Everything here is a plain answer to a pointer question: what drag does this
 * pen hit start, how does the start vertex move for a canvas delta, which
 * vertices is the pen rubber-banding? The module owns no state, no refs and no
 * canvas context — the overlay keeps the interaction refs, the pointer capture
 * and the store calls, and only sequences these answers around them.
 */

import type { MaskVertex } from '@/types/masks'
import type { Transform } from '../types/gizmo'
import type { MaskHit, PenHit } from './mask-editor-hit-testing'
import { cloneVertices } from './mask-editor-overlay-utils'

/** An edit-mode drag in flight: the control point or shape body being dragged. */
export type EditDragState =
  | {
      type: 'vertex' | 'handle'
      startVertices: MaskVertex[]
      vertexIndex: number
      handleType: 'in' | 'out' | null
      startCanvasPos: [number, number]
    }
  | {
      type: 'shape'
      startTransform: Transform
      interactionId: number
    }
  | {
      type: 'marquee'
      startScreenPos: [number, number]
      currentScreenPos: [number, number]
      hasMoved: boolean
    }

/** The vertex/handle drag an edit-mode hit starts, or null for any other hit. */
export function createVertexHandleDragState(
  vertices: MaskVertex[],
  hit: MaskHit,
  canvasPos: [number, number],
): Extract<EditDragState, { type: 'vertex' | 'handle' }> | null {
  if (hit.type === 'vertex') {
    return {
      type: 'vertex',
      startVertices: cloneVertices(vertices),
      vertexIndex: hit.index,
      handleType: null,
      startCanvasPos: canvasPos,
    }
  }

  if (hit.type === 'inHandle' || hit.type === 'outHandle') {
    return {
      type: 'handle',
      startVertices: cloneVertices(vertices),
      vertexIndex: hit.index,
      handleType: hit.type === 'inHandle' ? 'in' : 'out',
      startCanvasPos: canvasPos,
    }
  }

  return null
}

/** A pen pointer drag in flight: what was grabbed, and where it started. */
export type PenInteraction =
  | {
      type: 'create'
      vertexIndex: number
      startScreenPos: [number, number]
    }
  | {
      type: 'close-or-drag' | 'vertex' | 'handle'
      vertexIndex: number
      handleType: 'in' | 'out' | null
      startScreenPos: [number, number]
      startCanvasPos: [number, number]
      startVertices: MaskVertex[]
      hasMoved: boolean
    }

/** The store drag a pen interaction switches into. */
export type PenDragStart =
  | { kind: 'vertex'; index: number }
  | { kind: 'handle'; index: number; handleType: 'in' | 'out' }

/** Minimum planted points before the first anchor can close the path. */
const PEN_CLOSING_MIN_VERTICES = 3

/** Whether a pen hit means "close the path", which only the first anchor does. */
function isPenClosingVertex(hit: PenHit, vertexCount: number): boolean {
  return hit.type === 'vertex' && hit.index === 0 && vertexCount >= PEN_CLOSING_MIN_VERTICES
}

/** The handle a pen hit addresses, or null when it addresses an anchor. */
export function resolvePenHitHandle(hit: PenHit): 'in' | 'out' | null {
  if (hit.type === 'inHandle') {
    return 'in'
  }

  return hit.type === 'outHandle' ? 'out' : null
}

/** The interaction a pen pointer-down on an existing point or handle starts. */
export function createPenHitInteraction(params: {
  hit: PenHit
  screenPos: [number, number]
  canvasPos: [number, number]
  vertices: MaskVertex[]
}): PenInteraction {
  const { hit, screenPos, canvasPos, vertices } = params
  const isClosingVertex = isPenClosingVertex(hit, vertices.length)

  return {
    type: hit.type === 'vertex' ? (isClosingVertex ? 'close-or-drag' : 'vertex') : 'handle',
    vertexIndex: hit.index,
    // Closing the path drags the anchor's outgoing direction, matching what a
    // freshly planted point would do.
    handleType: isClosingVertex ? 'out' : resolvePenHitHandle(hit),
    startScreenPos: screenPos,
    startCanvasPos: canvasPos,
    startVertices: cloneVertices(vertices),
    hasMoved: false,
  }
}

/** The drag a pen pointer-down starts right away; a closing anchor waits for movement. */
export function resolvePenPointerDownDragStart(
  hit: PenHit,
  vertexCount: number,
): PenDragStart | null {
  const handleType = resolvePenHitHandle(hit)
  if (handleType) {
    return { kind: 'handle', index: hit.index, handleType }
  }

  if (hit.type === 'vertex' && !isPenClosingVertex(hit, vertexCount)) {
    return { kind: 'vertex', index: hit.index }
  }

  return null
}

/** The drag a moved pen interaction switches into once it passes its threshold. */
export function resolvePenDragStart(interaction: PenInteraction): PenDragStart | null {
  if (interaction.type === 'create') {
    return null
  }

  if (interaction.type === 'vertex') {
    return { kind: 'vertex', index: interaction.vertexIndex }
  }

  const handleType =
    interaction.type === 'close-or-drag' ? (interaction.handleType ?? 'in') : interaction.handleType

  return handleType ? { kind: 'handle', index: interaction.vertexIndex, handleType } : null
}

/**
 * Move a dragged vertex or handle by a canvas-space delta, in item units.
 *
 * `smoothTangentOnDrag` is the pen's close-or-drag gesture: it mirrors the
 * anchor's handles (a smooth knot) unless the user breaks tangents.
 */
export function dragVerticesByCanvasDelta(params: {
  startVertices: MaskVertex[]
  vertexIndex: number
  handleType: 'in' | 'out' | null
  dx: number
  dy: number
  itemWidth: number
  itemHeight: number
  breakTangents: boolean
  smoothTangentOnDrag: boolean
}): MaskVertex[] {
  const {
    startVertices,
    vertexIndex,
    handleType,
    dx,
    dy,
    itemWidth,
    itemHeight,
    breakTangents,
    smoothTangentOnDrag,
  } = params
  const nextVertices = cloneVertices(startVertices)
  const vertex = nextVertices[vertexIndex]!
  const origin = startVertices[vertexIndex]!

  if (handleType === null) {
    vertex.position[0] = origin.position[0] + dx / itemWidth
    vertex.position[1] = origin.position[1] + dy / itemHeight
    return nextVertices
  }

  const originHandle = handleType === 'in' ? origin.inHandle : origin.outHandle
  const nextHandle: [number, number] = [
    originHandle[0] + dx / itemWidth,
    originHandle[1] + dy / itemHeight,
  ]

  if (smoothTangentOnDrag && !breakTangents) {
    vertex.tangentMode = 'smooth'
  }

  applyDraggedHandle(vertex, handleType, nextHandle, breakTangents)
  return nextVertices
}

function applyDraggedHandle(
  vertex: MaskVertex,
  handleType: 'in' | 'out',
  nextHandle: [number, number],
  breakTangents: boolean,
): void {
  const oppositeKey = handleType === 'in' ? 'outHandle' : 'inHandle'
  const selectedKey = handleType === 'in' ? 'inHandle' : 'outHandle'
  vertex[selectedKey] = nextHandle

  if (breakTangents || vertex.tangentMode === 'broken' || vertex.tangentMode === 'corner') {
    if (breakTangents) vertex.tangentMode = 'broken'
    return
  }

  const nextLength = Math.hypot(nextHandle[0], nextHandle[1])
  const opposite = vertex[oppositeKey]
  const oppositeLength = Math.hypot(opposite[0], opposite[1])
  if (vertex.tangentMode === 'continuous' && nextLength > Number.EPSILON) {
    const scale = oppositeLength / nextLength
    vertex[oppositeKey] = [-nextHandle[0] * scale, -nextHandle[1] * scale]
  } else {
    vertex[oppositeKey] = [-nextHandle[0], -nextHandle[1]]
    vertex.tangentMode = 'smooth'
  }
}
