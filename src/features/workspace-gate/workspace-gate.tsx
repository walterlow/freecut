/**
 * WorkspaceGate
 *
 * Wraps the router and, when the current URL is a storage-dependent route
 * (`/projects*` or `/editor*`), blocks it until the user has picked a
 * workspace folder and granted read/write permission:
 *
 *   1. Check handles-db for a saved workspace handle
 *   2. If missing → show splash prompting user to pick a folder
 *   3. If present → queryPermission; if granted, set the active root and
 *      render the children. If revoked, show a Reconnect splash.
 *
 * The landing page (`/`) is not a storage-dependent route — it renders
 * without waiting for the gate, so users see no splash flash on first
 * visit. Navigating into a protected route after the handle is initialized
 * falls through to the "ready" path without additional UI.
 *
 * Also listens for permission-lost signals from fs-primitives and flips
 * back to the Reconnect state mid-session.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ensureKnownWorkspaceForCurrent,
  getWorkspaceHandleRecord,
  queryHandlePermission,
  requestHandlePermission,
  saveWorkspaceHandleRecord,
} from '@/infrastructure/storage/handles-db'
import { onPermissionLost, setWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import { ElectronDirectoryBackend } from '@/infrastructure/storage/local-directory/electron-directory-backend'
import { getElectronLocalDirectoryBridge } from '@/infrastructure/storage/local-directory/electron-directory-backend'
import type { LocalDirectoryBackend } from '@/infrastructure/storage/local-directory/types'
import { selectLocalDirectoryBackendKind } from '@/infrastructure/storage/local-directory/select-backend'
import { createLogger } from '@/shared/logging/logger'
import { WorkspaceGateSplash } from './workspace-gate-splash'
import { usePathname } from './use-pathname'

/**
 * Routes that read/write the workspace and therefore need the gate to be
 * ready before their loaders run. Anything else renders freely without
 * waiting on storage initialization.
 */
function isStorageProtectedPath(pathname: string): boolean {
  return pathname.startsWith('/projects') || pathname.startsWith('/editor')
}

const logger = createLogger('WorkspaceGate')
const ELECTRON_GRANT_STORAGE_KEY = 'freecut:electron-directory-grant'

type GateStatus =
  | { kind: 'initializing' }
  | { kind: 'unavailable' } // Non-Chromium browsers
  | { kind: 'pick' } // No saved handle
  | { kind: 'reconnect'; handleName: string } // Saved handle, permission revoked
  | { kind: 'ready' }

export function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<GateStatus>({ kind: 'initializing' })
  const [error, setError] = useState<string | null>(null)
  const { t } = useTranslation()
  const pathname = usePathname()
  const needsWorkspace = isStorageProtectedPath(pathname)

  const activate = useCallback(async (root: FileSystemDirectoryHandle | LocalDirectoryBackend) => {
    setWorkspaceRoot(root)
    try {
      const { bootstrapWorkspace } = await import('@/infrastructure/storage/workspace-fs/bootstrap')
      await bootstrapWorkspace(root)
    } catch (error) {
      logger.warn('bootstrapWorkspace failed', error)
    }
    // Fire the auto-purge sweep for long-trashed projects in the
    // background — it touches disk and we don't want it to block the
    // app render. Wrapped in setTimeout so it runs after first paint.
    setTimeout(() => {
      void import('./deps/trash-auto-purge').then(({ autoPurgeExpiredTrash }) =>
        autoPurgeExpiredTrash(),
      )
    }, 0)
    setStatus({ kind: 'ready' })
    window.dispatchEvent(new Event('freecut:ensure-toaster'))
  }, [])

  // Initial load: check if we have a saved handle, check its permission.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (selectLocalDirectoryBackendKind(window) === 'file-system-access') {
        // Promote any legacy `workspace:current` into a proper known-workspace
        // record before we read it, so the indicator's list includes it.
        await ensureKnownWorkspaceForCurrent()
        const record = await getWorkspaceHandleRecord()
        if (!record) {
          if (!cancelled) setStatus({ kind: 'pick' })
          return
        }
        const handle = record.handle as FileSystemDirectoryHandle
        const permission = await queryHandlePermission(handle)
        if (cancelled) return
        if (permission === 'granted') {
          await activate(handle)
        } else {
          setStatus({ kind: 'reconnect', handleName: record.name })
        }
        return
      }

      const bridge = getElectronLocalDirectoryBridge()
      if (!bridge) {
        if (!cancelled) setStatus({ kind: 'unavailable' })
        return
      }
      const savedGrantId = localStorage.getItem(ELECTRON_GRANT_STORAGE_KEY)
      const restored = savedGrantId ? await bridge.restoreGrant(savedGrantId) : null
      const grant = restored ?? (await bridge.listGrants())[0] ?? null
      if (cancelled) return
      if (!grant) {
        setStatus({ kind: 'pick' })
        return
      }
      localStorage.setItem(ELECTRON_GRANT_STORAGE_KEY, grant.grantId)
      await activate(new ElectronDirectoryBackend(bridge, grant))
    })().catch((error) => {
      logger.error('Gate initialization failed', error)
      if (!cancelled) setStatus({ kind: 'pick' })
    })
    return () => {
      cancelled = true
    }
  }, [activate])

  // Permission-lost mid-session → flip to reconnect.
  useEffect(() => {
    const unsubscribe = onPermissionLost(() => {
      void (async () => {
        const record = await getWorkspaceHandleRecord()
        setStatus({ kind: 'reconnect', handleName: record?.name ?? 'workspace' })
      })()
    })
    return () => {
      unsubscribe()
    }
  }, [])

  const handlePick = useCallback(async () => {
    setError(null)
    try {
      if (selectLocalDirectoryBackendKind(window) === 'file-system-access') {
        const handle = await window.showDirectoryPicker({
          id: 'freecut-workspace',
          mode: 'readwrite',
          startIn: 'documents',
        })
        const queryState = await queryHandlePermission(handle)
        const finalState =
          queryState === 'granted' ? queryState : await requestHandlePermission(handle)
        if (finalState !== 'granted') {
          setError(t('projects.workspaceGate.folderPermissionDenied'))
          setStatus({ kind: 'reconnect', handleName: handle.name })
          return
        }
        await saveWorkspaceHandleRecord(handle)
        await activate(handle)
        return
      }

      const bridge = getElectronLocalDirectoryBridge()
      if (!bridge) {
        setStatus({ kind: 'unavailable' })
        return
      }
      const grant = await bridge.pickDirectory({ mode: 'readwrite' })
      if (!grant) return
      localStorage.setItem(ELECTRON_GRANT_STORAGE_KEY, grant.grantId)
      await activate(new ElectronDirectoryBackend(bridge, grant))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        // User cancelled the picker; stay on splash.
        return
      }
      logger.error('Folder pick failed', error)
      setError(t('projects.workspaceGate.folderPickFailed'))
    }
  }, [activate, t])

  const handleReconnect = useCallback(async () => {
    setError(null)
    const backendKind = selectLocalDirectoryBackendKind(window)
    if (backendKind === 'file-system-access') {
      const record = await getWorkspaceHandleRecord()
      if (!record) {
        setStatus({ kind: 'pick' })
        return
      }
      const handle = record.handle as FileSystemDirectoryHandle
      const permission = await requestHandlePermission(handle)
      if (permission === 'granted') {
        await activate(handle)
        return
      }
      setError(t('projects.workspaceGate.reconnectPermissionDenied'))
      return
    }

    if (backendKind !== 'electron-directory') {
      setStatus({ kind: 'unavailable' })
      return
    }

    const bridge = getElectronLocalDirectoryBridge()
    const grantId = localStorage.getItem(ELECTRON_GRANT_STORAGE_KEY)
    if (!bridge || !grantId) {
      setStatus({ kind: 'pick' })
      return
    }
    const grant = await bridge.restoreGrant(grantId)
    if (!grant) {
      setStatus({ kind: 'pick' })
      return
    }
    await activate(new ElectronDirectoryBackend(bridge, grant))
  }, [activate, t])

  // Routes that don't touch storage never wait on the gate — no splash, no
  // flash, even on first load while we're checking handles-db.
  if (!needsWorkspace) {
    return <>{children}</>
  }

  if (status.kind === 'ready') {
    return <>{children}</>
  }

  // On protected routes during initialization, render a bare background
  // block so the transition from "checking" to "ready" or "splash" is
  // invisible instead of a logo+spinner flash.
  if (status.kind === 'initializing') {
    return <div className="min-h-screen bg-background" aria-hidden="true" />
  }

  return (
    <WorkspaceGateSplash
      status={status}
      error={error}
      onPickFolder={handlePick}
      onReconnect={handleReconnect}
    />
  )
}
