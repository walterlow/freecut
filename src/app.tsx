import { useEffect } from 'react';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { GlobalTooltip } from '@/components/ui/global-tooltip';
import { Toaster } from '@/components/ui/sonner';
import { ErrorBoundary } from '@/components/error-boundary';
import { routeTree } from './routeTree.gen';

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  // Prevent default browser zoom application-wide
  useEffect(() => {
    const wheelListenerOptions: AddEventListenerOptions = { passive: false, capture: true };
    const keyListenerOptions: AddEventListenerOptions = { capture: true };

    const preventBrowserZoom = (e: WheelEvent) => {
      // Prevent browser zoom when Ctrl/Cmd is held
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };

    const preventKeyboardZoom = (e: KeyboardEvent) => {
      // Prevent browser zoom shortcuts: Ctrl+=/+/-, Ctrl+0
      // Only preventDefault (blocks browser zoom), event still propagates to react-hotkeys-hook
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_' || e.key === '0') {
          e.preventDefault();
          // DO NOT call stopPropagation() - we want react-hotkeys-hook to still receive this
        }
      }
    };

    // Add listeners at capture phase to intercept before browser handles them
    document.addEventListener('wheel', preventBrowserZoom, wheelListenerOptions);
    document.addEventListener('keydown', preventKeyboardZoom, keyListenerOptions);

    return () => {
      document.removeEventListener('wheel', preventBrowserZoom, wheelListenerOptions);
      document.removeEventListener('keydown', preventKeyboardZoom, keyListenerOptions);
    };
  }, []);

  // TooltipProvider at app level to prevent re-renders cascading from Editor
  // GlobalTooltip for performant data-tooltip based tooltips
  // Toaster for toast notifications
  // ErrorBoundary for graceful error recovery
  return (
    <ErrorBoundary level="app">
      <TooltipProvider delayDuration={300}>
        <RouterProvider router={router} />
        <GlobalTooltip />
        <Toaster />
      </TooltipProvider>
    </ErrorBoundary>
  );
}
