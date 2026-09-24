/**
 * Audio side of the export settings: the audio-only note, the file format and
 * the quality the encoder targets.
 */

import { useTranslation } from 'react-i18next'
import type { Dispatch, SetStateAction } from 'react'
import { Music } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ExportSettings } from '@/types/export'
import type { ClientAudioContainer } from '../deps/renderer'

export interface ExportAudioSettingsProps {
  settings: ExportSettings
  setSettings: Dispatch<SetStateAction<ExportSettings>>
  container: ClientAudioContainer
  setContainer: Dispatch<SetStateAction<ClientAudioContainer>>
}

export function ExportAudioSettings({
  settings,
  setSettings,
  container,
  setContainer,
}: ExportAudioSettingsProps) {
  const { t } = useTranslation()

  const getAudioContainerOptions = () => [
    { value: 'mp3', label: 'MP3', description: t('export.audioContainer.mp3') },
    { value: 'aac', label: 'AAC', description: t('export.audioContainer.aac') },
    { value: 'wav', label: 'WAV', description: t('export.audioContainer.wav') },
  ]

  return (
    <div className="space-y-4">
      <Alert>
        <Music className="h-4 w-4" />
        <AlertDescription>{t('export.settings.audioOnlyNote')}</AlertDescription>
      </Alert>

      <div className="space-y-2">
        <Label htmlFor="audio-format">{t('export.settings.format')}</Label>
        <Select
          value={container}
          onValueChange={(v) => setContainer(v as ClientAudioContainer)}
        >
          <SelectTrigger id="audio-format">
            <SelectValue placeholder={t('export.settings.selectFormat')} />
          </SelectTrigger>
          <SelectContent>
            {getAudioContainerOptions().map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span>{option.label}</span>
                <span className="ml-2 text-xs text-muted-foreground">{option.description}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="audio-quality">{t('export.settings.quality')}</Label>
        <Select
          value={settings.quality}
          onValueChange={(value) =>
            setSettings({ ...settings, quality: value as ExportSettings['quality'] })
          }
        >
          <SelectTrigger id="audio-quality">
            <SelectValue placeholder={t('export.settings.selectQuality')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">{t('export.settings.audioQualityLow')}</SelectItem>
            <SelectItem value="medium">{t('export.settings.audioQualityMedium')}</SelectItem>
            <SelectItem value="high">{t('export.settings.audioQualityHigh')}</SelectItem>
            <SelectItem value="ultra">{t('export.settings.audioQualityUltra')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
