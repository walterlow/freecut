/**
 * Native SVG shape generators to replace @legacy-video/shapes
 *
 * Generates SVG path strings for common shapes.
 * All paths are generated at origin (0,0) and can be translated/scaled as needed.
 */

interface ShapeResult {
  path: string;
  width: number;
  height: number;
}

/**
 * Generate a rectangle path
 */
export function makeRect(options: {
  width: number;
  height: number;
  cornerRadius?: number;
}): ShapeResult {
  const { width, height, cornerRadius = 0 } = options;
  const r = Math.min(cornerRadius, width / 2, height / 2);

  let path: string;
  if (r > 0) {
    // Rounded rectangle
    path =
      `M ${r} 0 ` +
      `L ${width - r} 0 ` +
      `A ${r} ${r} 0 0 1 ${width} ${r} ` +
      `L ${width} ${height - r} ` +
      `A ${r} ${r} 0 0 1 ${width - r} ${height} ` +
      `L ${r} ${height} ` +
      `A ${r} ${r} 0 0 1 0 ${height - r} ` +
      `L 0 ${r} ` +
      `A ${r} ${r} 0 0 1 ${r} 0 Z`;
  } else {
    // Sharp rectangle
    path = `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`;
  }

  return { path, width, height };
}

/**
 * Generate a circle path
 */
export function makeCircle(options: { radius: number }): ShapeResult {
  const { radius } = options;
  const diameter = radius * 2;

  // Circle using two arcs
  const path =
    `M ${radius} 0 ` +
    `A ${radius} ${radius} 0 1 1 ${radius} ${diameter} ` +
    `A ${radius} ${radius} 0 1 1 ${radius} 0 Z`;

  return { path, width: diameter, height: diameter };
}

/**
 * Generate an ellipse path
 */
export function makeEllipse(options: { rx: number; ry: number }): ShapeResult {
  const { rx, ry } = options;
  const width = rx * 2;
  const height = ry * 2;

  // Ellipse using two arcs
  const path =
    `M ${rx} 0 ` +
    `A ${rx} ${ry} 0 1 1 ${rx} ${height} ` +
    `A ${rx} ${ry} 0 1 1 ${rx} 0 Z`;

  return { path, width, height };
}

/**
 * Generate a triangle path
 */
export function makeTriangle(options: {
  length: number;
  direction?: 'up' | 'down' | 'left' | 'right';
  cornerRadius?: number;
}): ShapeResult {
  const { length, direction = 'up', cornerRadius = 0 } = options;

  // Equilateral triangle dimensions
  const height = (length * Math.sqrt(3)) / 2;

  let points: [number, number][];
  let width: number;
  let h: number;

  switch (direction) {
    case 'up':
      width = length;
      h = height;
      points = [
        [length / 2, 0],
        [length, height],
        [0, height],
      ];
      break;
    case 'down':
      width = length;
      h = height;
      points = [
        [0, 0],
        [length, 0],
        [length / 2, height],
      ];
      break;
    case 'left':
      width = height;
      h = length;
      points = [
        [height, 0],
        [height, length],
        [0, length / 2],
      ];
      break;
    case 'right':
      width = height;
      h = length;
      points = [
        [0, 0],
        [height, length / 2],
        [0, length],
      ];
      break;
  }

  const path = cornerRadius > 0 ? makeRoundedPolygonPath(points, cornerRadius) : makePolygonPath(points);

  return { path, width, height: h };
}

/**
 * Generate a star path
 */
export function makeStar(options: {
  points: number;
  outerRadius: number;
  innerRadius: number;
  cornerRadius?: number;
}): ShapeResult {
  const { points, outerRadius, innerRadius, cornerRadius = 0 } = options;
  const diameter = outerRadius * 2;

  const vertices: [number, number][] = [];
  const angleStep = Math.PI / points;

  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = i * angleStep - Math.PI / 2; // Start from top
    const x = outerRadius + radius * Math.cos(angle);
    const y = outerRadius + radius * Math.sin(angle);
    vertices.push([x, y]);
  }

  const path = cornerRadius > 0 ? makeRoundedPolygonPath(vertices, cornerRadius) : makePolygonPath(vertices);

  return { path, width: diameter, height: diameter };
}

/**
 * Generate a regular polygon path
 */
export function makePolygon(options: {
  points: number;
  radius: number;
  cornerRadius?: number;
}): ShapeResult {
  const { points, radius, cornerRadius = 0 } = options;
  const diameter = radius * 2;

  const vertices: [number, number][] = [];
  const angleStep = (Math.PI * 2) / points;

  for (let i = 0; i < points; i++) {
    const angle = i * angleStep - Math.PI / 2; // Start from top
    const x = radius + radius * Math.cos(angle);
    const y = radius + radius * Math.sin(angle);
    vertices.push([x, y]);
  }

  const path = cornerRadius > 0 ? makeRoundedPolygonPath(vertices, cornerRadius) : makePolygonPath(vertices);

  return { path, width: diameter, height: diameter };
}

/**
 * Generate a heart path
 * Port of Composition's makeHeart algorithm using 7 cubic bezier segments.
 * The heart width equals height * 1.1.
 */
export function makeHeart(options: { height: number }): ShapeResult {
  const { height } = options;
  const width = height * 1.1;

  const bottomControlPointX = (23 / 110) * width;
  const bottomControlPointY = (69 / 100) * height;
  const bottomLeftControlPointY = (60 / 100) * height;
  const topLeftControlPoint = (13 / 100) * height;
  const topBezierWidth = (29 / 110) * width;
  const topRightControlPointX = (15 / 110) * width;
  const innerControlPointX = (5 / 110) * width;
  const innerControlPointY = (7 / 100) * height;
  const depth = (17 / 100) * height;

  const path = [
    // Start at bottom tip
    `M ${width / 2} ${height}`,
    // Bottom-left curve up to left side
    `C ${width / 2 - bottomControlPointX} ${bottomControlPointY}, 0 ${bottomLeftControlPointY}, 0 ${height / 4}`,
    // Left lobe: up to top-left peak
    `C 0 ${topLeftControlPoint}, ${width / 4 - topBezierWidth / 2} 0, ${width / 4} 0`,
    // Left lobe inner: down to center dip
    `C ${width / 4 + topBezierWidth / 2} 0, ${width / 2 - innerControlPointX} ${innerControlPointY}, ${width / 2} ${depth}`,
    // Right lobe inner: up from center dip to top-right peak
    `C ${width / 2 + innerControlPointX} ${innerControlPointY}, ${width / 2 + topRightControlPointX} 0, ${(width / 4) * 3} 0`,
    // Right lobe: from top-right peak down to right side
    `C ${(width / 4) * 3 + topBezierWidth / 2} 0, ${width} ${topLeftControlPoint}, ${width} ${height / 4}`,
    // Bottom-right curve down to bottom tip
    `C ${width} ${bottomLeftControlPointY}, ${width / 2 + bottomControlPointX} ${bottomControlPointY}, ${width / 2} ${height}`,
    'Z',
  ].join(' ');

  return { path, width, height };
}

/**
 * Helper: Create a simple polygon path from points
 */
function makePolygonPath(points: [number, number][]): string {
  if (points.length < 3) return '';

  const [first, ...rest] = points;
  const commands = [`M ${first![0]} ${first![1]}`];

  for (const [x, y] of rest) {
    commands.push(`L ${x} ${y}`);
  }

  commands.push('Z');
  return commands.join(' ');
}

/**
 * Helper: Create a rounded polygon path from points
 */
function makeRoundedPolygonPath(points: [number, number][], radius: number): string {
  if (points.length < 3) return '';

  const commands: string[] = [];
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const curr = points[i]!;
    const prev = points[(i - 1 + n) % n]!;
    const next = points[(i + 1) % n]!;

    // Vector from current to previous
    const dx1 = prev[0] - curr[0];
    const dy1 = prev[1] - curr[1];
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);

    // Vector from current to next
    const dx2 = next[0] - curr[0];
    const dy2 = next[1] - curr[1];
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

    // Clamp radius to half the shorter edge
    const maxRadius = Math.min(len1, len2) / 2;
    const r = Math.min(radius, maxRadius);

    // Points where the rounding starts/ends
    const startX = curr[0] + (dx1 / len1) * r;
    const startY = curr[1] + (dy1 / len1) * r;
    const endX = curr[0] + (dx2 / len2) * r;
    const endY = curr[1] + (dy2 / len2) * r;

    if (i === 0) {
      commands.push(`M ${startX} ${startY}`);
    } else {
      commands.push(`L ${startX} ${startY}`);
    }

    // Quadratic curve through the corner
    commands.push(`Q ${curr[0]} ${curr[1]} ${endX} ${endY}`);
  }

  commands.push('Z');
  return commands.join(' ');
}
