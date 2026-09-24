/**
 * Capability warnings above the video format fields: the browser probe failed,
 * or it supports none of the container/codec combinations on offer.
 */

import { useTranslation } from 'react-i18next'
import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'

export interface ExportCapabilityAlertsProps {
  /** The codec probe is still running — say nothing until it reports. */
  isCheckingSupport: boolean
  /** Message from a failed probe, or null when it reported. */
  supportError: string | null
  /** Whether any container/codec pair the probe reported is usable. */
  hasSupportedPath: boolean
  width: number
  height: number
}

export function ExportCapabilityAlerts({
  isCheckingSupport,
  supportError,
  hasSupportedPath,
  width,
  height,
}: ExportCapabilityAlertsProps) {
  const { t } = useTranslation()

  if (isCheckingSupport) return null

  if (supportError) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{t('export.settings.codecSupportUnverified')}</AlertDescription>
      </Alert>
    )
  }

  if (hasSupportedPath) return null

  return (
    <Alert>
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>{t('export.settings.cannotEncode', { width, height })}</AlertDescription>
    </Alert>
  )
}
