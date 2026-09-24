/**
 * Rate control fields for the export dialog: the auto/VBR/CBR mode, the target
 * bitrate it lets you override, and a shortcut to the source clip's own rate.
 */

import { useTranslation } from 'react-i18next'
import type { Dispatch, SetStateAction } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ExportSettings, SourceVideoEncodingInfo } from '@/types/export'

export interface ExportRateControlFieldsProps {
  settings: ExportSettings
  setSettings: Dispatch<SetStateAction<ExportSettings>>
  /** Bitrate the encoder would pick on auto — the input's fallback value. */
  resolvedVideoBitrate: number
  /** Encoding of the clip supplying the export, when one is known. */
  sourceVideo: SourceVideoEncodingInfo | undefined
}

export function ExportRateControlFields({
  settings,
  setSettings,
  resolvedVideoBitrate,
  sourceVideo,
}: ExportRateControlFieldsProps) {
  const { t } = useTranslation()

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="rate-control">{t('export.settings.rateControl')}</Label>
        <Select
          value={settings.rateControl ?? 'auto'}
          onValueChange={(value) =>
            setSettings((previous) => ({
              ...previous,
              rateControl: value as NonNullable<ExportSettings['rateControl']>,
              videoBitrate:
                value === 'auto' ? undefined : (previous.videoBitrate ?? resolvedVideoBitrate),
            }))
          }
        >
          <SelectTrigger id="rate-control">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t('export.settings.rateControlAuto')}</SelectItem>
            <SelectItem value="variable">{t('export.settings.rateControlVbr')}</SelectItem>
            <SelectItem value="constant">{t('export.settings.rateControlCbr')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="target-bitrate">{t('export.settings.targetBitrate')}</Label>
          {sourceVideo && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() =>
                setSettings((previous) => ({
                  ...previous,
                  rateControl: 'variable',
                  videoBitrate: sourceVideo.bitrate,
                }))
              }
            >
              {t('export.settings.useSourceBitrate')}
            </Button>
          )}
        </div>
        <div className="relative">
          <Input
            id="target-bitrate"
            type="number"
            min="0.1"
            max="500"
            step="0.1"
            disabled={(settings.rateControl ?? 'auto') === 'auto'}
            value={((settings.videoBitrate ?? resolvedVideoBitrate) / 1_000_000).toFixed(2)}
            onChange={(event) => {
              const mbps = Number(event.target.value)
              if (!Number.isFinite(mbps) || mbps <= 0) return
              setSettings((previous) => ({
                ...previous,
                videoBitrate: Math.round(mbps * 1_000_000),
              }))
            }}
            className="pr-14"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            Mbps
          </span>
        </div>
      </div>
    </div>
  )
}
