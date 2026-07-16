/**
 * Active workspace root owner.
 *
 * Holds the active local-directory backend the app writes to.
 * The backend is either the standard File System Access API or the generic
 * Electron local-directory bridge.
 *
 * Kept deliberately minimal — no React, no Zustand. This is the lowest
 * layer: pure getter/setter + permission-lost signaling.
 */

import { createLogger } from '@/shared/logging/logger'
import { FileSystemAccessDirectoryBackend } from '@/infrastructure/storage/local-directory/file-system-access-backend'
import type { LocalDirectoryBackend } from '@/infrastructure/storage/local-directory/types'

const logger = createLogger('WorkspaceRoot')

let activeRoot: LocalDirectoryBackend | null = null

type PermissionLostListener = () => void
const permissionLostListeners = new Set<PermissionLostListener>()

export function setWorkspaceRoot(
  root: FileSystemDirectoryHandle | LocalDirectoryBackend | null,
): void {
  activeRoot = root ? toBackend(root) : null
  if (activeRoot) {
    logger.info(`Workspace root set: ${activeRoot.name}`, { backend: activeRoot.kind })
  } else {
    logger.info('Workspace root cleared')
  }
}

export function getWorkspaceRoot(): LocalDirectoryBackend | null {
  return activeRoot
}

/**
 * Return the active root or throw — every storage operation calls this.
 * Throwing is correct: if WorkspaceGate did its job, a storage op can
 * never run without an active root.
 */
export function requireWorkspaceRoot(): LocalDirectoryBackend {
  if (!activeRoot) {
    throw new Error(
      'Workspace root is not set. The app must render <WorkspaceGate> before any storage operation runs.',
    )
  }
  return activeRoot
}

function toBackend(root: FileSystemDirectoryHandle | LocalDirectoryBackend): LocalDirectoryBackend {
  if (isLocalDirectoryBackend(root)) {
    return root
  }
  return new FileSystemAccessDirectoryBackend(root)
}

function isLocalDirectoryBackend(
  root: FileSystemDirectoryHandle | LocalDirectoryBackend,
): root is LocalDirectoryBackend {
  const kind = (root as { kind?: unknown }).kind
  return kind === 'file-system-access' || kind === 'electron-directory'
}

/**
 * Subscribe to permission-lost events. Fires when any FS op catches
 * a NotAllowedError from the active root — UI can show a Reconnect modal.
 */
export function onPermissionLost(listener: PermissionLostListener): () => void {
  permissionLostListeners.add(listener)
  return () => permissionLostListeners.delete(listener)
}

export function notifyPermissionLost(): void {
  logger.warn('Permission lost on workspace root')
  for (const listener of permissionLostListeners) {
    try {
      listener()
    } catch (error) {
      logger.warn('permission-lost listener threw', error)
    }
  }
}
