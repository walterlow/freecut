/**
 * Smart copy block for the export dialog: the pass-through switch, why it is or
 * isn't available, and the bitrate/size the export will end up with.
 */

import { useTranslation } from 'react-i18next'
import type { Dispatch, SetStateAction } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { ExportSettings, SourceVideoEncodingInfo } from '@/types/export'
import type { SmartCopyAssessment } from '../utils/smart-copy'
import { formatFileSize } from '../utils/export-format'

export interface ExportSmartCopyBlockProps {
  settings: ExportSettings
  setSettings: Dispatch<SetStateAction<ExportSettings>>
  /** Why smart copy is or isn't available for the current settings. */
  assessment: SmartCopyAssessment
  /** Whether the export will actually copy the source bytes. */
  willRun: boolean
  /** Bitrate the encoder would pick on auto. */
  resolvedVideoBitrate: number
  estimatedFileSizeBytes: number
  /** Encoding of the clip supplying the export, when one is known. */
  sourceVideo: SourceVideoEncodingInfo | undefined
}

export function ExportSmartCopyBlock({
  settings,
  setSettings,
  assessment,
  willRun,
  resolvedVideoBitrate,
  estimatedFileSizeBytes,
  sourceVideo,
}: ExportSmartCopyBlockProps) {
  const { t } = useTranslation()

  return (
    <>
      <div className="flex items-start justify-between gap-4 border-t border-border pt-3">
        <div className="space-y-1">
          <Label htmlFor="smart-copy" className="text-sm font-medium">
            {t('export.settings.smartCopy')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t(`export.settings.smartCopyStatus.${assessment.reason}`)}
          </p>
        </div>
        <Switch
          id="smart-copy"
          checked={settings.smartCopy !== false}
          onCheckedChange={(checked) =>
            setSettings((previous) => ({ ...previous, smartCopy: checked }))
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-background/60 px-3 py-2 text-xs">
        <span className="font-medium text-foreground">
          {willRun
            ? t('export.settings.smartCopyPath')
            : `${(resolvedVideoBitrate / 1_000_000).toFixed(2)} Mbps ${
                (settings.rateControl ?? 'auto') === 'constant' ? 'CBR' : 'VBR'
              }`}
        </span>
        <span className="text-muted-foreground">
          {t('export.settings.estimatedSize', { size: formatFileSize(estimatedFileSizeBytes) })}
        </span>
        {sourceVideo && (
          <span className="text-muted-foreground">
            {t('export.settings.sourceBitrate', {
              bitrate: (sourceVideo.bitrate / 1_000_000).toFixed(2),
            })}
          </span>
        )}
      </div>
    </>
  )
}
