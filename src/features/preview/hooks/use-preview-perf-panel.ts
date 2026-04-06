import { useEffect, useMemo, useState } from 'react';
import {
  PREVIEW_PERF_PANEL_QUERY_KEY,
  PREVIEW_PERF_PANEL_STORAGE_KEY,
  type PreviewPerfSnapshot,
  parsePreviewPerfPanelQuery,
} from '../utils/preview-constants';

export function usePreviewPerfPanel() {
  const [showPerfPanel, setShowPerfPanel] = useState(false);
  const [perfPanelSnapshot, setPerfPanelSnapshot] = useState<PreviewPerfSnapshot | null>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    let panelEnabled = window.__PREVIEW_PERF_PANEL__ === true;
    const queryOverride = parsePreviewPerfPanelQuery(
      new URLSearchParams(window.location.search).get(PREVIEW_PERF_PANEL_QUERY_KEY)
    );
    if (queryOverride !== null) {
      panelEnabled = queryOverride;
      try {
        window.localStorage.setItem(PREVIEW_PERF_PANEL_STORAGE_KEY, panelEnabled ? '1' : '0');
      } catch {
        // Ignore storage failures (private mode / quota / disabled storage).
      }
    } else {
      try {
        const persisted = window.localStorage.getItem(PREVIEW_PERF_PANEL_STORAGE_KEY);
        if (persisted === '1' || persisted === '0') {
          panelEnabled = persisted === '1';
        }
      } catch {
        // Ignore storage failures (private mode / quota / disabled storage).
      }
    }

    window.__PREVIEW_PERF_PANEL__ = panelEnabled;
    setShowPerfPanel(panelEnabled);
    setPerfPanelSnapshot(panelEnabled ? window.__PREVIEW_PERF__ ?? null : null);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.altKey && event.shiftKey && event.key.toLowerCase() === 'p')) return;
      event.preventDefault();
      const nextEnabled = !(window.__PREVIEW_PERF_PANEL__ === true);
      window.__PREVIEW_PERF_PANEL__ = nextEnabled;
      try {
        window.localStorage.setItem(PREVIEW_PERF_PANEL_STORAGE_KEY, nextEnabled ? '1' : '0');
      } catch {
        // Ignore storage failures (private mode / quota / disabled storage).
      }
      setShowPerfPanel(nextEnabled);
      if (!nextEnabled) {
        setPerfPanelSnapshot(null);
      }
    };

    const intervalId = setInterval(() => {
      if (window.__PREVIEW_PERF_PANEL__ !== true) return;
      setPerfPanelSnapshot(window.__PREVIEW_PERF__ ?? null);
    }, 250);

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearInterval(intervalId);
    };
  }, []);

  const latestRenderSourceSwitch = useMemo(() => (
    perfPanelSnapshot?.renderSourceHistory[
      perfPanelSnapshot.renderSourceHistory.length - 1
    ] ?? null
  ), [perfPanelSnapshot]);

  return {
    showPerfPanel,
    perfPanelSnapshot,
    latestRenderSourceSwitch,
  };
}
