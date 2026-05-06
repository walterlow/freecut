export async function safeWrite(
  writable: FileSystemWritableFileStream,
  data: FileSystemWriteChunkType,
): Promise<void> {
  let error: unknown
  try {
    await writable.write(data)
    await writable.close()
  } catch (writeError) {
    error = writeError
    throw writeError
  } finally {
    if (error) {
      try {
        await writable.abort(error)
      } catch {
        // Ignore abort failures from already-closed handles.
      }
    }
  }
}
