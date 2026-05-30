import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { i18n } from './i18n'
import { App } from './app'
import { createLogger } from '@/shared/logging/logger'
import './index.css'

const log = createLogger('App')
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000
const ACCEPTED_APP_UPDATE_SIGNATURE_KEY = 'freecut-accepted-app-update-signature'

let updateToastVisible = false
let currentBuildAssetSignature: string | null = null

// Debug utilities are editor-heavy; keep them out of the production startup graph.
if (import.meta.env.DEV) {
  void import('@/app/debug').then(({ initializeDebugUtils }) => initializeDebugUtils())
}

function getCurrentProjectId(): string | undefined {
  return window.location.pathname.match(/\/editor\/([^/]+)/)?.[1]
}

async function saveCurrentProjectBeforeReload() {
  const projectId = getCurrentProjectId()

  if (!projectId) {
    return
  }

  try {
    const { useTimelineStore } = await import('@/features/timeline/stores/timeline-store-facade')
    await useTimelineStore.getState().saveTimeline(projectId)
  } catch (e) {
    log.error('Failed to save before reload:', e)
  }
}

function rememberAcceptedAppUpdate(signature?: string) {
  if (signature) {
    window.localStorage.setItem(ACCEPTED_APP_UPDATE_SIGNATURE_KEY, signature)
  }
}

async function showUpdateAvailableToast(
  applyUpdate: () => void = () => window.location.reload(),
  updateSignature?: string,
): Promise<void> {
  if (updateToastVisible) {
    return
  }

  updateToastVisible = true
  window.dispatchEvent(new Event('freecut:ensure-toaster'))
  let toast: typeof import('sonner').toast
  try {
    ;({ toast } = await import('sonner'))
  } catch (error) {
    updateToastVisible = false
    log.warn('Failed to load update notification toast:', error)
    return
  }

  toast.error(i18n.t('appShell.newVersionAvailable'), {
    duration: Infinity,
    action: {
      label: i18n.t('appShell.saveAndReload'),
      onClick: async () => {
        rememberAcceptedAppUpdate(updateSignature)
        await saveCurrentProjectBeforeReload()
        applyUpdate()
      },
    },
    cancel: {
      label: i18n.t('appShell.reloadWithoutSaving'),
      onClick: () => {
        rememberAcceptedAppUpdate(updateSignature)
        applyUpdate()
      },
    },
    onDismiss: () => {
      rememberAcceptedAppUpdate(updateSignature)
      updateToastVisible = false
    },
    onAutoClose: () => {
      updateToastVisible = false
    },
  })
}

function getBuildAssetSignature(documentToInspect: Document): string {
  const assetUrls = [
    ...Array.from(
      documentToInspect.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'),
    ).map((element) => element.src),
    ...Array.from(
      documentToInspect.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]'),
    ).map((element) => element.href),
  ]

  return JSON.stringify(
    assetUrls.map((assetUrl) => new URL(assetUrl, window.location.href).pathname).sort(),
  )
}

async function checkForAppShellUpdate() {
  currentBuildAssetSignature ??= getBuildAssetSignature(document)

  try {
    const response = await fetch(`/?__freecut_update_check=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
      },
    })

    if (!response.ok) {
      return
    }

    const html = await response.text()
    const nextDocument = new DOMParser().parseFromString(html, 'text/html')
    const nextBuildAssetSignature = getBuildAssetSignature(nextDocument)
    const acceptedUpdateSignature = window.localStorage.getItem(ACCEPTED_APP_UPDATE_SIGNATURE_KEY)

    if (
      nextBuildAssetSignature &&
      nextBuildAssetSignature !== currentBuildAssetSignature &&
      nextBuildAssetSignature !== acceptedUpdateSignature
    ) {
      await showUpdateAvailableToast(() => {
        window.location.assign(`/?__freecut_updated=${Date.now()}`)
      }, nextBuildAssetSignature)
    }
  } catch (error) {
    log.warn('App update check failed:', error)
  }
}

function activateWaitingServiceWorker(registration: ServiceWorkerRegistration) {
  if (!registration.waiting) {
    window.location.reload()
    return
  }

  let reloadTriggered = false
  const reloadOnce = () => {
    if (reloadTriggered) {
      return
    }
    reloadTriggered = true
    window.location.reload()
  }

  navigator.serviceWorker.addEventListener('controllerchange', reloadOnce, { once: true })
  registration.waiting.postMessage({ type: 'SKIP_WAITING' })
  window.setTimeout(reloadOnce, 4000)
}

function watchForServiceWorkerUpdate(registration: ServiceWorkerRegistration) {
  if (registration.waiting && navigator.serviceWorker.controller) {
    void showUpdateAvailableToast(() => activateWaitingServiceWorker(registration))
  }

  registration.addEventListener('updatefound', () => {
    const installingWorker = registration.installing

    if (!installingWorker) {
      return
    }

    installingWorker.addEventListener('statechange', () => {
      if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
        void showUpdateAvailableToast(() => activateWaitingServiceWorker(registration))
      }
    })
  })
}

// Global error handlers
window.addEventListener('unhandledrejection', (event) => {
  log.error('Unhandled promise rejection:', event.reason)
})

window.addEventListener('error', (event) => {
  log.error('Uncaught error:', event.error)
})

// Handle stale asset errors after new deployments.
// When Vercel deploys a new version, old chunk hashes become 404s.
// Prompt the user to save before reloading so they don't lose work.
window.addEventListener('vite:preloadError', () => {
  void showUpdateAvailableToast()
})

// IMPORTANT: Intentionally do not dispose filmstrip cache on beforeunload.
// Filmstrip cache data is persistent in the workspace and
// should survive refresh/reload.
// The browser tears down workers/resources on navigation anyway.

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        watchForServiceWorkerUpdate(registration)
        registration.update().catch((error: unknown) => {
          log.warn('Service worker update check failed:', error)
        })
      })
      .catch((error: unknown) => {
        log.warn('Service worker registration failed:', error)
      })

    window.setInterval(checkForAppShellUpdate, UPDATE_CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void checkForAppShellUpdate()
      }
    })
  })
}

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
