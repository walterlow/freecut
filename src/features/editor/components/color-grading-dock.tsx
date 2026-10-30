import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useColorPlayheadAutoSelect } from '../hooks/use-color-playhead-auto-select'
import { cn } from '@/shared/ui/cn'
import { ColorGradePanel } from './properties-sidebar/color-grade-panel'

interface ColorGradingDockProps {
  /** True when the dock sits beside the preview instead of below or above it. */
  stacked?: boolean
}

export const ColorGradingDock = memo(function ColorGradingDock({
  stacked = false,
}: ColorGradingDockProps) {
  const { t } = useTranslation()
  useColorPlayheadAutoSelect()

  return (
    <section
      className={cn(
        'panel-bg flex h-full min-h-0 flex-col border-border',
        stacked ? 'border-x' : 'border-t',
      )}
      aria-label={t('editor.colorPanel.dockLabel')}
      data-testid="color-grading-dock"
    >
      {/* Stacked panes keep minimum heights and scroll rather than squeezing the graph. */}
      <div className={cn('min-h-0 flex-1 p-2', stacked ? 'overflow-y-auto' : 'overflow-hidden')}>
        <ColorGradePanel layout="dock" stacked={stacked} />
      </div>
    </section>
  )
})
