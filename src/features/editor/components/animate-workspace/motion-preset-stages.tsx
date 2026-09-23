import { memo } from 'react'
import type { TextItem } from '@/types/timeline'
import {
  MOTION_PRESET_CATEGORIES,
  type MotionPreset,
  type MotionPresetCategory,
} from '@/features/editor/deps/keyframes'
import { TextMotionSlotRows } from '../text-motion/text-motion-slot-rows'
import { TEXT_SLOT_BY_MOTION_CATEGORY } from './animation-preset-catalogue'
import { MotionPresetSection } from './motion-preset-section'
import { StageSection } from './stage-section'

interface MotionPresetStagesProps {
  /** Built-in presets per category, already filtered by search / compatibility. */
  presetsByCategory: Record<MotionPresetCategory, MotionPreset[]>
  selectedTextItems: TextItem[]
  /** Deferred search query handed to the text-motion rows. */
  query: string
  reasonFor: (preset: MotionPreset) => string | null
  onApply: (preset: MotionPreset) => void
  t: (key: string, options?: Record<string, unknown>) => string
}

/**
 * One collapsible stage per preset category: the built-in presets as an icon
 * grid, plus the matching text-motion slot when text is selected. Categories
 * that end up empty (filtered out, or text-less for a text-only slot) render
 * nothing, so filtering never leaves an empty stage behind.
 */
export const MotionPresetStages = memo(function MotionPresetStages({
  presetsByCategory,
  selectedTextItems,
  query,
  reasonFor,
  onApply,
  t,
}: MotionPresetStagesProps) {
  return (
    <>
          {MOTION_PRESET_CATEGORIES.map((category) => {
            const textSlot = TEXT_SLOT_BY_MOTION_CATEGORY[category]
            const layerPresets = presetsByCategory[category]
            const showTextScope = selectedTextItems.length > 0 && textSlot
            if (layerPresets.length === 0 && !showTextScope) return null
            return (
              <StageSection
                key={category}
                title={t(`editor.motionPresets.categories.${category}`)}
              >
                {layerPresets.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-medium text-muted-foreground">
                      {t('editor.animateStages.scopeLayer')}
                    </span>
                    <MotionPresetSection
                      category={category}
                      presets={layerPresets}
                      reasonFor={reasonFor}
                      onApply={onApply}
                      showHeading={false}
                      t={t}
                    />
                  </div>
                ) : null}
                {showTextScope ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-medium text-muted-foreground">
                      {t('editor.animateStages.scopeText')}
                    </span>
                    <TextMotionSlotRows
                      items={selectedTextItems}
                      query={query}
                      slots={[textSlot]}
                      showSlotHeading={false}
                      showEmptyState={false}
                    />
                  </div>
                ) : null}
              </StageSection>
            )
          })}
    </>
  )
})
