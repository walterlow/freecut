import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/shared/ui/cn'

export type AlignmentType =
  | 'left'
  | 'center-h'
  | 'right'
  | 'top'
  | 'center-v'
  | 'bottom'
  | 'distribute-h'
  | 'distribute-v'

interface AlignmentButtonsProps {
  onAlign: (alignment: AlignmentType) => void
  disabled?: boolean
  className?: string
}

interface AlignmentButtonConfig {
  type: AlignmentType
  icon: LucideIcon
  labelKey: string
}

const horizontalAlignments: AlignmentButtonConfig[] = [
  { type: 'left', icon: AlignStartVertical, labelKey: 'editor.alignment.left' },
  { type: 'center-h', icon: AlignCenterVertical, labelKey: 'editor.alignment.centerHorizontally' },
  { type: 'right', icon: AlignEndVertical, labelKey: 'editor.alignment.right' },
]

const verticalAlignments: AlignmentButtonConfig[] = [
  { type: 'top', icon: AlignStartHorizontal, labelKey: 'editor.alignment.top' },
  { type: 'center-v', icon: AlignCenterHorizontal, labelKey: 'editor.alignment.centerVertically' },
  { type: 'bottom', icon: AlignEndHorizontal, labelKey: 'editor.alignment.bottom' },
]

const distributionAlignments: AlignmentButtonConfig[] = [
  {
    type: 'distribute-h',
    icon: AlignHorizontalDistributeCenter,
    labelKey: 'editor.alignment.distributeHorizontally',
  },
  {
    type: 'distribute-v',
    icon: AlignVerticalDistributeCenter,
    labelKey: 'editor.alignment.distributeVertically',
  },
]

interface AlignmentButtonGroupProps {
  alignments: AlignmentButtonConfig[]
  disabled: boolean
  onAlign: (alignment: AlignmentType) => void
  t: (key: string) => string
}

function AlignmentButtonGroup({ alignments, disabled, onAlign, t }: AlignmentButtonGroupProps) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 bg-secondary rounded-md">
      {alignments.map(({ type, icon: Icon, labelKey }) => (
        <Button
          key={type}
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => onAlign(type)}
          disabled={disabled}
          aria-label={t(labelKey)}
          data-tooltip={t(labelKey)}
          data-tooltip-side="bottom"
        >
          <Icon className="w-3.5 h-3.5" />
        </Button>
      ))}
    </div>
  )
}

/**
 * Horizontal and vertical alignment button groups.
 * Used to align selected clips to canvas edges or center.
 */
export function AlignmentButtons({ onAlign, disabled = false, className }: AlignmentButtonsProps) {
  const { t } = useTranslation()
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <AlignmentButtonGroup
        alignments={horizontalAlignments}
        disabled={disabled}
        onAlign={onAlign}
        t={t}
      />
      <AlignmentButtonGroup
        alignments={verticalAlignments}
        disabled={disabled}
        onAlign={onAlign}
        t={t}
      />
      <AlignmentButtonGroup
        alignments={distributionAlignments}
        disabled={disabled}
        onAlign={onAlign}
        t={t}
      />
    </div>
  )
}
