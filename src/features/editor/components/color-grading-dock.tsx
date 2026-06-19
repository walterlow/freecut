import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useColorPlayheadAutoSelect } from '../hooks/use-color-playhead-auto-select'
import { ColorGradePanel } from './properties-sidebar/color-grade-panel'

export const ColorGradingDock = memo(function ColorGradingDock() {
  const { t } = useTranslation()
  useColorPlayheadAutoSelect()

  return (
    <section
      className="panel-bg flex h-full min-h-0 flex-col border-t border-border"
      aria-label={t('editor.colorPanel.dockLabel')}
      data-testid="color-grading-dock"
    >
      <div className="min-h-0 flex-1 overflow-hidden p-2">
        <ColorGradePanel layout="dock" />
      </div>
    </section>
  )
})
