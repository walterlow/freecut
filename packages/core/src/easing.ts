export type BasicEasingType = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
export type AdvancedEasingType = 'cubic-bezier' | 'spring';
export type EasingType = BasicEasingType | AdvancedEasingType;

export interface BezierControlPoints {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SpringParameters {
  tension: number;
  friction: number;
  mass: number;
}

export interface EasingConfig {
  type: EasingType;
  bezier?: BezierControlPoints;
  spring?: SpringParameters;
}

export const DEFAULT_SPRING_PARAMS: SpringParameters = {
  tension: 170,
  friction: 26,
  mass: 1,
};

export const DEFAULT_BEZIER_POINTS: BezierControlPoints = {
  x1: 0.42,
  y1: 0,
  x2: 0.58,
  y2: 1,
};

function linear(t: number): number {
  return t;
}

export function easeIn(t: number): number {
  return t * t;
}

export function easeOut(t: number): number {
  return t * (2 - t);
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

export function cubicBezier(t: number, points: BezierControlPoints): number {
  const { x1, y1, x2, y2 } = points;

  if (t === 0) return 0;
  if (t === 1) return 1;

  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;

  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  let tCurve = t;
  for (let i = 0; i < 8; i++) {
    const xCalc = ((ax * tCurve + bx) * tCurve + cx) * tCurve;
    const dx = xCalc - t;
    if (Math.abs(dx) < 1e-6) break;

    const dxdt = (3 * ax * tCurve + 2 * bx) * tCurve + cx;
    if (Math.abs(dxdt) < 1e-6) break;

    tCurve -= dx / dxdt;
    tCurve = Math.max(0, Math.min(1, tCurve));
  }

  return ((ay * tCurve + by) * tCurve + cy) * tCurve;
}

export function springEasing(t: number, params: SpringParameters): number {
  const { tension, friction, mass } = params;

  if (t === 0) return 0;
  if (t === 1) return 1;

  const omega0 = Math.sqrt(tension / mass);
  const zeta = friction / (2 * Math.sqrt(tension * mass));
  const settleTime = 4 / (zeta * omega0);
  const scaledT = t * settleTime;

  let value: number;
  if (zeta < 1) {
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    value =
      1 -
      Math.exp(-zeta * omega0 * scaledT) *
        (Math.cos(omegaD * scaledT) +
          (zeta * omega0 / omegaD) * Math.sin(omegaD * scaledT));
  } else if (zeta === 1) {
    value = 1 - Math.exp(-omega0 * scaledT) * (1 + omega0 * scaledT);
  } else {
    const s1 = -omega0 * (zeta - Math.sqrt(zeta * zeta - 1));
    const s2 = -omega0 * (zeta + Math.sqrt(zeta * zeta - 1));
    value =
      1 -
      (s2 * Math.exp(s1 * scaledT) - s1 * Math.exp(s2 * scaledT)) / (s2 - s1);
  }

  return Math.max(0, Math.min(1.2, value));
}

const easingFunctions: Record<EasingType, (t: number) => number> = {
  linear,
  'ease-in': easeIn,
  'ease-out': easeOut,
  'ease-in-out': easeInOut,
  'cubic-bezier': (t) => cubicBezier(t, DEFAULT_BEZIER_POINTS),
  spring: (t) => springEasing(t, DEFAULT_SPRING_PARAMS),
};

function getEasingFunction(type: EasingType): (t: number) => number {
  return easingFunctions[type] ?? linear;
}

export function applyEasing(t: number, type: EasingType): number {
  const clampedT = Math.max(0, Math.min(1, t));
  return getEasingFunction(type)(clampedT);
}

export function applyEasingConfig(t: number, config: EasingConfig): number {
  const clampedT = Math.max(0, Math.min(1, t));

  switch (config.type) {
    case 'cubic-bezier':
      return cubicBezier(clampedT, config.bezier ?? DEFAULT_BEZIER_POINTS);
    case 'spring':
      return springEasing(clampedT, config.spring ?? DEFAULT_SPRING_PARAMS);
    default:
      return getEasingFunction(config.type)(clampedT);
  }
}
