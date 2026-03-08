import type { MaskVertex } from '@/types/masks';
import type { TransformProperties } from '@/types/transform';
import type { Transform } from '../types/gizmo';

const ROOT_EPSILON = 1e-10;

function cubicPointAt(
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

function cubicDerivativeRoots(
  p0: number,
  p1: number,
  p2: number,
  p3: number
): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 3 * p0 - 6 * p1 + 3 * p2;
  const c = -3 * p0 + 3 * p1;

  const qa = 3 * a;
  const qb = 2 * b;
  const qc = c;

  if (Math.abs(qa) < 1e-8) {
    if (Math.abs(qb) < 1e-8) return [];
    const t = -qc / qb;
    return t > 0 && t < 1 ? [t] : [];
  }

  const discriminant = qb * qb - 4 * qa * qc;
  if (discriminant < 0) return [];

  if (Math.abs(discriminant) < ROOT_EPSILON) {
    const t = -qb / (2 * qa);
    return t > 0 && t < 1 ? [t] : [];
  }

  const sqrtDiscriminant = Math.sqrt(discriminant);
  const t1 = (-qb + sqrtDiscriminant) / (2 * qa);
  const t2 = (-qb - sqrtDiscriminant) / (2 * qa);

  return [t1, t2]
    .filter((t) => t > 0 && t < 1)
    .filter((t, index, roots) =>
      roots.findIndex((candidate) => Math.abs(candidate - t) < ROOT_EPSILON) === index
    );
}

export function getPathBounds(vertices: MaskVertex[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  if (vertices.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const updateBounds = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  if (vertices.length === 1) {
    const [x, y] = vertices[0]!.position;
    updateBounds(x, y);
    return { minX, minY, maxX, maxY };
  }

  for (let i = 0; i < vertices.length; i++) {
    const curr = vertices[i]!;
    const next = vertices[(i + 1) % vertices.length]!;
    const p0x = curr.position[0];
    const p0y = curr.position[1];
    const p1x = curr.position[0] + curr.outHandle[0];
    const p1y = curr.position[1] + curr.outHandle[1];
    const p2x = next.position[0] + next.inHandle[0];
    const p2y = next.position[1] + next.inHandle[1];
    const p3x = next.position[0];
    const p3y = next.position[1];

    const samples = new Set<number>([
      0,
      1,
      ...cubicDerivativeRoots(p0x, p1x, p2x, p3x),
      ...cubicDerivativeRoots(p0y, p1y, p2y, p3y),
    ]);

    for (const t of samples) {
      updateBounds(
        cubicPointAt(p0x, p1x, p2x, p3x, t),
        cubicPointAt(p0y, p1y, p2y, p3y, t)
      );
    }
  }

  return { minX, minY, maxX, maxY };
}

export function fitShapePathToBounds(
  vertices: MaskVertex[],
  baseTransform: Transform,
  existingTransform?: TransformProperties
): {
  pathVertices: MaskVertex[];
  transform: TransformProperties;
} {
  const bounds = getPathBounds(vertices);
  if (!bounds) {
    return {
      pathVertices: vertices,
      transform: existingTransform ?? {},
    };
  }

  const baseWidth = Math.max(baseTransform.width, 1);
  const baseHeight = Math.max(baseTransform.height, 1);
  const spanX = Math.max(bounds.maxX - bounds.minX, 2 / baseWidth);
  const spanY = Math.max(bounds.maxY - bounds.minY, 2 / baseHeight);

  const localCenterX = ((bounds.minX + bounds.maxX) / 2 - 0.5) * baseTransform.width;
  const localCenterY = ((bounds.minY + bounds.maxY) / 2 - 0.5) * baseTransform.height;
  const rotationRad = (baseTransform.rotation * Math.PI) / 180;
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);

  return {
    pathVertices: vertices.map((vertex) => ({
      position: [
        (vertex.position[0] - bounds.minX) / spanX,
        (vertex.position[1] - bounds.minY) / spanY,
      ],
      inHandle: [
        vertex.inHandle[0] / spanX,
        vertex.inHandle[1] / spanY,
      ],
      outHandle: [
        vertex.outHandle[0] / spanX,
        vertex.outHandle[1] / spanY,
      ],
    })),
    transform: {
      ...existingTransform,
      x: baseTransform.x + localCenterX * cos - localCenterY * sin,
      y: baseTransform.y + localCenterX * sin + localCenterY * cos,
      width: Math.max(baseTransform.width * spanX, 2),
      height: Math.max(baseTransform.height * spanY, 2),
      rotation: baseTransform.rotation,
      opacity: baseTransform.opacity,
      cornerRadius: baseTransform.cornerRadius,
    },
  };
}
