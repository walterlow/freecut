import { describe, expect, it, vi } from 'vite-plus/test'
import {
  hasMediaFilePickerSupport,
  MEDIA_FILE_PICKER_TYPES,
  showMediaFilePicker,
} from './media-file-picker'

describe('media-file-picker', () => {
  it('detects file picker support from window.showOpenFilePicker', () => {
    const originalWindow = globalThis.window

    vi.stubGlobal('window', {} as Window & typeof globalThis)
    expect(hasMediaFilePickerSupport()).toBe(false)

    vi.stubGlobal('window', {
      showOpenFilePicker: vi.fn(),
    } as unknown as Window & typeof globalThis)
    expect(hasMediaFilePickerSupport()).toBe(true)

    vi.stubGlobal('window', originalWindow)
  })

  it('passes the shared media picker types to the browser file picker', async () => {
    const showOpenFilePicker = vi.fn().mockResolvedValue(['handle-1'])
    const originalWindow = globalThis.window

    vi.stubGlobal('window', {
      showOpenFilePicker,
    } as unknown as Window & typeof globalThis)

    const result = await showMediaFilePicker({ multiple: false })

    expect(result).toEqual(['handle-1'])
    expect(showOpenFilePicker).toHaveBeenCalledWith({
      multiple: false,
      types: MEDIA_FILE_PICKER_TYPES,
    })

    vi.stubGlobal('window', originalWindow)
  })
})
