/**
 * Pure vertex-selection decisions for the mask editor overlay.
 *
 * These helpers answer the two questions the overlay's edit handlers share:
 * which vertices a `selectedVertexIndices` / `selectedVertexIndex` pair resolves
 * to, and what that selection becomes once vertices are deleted or converted to
 * a corner / bezier knot. Nothing here reads a store, a ref or the canvas, so
 * the handlers stay a sequence of store updates around these answers.
 */

import type { MaskVertex } from '@/types/masks'
import {
  convertVertexToBezier,
  convertVertexToCorner,
  removeVertex,
} from '../utils/mask-path-utils'
import { cloneVertices } from './mask-editor-overlay-utils'

export type VertexConversionMode = 'corner' | 'bezier'

/** Vertex indices the current selection resolves to, filtered to existing vertices. */
export function resolveSelectedVertexTargets(params: {
  selectedVertexIndices: readonly number[]
  selectedVertexIndex: number | null
  vertexCount: number
}): number[] {
  const { selectedVertexIndices, selectedVertexIndex, vertexCount } = params
  if (selectedVertexIndices.length > 0) {
    return selectedVertexIndices.filter((index) => isExistingVertexIndex(index, vertexCount))
  }

  return isExistingVertexIndex(selectedVertexIndex, vertexCount) ? [selectedVertexIndex] : []
}

function isExistingVertexIndex(index: number | null, vertexCount: number): index is number {
  return index !== null && Number.isInteger(index) && index >= 0 && index < vertexCount
}

/** The remaining selection once `removedIndices` are deleted, with indices shifted down. */
export function resolveSelectionAfterVertexRemoval(params: {
  selectedVertexIndices: readonly number[]
  selectedVertexIndex: number | null
  removedIndices: readonly number[]
}): { indices: number[]; primaryIndex: number | null } {
  const { selectedVertexIndices, selectedVertexIndex, removedIndices } = params
  const removed = new Set(removedIndices)
  const indices = selectedVertexIndices
    .filter((index) => !removed.has(index))
    .map((index) => index - removedIndices.filter((removedIndex) => removedIndex < index).length)
  const shiftedPrimary =
    selectedVertexIndex === null || removed.has(selectedVertexIndex)
      ? null
      : selectedVertexIndex -
        removedIndices.filter((removedIndex) => removedIndex < selectedVertexIndex).length
  const primaryIndex =
    shiftedPrimary !== null && indices.includes(shiftedPrimary)
      ? shiftedPrimary
      : (indices[indices.length - 1] ?? null)

  return { indices, primaryIndex }
}

/**
 * Delete `indices` from the path, highest index first so earlier splices do not
 * move the indices still to be removed. Returns null when the path would drop
 * below `minimumVertices`.
 */
export function removeVerticesAtIndices(
  vertices: MaskVertex[],
  indices: readonly number[],
  minimumVertices: number,
): MaskVertex[] | null {
  let nextVertices: MaskVertex[] | null = vertices

  for (const index of [...indices].sort((a, b) => b - a)) {
    if (!nextVertices) {
      return null
    }

    nextVertices = removeVertex(nextVertices, index, minimumVertices)
  }

  return nextVertices
}

/**
 * Convert every target vertex, cloning the untouched vertices.
 *
 * The converters already hand back freshly cloned vertices for a valid index, so
 * the converted entries are assigned as-is instead of being copied again.
 */
export function convertVerticesAtIndices(params: {
  vertices: MaskVertex[]
  targetIndices: readonly number[]
  mode: VertexConversionMode
  closed: boolean
}): MaskVertex[] {
  const { vertices, targetIndices, mode, closed } = params
  const converted = cloneVertices(vertices)

  for (const index of targetIndices) {
    const nextVertices =
      mode === 'corner'
        ? convertVertexToCorner(vertices, index)
        : convertVertexToBezier(vertices, index, closed)
    const nextVertex = nextVertices[index]
    if (nextVertex) {
      converted[index] = nextVertex
    }
  }

  return converted
}

/** Whether a pending convert-selected-vertex request is ready to run this render. */
export function shouldHandleConvertVertexRequest(params: {
  isEditing: boolean
  penMode: boolean
  requestVersion: number
  handledVersion: number
  draggingVertexIndex: number | null
  draggingHandle: 'in' | 'out' | null
}): boolean {
  const {
    isEditing,
    penMode,
    requestVersion,
    handledVersion,
    draggingVertexIndex,
    draggingHandle,
  } = params
  if (!isEditing || penMode) {
    return false
  }

  if (requestVersion === 0 || requestVersion === handledVersion) {
    return false
  }

  return draggingVertexIndex === null && draggingHandle === null
}
