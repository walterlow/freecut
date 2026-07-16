import { describe, expect, it, vi } from 'vite-plus/test'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { ProjectSyncConflictDialog } from './project-sync-conflict-dialog'

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { revision?: string }) => {
      const labels: Record<string, string> = {
        'editor.editor.syncConflict.title': 'External edits are waiting',
        'editor.editor.syncConflict.description': 'Choose how to continue.',
        'editor.editor.syncConflict.revision': `External revision: ${values?.revision ?? ''}`,
        'editor.editor.syncConflict.keepBoth': 'Keep both',
        'editor.editor.syncConflict.keepBothHint': 'Save a conflict copy.',
        'editor.editor.syncConflict.useExternal': 'Use Headless',
        'editor.editor.syncConflict.useExternalHint': 'Apply the external revision.',
        'editor.editor.syncConflict.useEditor': 'Use editor',
        'editor.editor.syncConflict.useEditorHint': 'Save the editor revision.',
        'editor.editor.syncConflict.later': 'Decide later',
      }
      return labels[key] ?? key
    },
  }),
}))

function renderDialog(overrides: Partial<Parameters<typeof ProjectSyncConflictDialog>[0]> = {}) {
  const props = {
    open: true,
    revision: 'abcdef1234567890',
    busy: false,
    error: null,
    onOpenChange: vi.fn(),
    onKeepBoth: vi.fn(),
    onUseExternal: vi.fn(),
    onUseEditor: vi.fn(),
    onLater: vi.fn(),
    ...overrides,
  }
  render(<ProjectSyncConflictDialog {...props} />)
  return props
}

describe('ProjectSyncConflictDialog', () => {
  it('offers all four conflict strategies and reports the queued revision', () => {
    const props = renderDialog()

    expect(screen.getByText('External revision: abcdef123456')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Keep both/u }))
    fireEvent.click(screen.getByRole('button', { name: /Use Headless/u }))
    fireEvent.click(screen.getByRole('button', { name: /Use editor/u }))
    fireEvent.click(screen.getByRole('button', { name: 'Decide later' }))

    expect(props.onKeepBoth).toHaveBeenCalledOnce()
    expect(props.onUseExternal).toHaveBeenCalledOnce()
    expect(props.onUseEditor).toHaveBeenCalledOnce()
    expect(props.onLater).toHaveBeenCalledOnce()
  })

  it('disables every resolution while another strategy is being applied', () => {
    renderDialog({ busy: true })

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
    }
  })

  it('surfaces a resolution error without closing the dialog', () => {
    renderDialog({ error: 'Could not save the conflict copy' })

    expect(screen.getByRole('alert')).toHaveTextContent('Could not save the conflict copy')
  })
})
