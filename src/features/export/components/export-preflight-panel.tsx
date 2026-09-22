/**
 * Preflight report shown on the settings step: the worst severity found, the
 * render path the export will take, and the checks worth reading.
 */

import { useTranslation } from 'react-i18next'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import {
  summarizePreflightSeverity,
  type ExportPreflightCheck,
  type ExportPreflightResult,
} from '../utils/export-preflight'

/** Tailwind text colour for a preflight severity (icon and check label alike). */
function severityTextClass(severity: ExportPreflightCheck['severity']): string {
  switch (severity) {
    case 'error':
      return 'text-destructive'
    case 'warning':
      return 'text-amber-500'
    case 'info':
      return 'text-blue-500'
    case 'ok':
      return 'text-green-500'
  }
}

export function ExportPreflightPanel({ preflight }: { preflight: ExportPreflightResult | null }) {
  const { t } = useTranslation()

  if (!preflight) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
        {t('export.preflight.checking')}
      </div>
    )
  }

  const summarySeverity = summarizePreflightSeverity(preflight.checks)
  const visibleChecks = preflight.checks.filter((check) => check.severity !== 'ok').slice(0, 4)
  const checksToRender = visibleChecks.length > 0 ? visibleChecks : preflight.checks.slice(0, 2)

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {summarySeverity === 'ok' ? (
            <CheckCircle2 className={`h-4 w-4 ${severityTextClass(summarySeverity)}`} />
          ) : (
            <AlertCircle className={`h-4 w-4 ${severityTextClass(summarySeverity)}`} />
          )}
          <span className="text-sm font-medium">{t('export.preflight.title')}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {preflight.predictedRenderPath === 'smart-copy'
            ? t('export.preflight.smartCopyPath')
            : preflight.predictedRenderPath === 'worker'
              ? t('export.preflight.workerPath')
              : t('export.preflight.fallback')}
        </span>
      </div>
      <div className="space-y-1.5">
        {checksToRender.map((check) => (
          <div key={check.id} className="text-xs leading-relaxed">
            <span className={severityTextClass(check.severity)}>
              {t(check.titleKey, check.titleParams)}
            </span>
            <span className="text-muted-foreground">
              {' '}
              — {t(check.detailKey, check.detailParams)}
            </span>
            {check.fixKey && (
              <span className="text-muted-foreground"> {t(check.fixKey, check.fixParams)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
