import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { i18n, i18nReady } from './i18n'
import { App } from './app'
import { recoverDevVitePreload } from './app/vite-preload-recovery'
import { createLogger } from '@/shared/logging/logger'
import {
  getEditorProjectIdFromPathname,
  getEditorProjectReloadPathWithCacheBust,
  rememberLastEditorProjectId,
} from '@/shared/projects/last-editor-project'
import './index.css'

const log = createLogger('App')
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000
const ACCEPTED_APP_UPDATE_SIGNATURE_KEY = 'freecut-accepted-app-update-signature'

let updateToastVisible = false
let devVitePreloadRecoveryInFlight = false

// Debug utilities are editor-heavy; keep them out of the production startup graph.
if (import.meta.env.DEV) {
  const origWarn = console.warn
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('reduced-motion-disabled')) {
      return
    }
    origWarn.apply(console, args)
  }
  void import('@/app/debug').then(({ initializeDebugUtils }) => initializeDebugUtils())
}

const initialProjectId = getEditorProjectIdFromPathname(window.location.pathname)
if (initialProjectId) {
  rememberLastEditorProjectId(initialProjectId)
}

function getCurrentProjectId(): string | undefined {
  return getEditorProjectIdFromPathname(window.location.pathname)
}

async function saveCurrentProjectBeforeReload(): Promise<boolean> {
  const projectId = getCurrentProjectId()

  if (!projectId) {
    return true
  }

  try {
    const { useTimelineStore } = await import('@/features/timeline/stores/timeline-store-facade')
    await useTimelineStore.getState().saveTimeline(projectId)
    return true
  } catch (e) {
    log.error('Failed to save before reload:', e)
    return false
  }
}

async function showSaveBeforeReloadFailedToast() {
  window.dispatchEvent(new Event('freecut:ensure-toaster'))
  try {
    const { toast } = await import('sonner')
    toast.error(i18n.t('editor.editor.projectSaveFailed'))
  } catch (error) {
    log.warn('Failed to show save-before-reload error:', error)
  }
}

function rememberAcceptedAppUpdate(signature?: string) {
  if (signature) {
    window.localStorage.setItem(ACCEPTED_APP_UPDATE_SIGNATURE_KEY, signature)
  }
}

function reloadCurrentLocationWithUpdateCacheBust() {
  window.location.assign(getEditorProjectReloadPathWithCacheBust())
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
        if (!(await saveCurrentProjectBeforeReload())) {
          toast.error(i18n.t('editor.editor.projectSaveFailed'))
          return
        }
        rememberAcceptedAppUpdate(updateSignature)
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
  // Build identity is the entry module script (e.g. /assets/main-[hash].js); its content
  // hash changes on every deploy. We deliberately IGNORE <link rel="stylesheet"> tags:
  // route/feature CSS is code-split and injected into the live DOM at runtime, so an
  // editor session accumulates stylesheet links that the pristine server HTML never has.
  // Comparing those made checkForAppShellUpdate fire a false "new version" toast on every
  // editor load. Dynamic import()s inject <link rel="modulepreload">, never <script>, so
  // the module-script set stays stable for a given build.
  const scriptPaths = Array.from(
    documentToInspect.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'),
  ).map((element) => new URL(element.src, window.location.href).pathname)

  return JSON.stringify(scriptPaths.sort())
}

// Snapshot the entry-script signature at startup, before React mounts or the router
// injects anything, so it matches the pristine HTML that checkForAppShellUpdate re-fetches.
const currentBuildAssetSignature = getBuildAssetSignature(document)

let appShellUpdateCheckInFlight = false
let appShellUpdateRecheckQueued = false
async function checkForAppShellUpdate() {
  // Coalesce overlapping checks — the interval, visibilitychange, and a burst of
  // vite:preloadError events would otherwise fire several concurrent fetches of `/`.
  // Rather than drop the extras (which would lose the signal if the in-flight fetch
  // transiently fails or gets a stale `/`), queue a single trailing re-check so a real
  // deploy is still caught after the current fetch settles instead of only at the next
  // interval/visibility event.
  if (appShellUpdateCheckInFlight) {
    appShellUpdateRecheckQueued = true
    return
  }
  appShellUpdateCheckInFlight = true
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
      await showUpdateAvailableToast(
        reloadCurrentLocationWithUpdateCacheBust,
        nextBuildAssetSignature,
      )
    }
  } catch (error) {
    log.warn('App update check failed:', error)
  } finally {
    appShellUpdateCheckInFlight = false
  }

  if (appShellUpdateRecheckQueued) {
    appShellUpdateRecheckQueued = false
    await checkForAppShellUpdate()
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

// A failed lazy-chunk load has two very different causes:
//   (a) a new deployment removed the old chunk hash — a real stale version, worth
//       prompting the user to save + reload, or
//   (b) a transient network blip while fetching an otherwise-present chunk.
// Blindly toasting treated every blip as a version change, so a flaky connection while
// opening a workspace or panel popped a scary "new version available". Instead, verify
// against the server: checkForAppShellUpdate re-fetches the app shell and only surfaces
// the toast when the live entry-script hash actually differs from ours. A transient
// failure leaves the signature unchanged, so it stays silent and the user can retry.
window.addEventListener('vite:preloadError', (event) => {
  if (import.meta.env.DEV) {
    event.preventDefault()
    if (devVitePreloadRecoveryInFlight) return

    devVitePreloadRecoveryInFlight = true
    void recoverDevVitePreload({
      save: saveCurrentProjectBeforeReload,
      reload: reloadCurrentLocationWithUpdateCacheBust,
      onSaveFailure: showSaveBeforeReloadFailedToast,
    }).then((didReload) => {
      if (!didReload) devVitePreloadRecoveryInFlight = false
    })
    return
  }
  void checkForAppShellUpdate()
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

void i18nReady.then(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
