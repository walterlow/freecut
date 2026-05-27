/**
 * WorkspaceGate
 *
 * Initializes the OPFS-backed workspace automatically on mount — no folder
 * picker, no permission prompt, no splash screen.  Blocks storage-dependent
 * routes (`/projects*`, `/editor*`) until OPFS is ready, then renders the
 * children immediately.
 */

import { useEffect, useState } from 'react'
import { setWorkspaceRoot } from '@/infrastructure/storage/workspace-fs/root'
import { bootstrapWorkspace } from '@/infrastructure/storage/workspace-fs/bootstrap'
import { createLogger } from '@/shared/logging/logger'
import { usePathname } from './use-pathname'
import { autoPurgeExpiredTrash } from './deps/trash-auto-purge'

function isStorageProtectedPath(pathname: string): boolean {
  return pathname.startsWith('/projects') || pathname.startsWith('/editor')
}

const logger = createLogger('WorkspaceGate')

export function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const pathname = usePathname()
  const needsWorkspace = isStorageProtectedPath(pathname)

  useEffect(() => {
    ;(async () => {
      try {
        const handle = await navigator.storage.getDirectory()
        setWorkspaceRoot(handle)
        try {
          await bootstrapWorkspace(handle)
        } catch (error) {
          logger.warn('bootstrapWorkspace failed', error)
        }
        setTimeout(() => {
          void autoPurgeExpiredTrash()
        }, 0)
      } catch (error) {
        logger.error('OPFS initialization failed', error)
      }
      setReady(true)
    })()
  }, [])

  if (!needsWorkspace) return <>{children}</>
  if (!ready) return <div className="min-h-screen bg-background" aria-hidden="true" />
  return <>{children}</>
}
