import { getMediaType, getMimeType, validateMediaFile } from './validation'

export interface ExtractedMediaFileEntry {
  file: File
  mediaType: 'video' | 'audio' | 'image' | 'unknown'
}

export interface ExtractedMediaFileDropResult {
  supported: boolean
  entries: ExtractedMediaFileEntry[]
  errors: string[]
}

export async function extractValidMediaFileEntriesFromDataTransfer(
  dataTransfer: DataTransfer,
): Promise<ExtractedMediaFileDropResult> {
  const files = Array.from(dataTransfer.files)

  const entries: ExtractedMediaFileEntry[] = []
  const errors: string[] = []

  for (const file of files) {
    const validation = validateMediaFile(file)
    if (!validation.valid) {
      errors.push(`${file.name}: ${validation.error}`)
      continue
    }

    entries.push({
      file,
      mediaType: getMediaType(getMimeType(file)),
    })
  }

  return {
    supported: true,
    entries,
    errors,
  }
}
