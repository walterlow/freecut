import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { ExportPreflightCheck, ExportPreflightResult } from '../utils/export-preflight'
import { ExportPreflightPanel } from './export-preflight-panel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function check(
  id: string,
  severity: ExportPreflightCheck['severity'],
  extra: Partial<ExportPreflightCheck> = {},
): ExportPreflightCheck {
  return { id, severity, titleKey: `title.${id}`, detailKey: `detail.${id}`, ...extra }
}

function preflight(
  checks: ExportPreflightCheck[],
  predictedRenderPath: ExportPreflightResult['predictedRenderPath'] = 'worker',
): ExportPreflightResult {
  return {
    canExport: !checks.some((entry) => entry.severity === 'error'),
    checks,
    predictedRenderPath,
    estimatedDurationSeconds: 10,
  }
}

function findCheckLabel(id: string) {
  return screen.getByText(`title.${id}`)
}

describe('ExportPreflightPanel', () => {
  it('says it is still checking before the preflight reports', () => {
    render(<ExportPreflightPanel preflight={null} />)

    expect(screen.getByText('export.preflight.checking')).toBeTruthy()
  })

  it('lists the checks that are not ok, capped at four', () => {
    render(
      <ExportPreflightPanel
        preflight={preflight([
          check('warn-1', 'warning'),
          check('warn-2', 'warning'),
          check('warn-3', 'warning'),
          check('warn-4', 'warning'),
          check('warn-5', 'warning'),
          check('fine', 'ok'),
        ])}
      />,
    )

    expect(findCheckLabel('warn-1')).toBeTruthy()
    expect(findCheckLabel('warn-4')).toBeTruthy()
    expect(screen.queryByText('title.warn-5')).toBeNull()
    expect(screen.queryByText('title.fine')).toBeNull()
  })

  it('falls back to the first two checks when everything is ok', () => {
    render(
      <ExportPreflightPanel
        preflight={preflight([check('ok-1', 'ok'), check('ok-2', 'ok'), check('ok-3', 'ok')])}
      />,
    )

    expect(findCheckLabel('ok-1')).toBeTruthy()
    expect(findCheckLabel('ok-2')).toBeTruthy()
    expect(screen.queryByText('title.ok-3')).toBeNull()
  })

  it('colours each check label by its own severity, not the summary', () => {
    render(
      <ExportPreflightPanel
        preflight={preflight([check('bad', 'error'), check('meh', 'warning'), check('fyi', 'info')])}
      />,
    )

    expect(findCheckLabel('bad').className).toBe('text-destructive')
    expect(findCheckLabel('meh').className).toBe('text-amber-500')
    expect(findCheckLabel('fyi').className).toBe('text-blue-500')
  })

  it('names the render path the export will take', () => {
    const { rerender } = render(
      <ExportPreflightPanel preflight={preflight([check('ok', 'ok')], 'smart-copy')} />,
    )
    expect(screen.getByText('export.preflight.smartCopyPath')).toBeTruthy()

    rerender(<ExportPreflightPanel preflight={preflight([check('ok', 'ok')], 'main-thread')} />)
    expect(screen.getByText('export.preflight.fallback')).toBeTruthy()
  })

  it('shows a fix hint only for checks that have one', () => {
    render(
      <ExportPreflightPanel
        preflight={preflight([
          check('with-fix', 'warning', { fixKey: 'fix.with-fix' }),
          check('without-fix', 'warning'),
        ])}
      />,
    )

    expect(screen.getByText(/fix\.with-fix/)).toBeTruthy()
    expect(screen.getByText(/detail\.without-fix/).textContent).not.toMatch(/fix\./)
  })
})
