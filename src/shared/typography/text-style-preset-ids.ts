export const TEXT_STYLE_PRESET_IDS = [
  'clean-title',
  'poster',
  'outline-pill',
  'lower-third',
  'speaker-card',
  'cinematic',
  'quote',
  'neon',
  'headline-stack',
  'breaking-update',
  'event-card',
  'launch-stack',
  'badge',
] as const

export type TextStylePresetId = (typeof TEXT_STYLE_PRESET_IDS)[number]
