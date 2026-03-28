/**
 * Corner Pin Mesh Generator
 *
 * CPU-side: generates a subdivided quad mesh with bilinearly-interpolated
 * vertex positions from 4 corner pin control points. The GPU just renders
 * the pre-computed vertices with texture sampling.
 *
 * Default subdivision: 16x16 = 256 quads = 1536 vertices (6 per quad).
 * Vertex format: [posX, posY, uvX, uvY] interleaved, 4 floats per vertex.
 */

export interface CornerPinCorners {
  topLeft: [number, number];
  topRight: [number, number];
  bottomRight: [number, number];
  bottomLeft: [number, number];
}

/** Default corners: identity (unit square, no warp) */
export const IDENTITY_CORNERS: CornerPinCorners = {
  topLeft: [0, 0],
  topRight: [1, 0],
  bottomRight: [1, 1],
  bottomLeft: [0, 1],
};

/**
 * Bilinear interpolation of 4 corners at normalized (s, t).
 * s: 0=left, 1=right. t: 0=top, 1=bottom.
 */
function bilinear(
  tl: [number, number],
  tr: [number, number],
  br: [number, number],
  bl: [number, number],
  s: number,
  t: number,
): [number, number] {
  const top: [number, number] = [
    tl[0] + (tr[0] - tl[0]) * s,
    tl[1] + (tr[1] - tl[1]) * s,
  ];
  const bot: [number, number] = [
    bl[0] + (br[0] - bl[0]) * s,
    bl[1] + (br[1] - bl[1]) * s,
  ];
  return [
    top[0] + (bot[0] - top[0]) * t,
    top[1] + (bot[1] - top[1]) * t,
  ];
}

/**
 * Convert normalized [0..1] position to clip space [-1..1].
 * Y is flipped for WebGPU (0=top in UV, -1=bottom in clip).
 */
function toClipSpace(x: number, y: number): [number, number] {
  return [x * 2 - 1, -(y * 2 - 1)];
}

/**
 * Generate a subdivided corner pin mesh.
 *
 * @param outputCorners - Where the quad corners map to on screen (normalized 0..1)
 * @param inputCorners - Where to sample the source texture (default: unit square)
 * @param subdivisions - Grid resolution per axis (default: 16)
 * @returns Interleaved Float32Array: [posX, posY, uvX, uvY] per vertex
 */
export function generateCornerPinMesh(
  outputCorners: CornerPinCorners,
  inputCorners: CornerPinCorners = IDENTITY_CORNERS,
  subdivisions = 16,
): Float32Array {
  const n = subdivisions;
  const vertexCount = n * n * 6; // 2 triangles per cell, 3 verts each
  const data = new Float32Array(vertexCount * 4); // 4 floats per vertex
  let offset = 0;

  function writeVertex(s: number, t: number): void {
    const [ox, oy] = bilinear(
      outputCorners.topLeft, outputCorners.topRight,
      outputCorners.bottomRight, outputCorners.bottomLeft,
      s, t,
    );
    const [cx, cy] = toClipSpace(ox, oy);
    const [uvx, uvy] = bilinear(
      inputCorners.topLeft, inputCorners.topRight,
      inputCorners.bottomRight, inputCorners.bottomLeft,
      s, t,
    );
    data[offset++] = cx;
    data[offset++] = cy;
    data[offset++] = uvx;
    data[offset++] = uvy;
  }

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const s0 = col / n;
      const s1 = (col + 1) / n;
      const t0 = row / n;
      const t1 = (row + 1) / n;

      // Triangle 1: TL, TR, BL
      writeVertex(s0, t0);
      writeVertex(s1, t0);
      writeVertex(s0, t1);

      // Triangle 2: BL, TR, BR
      writeVertex(s0, t1);
      writeVertex(s1, t0);
      writeVertex(s1, t1);
    }
  }

  return data;
}

/** Check if corners represent identity (no warp needed) */
export function isIdentityCornerPin(corners: CornerPinCorners): boolean {
  const eps = 0.001;
  return (
    Math.abs(corners.topLeft[0]) < eps && Math.abs(corners.topLeft[1]) < eps &&
    Math.abs(corners.topRight[0] - 1) < eps && Math.abs(corners.topRight[1]) < eps &&
    Math.abs(corners.bottomRight[0] - 1) < eps && Math.abs(corners.bottomRight[1] - 1) < eps &&
    Math.abs(corners.bottomLeft[0]) < eps && Math.abs(corners.bottomLeft[1] - 1) < eps
  );
}
