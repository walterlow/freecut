/**
 * Corner Pin Utilities
 *
 * Computes CSS matrix3d transforms and Canvas2D mesh-based rendering
 * for perspective warp (4-corner pin distortion).
 *
 * Corner pin offsets are in item-local pixel space:
 * - topLeft: offset from (0, 0)
 * - topRight: offset from (width, 0)
 * - bottomRight: offset from (width, height)
 * - bottomLeft: offset from (0, height)
 * When all offsets are [0, 0], there is no distortion.
 */

export interface CornerPinOffsets {
  topLeft: [number, number];
  topRight: [number, number];
  bottomRight: [number, number];
  bottomLeft: [number, number];
}

/** Check if corner pin has any non-zero offset */
export function hasCornerPin(pin: CornerPinOffsets | undefined): boolean {
  if (!pin) return false;
  return (
    pin.topLeft[0] !== 0 || pin.topLeft[1] !== 0 ||
    pin.topRight[0] !== 0 || pin.topRight[1] !== 0 ||
    pin.bottomRight[0] !== 0 || pin.bottomRight[1] !== 0 ||
    pin.bottomLeft[0] !== 0 || pin.bottomLeft[1] !== 0
  );
}

/**
 * Compute 3x3 homography matrix (flattened as 9-element array)
 * that maps from source rect (0,0)-(w,h) to corner-pinned quad.
 */
function computeHomography(
  w: number,
  h: number,
  pin: CornerPinOffsets,
): number[] {
  // Destination corners
  const x0 = pin.topLeft[0];
  const y0 = pin.topLeft[1];
  const x1 = w + pin.topRight[0];
  const y1 = pin.topRight[1];
  const x2 = w + pin.bottomRight[0];
  const y2 = h + pin.bottomRight[1];
  const x3 = pin.bottomLeft[0];
  const y3 = h + pin.bottomLeft[1];

  // Compute unit-square-to-quad homography
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const sx = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const sy = y0 - y1 + y2 - y3;

  const det = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(det) < 1e-10) {
    return [1, 0, 0, 0, 1, 0, 0, 0, 1]; // Identity (degenerate)
  }

  const g = (sx * dy2 - sy * dx2) / det;
  const hCoeff = (dx1 * sy - dy1 * sx) / det;

  // Scale from rect to unit square: divide column 0 by w, column 1 by h
  const a = (x1 - x0 + g * x1) / w;
  const b = (x3 - x0 + hCoeff * x3) / h;
  const c = x0;
  const d = (y1 - y0 + g * y1) / w;
  const e = (y3 - y0 + hCoeff * y3) / h;
  const f = y0;

  return [a, b, c, d, e, f, g / w, hCoeff / h, 1];
}

/**
 * Compute CSS matrix3d string for a corner pin distortion.
 *
 * The returned matrix3d should be used with transformOrigin: '0 0'.
 */
export function computeCornerPinMatrix3d(
  w: number,
  h: number,
  pin: CornerPinOffsets,
): string {
  const H = computeHomography(w, h, pin);
  // CSS matrix3d (column-major):
  // matrix3d(m00, m10, 0, m20, m01, m11, 0, m21, 0, 0, 1, 0, m02, m12, 0, m22)
  return `matrix3d(${H[0]},${H[3]},0,${H[6]},${H[1]},${H[4]},0,${H[7]},0,0,1,0,${H[2]},${H[5]},0,${H[8]})`;
}

/**
 * Apply a 3x3 homography to a 2D point.
 */
function projectPoint(
  H: number[],
  x: number,
  y: number,
): [number, number] {
  const pw = H[6]! * x + H[7]! * y + H[8]!;
  if (Math.abs(pw) < 1e-10) return [x, y];
  return [
    (H[0]! * x + H[1]! * y + H[2]!) / pw,
    (H[3]! * x + H[4]! * y + H[5]!) / pw,
  ];
}

/**
 * Draw a textured triangle by computing the affine transform
 * that maps source triangle to destination triangle, then clipping and drawing.
 */
function drawTexturedTriangle(
  ctx: OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  sx0: number, sy0: number,
  sx1: number, sy1: number,
  sx2: number, sy2: number,
  dx0: number, dy0: number,
  dx1: number, dy1: number,
  dx2: number, dy2: number,
): void {
  ctx.save();

  // Expand clip triangle slightly outward from centroid to eliminate
  // anti-aliasing seams between adjacent mesh triangles.
  const cx = (dx0 + dx1 + dx2) / 3;
  const cy = (dy0 + dy1 + dy2) / 3;
  const EXPAND = 1.5;
  const expand = (vx: number, vy: number): [number, number] => {
    const ox = vx - cx;
    const oy = vy - cy;
    const len = Math.sqrt(ox * ox + oy * oy);
    if (len < 1e-6) return [vx, vy];
    return [vx + (ox / len) * EXPAND, vy + (oy / len) * EXPAND];
  };
  const [ex0, ey0] = expand(dx0, dy0);
  const [ex1, ey1] = expand(dx1, dy1);
  const [ex2, ey2] = expand(dx2, dy2);

  // Clip to expanded destination triangle
  ctx.beginPath();
  ctx.moveTo(ex0, ey0);
  ctx.lineTo(ex1, ey1);
  ctx.lineTo(ex2, ey2);
  ctx.closePath();
  ctx.clip();

  // Solve for affine: [dx] = [a c e] * [sx, sy, 1]^T
  const det = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
  if (Math.abs(det) < 1e-10) {
    ctx.restore();
    return;
  }
  const invDet = 1 / det;

  const a = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) * invDet;
  const b = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) * invDet;
  const c = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) * invDet;
  const d = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) * invDet;
  const e2 = (dx0 * (sx1 * sy2 - sx2 * sy1) + dx1 * (sx2 * sy0 - sx0 * sy2) + dx2 * (sx0 * sy1 - sx1 * sy0)) * invDet;
  const f = (dy0 * (sx1 * sy2 - sx2 * sy1) + dy1 * (sx2 * sy0 - sx0 * sy2) + dy2 * (sx0 * sy1 - sx1 * sy0)) * invDet;

  ctx.setTransform(a, b, c, d, e2, f);
  ctx.drawImage(source, 0, 0);
  ctx.restore();
}

/**
 * Draw an image warped by corner pin onto a canvas using mesh subdivision.
 *
 * @param ctx - Destination canvas context
 * @param source - Source image/canvas to warp
 * @param srcW - Source width
 * @param srcH - Source height
 * @param dstX - Destination X offset (item position on canvas)
 * @param dstY - Destination Y offset
 * @param pin - Corner pin offsets
 * @param subdivisions - Grid subdivision count (higher = smoother, 16 is good)
 */
export function drawCornerPinImage(
  ctx: OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  dstX: number,
  dstY: number,
  pin: CornerPinOffsets,
  subdivisions: number = 16,
): void {
  const H = computeHomography(srcW, srcH, pin);

  for (let row = 0; row < subdivisions; row++) {
    for (let col = 0; col < subdivisions; col++) {
      const sx0 = (col / subdivisions) * srcW;
      const sy0 = (row / subdivisions) * srcH;
      const sx1 = ((col + 1) / subdivisions) * srcW;
      const sy1 = ((row + 1) / subdivisions) * srcH;

      const [px0, py0] = projectPoint(H, sx0, sy0);
      const [px1, py1] = projectPoint(H, sx1, sy0);
      const [px2, py2] = projectPoint(H, sx1, sy1);
      const [px3, py3] = projectPoint(H, sx0, sy1);

      // Triangle 1: top-left diagonal
      drawTexturedTriangle(
        ctx, source,
        sx0, sy0, sx1, sy0, sx1, sy1,
        dstX + px0, dstY + py0,
        dstX + px1, dstY + py1,
        dstX + px2, dstY + py2,
      );
      // Triangle 2: bottom-right diagonal
      drawTexturedTriangle(
        ctx, source,
        sx0, sy0, sx1, sy1, sx0, sy1,
        dstX + px0, dstY + py0,
        dstX + px2, dstY + py2,
        dstX + px3, dstY + py3,
      );
    }
  }
}
