/**
 * Path utilities for the bezier mask editor used by shape masks.
 */

import type { MaskVertex } from '@/types/masks';

const DEFAULT_BEZIER_HANDLE_SCALE = 0.25;

function cloneVertex(vertex: MaskVertex): MaskVertex {
  return {
    position: [...vertex.position] as [number, number],
    inHandle: [...vertex.inHandle] as [number, number],
    outHandle: [...vertex.outHandle] as [number, number],
  };
}

function getVectorLength([x, y]: readonly [number, number]): number {
  return Math.hypot(x, y);
}

function normalizeVector([x, y]: readonly [number, number]): [number, number] {
  const length = Math.hypot(x, y);
  if (length <= Number.EPSILON) {
    return [0, 0];
  }
  return [x / length, y / length];
}

function getSmoothTangentDirection(
  prevPosition: readonly [number, number],
  currentPosition: readonly [number, number],
  nextPosition: readonly [number, number]
): [number, number] {
  const incoming = normalizeVector([
    currentPosition[0] - prevPosition[0],
    currentPosition[1] - prevPosition[1],
  ]);
  const outgoing = normalizeVector([
    nextPosition[0] - currentPosition[0],
    nextPosition[1] - currentPosition[1],
  ]);
  const combined = normalizeVector([
    incoming[0] + outgoing[0],
    incoming[1] + outgoing[1],
  ]);

  if (combined[0] !== 0 || combined[1] !== 0) {
    return combined;
  }

  if (outgoing[0] !== 0 || outgoing[1] !== 0) {
    return outgoing;
  }

  return incoming;
}

/**
 * Convert a screen position to normalized mask vertex coordinates.
 * Takes item bounds (in canvas space) and converts a canvas-space point
 * to 0-1 normalized coordinates relative to the item.
 */
export function canvasToMaskCoords(
  canvasX: number,
  canvasY: number,
  itemLeft: number,
  itemTop: number,
  itemWidth: number,
  itemHeight: number,
): [number, number] {
  return [
    (canvasX - itemLeft) / itemWidth,
    (canvasY - itemTop) / itemHeight,
  ];
}

/**
 * Convert normalized mask coordinates to canvas-space pixel position.
 */
export function maskToCanvasCoords(
  nx: number,
  ny: number,
  itemLeft: number,
  itemTop: number,
  itemWidth: number,
  itemHeight: number,
): [number, number] {
  return [
    itemLeft + nx * itemWidth,
    itemTop + ny * itemHeight,
  ];
}

/**
 * Insert a new vertex on the mask path segment between two existing vertices.
 * Returns a new vertices array with the vertex inserted at the midpoint.
 */
export function insertVertexBetween(
  vertices: MaskVertex[],
  afterIndex: number,
): MaskVertex[] {
  const curr = vertices[afterIndex]!;
  const next = vertices[(afterIndex + 1) % vertices.length]!;

  // Midpoint position
  const mx = (curr.position[0] + next.position[0]) / 2;
  const my = (curr.position[1] + next.position[1]) / 2;

  const newVertex: MaskVertex = {
    position: [mx, my],
    inHandle: [0, 0],
    outHandle: [0, 0],
  };

  const result = [...vertices];
  result.splice(afterIndex + 1, 0, newVertex);
  return result;
}

/**
 * Convert a vertex to a sharp corner by removing both bezier handles.
 */
export function convertVertexToCorner(
  vertices: MaskVertex[],
  index: number,
): MaskVertex[] {
  if (index < 0 || index >= vertices.length) {
    return vertices;
  }

  const result = vertices.map(cloneVertex);
  result[index] = {
    ...result[index]!,
    inHandle: [0, 0],
    outHandle: [0, 0],
  };
  return result;
}

/**
 * Convert a vertex to a smooth bezier knot.
 *
 * Existing handle lengths are preserved when present. If the knot is currently
 * a corner, new handle lengths are synthesized from neighboring segment lengths.
 */
export function convertVertexToBezier(
  vertices: MaskVertex[],
  index: number,
): MaskVertex[] {
  if (vertices.length < 2 || index < 0 || index >= vertices.length) {
    return vertices;
  }

  const result = vertices.map(cloneVertex);
  const vertex = result[index]!;
  const prev = result[(index - 1 + result.length) % result.length]!;
  const next = result[(index + 1) % result.length]!;

  const existingInLength = getVectorLength(vertex.inHandle);
  const existingOutLength = getVectorLength(vertex.outHandle);
  const prevDistance = Math.hypot(
    vertex.position[0] - prev.position[0],
    vertex.position[1] - prev.position[1]
  );
  const nextDistance = Math.hypot(
    next.position[0] - vertex.position[0],
    next.position[1] - vertex.position[1]
  );
  const inLength = existingInLength || prevDistance * DEFAULT_BEZIER_HANDLE_SCALE;
  const outLength = existingOutLength || nextDistance * DEFAULT_BEZIER_HANDLE_SCALE;

  const existingInDirection = existingInLength > 0
    ? normalizeVector([-vertex.inHandle[0], -vertex.inHandle[1]])
    : null;
  const existingOutDirection = existingOutLength > 0
    ? normalizeVector(vertex.outHandle)
    : null;

  const combinedExistingDirection = existingInDirection && existingOutDirection
    ? normalizeVector([
        existingInDirection[0] + existingOutDirection[0],
        existingInDirection[1] + existingOutDirection[1],
      ])
    : null;

  const direction =
    (combinedExistingDirection && (combinedExistingDirection[0] !== 0 || combinedExistingDirection[1] !== 0))
      ? combinedExistingDirection
      : existingOutDirection
        ?? existingInDirection
        ?? getSmoothTangentDirection(prev.position, vertex.position, next.position);

  if (direction[0] === 0 && direction[1] === 0) {
    return convertVertexToCorner(result, index);
  }

  vertex.inHandle = [-direction[0] * inLength, -direction[1] * inLength];
  vertex.outHandle = [direction[0] * outLength, direction[1] * outLength];
  return result;
}

/**
 * Remove a vertex from the mask path.
 * Returns null if removing would leave fewer than 3 vertices.
 */
export function removeVertex(
  vertices: MaskVertex[],
  index: number,
): MaskVertex[] | null {
  if (vertices.length <= 3) return null;
  const result = [...vertices];
  result.splice(index, 1);
  return result;
}
