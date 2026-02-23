import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { toast } from 'sonner';
import { App } from './app';
import { filmstripCache } from '@/features/timeline/services/filmstrip-cache';
import { initializeDebugUtils } from '@/lib/debug';
import { createLogger } from '@/lib/logger';
import './index.css';

const log = createLogger('App');

// Initialize debug utilities in development mode
initializeDebugUtils();

// Global error handlers
window.addEventListener('unhandledrejection', (event) => {
  log.error('Unhandled promise rejection:', event.reason);
});

window.addEventListener('error', (event) => {
  log.error('Uncaught error:', event.error);
});

// Handle stale asset errors after new deployments.
// When Vercel deploys a new version, old chunk hashes become 404s.
// Prompt the user to save before reloading so they don't lose work.
window.addEventListener('vite:preloadError', () => {
  const projectIdMatch = window.location.pathname.match(/\/editor\/([^/]+)/);

  if (projectIdMatch) {
    toast.error('A new version is available. Save your work and reload.', {
      duration: Infinity,
      action: {
        label: 'Save & Reload',
        onClick: async () => {
          try {
            const { useTimelineStore } = await import(
              '@/features/timeline/stores/timeline-store-facade'
            );
            await useTimelineStore.getState().saveTimeline(projectIdMatch[1]);
          } catch (e) {
            log.error('Failed to save before reload:', e);
          }
          window.location.reload();
        },
      },
      cancel: {
        label: 'Reload without saving',
        onClick: () => window.location.reload(),
      },
    });
  } else {
    // Not in the editor — safe to reload immediately
    window.location.reload();
  }
});

// Cleanup filmstrip workers on page unload
window.addEventListener('beforeunload', () => {
  void filmstripCache.dispose();
});

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
