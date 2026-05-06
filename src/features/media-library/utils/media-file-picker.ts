export const MEDIA_FILE_PICKER_TYPES = [
  {
    description: 'Media files',
    accept: {
      'video/*': ['.mp4', '.webm', '.mov', '.avi', '.mkv'],
      'audio/*': ['.mp3', '.wav', '.ogg', '.m4a', '.aac'],
      'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'],
    },
  },
] satisfies FilePickerAcceptType[]

export function hasMediaFilePickerSupport(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window
}

export async function showMediaFilePicker(options?: {
  multiple?: boolean
}): Promise<FileSystemFileHandle[]> {
  return window.showOpenFilePicker({
    multiple: options?.multiple ?? true,
    types: MEDIA_FILE_PICKER_TYPES,
  })
}
