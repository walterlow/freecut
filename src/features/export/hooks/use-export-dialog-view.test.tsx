import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import type { ClientRenderResult } from '../deps/renderer'
import { useExportDialogView } from './use-export-dialog-view'

function result(overrides: Partial<ClientRenderResult> = {}): ClientRenderResult {
  return {
    blob: new Blob(['video']),
    mimeType: 'video/mp4',
    duration: 10,
    fileSize: 1024,
    ...overrides,
  }
}

function setup(overrides: { status?: string; result?: ClientRenderResult | null } = {}) {
  const resetState = vi.fn()
  const onClose = vi.fn()
  const options = {
    status: overrides.status ?? 'idle',
    result: overrides.result ?? null,
    resetState,
    onClose,
  }
  const view = renderHook((props: typeof options) => useExportDialogView(props), {
    initialProps: options,
  })

  return { ...view, resetState, onClose, options }
}

describe('useExportDialogView', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:preview'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    })
  })

  it('starts on the settings step', () => {
    const { result: view } = setup()

    expect(view.current.view).toBe('settings')
    expect(view.current.preventClose).toBe(false)
    expect(view.current.elapsedSeconds).toBe(0)
    expect(view.current.previewUrl).toBeNull()
    expect(view.current.isVideoResult).toBe(false)
  })

  it('advances to the step the render status reports', () => {
    const { result: view, rerender, options } = setup()

    rerender({ ...options, status: 'completed' })
    expect(view.current.view).toBe('complete')

    rerender({ ...options, status: 'failed' })
    expect(view.current.view).toBe('error')

    rerender({ ...options, status: 'cancelled' })
    expect(view.current.view).toBe('cancelled')
  })

  it('blocks closing while the export is running, and lets every other step close', () => {
    const { result: view, onClose, resetState } = setup()

    act(() => view.current.setView('progress'))
    act(() => view.current.handleClose())
    expect(view.current.view).toBe('progress')
    expect(onClose).not.toHaveBeenCalled()
    expect(resetState).not.toHaveBeenCalled()

    act(() => view.current.setView('complete'))
    act(() => view.current.handleClose())
    expect(view.current.view).toBe('settings')
    expect(resetState).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('counts elapsed seconds while the export runs, and forgets them afterwards', () => {
    vi.useFakeTimers()
    try {
      const { result: view } = setup()

      act(() => view.current.setView('progress'))
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(view.current.elapsedSeconds).toBe(3)
      expect(view.current.preventClose).toBe(true)

      act(() => view.current.resetView())
      expect(view.current.view).toBe('settings')
      expect(view.current.elapsedSeconds).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('resets the timing when the dialog returns to the settings step', () => {
    vi.useFakeTimers()
    try {
      const { result: view } = setup()

      act(() => view.current.setView('progress'))
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      act(() => view.current.setView('settings'))

      expect(view.current.elapsedSeconds).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('previews the finished render and revokes the URL when it is replaced or dropped', () => {
    const { result: view, rerender, options } = setup()

    rerender({ ...options, result: result() })
    expect(view.current.previewUrl).toBe('blob:preview')
    expect(view.current.isVideoResult).toBe(true)

    rerender({ ...options, result: result({ mimeType: 'audio/mpeg' }) })
    expect(view.current.isVideoResult).toBe(false)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)

    rerender({ ...options, result: null })
    expect(view.current.previewUrl).toBeNull()
  })
})
