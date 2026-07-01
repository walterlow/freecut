import {
  DEFAULT_BEZIER_POINTS,
  DEFAULT_SPRING_PARAMS,
  type BezierControlPoints,
  type EasingConfig,
  type EasingType,
} from '@/types/keyframe'

const EASING_BEZIER_PRESETS: Partial<Record<EasingType, BezierControlPoints>> = {
  'ease-in': { x1: 0.42, y1: 0, x2: 1, y2: 1 },
  'ease-out': { x1: 0, y1: 0, x2: 0.58, y2: 1 },
  'ease-in-out': { x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
}

export function getBezierPresetForEasing(easing: EasingType): BezierControlPoints | null {
  return EASING_BEZIER_PRESETS[easing] ? { ...EASING_BEZIER_PRESETS[easing] } : null
}

/**
 * Named cubic-bezier curves offered in the easing editors. Values are the
 * standard Penner / easings.net cubic-bezier approximations. This is the single
 * source of truth shared by the docked interpolation controls and the
 * dopesheet's per-segment easing popover.
 */
export const BEZIER_PRESETS = [
  {
    value: 'soft',
    labelKey: 'timeline.keyframeEditor.bezierPreset.soft',
    points: { x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
  },
  {
    value: 'ease-out',
    labelKey: 'timeline.keyframeEditor.bezierPreset.easeOut',
    points: { x1: 0.215, y1: 0.61, x2: 0.355, y2: 1 },
  },
  {
    value: 'ease-in',
    labelKey: 'timeline.keyframeEditor.bezierPreset.easeIn',
    points: { x1: 0.55, y1: 0.055, x2: 0.675, y2: 0.19 },
  },
  {
    value: 'ease-in-out',
    labelKey: 'timeline.keyframeEditor.bezierPreset.easeInOut',
    points: { x1: 0.645, y1: 0.045, x2: 0.355, y2: 1 },
  },
  {
    value: 'overshoot',
    labelKey: 'timeline.keyframeEditor.bezierPreset.overshoot',
    points: { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 },
  },
  {
    value: 'snap',
    labelKey: 'timeline.keyframeEditor.bezierPreset.snap',
    points: { x1: 0.19, y1: 1, x2: 0.22, y2: 1 },
  },
  // Standard easing library (Penner / easings.net cubic-bezier approximations).
  {
    value: 'out-cubic',
    labelKey: 'timeline.keyframeEditor.bezierPreset.outCubic',
    points: { x1: 0.33, y1: 1, x2: 0.68, y2: 1 },
  },
  {
    value: 'out-quart',
    labelKey: 'timeline.keyframeEditor.bezierPreset.outQuart',
    points: { x1: 0.25, y1: 1, x2: 0.5, y2: 1 },
  },
  {
    value: 'out-quint',
    labelKey: 'timeline.keyframeEditor.bezierPreset.outQuint',
    points: { x1: 0.22, y1: 1, x2: 0.36, y2: 1 },
  },
  {
    value: 'out-expo',
    labelKey: 'timeline.keyframeEditor.bezierPreset.outExpo',
    points: { x1: 0.16, y1: 1, x2: 0.3, y2: 1 },
  },
  {
    value: 'out-circ',
    labelKey: 'timeline.keyframeEditor.bezierPreset.outCirc',
    points: { x1: 0, y1: 0.55, x2: 0.45, y2: 1 },
  },
  {
    value: 'in-out-cubic',
    labelKey: 'timeline.keyframeEditor.bezierPreset.inOutCubic',
    points: { x1: 0.65, y1: 0, x2: 0.35, y2: 1 },
  },
  {
    value: 'in-out-quart',
    labelKey: 'timeline.keyframeEditor.bezierPreset.inOutQuart',
    points: { x1: 0.76, y1: 0, x2: 0.24, y2: 1 },
  },
  {
    value: 'in-out-expo',
    labelKey: 'timeline.keyframeEditor.bezierPreset.inOutExpo',
    points: { x1: 0.87, y1: 0, x2: 0.13, y2: 1 },
  },
  {
    value: 'in-cubic',
    labelKey: 'timeline.keyframeEditor.bezierPreset.inCubic',
    points: { x1: 0.32, y1: 0, x2: 0.67, y2: 0 },
  },
  {
    value: 'in-quart',
    labelKey: 'timeline.keyframeEditor.bezierPreset.inQuart',
    points: { x1: 0.5, y1: 0, x2: 0.75, y2: 0 },
  },
  {
    value: 'in-expo',
    labelKey: 'timeline.keyframeEditor.bezierPreset.inExpo',
    points: { x1: 0.7, y1: 0, x2: 0.84, y2: 0 },
  },
] as const

export type BezierPresetName = (typeof BEZIER_PRESETS)[number]['value']
export type BezierPresetValue = BezierPresetName | 'custom'

export function areBezierPointsEqual(a: BezierControlPoints, b: BezierControlPoints): boolean {
  return a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2
}

/** Return the named preset matching these control points, or `'custom'`. */
export function findMatchingBezierPreset(points: BezierControlPoints): BezierPresetValue {
  const match = BEZIER_PRESETS.find((preset) => areBezierPointsEqual(preset.points, points))
  return match?.value ?? 'custom'
}

/** Clamp a bezier control-point component: x ∈ [0,1], y ∈ [-2,3] (overshoot). */
export function clampBezierValue(key: keyof BezierControlPoints, value: number): number {
  if (key === 'x1' || key === 'x2') {
    return Math.max(0, Math.min(1, value))
  }
  return Math.max(-2, Math.min(3, value))
}

export function clampSpringValue(
  key: 'tension' | 'friction' | 'mass',
  value: number,
): number {
  switch (key) {
    case 'tension':
      return Math.max(1, Math.min(500, value))
    case 'friction':
      return Math.max(1, Math.min(100, value))
    case 'mass':
      return Math.max(0.1, Math.min(10, value))
  }
}

/**
 * Build the `easingConfig` that pairs with an easing type. Named eases that map
 * to a fixed bezier (`ease-in`/`out`/`in-out`) resolve to that curve; explicit
 * `cubic-bezier`/`spring` preserve an existing compatible config or fall back to
 * defaults; `linear`/`hold` need no config.
 */
export function buildEasingConfig(
  easing: EasingType,
  existingConfig?: EasingConfig,
): EasingConfig | undefined {
  const presetBezier = getBezierPresetForEasing(easing)
  if (presetBezier) {
    return { type: 'cubic-bezier', bezier: presetBezier }
  }

  if (easing === 'cubic-bezier') {
    return {
      type: 'cubic-bezier',
      bezier:
        existingConfig?.type === 'cubic-bezier' && existingConfig.bezier
          ? existingConfig.bezier
          : { ...DEFAULT_BEZIER_POINTS },
    }
  }

  if (easing === 'spring') {
    return {
      type: 'spring',
      spring:
        existingConfig?.type === 'spring' && existingConfig.spring
          ? existingConfig.spring
          : { ...DEFAULT_SPRING_PARAMS },
    }
  }

  return undefined
}
