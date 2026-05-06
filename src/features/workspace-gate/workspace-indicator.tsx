/**
 * WorkspaceIndicator
 *
 * Lists every known workspace in a popover, marks the active one, and
 * exposes inline controls per workspace:
 *   - Switch       activate a different known workspace
 *   - Remove       forget the workspace (with inline Yes/Cancel confirm)
 *   - Add new…     pick another folder and set it as active
 *
 * All mutating actions reload the page so `WorkspaceGate` re-runs with
 * the new state. Reload is a sledgehammer but keeps the UX simple and
 * avoids plumbing a workspace-changed signal through every cached store.
 */

import { useCallback, useEffect, useState } from 'react'
import { Check, FolderOpen, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createLogger } from '@/shared/logging/logger'
import {
  activateWorkspaceHandle,
  getWorkspaceHandleRecord,
  listKnownWorkspaces,
  queryHandlePermission,
  removeKnownWorkspace,
  requestHandlePermission,
  saveWorkspaceHandleRecord,
  type HandleRecord,
} from '@/infrastructure/storage/handles-db'

const logger = createLogger('WorkspaceIndicator')

interface WorkspaceEntry {
  record: HandleRecord
  isActive: boolean
}

export function WorkspaceIndicator() {
  const [entries, setEntries] = useState<WorkspaceEntry[] | null>(null)
  const [activeName, setActiveName] = useState<string | null>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)

  const loadEntries = useCallback(async () => {
    try {
      const [known, current] = await Promise.all([
        listKnownWorkspaces(),
        getWorkspaceHandleRecord(),
      ])
      const activeId = current?.activeWorkspaceId ?? null
      setActiveName(current?.name ?? null)
      setEntries(
        known.map((record) => ({
          record,
          isActive: record.id === activeId,
        })),
      )
    } catch (error) {
      logger.warn('Failed to load workspaces', error)
      setEntries([])
    }
  }, [])

  useEffect(() => {
    void loadEntries()
  }, [loadEntries])

  // Reset the per-row remove-confirm whenever the popover closes, so a
  // subsequent open always starts from the list view.
  useEffect(() => {
    if (!popoverOpen) setConfirmRemoveId(null)
  }, [popoverOpen])

  const handleAdd = useCallback(async () => {
    try {
      const handle = await window.showDirectoryPicker({
        id: 'freecut-workspace',
        mode: 'readwrite',
        startIn: 'documents',
      })
      const existing = await queryHandlePermission(handle)
      const granted = existing === 'granted' ? existing : await requestHandlePermission(handle)
      if (granted !== 'granted') return
      await saveWorkspaceHandleRecord(handle)
      window.location.reload()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      logger.error('Add workspace failed', error)
    }
  }, [])

  const handleSwitch = useCallback(async (workspaceId: string) => {
    try {
      const record = await activateWorkspaceHandle(workspaceId)
      if (!record) return
      // A previously-granted handle may have lost permission between sessions;
      // request again before reloading.
      const handle = record.handle as FileSystemDirectoryHandle
      const existing = await queryHandlePermission(handle)
      const granted = existing === 'granted' ? existing : await requestHandlePermission(handle)
      if (granted !== 'granted') {
        // Reload anyway so WorkspaceGate surfaces the reconnect splash.
      }
      window.location.reload()
    } catch (error) {
      logger.error(`Switch workspace failed (${workspaceId})`, error)
    }
  }, [])

  const handleRemove = useCallback(
    async (workspaceId: string, wasActive: boolean) => {
      try {
        await removeKnownWorkspace(workspaceId)
        if (wasActive) {
          window.location.reload()
          return
        }
        await loadEntries()
        setConfirmRemoveId(null)
      } catch (error) {
        logger.error(`Remove workspace failed (${workspaceId})`, error)
      }
    },
    [loadEntries],
  )

  // Don't render anything until we've finished loading.
  if (entries === null) return null
  // When there's no active workspace, the gate is on-screen instead.
  if (!activeName) return null

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="lg"
          className="gap-2 max-w-[220px]"
          data-tooltip="Workspace folder"
          data-tooltip-side="bottom"
        >
          <FolderOpen className="w-4 h-4 shrink-0" />
          <span className="truncate">{activeName}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="end">
        <div className="text-xs font-medium text-muted-foreground px-2 py-1">Workspaces</div>

        <div className="flex flex-col">
          {entries.map(({ record, isActive }) => {
            const isConfirming = confirmRemoveId === record.id
            return (
              <div
                key={record.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent"
              >
                <FolderOpen className="w-4 h-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate text-sm" title={record.name}>
                  {record.name}
                </span>
                {isActive && (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                    <Check className="w-3 h-3" /> Active
                  </span>
                )}
                {isConfirming ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setConfirmRemoveId(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => void handleRemove(record.id, isActive)}
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <>
                    {!isActive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => void handleSwitch(record.id)}
                      >
                        Switch
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      aria-label="Remove workspace"
                      onClick={() => setConfirmRemoveId(record.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
              </div>
            )
          })}
        </div>

        <div className="h-px bg-border my-1" />

        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => void handleAdd()}
        >
          <Plus className="w-4 h-4" />
          Add workspace…
        </Button>
      </PopoverContent>
    </Popover>
  )
}
