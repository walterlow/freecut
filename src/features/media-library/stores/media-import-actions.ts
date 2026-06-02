import type { MediaLibraryState, MediaLibraryActions, UnsupportedCodecFile } from '../types'
import type { MediaMetadata } from '@/types/storage'
import { importMediaLibraryService } from '../services/media-library-service-loader'
import { proxyService } from '../services/proxy-service'
import { getMimeType } from '../utils/validation'
import { getSharedProxyKey } from '../utils/proxy-key'
import { hasMediaFilePickerSupport, showMediaFilePicker } from '../utils/media-file-picker'
import { createLogger, createOperationId } from '@/shared/logging/logger'
import { useMediaPreparationStore } from './media-preparation-store'

const logger = createLogger('MediaImport')

type Set = (
  partial:
    | Partial<MediaLibraryState>
    | ((state: MediaLibraryState & MediaLibraryActions) => Partial<MediaLibraryState>),
) => void
type Get = () => MediaLibraryState & MediaLibraryActions

type ImportedMetadata = MediaMetadata & { isDuplicate?: boolean; hasUnsupportedCodec?: boolean }

const IMPORT_PROCESSING_CONCURRENCY = 2

interface ImportTask {
  handle: FileSystemFileHandle
  tempId: string
  file: File
}

interface CompletedImportTask extends ImportTask {
  metadata: ImportedMetadata
}

function buildOptimisticMediaItem(
  handle: FileSystemFileHandle,
  file: File,
  tempId: string,
): MediaMetadata {
  const now = Date.now()

  return {
    id: tempId,
    storageType: 'handle',
    fileHandle: handle,
    fileName: file.name,
    fileSize: file.size,
    fileLastModified: file.lastModified,
    mimeType: getMimeType(file),
    duration: 0,
    width: 0,
    height: 0,
    fps: 30,
    codec: 'importing...',
    bitrate: 0,
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
}

function removeImportPlaceholder(set: Set, tempId: string): void {
  useMediaPreparationStore.getState().clearMedia(tempId)

  set((state) => ({
    mediaItems: state.mediaItems.filter((item) => item.id !== tempId),
    importingIds: state.importingIds.filter((id) => id !== tempId),
  }))
}

/**
 * Drop the optimistic placeholder and guarantee the resolved media record is
 * visible in the library exactly once.
 *
 * Used for BOTH fresh imports and "duplicate" results. A re-imported file is
 * flagged `isDuplicate` whenever it already has a `media-links.json`
 * association with the project — but that association can outlive the file's
 * presence in the in-memory library (the user removed it from the library
 * view, or the association was re-backfilled from a lingering timeline clip).
 * The old duplicate path only removed the placeholder, so re-importing such a
 * file showed "already exists in library" while the file stayed invisible and
 * un-recoverable without a full reload. Surfacing it here fixes that.
 *
 * Also resilient to a concurrent `loadMediaItems()` wiping the placeholder
 * mid-import: the record is prepended rather than silently dropped.
 */
function ensureImportedMediaVisible(set: Set, tempId: string, metadata: MediaMetadata): boolean {
  let wasAlreadyVisible = false
  useMediaPreparationStore.getState().clearMedia(tempId)

  set((state) => {
    const withoutPlaceholder = state.mediaItems.filter((item) => item.id !== tempId)
    wasAlreadyVisible = withoutPlaceholder.some((item) => item.id === metadata.id)

    return {
      mediaItems: wasAlreadyVisible
        ? withoutPlaceholder.map((item) => (item.id === metadata.id ? metadata : item))
        : [metadata, ...withoutPlaceholder],
      importingIds: state.importingIds.filter((id) => id !== tempId),
    }
  })
  return wasAlreadyVisible
}

function prependImportedMedia(set: Set, metadata: MediaMetadata): void {
  set((state) => ({
    mediaItems: [metadata, ...state.mediaItems.filter((item) => item.id !== metadata.id)],
    error: null,
    errorLink: null,
  }))
}

function setupImportedVideoProxy(metadata: MediaMetadata): void {
  if (!proxyService.canGenerateProxy(metadata.mimeType)) {
    return
  }

  proxyService.setProxyKey(metadata.id, getSharedProxyKey(metadata))
}

function queueImportPreparationTask(tempId: string): void {
  const preparationStore = useMediaPreparationStore.getState()
  preparationStore.queueTask(tempId, 'import')
  preparationStore.updateTask(tempId, 'import', { status: 'queued', progress: 0.05 })
}

function markImportPreparationRunning(tempId: string): void {
  useMediaPreparationStore
    .getState()
    .updateTask(tempId, 'import', { status: 'running', progress: 0.2 })
}

function processImportResults(
  importResults: PromiseSettledResult<CompletedImportTask>[],
  importTasks: ImportTask[],
  set: Set,
  options?: { includeDuplicatesInResults?: boolean },
): {
  results: MediaMetadata[]
  importedCount: number
  duplicateNames: string[]
  unsupportedCodecFiles: UnsupportedCodecFile[]
  failedCount: number
} {
  const results: MediaMetadata[] = []
  const duplicateNames: string[] = []
  const unsupportedCodecFiles: UnsupportedCodecFile[] = []
  let importedCount = 0
  let failedCount = 0

  importResults.forEach((result, index) => {
    const importTask = importTasks[index]
    if (!importTask) {
      return
    }

    if (result.status === 'fulfilled') {
      const { metadata, tempId, file, handle } = result.value

      const wasAlreadyVisible = ensureImportedMediaVisible(set, tempId, metadata)

      // "already exists in library" should only fire for a genuine no-op:
      // re-importing a file that is ALREADY visible in this project's library.
      // A file flagged `isDuplicate` merely has a project↔media association —
      // which the by-design cross-workspace dedup re-creates when you re-import
      // a file you'd removed. Surfacing that as "already exists" is wrong; it's
      // a normal (re-)add, so fall through to the import branch with no banner.
      if (metadata.isDuplicate && wasAlreadyVisible) {
        duplicateNames.push(file.name)
        if (options?.includeDuplicatesInResults) {
          results.push(metadata)
        }
      } else {
        setupImportedVideoProxy(metadata)
        results.push(metadata)
        importedCount += 1

        if (metadata.hasUnsupportedCodec && metadata.audioCodec) {
          unsupportedCodecFiles.push({
            fileName: file.name,
            audioCodec: metadata.audioCodec,
            handle,
          })
        }
      }
    } else {
      failedCount++
      removeImportPlaceholder(set, importTask.tempId)
      logger.error(`Failed to import ${importTask.file.name}`, result.reason)
    }
  })

  return { results, importedCount, duplicateNames, unsupportedCodecFiles, failedCount }
}

function pluralFile(count: number): string {
  return count === 1 ? 'file' : 'files'
}

function formatNameList(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

function buildImportSummaryMessage({
  importedCount,
  duplicateNames,
  unsupportedCodecFiles,
  failedCount,
}: {
  importedCount: number
  duplicateNames: string[]
  unsupportedCodecFiles: UnsupportedCodecFile[]
  failedCount: number
}): string | null {
  const hasProblems =
    duplicateNames.length > 0 || unsupportedCodecFiles.length > 0 || failedCount > 0
  if (!hasProblems) return null

  const parts: string[] = []

  // Keep clean imports quiet, but include the successful count when the user
  // also needs to know what was skipped or failed.
  if (importedCount > 0) {
    parts.push(`Imported ${importedCount} ${pluralFile(importedCount)}.`)
  }

  if (duplicateNames.length > 0) {
    if (importedCount === 0 && unsupportedCodecFiles.length === 0 && failedCount === 0) {
      parts.push(
        duplicateNames.length === 1
          ? `"${duplicateNames[0]}" already exists in library`
          : `${duplicateNames.length} files already exist in library`,
      )
    } else if (duplicateNames.length === 1) {
      parts.push(`Skipped 1 duplicate: ${duplicateNames[0]}.`)
    } else {
      parts.push(`Skipped ${duplicateNames.length} duplicates: ${formatNameList(duplicateNames)}.`)
    }
  }

  if (unsupportedCodecFiles.length > 0) {
    const codecList = [...new Set(unsupportedCodecFiles.map((f) => f.audioCodec))].join(', ')
    parts.push(
      `${unsupportedCodecFiles.length} ${pluralFile(
        unsupportedCodecFiles.length,
      )} ${unsupportedCodecFiles.length === 1 ? 'has' : 'have'} unsupported audio codec (${codecList}). Waveforms may not be available.`,
    )
  }

  if (failedCount > 0) {
    parts.push(
      failedCount === 1
        ? '1 file failed to import. Check the file and try again.'
        : `${failedCount} files failed to import. Check the files and try again.`,
    )
  }

  return parts.length > 0 ? parts.join(' ') : null
}

function showImportNotifications(
  importedCount: number,
  duplicateNames: string[],
  unsupportedCodecFiles: UnsupportedCodecFile[],
  failedCount: number,
  get: Get,
): void {
  const message = buildImportSummaryMessage({
    importedCount,
    duplicateNames,
    unsupportedCodecFiles,
    failedCount,
  })
  if (!message) return

  const type = failedCount > 0 || unsupportedCodecFiles.length > 0 ? 'warning' : 'info'
  get().showNotification({ type, message })
}

export function createImportActions(
  set: Set,
  get: Get,
): Pick<
  MediaLibraryActions,
  'importMedia' | 'importMediaFromUrl' | 'importHandles' | 'importHandlesForPlacement'
> {
  const createOptimisticImportTasks = async (
    handles: FileSystemFileHandle[],
  ): Promise<ImportTask[]> => {
    const importTasks: ImportTask[] = []

    for (const handle of handles) {
      if (!handle) continue
      const tempId = crypto.randomUUID()

      let file: File
      try {
        file = await handle.getFile()
      } catch (error) {
        // getFile() can fail if permission is denied or file is missing —
        // remove the placeholder that was about to be inserted and skip.
        logger.error(`Failed to read file from handle "${handle.name}":`, error)
        continue
      }

      const tempItem = buildOptimisticMediaItem(handle, file, tempId)

      set((state) => ({
        mediaItems: [tempItem, ...state.mediaItems],
        importingIds: [...state.importingIds, tempId],
        error: null,
      }))
      queueImportPreparationTask(tempId)

      importTasks.push({ handle, tempId, file })
    }

    return importTasks
  }

  const runImportTasks = async (
    importTasks: ImportTask[],
    projectId: string,
    serviceModulePromise: ReturnType<typeof importMediaLibraryService>,
  ): Promise<PromiseSettledResult<CompletedImportTask>[]> => {
    const results: PromiseSettledResult<CompletedImportTask>[] = new Array(importTasks.length)
    let nextIndex = 0
    const { mediaLibraryService } = await serviceModulePromise

    const runNext = async (): Promise<void> => {
      while (nextIndex < importTasks.length) {
        const index = nextIndex++
        const task = importTasks[index]
        if (!task) {
          continue
        }

        try {
          markImportPreparationRunning(task.tempId)
          const metadata = await mediaLibraryService.importMediaWithHandle(task.handle, projectId)
          results[index] = {
            status: 'fulfilled',
            value: { metadata, tempId: task.tempId, file: task.file, handle: task.handle },
          }
        } catch (reason) {
          results[index] = { status: 'rejected', reason }
        }
      }
    }

    const workerCount = Math.min(IMPORT_PROCESSING_CONCURRENCY, importTasks.length)
    await Promise.all(Array.from({ length: workerCount }, runNext))
    return results
  }

  const importHandlesInternal = async (
    handles: FileSystemFileHandle[],
    options?: { includeDuplicatesInResults?: boolean; waitForPreparation?: boolean },
  ): Promise<MediaMetadata[]> => {
    const { currentProjectId } = get()

    if (!currentProjectId) {
      set({ error: 'No project selected' })
      return []
    }

    const opId = createOperationId()
    const event = logger.startEvent('import', opId)
    event.merge({
      source: 'drag-drop',
      projectId: currentProjectId,
      fileCount: handles.length,
    })

    const serviceModulePromise = importMediaLibraryService()
    const importTasks = await createOptimisticImportTasks(handles)
    const importResults = await runImportTasks(importTasks, currentProjectId, serviceModulePromise)

    const { results, importedCount, duplicateNames, unsupportedCodecFiles, failedCount } =
      processImportResults(importResults, importTasks, set, options)

    showImportNotifications(importedCount, duplicateNames, unsupportedCodecFiles, failedCount, get)

    if (options?.waitForPreparation && results.length > 0) {
      const { mediaLibraryService } = await serviceModulePromise
      await mediaLibraryService.waitForMediaPreparation(results.map((media) => media.id))
    }

    event.success({
      imported: importedCount,
      duplicates: duplicateNames.length,
      failed: failedCount,
      unsupportedCodecs: unsupportedCodecFiles.length,
    })

    return results
  }

  return {
    importMedia: async () => {
      const { currentProjectId } = get()

      if (!currentProjectId) {
        set({ error: 'No project selected' })
        return []
      }

      // Check if File System Access API is supported
      if (!hasMediaFilePickerSupport()) {
        const isBrave = 'brave' in navigator
        set({
          error: isBrave
            ? 'File System Access API is disabled in Brave. Copy the URL below, paste it in your address bar, set the flag to Enabled, and relaunch.'
            : 'File picker not supported in this browser. Use Chrome or Edge.',
          errorLink: isBrave ? 'brave://flags/#file-system-access-api' : null,
        })
        return []
      }

      const opId = createOperationId()
      const event = logger.startEvent('import', opId)
      event.set('source', 'picker')
      event.set('projectId', currentProjectId)

      try {
        // Open file picker
        const handles = await showMediaFilePicker({ multiple: true })

        event.set('fileCount', handles.length)

        // Create optimistic placeholders for all files immediately
        const serviceModulePromise = importMediaLibraryService()
        const importTasks = await createOptimisticImportTasks(handles)
        const importResults = await runImportTasks(
          importTasks,
          currentProjectId,
          serviceModulePromise,
        )

        const { results, importedCount, duplicateNames, unsupportedCodecFiles, failedCount } =
          processImportResults(importResults, importTasks, set)

        showImportNotifications(
          importedCount,
          duplicateNames,
          unsupportedCodecFiles,
          failedCount,
          get,
        )

        event.success({
          imported: importedCount,
          duplicates: duplicateNames.length,
          failed: failedCount,
          unsupportedCodecs: unsupportedCodecFiles.length,
        })

        return results
      } catch (error) {
        // User cancelled or error
        if (error instanceof Error && error.name !== 'AbortError') {
          set({ error: error.message })
          event.failure(error)
        } else {
          event.success({
            outcome: 'cancelled',
            imported: 0,
            duplicates: 0,
            failed: 0,
            unsupportedCodecs: 0,
          })
        }
        return []
      }
    },

    importMediaFromUrl: async (url: string) => {
      const { currentProjectId } = get()
      const trimmedUrl = url.trim()

      if (!currentProjectId) {
        set({ error: 'No project selected', errorLink: null })
        return []
      }

      if (trimmedUrl.length === 0) {
        set({ error: 'Enter a media URL.', errorLink: null })
        return []
      }

      set({ error: null, errorLink: null })

      const opId = createOperationId()
      const event = logger.startEvent('import', opId)
      event.set('source', 'url')
      event.set('projectId', currentProjectId)

      try {
        const parsedUrl = new URL(trimmedUrl)
        event.set('urlHost', parsedUrl.hostname)
      } catch {
        event.set('urlHost', 'invalid')
      }

      try {
        const { mediaLibraryService } = await importMediaLibraryService()
        const metadata = await mediaLibraryService.importMediaFromUrl(trimmedUrl, currentProjectId)

        if (metadata.isDuplicate) {
          showImportNotifications(0, [metadata.fileName], [], 0, get)
          event.success({
            imported: 0,
            duplicates: 1,
            failed: 0,
            unsupportedCodecs: 0,
          })
          return []
        }

        prependImportedMedia(set, metadata)
        setupImportedVideoProxy(metadata)

        const unsupportedCodecFiles =
          metadata.hasUnsupportedCodec && metadata.audioCodec
            ? [{ fileName: metadata.fileName, audioCodec: metadata.audioCodec }]
            : []
        showImportNotifications(1, [], unsupportedCodecFiles, 0, get)

        event.success({
          imported: 1,
          duplicates: 0,
          failed: 0,
          unsupportedCodecs: unsupportedCodecFiles.length,
        })
        return [metadata]
      } catch (error) {
        const importError = error instanceof Error ? error : new Error(String(error))
        set({ error: importError.message, errorLink: null })
        event.failure(importError)
        return []
      }
    },

    importHandles: async (handles: FileSystemFileHandle[]) => {
      return importHandlesInternal(handles)
    },

    importHandlesForPlacement: async (handles: FileSystemFileHandle[]) =>
      importHandlesInternal(handles, {
        includeDuplicatesInResults: true,
        waitForPreparation: true,
      }),
  }
}
