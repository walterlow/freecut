import { createLogger, createOperationId } from '@/shared/logging/logger'

const logger = createLogger('FileAccess')

/**
 * Error thrown when file handle permission is denied or file is missing.
 */
export class FileAccessError extends Error {
  constructor(
    message: string,
    public readonly type: 'permission_denied' | 'file_missing' | 'unknown',
  ) {
    super(message)
    this.name = 'FileAccessError'
  }
}

/**
 * Check and request permission for a file handle.
 * Returns true if permission is granted, false otherwise.
 */
export async function ensureFileHandlePermission(handle: FileSystemFileHandle): Promise<boolean> {
  const opId = createOperationId()
  const event = logger.startEvent('file.permission.check', opId)

  try {
    const permission = await handle.queryPermission({ mode: 'read' })
    event.set('queryPermission', permission)
    if (permission === 'granted') {
      event.success({ permission })
      return true
    }

    const newPermission = await handle.requestPermission({ mode: 'read' })
    event.set('requestPermission', newPermission)
    const granted = newPermission === 'granted'
    event.success({ permission: newPermission })
    return granted
  } catch (error) {
    event.failure(error)
    throw new FileAccessError(
      `Unexpected error checking file permission: ${error instanceof Error ? error.message : String(error)}`,
      'unknown',
    )
  }
}
