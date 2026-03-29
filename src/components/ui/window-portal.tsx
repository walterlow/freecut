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
  /** Window width */
  width?: number;
  /** Window height */
  height?: number;
  /** localStorage key for persisting window position/size */
  storageKey?: string;
  /** Called when the external window is closed by the user */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface WindowBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

function loadBounds(key: string, fallback: WindowBounds): WindowBounds {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<WindowBounds>;
    if (
      typeof parsed.left === 'number' &&
      typeof parsed.top === 'number' &&
      typeof parsed.width === 'number' &&
      typeof parsed.height === 'number'
    ) {
      return { left: parsed.left, top: parsed.top, width: parsed.width, height: parsed.height };
    }
  } catch {
    // ignore
  }
  return fallback;
}

function saveBounds(key: string, bounds: WindowBounds): void {
  try {
    localStorage.setItem(key, JSON.stringify(bounds));
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
  onClose,
}: WindowPortalProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const externalWindowRef = useRef<Window | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Track whether the component is mounted. Used to distinguish real unmount
  // from StrictMode cleanup — we only close the window on real unmount.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // Reuse window from previous mount (survives StrictMode double-mount)
    let externalWindow = externalWindowRef.current;
    if (externalWindow && !externalWindow.closed) {
      const existingDiv = externalWindow.document.getElementById('window-portal-root');
      if (existingDiv) {
        setContainer(existingDiv as HTMLDivElement);
      }
    } else {
      // Open fresh window
      const defaultBounds: WindowBounds = {
        left: window.screenX + 100,
        top: window.screenY + 100,
        width,
        height,
      };
      const bounds = storageKey ? loadBounds(storageKey, defaultBounds) : defaultBounds;

      const features = [
        `width=${bounds.width}`,
        `height=${bounds.height}`,
        `left=${bounds.left}`,
        `top=${bounds.top}`,
        'menubar=no',
        'toolbar=no',
        'location=no',
        'status=no',
      ].join(',');

      externalWindow = window.open('', '', features);
      if (!externalWindow) {
        onCloseRef.current();
        return;
      }

      externalWindowRef.current = externalWindow;
      externalWindow.document.title = title;

      // Set up the document body
      externalWindow.document.body.style.margin = '0';
      externalWindow.document.body.style.padding = '0';
      externalWindow.document.body.style.overflow = 'hidden';

      // Copy all styles from parent
      copyStyles(document, externalWindow.document);

      // Create container for React portal
      const div = externalWindow.document.createElement('div');
      div.id = 'window-portal-root';
      div.style.width = '100vw';
      div.style.height = '100vh';
      div.style.overflow = 'hidden';
      externalWindow.document.body.appendChild(div);

      setContainer(div);
    }

    // Save bounds on close & resize
    const win = externalWindow;

    const persistBounds = () => {
      if (!storageKey || !win || win.closed) return;
      saveBounds(storageKey, {
        left: win.screenX,
        top: win.screenY,
        width: win.outerWidth,
        height: win.outerHeight,
      });
    };

    // Handle external window close (user action only)
    const handleUnload = () => {
      persistBounds();
      // Defer the onClose call so it doesn't fire during StrictMode cleanup
      setTimeout(() => {
        if (!mountedRef.current) {
          onCloseRef.current();
        }
      }, 0);
    };

    win.addEventListener('beforeunload', handleUnload);
    win.addEventListener('resize', persistBounds);

    return () => {
      mountedRef.current = false;
      win.removeEventListener('beforeunload', handleUnload);
      win.removeEventListener('resize', persistBounds);
      persistBounds();
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
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps -- intentionally run once

  if (!container) return null;
  return createPortal(children, container);
}
