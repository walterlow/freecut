import type { ElectronLocalDirectoryBridge, LocalDirectoryKind } from './types'

type LocalDirectoryRuntime = {
  showDirectoryPicker?: unknown
  electronLocalDirectory?: ElectronLocalDirectoryBridge
}

export function selectLocalDirectoryBackendKind(
  runtime: LocalDirectoryRuntime,
): LocalDirectoryKind | null {
  if (typeof runtime.showDirectoryPicker === 'function') {
    return 'file-system-access'
  }
  if (
    runtime.electronLocalDirectory?.runtime === 'electron' &&
    runtime.electronLocalDirectory.version === 1
  ) {
    return 'electron-directory'
  }
  return null
}
