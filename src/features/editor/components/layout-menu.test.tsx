import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEditorStore } from '@/shared/state/editor'
import { LayoutEditor } from './layout-menu'

describe('layout editor', () => {
  beforeEach(() => {
    useEditorStore.setState({ workspace: 'edit', panelPosition: 'bottom', layoutEditing: true })
  })
  afterEach(cleanup)

  it('lets keyboard and pointer users choose a position and close the editor', () => {
    render(<LayoutEditor />)
    const right = screen.getByRole('button', { name: 'Right' })
    fireEvent.click(right)
    expect(right).toHaveAttribute('aria-pressed', 'true')
    expect(useEditorStore.getState().panelPosition).toBe('right')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Edit layout' })).not.toBeInTheDocument()
  })

  it('keeps editor shortcuts from seeing keys pressed in the layout editor', () => {
    const shortcut = vi.fn()
    // Editor hotkeys listen on document in the capture phase.
    document.addEventListener('keydown', shortcut, true)
    try {
      render(<LayoutEditor />)
      fireEvent.keyDown(screen.getByRole('button', { name: 'Right' }), { key: ' ' })
      fireEvent.keyDown(screen.getByRole('region', { name: 'Edit layout' }), { key: 'Delete' })
      expect(shortcut).not.toHaveBeenCalled()
      expect(useEditorStore.getState().layoutEditing).toBe(true)
    } finally {
      document.removeEventListener('keydown', shortcut, true)
    }
  })

  it('moves the panel when dropped on a position', () => {
    render(<LayoutEditor />)
    const dataTransfer = { getData: () => 'surface' }
    fireEvent.drop(screen.getByRole('button', { name: 'Left' }), { dataTransfer })
    expect(useEditorStore.getState().panelPosition).toBe('left')
  })
})
