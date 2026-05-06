import type { BezierControlPoints, EasingType } from '@/types/keyframe'

const EASING_BEZIER_PRESETS: Partial<Record<EasingType, BezierControlPoints>> = {
  'ease-in': { x1: 0.42, y1: 0, x2: 1, y2: 1 },
  'ease-out': { x1: 0, y1: 0, x2: 0.58, y2: 1 },
  'ease-in-out': { x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
}

export function getBezierPresetForEasing(easing: EasingType): BezierControlPoints | null {
  return EASING_BEZIER_PRESETS[easing] ? { ...EASING_BEZIER_PRESETS[easing] } : null
}
