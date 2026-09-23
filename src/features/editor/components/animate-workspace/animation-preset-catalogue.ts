import type { AnimatableProperty } from '@/types/keyframe'
import type { TextMotionSlot } from '@/types/text-motion'
import {
  MOTION_PRESETS,
  MOTION_PRESET_CATEGORIES,
  type MotionPreset,
  type MotionPresetCategory,
} from '@/features/editor/deps/keyframes'

// Every transform/opacity property any built-in motion preset can write. In
// Replace mode we clear these (within the new preset's frame window) so a fresh
// preset fully supersedes whatever animation occupied that region.
export const MOTION_PRESET_PROPERTIES: AnimatableProperty[] = Array.from(
  new Set(MOTION_PRESETS.flatMap((preset) => preset.properties)),
)

export const presetsByCategory = MOTION_PRESET_CATEGORIES.reduce(
  (map, category) => {
    map[category] = MOTION_PRESETS.filter((preset) => preset.category === category)
    return map
  },
  {} as Record<MotionPresetCategory, MotionPreset[]>,
)

export const TEXT_SLOT_BY_MOTION_CATEGORY: Partial<Record<MotionPresetCategory, TextMotionSlot>> = {
  entrance: 'in',
  exit: 'out',
}

export const EDIT_QUICK_PRESET_IDS = new Set([
  'fade-in',
  'slide-in-left',
  'pop-in',
  'fade-out',
  'slide-out-right',
  'pulse',
])
