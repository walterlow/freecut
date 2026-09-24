/**
 * Subtitle fields for the export dialog: which subtitle mode the video carries,
 * or why there is nothing to offer when the timeline has no transcript.
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
import type { SubtitleExportMode } from '@/types/export'

export interface ExportSubtitleFieldsProps {
  /** The subtitle mode the export will use, coerced to one the container supports. */
  mode: SubtitleExportMode
  onModeChange: (mode: SubtitleExportMode) => void
  /** Modes the current container can carry. */
  modeOptions: SubtitleExportMode[]
  /** Whether the timeline holds transcript captions to act on. */
  hasTranscriptSubtitles: boolean
}

export function ExportSubtitleFields({
  mode,
  onModeChange,
  modeOptions,
  hasTranscriptSubtitles,
}: ExportSubtitleFieldsProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="subtitle-mode" className="text-sm font-medium">
          {t('export.settings.subtitles', { defaultValue: 'Subtitles' })}
        </Label>
        <Select
          value={mode}
          onValueChange={(value) => onModeChange(value as SubtitleExportMode)}
          disabled={!hasTranscriptSubtitles}
        >
          <SelectTrigger id="subtitle-mode" className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {modeOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {t(`export.settings.subtitleMode.${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">
        {hasTranscriptSubtitles
          ? t(`export.settings.subtitleMode.${mode}Description`)
          : t('export.settings.noTranscriptSegments')}
      </p>
    </div>
  )
}
