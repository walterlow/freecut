import { HelpCircle, LineChart, Lock, Timer } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface DopesheetLegendPopoverProps {
  disabled?: boolean
}

export function DopesheetLegendPopover({ disabled }: DopesheetLegendPopoverProps) {
  const { t } = useTranslation()
  const triggerLabel = t('timeline.keyframeEditor.legend.trigger')

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          disabled={disabled}
          aria-label={triggerLabel}
          title={triggerLabel}
        >
          <HelpCircle className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[260px] text-xs">
        <p className="mb-2 text-xs font-medium text-foreground">
          {t('timeline.keyframeEditor.legend.title')}
        </p>

        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('timeline.keyframeEditor.legend.modesHeading')}
        </p>
        <ul className="mb-2 space-y-1 text-muted-foreground">
          <li>{t('timeline.keyframeEditor.legend.graphMode')}</li>
          <li>{t('timeline.keyframeEditor.legend.sheetMode')}</li>
        </ul>

        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('timeline.keyframeEditor.legend.iconsHeading')}
        </p>
        <ul className="mb-2 space-y-1 text-muted-foreground">
          <li className="flex items-start gap-1.5">
            <LineChart className="mt-px h-3 w-3 flex-shrink-0 text-orange-500" />
            <span>{t('timeline.keyframeEditor.legend.iconCurve')}</span>
          </li>
          <li className="flex items-start gap-1.5">
            <Lock className="mt-px h-3 w-3 flex-shrink-0 text-red-400" />
            <span>{t('timeline.keyframeEditor.legend.iconLock')}</span>
          </li>
          <li className="flex items-start gap-1.5">
            <Timer className="mt-px h-3 w-3 flex-shrink-0" />
            <span>{t('timeline.keyframeEditor.legend.iconAutoKey')}</span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="mt-0.5 block h-2 w-2 flex-shrink-0 rotate-45 bg-neutral-200" />
            <span>{t('timeline.keyframeEditor.legend.iconDiamond')}</span>
          </li>
        </ul>

        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('timeline.keyframeEditor.legend.colorsHeading')}
        </p>
        <ul className="space-y-1 text-muted-foreground">
          <li className="flex items-start gap-1.5">
            <span className="mt-0.5 block h-2 w-2 flex-shrink-0 rotate-45 bg-neutral-200" />
            <span>{t('timeline.keyframeEditor.legend.colorDefault')}</span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="mt-0.5 block h-2 w-2 flex-shrink-0 rotate-45 bg-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.45)]" />
            <span>{t('timeline.keyframeEditor.legend.colorSelected')}</span>
          </li>
        </ul>
      </PopoverContent>
    </Popover>
  )
}
