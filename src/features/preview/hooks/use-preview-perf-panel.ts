import { useEffect, useMemo, useRef, useState } from 'react'
import { useDebugStore } from '@/features/editor/stores/debug-store'
import {
  PREVIEW_PERF_PANEL_QUERY_KEY,
  PREVIEW_PERF_PANEL_STORAGE_KEY,
  type PreviewPerfSnapshot,
  parsePreviewPerfPanelQuery,
} from '../utils/preview-constants'

const POLL_INTERVAL_MS = 250

export function usePreviewPerfPanel() {
  const showPerfPanel = useDebugStore((s) => s.showPreviewPerfPanel)
  const setShowPerfPanel = useDebugStore((s) => s.setShowPreviewPerfPanel)
  const [perfPanelSnapshot, setPerfPanelSnapshot] = useState<PreviewPerfSnapshot | null>(null)
  const initializedRef = useRef(false)

  useEffect(() => {
    if (!import.meta.env.DEV) return

    let panelEnabled = window.__PREVIEW_PERF_PANEL__ === true
    const queryOverride = parsePreviewPerfPanelQuery(
      new URLSearchParams(window.location.search).get(PREVIEW_PERF_PANEL_QUERY_KEY),
    )
    if (queryOverride !== null) {
      panelEnabled = queryOverride
      try {
        window.localStorage.setItem(PREVIEW_PERF_PANEL_STORAGE_KEY, panelEnabled ? '1' : '0')
      } catch {
        // Ignore storage failures (private mode / quota / disabled storage).
      }
    } else {
      try {
        const persisted = window.localStorage.getItem(PREVIEW_PERF_PANEL_STORAGE_KEY)
        if (persisted === '1' || persisted === '0') {
          panelEnabled = persisted === '1'
        }
      } catch {
        // Ignore storage failures (private mode / quota / disabled storage).
      }
    }

    window.__PREVIEW_PERF_PANEL__ = panelEnabled
    initializedRef.current = true
    setShowPerfPanel(panelEnabled)
    setPerfPanelSnapshot(panelEnabled ? (window.__PREVIEW_PERF__ ?? null) : null)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.altKey && event.shiftKey && event.key.toLowerCase() === 'p')) return
      event.preventDefault()
      const nextEnabled = !(window.__PREVIEW_PERF_PANEL__ === true)
      setShowPerfPanel(nextEnabled)
    }

    const intervalId = setInterval(() => {
      if (window.__PREVIEW_PERF_PANEL__ !== true) return
      setPerfPanelSnapshot(window.__PREVIEW_PERF__ ?? null)
    }, POLL_INTERVAL_MS)

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      clearInterval(intervalId)
    }
  }, [setShowPerfPanel])

  useEffect(() => {
    if (!import.meta.env.DEV || !initializedRef.current) return

    window.__PREVIEW_PERF_PANEL__ = showPerfPanel
    try {
      window.localStorage.setItem(PREVIEW_PERF_PANEL_STORAGE_KEY, showPerfPanel ? '1' : '0')
    } catch {
      // Ignore storage failures (private mode / quota / disabled storage).
    }

    setPerfPanelSnapshot(showPerfPanel ? (window.__PREVIEW_PERF__ ?? null) : null)
  }, [showPerfPanel])

  const latestRenderSourceSwitch = useMemo(
    () =>
      perfPanelSnapshot?.renderSourceHistory[perfPanelSnapshot.renderSourceHistory.length - 1] ??
      null,
    [perfPanelSnapshot],
  )

  return {
    showPerfPanel,
    perfPanelSnapshot,
    latestRenderSourceSwitch,
  }
}
