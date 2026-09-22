import { useTranslation } from 'react-i18next'
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { TextItem } from '@/types/timeline'
import { PropertyRow } from '../components'

interface TextAlignControlsProps {
  textAlign: TextItem['textAlign']
  verticalAlign: TextItem['verticalAlign']
  onTextAlignChange: (value: string) => void
  onVerticalAlignChange: (value: string) => void
}

/** Horizontal and vertical text alignment, sharing one row. */
export function TextAlignControls({
  textAlign,
  verticalAlign,
  onTextAlignChange,
  onVerticalAlignChange,
}: TextAlignControlsProps) {
  const { t } = useTranslation()

  return (
    <PropertyRow label={t('editor.textSection.align')}>
      <div className="flex gap-1">
        <Button
          variant={textAlign === 'left' ? 'secondary' : 'ghost'}
          size="icon"
          className="h-7 w-7"
          onClick={() => onTextAlignChange('left')}
          title={t('editor.textSection.alignLeft')}
        >
          <AlignLeft className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant={textAlign === 'center' ? 'secondary' : 'ghost'}
          size="icon"
          className="h-7 w-7"
          onClick={() => onTextAlignChange('center')}
          title={t('editor.textSection.alignCenter')}
        >
          <AlignCenter className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant={textAlign === 'right' ? 'secondary' : 'ghost'}
          size="icon"
          className="h-7 w-7"
          onClick={() => onTextAlignChange('right')}
          title={t('editor.textSection.alignRight')}
        >
          <AlignRight className="w-3.5 h-3.5" />
        </Button>
        <div className="w-px h-5 bg-border mx-1" />
        <Button
          variant={verticalAlign === 'top' ? 'secondary' : 'ghost'}
          size="icon"
          className="h-7 w-7"
          onClick={() => onVerticalAlignChange('top')}
          title={t('editor.textSection.alignTop')}
        >
          <AlignStartHorizontal className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant={verticalAlign === 'middle' ? 'secondary' : 'ghost'}
          size="icon"
          className="h-7 w-7"
          onClick={() => onVerticalAlignChange('middle')}
          title={t('editor.textSection.alignMiddle')}
        >
          <AlignCenterHorizontal className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant={verticalAlign === 'bottom' ? 'secondary' : 'ghost'}
          size="icon"
          className="h-7 w-7"
          onClick={() => onVerticalAlignChange('bottom')}
          title={t('editor.textSection.alignBottom')}
        >
          <AlignEndHorizontal className="w-3.5 h-3.5" />
        </Button>
      </div>
    </PropertyRow>
  )
}
