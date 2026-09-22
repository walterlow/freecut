/**
 * Step state machine for the export dialog: which view is showing, how long the
 * export has been running, and the preview URL of a finished render. The dialog
 * keeps the settings/session state; this hook owns only the step wiring.
 */

import { useCallback, useEffect, useState } from 'react'
import type { ClientRenderResult } from '../deps/renderer'

export type DialogView = 'settings' | 'progress' | 'complete' | 'error' | 'cancelled'

export interface ExportDialogViewOptions {
  /** Render status; the terminal statuses advance the step. */
  status: string
  /** Finished render, once there is one. */
  result: ClientRenderResult | null
  resetState: () => void
  onClose: () => void
}

export function useExportDialogView({
  status,
  result,
  resetState,
  onClose,
}: ExportDialogViewOptions) {
  const [view, setView] = useState<DialogView>('settings')
  const [startTime, setStartTime] = useState<number | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  // Track elapsed time
  useEffect(() => {
    if (view === 'progress' && !startTime) {
      setStartTime(Date.now())
    }
    if (view === 'settings') {
      setStartTime(null)
      setElapsedSeconds(0)
    }
  }, [view, startTime])

  useEffect(() => {
    if (!startTime || view !== 'progress') return

    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)

    return () => clearInterval(interval)
  }, [startTime, view])

  // Watch status changes to update view
  useEffect(() => {
    if (status === 'completed') {
      setView('complete')
    } else if (status === 'failed') {
      setView('error')
    } else if (status === 'cancelled') {
      setView('cancelled')
    }
  }, [status])

  // Preview blob URL for completed exports
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    const blob = result?.blob
    if (!blob) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(blob)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [result?.blob])

  /**
   * Back to the first step, forgetting the previous run's timing. Memoized
   * because the dialog resets the step from an effect dependency list.
   */
  const resetView = useCallback(() => {
    setView('settings')
    setStartTime(null)
    setElapsedSeconds(0)
  }, [])

  // Handle close
  const handleClose = () => {
    if (view === 'progress') return // Prevent closing during export
    setView('settings')
    resetState()
    onClose()
  }

  return {
    view,
    setView,
    elapsedSeconds,
    previewUrl,
    isVideoResult: result?.mimeType?.startsWith('video/') ?? false,
    preventClose: view === 'progress' || view === 'complete',
    handleClose,
    resetView,
  }
}
