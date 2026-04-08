import type { MaskVertex } from '@/types/masks';
import type { TimelineTrack } from '@/types/timeline';
import type { Transform } from '../types/gizmo';

const SELECTED_VERTEX_RING_RADIUS = 8;
const TRACK_NUMBER_REGEX = /^Track\s+(\d+)$/i;

export const MASK_GEOMETRY_TRANSFORM_PROPS = ['x', 'y', 'width', 'height'] as const;

export function cloneVertices(vertices: MaskVertex[]): MaskVertex[] {
  return vertices.map((vertex) => ({
    position: [...vertex.position] as [number, number],
    inHandle: [...vertex.inHandle] as [number, number],
    outHandle: [...vertex.outHandle] as [number, number],
  }));
}

export function drawSelectedVertexRing(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number
): void {
  ctx.beginPath();
  ctx.arc(centerX, centerY, SELECTED_VERTEX_RING_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(251, 191, 36, 0.18)';
  ctx.fill();
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

export function getNextTrackName(tracks: ReadonlyArray<TimelineTrack>): string {
  const existingNumbers = new Set<number>();

  for (const track of tracks) {
    const match = track.name.match(TRACK_NUMBER_REGEX);
    if (!match?.[1]) {
      continue;
    }

    const trackNumber = Number.parseInt(match[1], 10);
    if (Number.isFinite(trackNumber) && trackNumber > 0) {
      existingNumbers.add(trackNumber);
    }
  }

  let nextTrackNumber = 1;
  while (existingNumbers.has(nextTrackNumber)) {
    nextTrackNumber++;
  }

  return `Track ${nextTrackNumber}`;
}

export function cubicPointAt(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number
): number {
  const invT = 1 - t;
  return (
    invT * invT * invT * p0
    + 3 * invT * invT * t * p1
    + 3 * invT * t * t * p2
    + t * t * t * p3
  );
}

export function isPointInPolygon(
  x: number,
  y: number,
  polygon: ReadonlyArray<readonly [number, number]>
): boolean {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    const intersects = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

export function distanceToLineSegment(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number
): number {
  const dx = endX - startX;
  const dy = endY - startY;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.hypot(pointX - startX, pointY - startY);
  }

  const t = Math.max(
    0,
    Math.min(1, ((pointX - startX) * dx + (pointY - startY) * dy) / lenSq)
  );
  const closestX = startX + t * dx;
  const closestY = startY + t * dy;
  return Math.hypot(pointX - closestX, pointY - closestY);
}

export function transformChanged(a: Transform, b: Transform): boolean {
  const tolerance = 0.01;
  return (
    Math.abs(a.x - b.x) > tolerance ||
    Math.abs(a.y - b.y) > tolerance ||
    Math.abs(a.width - b.width) > tolerance ||
    Math.abs(a.height - b.height) > tolerance ||
    Math.abs(a.rotation - b.rotation) > tolerance
  );
}

export function toOverlayTransform(
  transform: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    rotation?: number;
    opacity?: number;
    cornerRadius?: number;
    aspectRatioLocked?: boolean;
  },
  fallback: Transform
): Transform {
  return {
    x: transform.x ?? fallback.x,
    y: transform.y ?? fallback.y,
    width: transform.width ?? fallback.width,
    height: transform.height ?? fallback.height,
    rotation: transform.rotation ?? fallback.rotation,
    opacity: transform.opacity ?? fallback.opacity,
    cornerRadius: transform.cornerRadius ?? fallback.cornerRadius,
    aspectRatioLocked: transform.aspectRatioLocked ?? fallback.aspectRatioLocked,
  };
}
