import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { toast } from 'sonner';
import { App } from './app';
import { initializeDebugUtils } from '@/app/debug';
import { createLogger } from '@/shared/logging/logger';
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
  const projectId = projectIdMatch?.[1];

  if (projectId) {
    toast.error('A new version is available. Save your work and reload.', {
      duration: Infinity,
      action: {
        label: 'Save & Reload',
        onClick: async () => {
          try {
            const { useTimelineStore } = await import(
              '@/features/timeline/stores/timeline-store-facade'
            );
            await useTimelineStore.getState().saveTimeline(projectId);
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
    // Not in the editor â€” safe to reload immediately
    window.location.reload();
  }
});

// IMPORTANT: Intentionally do not dispose filmstrip cache on beforeunload.
// Filmstrip OPFS data is persistent and should survive refresh/reload.
// The browser tears down workers/resources on navigation anyway.

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);

