import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WindowPortalProps {
  /** Content rendered inside the external window */
  children: ReactNode;
  /** Window title */
  title: string;
  /** Window width (inner/content-area pixels) */
  width?: number;
  /** Window height (inner/content-area pixels) */
  height?: number;
  /** localStorage key for persisting window position */
  storageKey?: string;
  /** Reuse an already-opened window (useful for pop-out actions initiated by a click) */
  externalWindow?: Window | null;
  /** Called when opening a fresh external window is blocked */
  onBlocked?: () => void;
  /** When true, window height fits content after first render */
  autoHeight?: boolean;
  /** Called when the external window is closed by the user */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers — position only (size comes from props)
// ---------------------------------------------------------------------------

interface WindowPosition {
  left: number;
  top: number;
}

function loadPosition(key: string, fallback: WindowPosition, winWidth: number, winHeight: number): WindowPosition {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<WindowPosition>;
    if (typeof parsed.left === 'number' && typeof parsed.top === 'number') {
      const sw = window.screen.availWidth;
      const sh = window.screen.availHeight;
      return {
        left: Math.max(0, Math.min(parsed.left, sw - winWidth)),
        top: Math.max(0, Math.min(parsed.top, sh - winHeight)),
      };
    }
  } catch {
    // ignore
  }
  return fallback;
}

function savePosition(key: string, pos: WindowPosition): void {
  try {
    localStorage.setItem(key, JSON.stringify(pos));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Copy styles from parent window to child window
// ---------------------------------------------------------------------------

function copyStyles(sourceDoc: Document, targetDoc: Document): void {
  // Copy <link> stylesheets
  for (const link of Array.from(sourceDoc.querySelectorAll('link[rel="stylesheet"]'))) {
    const clone = targetDoc.createElement('link');
    clone.rel = 'stylesheet';
    clone.href = (link as HTMLLinkElement).href;
    targetDoc.head.appendChild(clone);
  }

  // Copy <style> elements (includes Tailwind's generated styles)
  for (const style of Array.from(sourceDoc.querySelectorAll('style'))) {
    const clone = targetDoc.createElement('style');
    clone.textContent = style.textContent;
    targetDoc.head.appendChild(clone);
  }

  // Copy CSS custom properties from :root / <html>
  const rootStyles = sourceDoc.documentElement.getAttribute('style');
  if (rootStyles) {
    targetDoc.documentElement.setAttribute('style', rootStyles);
  }

  // Copy class names from <html> (dark mode class, etc.)
  const rootClasses = sourceDoc.documentElement.className;
  if (rootClasses) {
    targetDoc.documentElement.className = rootClasses;
  }

  // Copy inline styles from <body> if any
  const bodyStyles = sourceDoc.body.getAttribute('style');
  if (bodyStyles) {
    targetDoc.body.setAttribute('style', bodyStyles);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WindowPortal({
  children,
  title,
  width = 400,
  height = 500,
  storageKey,
  externalWindow: providedExternalWindow = null,
  autoHeight = false,
  onBlocked,
  onClose,
}: WindowPortalProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const externalWindowRef = useRef<Window | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onBlockedRef = useRef(onBlocked);
  onBlockedRef.current = onBlocked;
  // Track whether the component is mounted. Used to distinguish real unmount
  // from StrictMode cleanup — we only close the window on real unmount.
  const mountedRef = useRef(true);

  useEffect(() => {
    const externalWindow = externalWindowRef.current;
    if (!externalWindow || externalWindow.closed) return;
    externalWindow.document.title = title;
  }, [title]);

  useEffect(() => {
    mountedRef.current = true;

    const defaultPos: WindowPosition = {
      left: window.screenX + 100,
      top: window.screenY + 100,
    };
    const pos = storageKey ? loadPosition(storageKey, defaultPos, width, height) : defaultPos;

    // Reuse a provided window or one from a previous mount (survives StrictMode double-mount)
    let externalWindow = providedExternalWindow ?? externalWindowRef.current;
    if (!(externalWindow && !externalWindow.closed)) {
      const features = [
        `width=${width}`,
        `height=${height}`,
        `left=${pos.left}`,
        `top=${pos.top}`,
        'menubar=no',
        'toolbar=no',
        'location=no',
        'status=no',
      ].join(',');

      externalWindow = window.open('', '', features);
      if (!externalWindow) {
        (onBlockedRef.current ?? onCloseRef.current)();
        return;
      }
    }

    externalWindowRef.current = externalWindow;
    externalWindow.document.title = title;
    externalWindow.document.body.style.margin = '0';
    externalWindow.document.body.style.padding = '0';
    externalWindow.document.body.style.overflow = 'hidden';

    if (!externalWindow.document.getElementById('window-portal-style-marker')) {
      copyStyles(document, externalWindow.document);
      const styleMarker = externalWindow.document.createElement('meta');
      styleMarker.id = 'window-portal-style-marker';
      externalWindow.document.head.appendChild(styleMarker);
    }

    let root = externalWindow.document.getElementById('window-portal-root') as HTMLDivElement | null;
    if (!root) {
      root = externalWindow.document.createElement('div');
      root.id = 'window-portal-root';
      root.style.width = '100vw';
      root.style.height = autoHeight ? 'auto' : '100vh';
      root.style.overflow = 'hidden';
      externalWindow.document.body.appendChild(root);
    }
    setContainer(root);

    // Force correct size — window.open() features are unreliable on Windows Chrome.
    try {
      const chromeW = Math.max(0, externalWindow.outerWidth - externalWindow.innerWidth);
      const chromeH = Math.max(0, externalWindow.outerHeight - externalWindow.innerHeight);
      externalWindow.resizeTo(width + chromeW, (autoHeight ? externalWindow.outerHeight : height + chromeH));
      externalWindow.moveTo(pos.left, pos.top);
    } catch {
      // ignore
    }

    const win = externalWindow;

    const persistPosition = () => {
      if (!storageKey || !win || win.closed) return;
      savePosition(storageKey, { left: win.screenX, top: win.screenY });
    };

    // Child window closed by user
    const handleUnload = () => {
      persistPosition();
      externalWindowRef.current = null;
      setContainer(null);
      onCloseRef.current();
    };

    // Parent window refresh/close → close child
    const handleParentUnload = () => {
      if (!win.closed) win.close();
    };

    win.addEventListener('beforeunload', handleUnload);
    window.addEventListener('beforeunload', handleParentUnload);

    // autoHeight: wait for stylesheets to load, then measure content and resize
    let cancelled = false;
    if (autoHeight && root) {
      const rootEl = root;
      const fitWindowToContent = () => {
        if (cancelled || win.closed) return;
        const contentHeight = rootEl.scrollHeight;
        if (contentHeight > 0) {
          const chromeHeight = Math.max(0, win.outerHeight - win.innerHeight);
          win.resizeTo(win.outerWidth, contentHeight + chromeHeight);
        }
      };
      // Wait for all <link> stylesheets in the popup to finish loading
      const links = Array.from(win.document.querySelectorAll('link[rel="stylesheet"]'));
      const pending = links.filter((link) => !(link as HTMLLinkElement).sheet);
      if (pending.length === 0) {
        setTimeout(fitWindowToContent, 50);
      } else {
        let remaining = pending.length;
        const onDone = () => {
          remaining--;
          if (remaining <= 0) {
            setTimeout(fitWindowToContent, 50);
          }
        };
        for (const link of pending) {
          link.addEventListener('load', onDone);
          link.addEventListener('error', onDone);
        }
      }
    }

    // Observe content size changes for autoHeight windows
    let resizeObserver: ResizeObserver | undefined;
    if (autoHeight && root) {
      const rootEl = root;
      resizeObserver = new ResizeObserver(() => {
        if (cancelled || win.closed) return;
        const contentHeight = rootEl.scrollHeight;
        if (contentHeight > 0) {
          const chromeHeight = Math.max(0, win.outerHeight - win.innerHeight);
          win.resizeTo(win.outerWidth, contentHeight + chromeHeight);
        }
      });
      resizeObserver.observe(rootEl);
    }

    return () => {
      mountedRef.current = false;
      cancelled = true;
      resizeObserver?.disconnect();
      win.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('beforeunload', handleParentUnload);
      persistPosition();
      // Don't close the window here — it may be a StrictMode remount.
      // Schedule a deferred close that only fires if the component
      // doesn't remount (i.e. it was a real unmount).
      setTimeout(() => {
        if (!mountedRef.current && !win.closed) {
          win.close();
          externalWindowRef.current = null;
        }
      }, 50);
    };
  }, [autoHeight, height, providedExternalWindow, storageKey, width]);

  if (!container) return null;
  return createPortal(children, container);
}
