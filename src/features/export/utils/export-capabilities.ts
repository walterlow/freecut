/**
 * Capability-driven gating for the export dialog: the option the dialog falls
 * back to once the codec probe reports, and whether the export actions are
 * usable at all. Pure — the dialog owns the state these read from.
 */

import type { ExportMode, ExportSettings } from '@/types/export'
import type { ExportPreflightResult } from './export-preflight'
import type { VideoCodecOption, VideoContainerOption } from './export-options'
import type { ClientVideoContainer } from '../deps/renderer'

/**
 * Container to switch to when the probe rules the current one out; `null` when
 * the current container is still supported (or nothing at all is).
 */
export function resolveSupportedContainer(
  options: VideoContainerOption[],
  currentContainer: ClientVideoContainer,
): ClientVideoContainer | null {
  const currentSupported = options.some(
    (option) => option.value === currentContainer && option.supported,
  )
  if (currentSupported) return null

  const firstSupported = options.find((option) => option.supported)
  return firstSupported ? firstSupported.value : null
}

/**
 * Codec the dialog must fall back to when the probe rules the selected one out
 * — the best probed codec, or the container's own first codec. `null` when the
 * current codec is still encodable.
 */
export function resolveFallbackCodec(
  options: VideoCodecOption[],
  currentCodec: ExportSettings['codec'],
): ExportSettings['codec'] | null {
  const validCodecs = options.filter((option) => option.supported).map((option) => option.value)
  if (validCodecs.includes(currentCodec)) return null

  return validCodecs[0] ?? options[0]?.value ?? null
}

/** Whether the preflight reported an error the user must resolve before exporting. */
export function doesPreflightBlockExport(preflight: ExportPreflightResult | null): boolean {
  if (preflight === null) return false

  return preflight.checks.some((check) => check.severity === 'error')
}

export interface ExportActionGateInput {
  exportMode: ExportMode
  smartCopyWillRun: boolean
  /** At least one container the probed codecs can serve. */
  hasSupportedVideoPath: boolean
  isCheckingVideoSupport: boolean
  preflightBlocksExport: boolean
}

/** Whether "Export" and "Add to queue" must stay disabled for the current settings. */
export function areExportActionsDisabled(input: ExportActionGateInput): boolean {
  if (input.preflightBlocksExport) return true
  if (input.exportMode !== 'video') return false

  return !input.smartCopyWillRun && (!input.hasSupportedVideoPath || input.isCheckingVideoSupport)
}
