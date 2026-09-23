import { memo } from 'react'
import { WandSparkles } from 'lucide-react'
import type { MotionModifierType } from '@/types/motion'
import type { TextItem } from '@/types/timeline'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  getMotionModifierSettings,
  type MotionModulator,
} from '@/features/editor/deps/keyframes'
import { TextMotionSlotRows } from '../text-motion/text-motion-slot-rows'
import { ContinuousMotionRow, type ModifierEditSettings } from './continuous-motion-row'
import { StageSection } from './stage-section'

interface ContinuousMotionStageProps {
  /** Live generators matching the current search / compatibility filters. */
  modulators: MotionModulator[]
  /** Generators already applied to every selected clip. */
  activeModulatorIds: ReadonlySet<string>
  /** Live settings of the applied generators, keyed by type. */
  settingsByModulator: ReadonlyMap<MotionModifierType, ReturnType<typeof getMotionModifierSettings>>
  selectedTextItems: TextItem[]
  /** Deferred search query handed to the text-motion rows. */
  query: string
  reasonFor: (modulator: MotionModulator) => string | null
  onApplyModulator: (modulator: MotionModulator) => void
  onRemoveModulator: (modulator: MotionModulator) => void
  onLiveEdit: (type: MotionModifierType, settings: ModifierEditSettings) => void
  onCommitEdit: (type: MotionModifierType, settings: ModifierEditSettings) => void
  hasBakeableMotion: boolean
  onOpenBakeDialog: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}

/**
 * "Layer behaviours" stage: the live motion generators as tiles, the bake
 * bridge, and the text loop rows that share the same intent. Hidden entirely
 * when neither applies to the current selection.
 */
export const ContinuousMotionStage = memo(function ContinuousMotionStage({
  modulators,
  activeModulatorIds,
  settingsByModulator,
  selectedTextItems,
  query,
  reasonFor,
  onApplyModulator,
  onRemoveModulator,
  onLiveEdit,
  onCommitEdit,
  hasBakeableMotion,
  onOpenBakeDialog,
  t,
}: ContinuousMotionStageProps) {
  if (modulators.length === 0 && selectedTextItems.length === 0) return null
  return (
            <StageSection
              title={t('editor.animateStages.continuousTitle')}
              hint={t('editor.animateStages.continuousHint')}
              defaultOpen={false}
            >
              {modulators.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {t('editor.animateStages.scopeLayer')}
                  </span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {modulators.map((modulator) => (
                      <ContinuousMotionRow
                        key={modulator.id}
                        modulator={modulator}
                        active={activeModulatorIds.has(modulator.id)}
                        reason={reasonFor(modulator)}
                        settings={settingsByModulator.get(modulator.id) ?? null}
                        onApply={() => onApplyModulator(modulator)}
                        onRemove={() => onRemoveModulator(modulator)}
                        onLiveEdit={(settings) => onLiveEdit(modulator.id, settings)}
                        onCommitEdit={(settings) =>
                          onCommitEdit(modulator.id, settings)
                        }
                        t={t}
                      />
                    ))}
                  </div>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-full justify-start gap-1.5 px-2 text-[11px]"
                          disabled={!hasBakeableMotion}
                          onClick={onOpenBakeDialog}
                        >
                          <WandSparkles className="h-3.5 w-3.5" />
                          {t('editor.motionGenerator.bakeToKeyframes')}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t('editor.motionGenerator.bakeToKeyframesHint')}
                    </TooltipContent>
                  </Tooltip>
                </div>
              ) : null}
              {selectedTextItems.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {t('editor.animateStages.scopeText')}
                  </span>
                  <TextMotionSlotRows
                    items={selectedTextItems}
                    query={query}
                    slots={['loop']}
                    showSlotHeading={false}
                    showEmptyState={false}
                  />
                </div>
              ) : null}
            </StageSection>
  )
})
