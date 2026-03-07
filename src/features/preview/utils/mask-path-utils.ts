/**
 * Mask path utilities for the bezier mask editor.
 *
 * Generates preset mask shapes and converts ClipMask vertices
 * to SVG path strings for rendering.
 */

import type { ClipMask, MaskVertex } from '@/types/masks';

let maskIdCounter = 0;

/** Generate a unique mask ID */
export function generateMaskId(): string {
  return `mask-${Date.now()}-${maskIdCounter++}`;
}

/**
 * Create a rectangular mask covering the full item bounds.
 * Vertices are in normalized 0-1 space relative to item bounds.
 * Inset by a small margin so the mask is visible as a distinct shape.
 */
export function createRectangleMask(inset = 0.1): ClipMask {
  return {
    id: generateMaskId(),
    vertices: [
      { position: [inset, inset], inHandle: [0, 0], outHandle: [0, 0] },
      { position: [1 - inset, inset], inHandle: [0, 0], outHandle: [0, 0] },
      { position: [1 - inset, 1 - inset], inHandle: [0, 0], outHandle: [0, 0] },
      { position: [inset, 1 - inset], inHandle: [0, 0], outHandle: [0, 0] },
    ],
    mode: 'add',
    opacity: 1,
    feather: 0,
    inverted: false,
    enabled: true,
  };
}

/**
 * Create an elliptical mask inscribed in the item bounds.
 * Uses 4 vertices with bezier handles approximating a circle.
 * The magic number 0.5522847498 (kappa) gives the best cubic bezier circle approx.
 */
export function createEllipseMask(inset = 0.05): ClipMask {
  const k = 0.5522847498;
  const cx = 0.5;
  const cy = 0.5;
  const rx = 0.5 - inset;
  const ry = 0.5 - inset;
  const kx = rx * k;
  const ky = ry * k;

  return {
    id: generateMaskId(),
    vertices: [
      { position: [cx, cy - ry], inHandle: [-kx, 0], outHandle: [kx, 0] },     // top
      { position: [cx + rx, cy], inHandle: [0, -ky], outHandle: [0, ky] },      // right
      { position: [cx, cy + ry], inHandle: [kx, 0], outHandle: [-kx, 0] },      // bottom
      { position: [cx - rx, cy], inHandle: [0, ky], outHandle: [0, -ky] },      // left
    ],
    mode: 'add',
    opacity: 1,
    feather: 0,
    inverted: false,
    enabled: true,
  };
}

/**
 * Convert ClipMask vertices to an SVG path string.
 * Vertices are in normalized 0-1 space; width/height scale to pixel space.
 */
export function maskVerticesToSvgPath(
  vertices: MaskVertex[],
  width: number,
  height: number,
): string {
  if (vertices.length < 2) return '';

  const parts: string[] = [];
  const first = vertices[0]!;
  parts.push(`M ${first.position[0] * width} ${first.position[1] * height}`);

  for (let i = 0; i < vertices.length; i++) {
    const curr = vertices[i]!;
    const next = vertices[(i + 1) % vertices.length]!;

    const outH = curr.outHandle;
    const inH = next.inHandle;

    const isStraight =
      outH[0] === 0 && outH[1] === 0 && inH[0] === 0 && inH[1] === 0;

    if (isStraight) {
      parts.push(`L ${next.position[0] * width} ${next.position[1] * height}`);
    } else {
      const cp1x = (curr.position[0] + outH[0]) * width;
      const cp1y = (curr.position[1] + outH[1]) * height;
      const cp2x = (next.position[0] + inH[0]) * width;
      const cp2y = (next.position[1] + inH[1]) * height;
      parts.push(
        `C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${next.position[0] * width} ${next.position[1] * height}`
      );
    }
  }

  parts.push('Z');
  return parts.join(' ');
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
