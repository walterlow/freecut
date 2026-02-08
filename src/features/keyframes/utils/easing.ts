/**
 * Easing functions for keyframe interpolation.
 * Each function takes a progress value (0-1) and returns an eased value (0-1).
 */

import type {
  EasingType,
  EasingConfig,
  BezierControlPoints,
  SpringParameters,
} from '@/types/keyframe';
import { DEFAULT_BEZIER_POINTS, DEFAULT_SPRING_PARAMS } from '@/types/keyframe';

/**
 * Linear easing - constant speed
 */
function linear(t: number): number {
  return t;
}

/**
 * Ease in - starts slow, accelerates
 * Uses quadratic function (t^2)
 */
export function easeIn(t: number): number {
  return t * t;
}

/**
 * Ease out - starts fast, decelerates
 * Uses inverse quadratic function
 */
export function easeOut(t: number): number {
  return t * (2 - t);
}

/**
 * Ease in-out - starts slow, accelerates, then decelerates
 * Uses piecewise quadratic function
 */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/**
 * Cubic bezier easing function.
 * Attempt to find Y value for given X using Newton-Raphson iteration.
 */
export function cubicBezier(t: number, points: BezierControlPoints): number {
  const { x1, y1, x2, y2 } = points;

  // Special cases
  if (t === 0) return 0;
  if (t === 1) return 1;

  // Calculate coefficients for X(t)
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;

  // Calculate coefficients for Y(t)
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  // Find parameter t for given x using Newton-Raphson
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

  // Return Y value at parameter t
  return ((ay * tCurve + by) * tCurve + cy) * tCurve;
}

/**
 * Spring physics easing function.
 * Simulates a damped spring oscillation.
 */
export function springEasing(t: number, params: SpringParameters): number {
  const { tension, friction, mass } = params;

  if (t === 0) return 0;
  if (t === 1) return 1;

  // Calculate spring parameters
  const omega0 = Math.sqrt(tension / mass);
  const zeta = friction / (2 * Math.sqrt(tension * mass));

  // Duration factor - springs technically never fully settle,
  // so we scale time to reach ~99% settlement
  const settleTime = 4 / (zeta * omega0);
  const scaledT = t * settleTime;

  let value: number;

  if (zeta < 1) {
    // Underdamped - oscillates
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    value =
      1 -
      Math.exp(-zeta * omega0 * scaledT) *
        (Math.cos(omegaD * scaledT) +
          (zeta * omega0 / omegaD) * Math.sin(omegaD * scaledT));
  } else if (zeta === 1) {
    // Critically damped
    value = 1 - Math.exp(-omega0 * scaledT) * (1 + omega0 * scaledT);
  } else {
    // Overdamped
    const s1 = -omega0 * (zeta - Math.sqrt(zeta * zeta - 1));
    const s2 = -omega0 * (zeta + Math.sqrt(zeta * zeta - 1));
    value =
      1 -
      (s2 * Math.exp(s1 * scaledT) - s1 * Math.exp(s2 * scaledT)) / (s2 - s1);
  }

  return Math.max(0, Math.min(1.2, value)); // Allow slight overshoot
}

/**
 * Map of basic easing type to easing function
 */
const easingFunctions: Record<EasingType, (t: number) => number> = {
  'linear': linear,
  'ease-in': easeIn,
  'ease-out': easeOut,
  'ease-in-out': easeInOut,
  'cubic-bezier': (t) => cubicBezier(t, DEFAULT_BEZIER_POINTS),
  'spring': (t) => springEasing(t, DEFAULT_SPRING_PARAMS),
};

/**
 * Get an easing function by type
 */
function getEasingFunction(type: EasingType): (t: number) => number {
  return easingFunctions[type] ?? linear;
}

/**
 * Apply easing to a progress value
 * @param t Progress value (0-1)
 * @param type Easing type
 * @returns Eased progress value (0-1)
 */
export function applyEasing(t: number, type: EasingType): number {
  // Clamp input to valid range
  const clampedT = Math.max(0, Math.min(1, t));
  return getEasingFunction(type)(clampedT);
}

/**
 * Apply easing with full configuration (for advanced easing types)
 * @param t Progress value (0-1)
 * @param config Easing configuration with type and parameters
 * @returns Eased progress value
 */
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
