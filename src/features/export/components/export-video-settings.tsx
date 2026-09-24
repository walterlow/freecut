/**
 * Video side of the export settings: quick presets, capability warnings, format
 * fields, rate control, smart copy and subtitles. Layout only — every value it
 * shows is prepared by the dialog, which owns the state behind them.
 */

import { ExportPresetGrid, type ExportPresetGridProps } from './export-preset-grid'
import { ExportCapabilityAlerts, type ExportCapabilityAlertsProps } from './export-capability-alerts'
import {
  ExportVideoFormatFields,
  type ExportVideoFormatFieldsProps,
} from './export-video-format-fields'
import {
  ExportRateControlFields,
  type ExportRateControlFieldsProps,
} from './export-rate-control-fields'
import { ExportSmartCopyBlock, type ExportSmartCopyBlockProps } from './export-smart-copy-block'
import { ExportSubtitleFields, type ExportSubtitleFieldsProps } from './export-subtitle-fields'

export interface ExportVideoSettingsProps {
  presets: ExportPresetGridProps
  alerts: ExportCapabilityAlertsProps
  format: ExportVideoFormatFieldsProps
  rateControl: ExportRateControlFieldsProps
  smartCopy: ExportSmartCopyBlockProps
  subtitles: ExportSubtitleFieldsProps
}

export function ExportVideoSettings(props: ExportVideoSettingsProps) {
  return (
    <>
      <ExportPresetGrid {...props.presets} />

      <div className="space-y-4">
        <ExportCapabilityAlerts {...props.alerts} />

        <ExportVideoFormatFields {...props.format} />

        <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
          <ExportRateControlFields {...props.rateControl} />

          <ExportSmartCopyBlock {...props.smartCopy} />
        </div>

        <ExportSubtitleFields {...props.subtitles} />
      </div>
    </>
  )
}
