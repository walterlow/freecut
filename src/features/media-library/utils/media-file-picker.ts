const MEDIA_ACCEPT =
  'video/*,audio/*,image/*,.mp4,.webm,.mov,.avi,.mkv,.mp3,.wav,.ogg,.m4a,.aac,.jpg,.jpeg,.png,.gif,.webp,.svg'

/** Open a browser file-input dialog and return the selected Files. */
export async function showMediaFilePicker(options?: { multiple?: boolean }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = options?.multiple ?? true
    input.accept = MEDIA_ACCEPT

    let resolved = false
    const done = (files: File[]) => {
      if (resolved) return
      resolved = true
      resolve(files)
    }

    input.addEventListener('change', () => done(Array.from(input.files ?? [])))
    input.addEventListener('cancel', () => done([]))

    input.click()
  })
}

/** @deprecated Only for legacy re-linking of handle-based media from old projects. */
export async function showFileHandlePicker(options?: {
  multiple?: boolean
}): Promise<FileSystemFileHandle[]> {
  return window.showOpenFilePicker({
    multiple: options?.multiple ?? false,
    types: [
      {
        description: 'Media files',
        accept: {
          'video/*': ['.mp4', '.webm', '.mov', '.avi', '.mkv'],
          'audio/*': ['.mp3', '.wav', '.ogg', '.m4a', '.aac'],
          'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'],
        },
      },
    ],
  })
}

export function hasMediaFilePickerSupport(): boolean {
  return true
}
