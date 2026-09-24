/**
 * Sequence picker for the export dialog: which timeline (Main or a standalone
 * tab) the settings apply to. The caller decides whether the picker is worth
 * showing at all.
 */

import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const MAIN_SEQUENCE = '__main__'

export interface ExportSequencePickerProps {
  /** Every exportable sequence; `null` is the Main timeline. */
  options: Array<{ id: string | null; name: string }>
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function ExportSequencePicker({ options, selectedId, onSelect }: ExportSequencePickerProps) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center justify-between">
      <Label htmlFor="sequence" className="text-sm font-medium">
        {t('export.settings.sequence')}
      </Label>
      <Select
        value={selectedId ?? MAIN_SEQUENCE}
        onValueChange={(value) => onSelect(value === MAIN_SEQUENCE ? null : value)}
      >
        <SelectTrigger id="sequence" className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id ?? MAIN_SEQUENCE} value={option.id ?? MAIN_SEQUENCE}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
