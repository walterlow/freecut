/**
 * Path utilities for the bezier mask editor used by shape masks.
 */

import type { MaskVertex } from '@/types/masks';

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
