interface CurvePoint {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatCoord(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function computeMonotoneTangents(points: CurvePoint[]): number[] {
  if (points.length <= 1) return [0];

  const segmentCount = points.length - 1;
  const slopes = new Array<number>(segmentCount);
  for (let i = 0; i < segmentCount; i += 1) {
    const left = points[i]!;
    const right = points[i + 1]!;
    const width = Math.max(0.000001, right.x - left.x);
    slopes[i] = (right.y - left.y) / width;
  }

  const tangents = new Array<number>(points.length);
  tangents[0] = slopes[0]!;
  tangents[points.length - 1] = slopes[segmentCount - 1]!;

  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = slopes[i - 1]!;
    const next = slopes[i]!;
    tangents[i] = prev * next <= 0 ? 0 : (prev + next) / 2;
  }

  // Fritsch-Carlson slope limiter to preserve monotonicity.
  for (let i = 0; i < segmentCount; i += 1) {
    const slope = slopes[i]!;
    if (Math.abs(slope) < 0.000001) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }

    const a = tangents[i]! / slope;
    const b = tangents[i + 1]! / slope;
    const magnitude = a * a + b * b;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[i] = scale * a * slope;
      tangents[i + 1] = scale * b * slope;
    }
  }

  return tangents;
}

export function normalizeCurvePoints(points: CurvePoint[] | undefined): CurvePoint[] {
  if (!points || points.length === 0) {
    return [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  }

  const sorted = points
    .map((point) => ({
      x: clamp(point.x, 0, 1),
      y: clamp(point.y, 0, 1),
    }))
    .sort((a, b) => a.x - b.x);

  const deduped: CurvePoint[] = [];
  for (const point of sorted) {
    const prev = deduped[deduped.length - 1];
    if (!prev || Math.abs(prev.x - point.x) > 0.0005) {
      deduped.push(point);
    }
  }

  if (deduped.length === 0) {
    return [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  }

  if (deduped[0]!.x > 0.0001) {
    deduped.unshift({ x: 0, y: deduped[0]!.y });
  } else {
    deduped[0] = { x: 0, y: deduped[0]!.y };
  }

  const last = deduped[deduped.length - 1]!;
  if (last.x < 0.9999) {
    deduped.push({ x: 1, y: last.y });
  } else if (Math.abs(last.x - 1) > 0.0001) {
    deduped[deduped.length - 1] = { x: 1, y: last.y };
  }

  return deduped;
}

export function evaluateMonotoneCurve(points: CurvePoint[] | undefined, x: number): number {
  const normalized = normalizeCurvePoints(points);
  const input = clamp(x, 0, 1);

  if (input <= normalized[0]!.x) return normalized[0]!.y;
  if (input >= normalized[normalized.length - 1]!.x) return normalized[normalized.length - 1]!.y;

  let segmentIndex = normalized.length - 2;
  for (let i = 0; i < normalized.length - 1; i += 1) {
    const left = normalized[i]!;
    const right = normalized[i + 1]!;
    if (input >= left.x && input <= right.x) {
      segmentIndex = i;
      break;
    }
  }

  const left = normalized[segmentIndex]!;
  const right = normalized[segmentIndex + 1]!;
  const width = Math.max(0.000001, right.x - left.x);
  const t = clamp((input - left.x) / width, 0, 1);
  const t2 = t * t;
  const t3 = t2 * t;
  const tangents = computeMonotoneTangents(normalized);
  const m0 = tangents[segmentIndex]!;
  const m1 = tangents[segmentIndex + 1]!;

  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  const y =
    h00 * left.y
    + h10 * width * m0
    + h01 * right.y
    + h11 * width * m1;

  return clamp(y, 0, 1);
}

export function buildMonotoneCurveSvgPath(
  points: CurvePoint[] | undefined,
  width: number,
  height: number
): string {
  const normalized = normalizeCurvePoints(points);
  if (normalized.length === 0) return '';

  const tangents = computeMonotoneTangents(normalized);
  const toX = (x: number) => x * width;
  const toY = (y: number) => (1 - y) * height;

  let path = `M ${formatCoord(toX(normalized[0]!.x))} ${formatCoord(toY(normalized[0]!.y))}`;

  for (let i = 0; i < normalized.length - 1; i += 1) {
    const left = normalized[i]!;
    const right = normalized[i + 1]!;
    const span = right.x - left.x;
    const cp1x = left.x + span / 3;
    const cp1y = left.y + (tangents[i]! * span) / 3;
    const cp2x = right.x - span / 3;
    const cp2y = right.y - (tangents[i + 1]! * span) / 3;

    path += ` C ${formatCoord(toX(cp1x))} ${formatCoord(toY(cp1y))} ${formatCoord(toX(cp2x))} ${formatCoord(toY(cp2y))} ${formatCoord(toX(right.x))} ${formatCoord(toY(right.y))}`;
  }

  return path;
}
