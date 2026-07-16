import { describe, expect, it, vi } from 'vite-plus/test'
import type { ElectronLocalDirectoryBridge } from './types'
import { selectLocalDirectoryBackendKind } from './select-backend'

function electronBridge(): ElectronLocalDirectoryBridge {
  return {
    runtime: 'electron',
    version: 1,
    pickDirectory: vi.fn(),
    restoreGrant: vi.fn(),
    listGrants: vi.fn(),
    revokeGrant: vi.fn(),
    readFile: vi.fn(),
    createReadUrl: vi.fn(),
    writeFileAtomic: vi.fn(),
    listDirectory: vi.fn(),
    createDirectory: vi.fn(),
    exists: vi.fn(),
    stat: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
    selectAndCopyFiles: vi.fn(),
    onDidChange: vi.fn(),
  }
}

describe('selectLocalDirectoryBackendKind', () => {
  it('always prefers the standard File System Access API when both are present', () => {
    expect(
      selectLocalDirectoryBackendKind({
        showDirectoryPicker: vi.fn(),
        electronLocalDirectory: electronBridge(),
      }),
    ).toBe('file-system-access')
  })

  it('uses the controlled Electron bridge only when the standard picker is absent', () => {
    expect(
      selectLocalDirectoryBackendKind({
        electronLocalDirectory: electronBridge(),
      }),
    ).toBe('electron-directory')
  })

  it('returns null without either supported backend', () => {
    expect(selectLocalDirectoryBackendKind({})).toBeNull()
  })
})
