import { describe, expect, it, vi } from 'vite-plus/test'
import { hasMediaFilePickerSupport, showMediaFilePicker } from './media-file-picker'

describe('media-file-picker', () => {
  it('always reports support since input[type=file] is universal', () => {
    expect(hasMediaFilePickerSupport()).toBe(true)
  })

  it('resolves with selected files when the user picks files', async () => {
    const file = new File(['data'], 'clip.mp4', { type: 'video/mp4' })

    // Intercept createElement to return a fake input
    const fakeInput = {
      type: '',
      multiple: false,
      accept: '',
      files: { 0: file, length: 1, [Symbol.iterator]: [file][Symbol.iterator].bind([file]) },
      addEventListener: vi.fn((event: string, cb: () => void) => {
        if (event === 'change') setTimeout(cb, 0)
      }),
      click: vi.fn(),
    }

    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementationOnce((tag: string) => {
      if (tag === 'input') return fakeInput as unknown as HTMLElement
      return origCreate(tag)
    })

    const result = await showMediaFilePicker({ multiple: true })
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe('clip.mp4')
  })

  it('resolves with empty array when the user cancels', async () => {
    const fakeInput = {
      type: '',
      multiple: false,
      accept: '',
      addEventListener: vi.fn((event: string, cb: () => void) => {
        if (event === 'cancel') setTimeout(cb, 0)
      }),
      click: vi.fn(),
    }

    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementationOnce((tag: string) => {
      if (tag === 'input') return fakeInput as unknown as HTMLElement
      return origCreate(tag)
    })

    const result = await showMediaFilePicker()
    expect(result).toEqual([])
  })
})
