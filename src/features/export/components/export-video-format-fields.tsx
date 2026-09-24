/**
 * Video format fields for the export dialog: container, codec, quality and
 * resolution, each option gated by what the browser codec probe supported.
 */

import { useTranslation } from 'react-i18next'
import type { Dispatch, SetStateAction } from 'react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ExportSettings } from '@/types/export'
import type { ClientVideoContainer } from '../deps/renderer'
import type {
  ResolutionOption,
  VideoCodecOption,
  VideoContainerOption,
} from '../utils/export-options'

export interface ExportVideoFormatFieldsProps {
  settings: ExportSettings
  setSettings: Dispatch<SetStateAction<ExportSettings>>
  container: ClientVideoContainer
  setContainer: Dispatch<SetStateAction<ClientVideoContainer>>
  containerOptions: VideoContainerOption[]
  codecOptions: VideoCodecOption[]
  resolutionOptions: ResolutionOption[]
  projectWidth: number
  projectHeight: number
}

export function ExportVideoFormatFields({
  settings,
  setSettings,
  container,
  setContainer,
  containerOptions,
  codecOptions,
  resolutionOptions,
  projectWidth,
  projectHeight,
}: ExportVideoFormatFieldsProps) {
  const { t } = useTranslation()

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="container">{t('export.settings.format')}</Label>
        <Select value={container} onValueChange={(v) => setContainer(v as ClientVideoContainer)}>
          <SelectTrigger id="container">
            <SelectValue placeholder={t('export.settings.selectFormat')} />
          </SelectTrigger>
          <SelectContent>
            {containerOptions.map((option) => (
              <SelectItem key={option.value} value={option.value} disabled={!option.supported}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="codec">{t('export.settings.codec')}</Label>
        <Select
          value={settings.codec}
          onValueChange={(value) =>
            setSettings({ ...settings, codec: value as ExportSettings['codec'] })
          }
        >
          <SelectTrigger id="codec">
            <SelectValue placeholder={t('export.settings.selectCodec')} />
          </SelectTrigger>
          <SelectContent>
            {codecOptions.map((option) => (
              <SelectItem key={option.value} value={option.value} disabled={!option.supported}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="quality">{t('export.settings.quality')}</Label>
        <Select
          value={settings.quality}
          onValueChange={(value) =>
            setSettings({
              ...settings,
              quality: value as ExportSettings['quality'],
            })
          }
        >
          <SelectTrigger id="quality">
            <SelectValue placeholder={t('export.settings.selectQuality')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">{t('export.settings.qualityLow')}</SelectItem>
            <SelectItem value="medium">{t('export.settings.qualityMedium')}</SelectItem>
            <SelectItem value="high">{t('export.settings.qualityHigh')}</SelectItem>
            <SelectItem value="ultra">{t('export.settings.qualityUltra')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="resolution">{t('export.settings.resolution')}</Label>
        <Select
          value={`${settings.resolution.width}x${settings.resolution.height}`}
          onValueChange={(value) => {
            const parts = value.split('x').map(Number)
            const width = parts[0] ?? projectWidth
            const height = parts[1] ?? projectHeight
            setSettings({ ...settings, resolution: { width, height } })
          }}
        >
          <SelectTrigger id="resolution">
            <SelectValue placeholder={t('export.settings.selectResolution')} />
          </SelectTrigger>
          <SelectContent>
            {resolutionOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
