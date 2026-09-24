/**
 * Settings step of the export dialog: the source/range column on the left, the
 * video-or-audio settings on the right, and the footer actions below. It owns no
 * state — the dialog prepares each region's props and this lays them out.
 */

import { ExportSequencePicker, type ExportSequencePickerProps } from './export-sequence-picker'
import { ExportModeToggle, type ExportModeToggleProps } from './export-mode-toggle'
import { ExportRangeSummary, type ExportRangeSummaryProps } from './export-range-summary'
import { ExportPreflightPanel } from './export-preflight-panel'
import { ExportVideoSettings, type ExportVideoSettingsProps } from './export-video-settings'
import { ExportAudioSettings, type ExportAudioSettingsProps } from './export-audio-settings'
import { ExportSettingsFooter, type ExportSettingsFooterProps } from './export-settings-footer'
import type { ExportPreflightResult } from '../utils/export-preflight'

export interface ExportSettingsViewProps {
  sequencePicker: ExportSequencePickerProps
  modeToggle: ExportModeToggleProps
  rangeSummary: ExportRangeSummaryProps
  preflight: ExportPreflightResult | null
  video: ExportVideoSettingsProps
  audio: ExportAudioSettingsProps
  footer: ExportSettingsFooterProps
}

export function ExportSettingsView(props: ExportSettingsViewProps) {
  return (
    <div className="py-4">
      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          {/* Sequence picker — only when there's more than the Main timeline */}
          {props.sequencePicker.options.length > 1 && (
            <ExportSequencePicker {...props.sequencePicker} />
          )}

          <ExportModeToggle {...props.modeToggle} />

          <ExportRangeSummary {...props.rangeSummary} />

          <ExportPreflightPanel preflight={props.preflight} />
        </div>

        <div className="space-y-5 min-w-0">
          {props.modeToggle.mode === 'video' ? (
            <ExportVideoSettings {...props.video} />
          ) : (
            <ExportAudioSettings {...props.audio} />
          )}
        </div>
      </div>

      <ExportSettingsFooter {...props.footer} />
    </div>
  )
}
