import { describe, expect, it } from 'vite-plus/test'
import { normalizeEditorWorkspaceId, normalizeEditorWorkspaceLayout } from './editor-workspaces'

describe('normalizeEditorWorkspaceId', () => {
  it('uses Motion as the workspace id and migrates former Animate and Compose ids', () => {
    expect(normalizeEditorWorkspaceId('motion')).toBe('motion')
    expect(normalizeEditorWorkspaceId('animate')).toBe('motion')
    expect(normalizeEditorWorkspaceId('compose')).toBe('motion')
  })
})

describe('workspace layout migration', () => {
  it('defaults missing or invalid positions and keeps valid positions', () => {
    expect(normalizeEditorWorkspaceLayout({}, 'edit').panelPosition).toBe('bottom')
    expect(
      normalizeEditorWorkspaceLayout({ panelPosition: 'diagonal' }, 'color').panelPosition,
    ).toBe('bottom')
    expect(normalizeEditorWorkspaceLayout({ panelPosition: 'right' }, 'motion').panelPosition).toBe(
      'right',
    )
  })
})
