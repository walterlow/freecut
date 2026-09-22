import { defineConfig, lazyPlugins } from 'vite-plus'
import type { Plugin } from 'vite-plus'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Stamps public/sw.js with the hashed entry-chunk filename at build time so the service
// worker's CACHE_VERSION — and the sw.js bytes — change on every deploy. Without this the
// SW file is byte-identical across deploys, so registration.update() never detects a new
// version and old cached chunks are never purged. Uses the content hash (not a timestamp)
// so identical builds produce an identical SW and avoid needless update churn.
function serviceWorkerVersionPlugin(): Plugin {
  const placeholder = '__FREECUT_BUILD_ID__'
  let buildId = ''

  return {
    name: 'freecut-sw-version',
    apply: 'build',
    writeBundle(options, bundle) {
      const mainEntry = Object.values(bundle).find(
        (output) => output.type === 'chunk' && output.isEntry && output.name === 'main',
      )
      buildId =
        mainEntry && mainEntry.type === 'chunk'
          ? mainEntry.fileName.replace(/[^a-zA-Z0-9]/g, '-')
          : buildId
    },
    // closeBundle runs after Vite has copied publicDir into the out dir, so dist/sw.js
    // exists here with the placeholder intact.
    closeBundle() {
      if (!buildId) {
        this.warn('serviceWorkerVersionPlugin: no main entry chunk found; sw.js not stamped')
        return
      }
      const swPath = join(fileURLToPath(new URL('./dist', import.meta.url)), 'sw.js')
      const source = readFileSync(swPath, 'utf8')
      if (!source.includes(placeholder)) {
        return
      }
      writeFileSync(swPath, source.replaceAll(placeholder, buildId))
    },
  }
}

const oxlintConfig = JSON.parse(readFileSync(new URL('./.oxlintrc.json', import.meta.url), 'utf8'))
const oxfmtConfig = JSON.parse(readFileSync(new URL('./.oxfmtrc.json', import.meta.url), 'utf8'))
const toolIgnorePatterns = [
  'dist/**',
  'coverage/**',
  'public/**',
  'tmp/**',
  'output/**',
  'scripts/**',
]

// https://vite.dev/config/
export default defineConfig({
  lint: {
    ...oxlintConfig,
    ignorePatterns: toolIgnorePatterns,
    options: {
      ...(oxlintConfig.options ?? {}),
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ...oxfmtConfig,
    // `tsr generate` emits routeTree.gen.ts at 80 cols; oxfmt would rewrap it
    // at 100, so the two rewrite each other on every `npm run routes`.
    ignorePatterns: [...toolIgnorePatterns, 'src/routeTree.gen.ts'],
  },
  staged: {
    '*.{js,ts,tsx,json}': 'vp check --fix',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Ratchet floor, not a target: set just below measured coverage
      // (2026-06-10: 50.2% stmts / 43.7% branch / 54.9% funcs / 51.5% lines)
      // so CI fails on regressions. Raise these as coverage grows.
      thresholds: {
        statements: 48,
        branches: 42,
        functions: 52,
        lines: 49,
      },
    },
  },
  plugins: lazyPlugins(() => [react(), tailwindcss(), serviceWorkerVersionPlugin()]),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    // Keep every UI dependency on the same React dispatcher. This also prevents
    // an optimizer refresh from leaving Radix on a stale React module during HMR.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      // Enables the JS self-profiling API (new Profiler(...)) for dev-time
      // performance investigation, e.g. profiling play-start latency.
      'Document-Policy': 'js-profiling',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    // @mediabunny/ac3 is an intentionally large lazy decoder bundle (~1.1 MB minified).
    // Keep warnings focused on unexpected growth rather than this known outlier.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      // Multi-entry: the editor app (index.html) plus the headless render
      // harness (headless.html), a UI-less entry that exposes window.freecut
      // for the Node/Playwright headless render+edit CLI.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        headless: fileURLToPath(new URL('./headless.html', import.meta.url)),
      },
      output: {
        manualChunks: (id) => {
          const normalizedId = id.replaceAll('\\', '/')
          const isWorkspaceGateShell =
            normalizedId.endsWith('/src/features/workspace-gate/workspace-gate.tsx') ||
            normalizedId.endsWith('/src/features/workspace-gate/workspace-gate-splash.tsx') ||
            normalizedId.endsWith('/src/features/workspace-gate/use-pathname.ts')
          const isAppShellComponent =
            normalizedId.endsWith('/src/components/brand/freecut-logo.tsx') ||
            normalizedId.endsWith('/src/components/ui/accordion.tsx') ||
            normalizedId.endsWith('/src/components/ui/button.tsx') ||
            normalizedId.endsWith('/src/components/ui/button-variants.ts') ||
            normalizedId.endsWith('/src/components/ui/global-tooltip.tsx') ||
            // TooltipProvider wraps the whole app in App, so the Radix tooltip
            // primitive must live in the shell. Without this pin, the chunker
            // places it in feature-editing-core (majority importer) and the
            // entire 1.2MB editor chunk loads on the landing page.
            normalizedId.endsWith('/src/components/ui/tooltip.tsx')

          // Logger must be in its own chunk to avoid circular chunk TDZ errors.
          // Without this, Rollup places it in composition-runtime which has a
          // circular import with media-library, causing "Cannot access before
          // initialization" in production builds.
          if (normalizedId.endsWith('/src/shared/logging/logger.ts')) {
            return 'core-logger'
          }

          if (
            isAppShellComponent ||
            (normalizedId.includes('/src/routes/') && !normalizedId.includes('.lazy.')) ||
            normalizedId.includes('/src/app/error-boundary') ||
            normalizedId.includes('/src/app/pwa-install-prompt') ||
            isWorkspaceGateShell ||
            (normalizedId.includes('/src/i18n/') && !normalizedId.includes('/src/i18n/locales/'))
          ) {
            return 'app-shell'
          }

          // Timeline bridge modules that re-export UI must live with the UI
          // chunk; otherwise core ends up importing UI, which creates a
          // feature-editing-core <-> feature-editing-ui TDZ cycle at startup.
          if (normalizedId.includes('/src/features/timeline/index.ts')) {
            return 'feature-editing-ui'
          }

          // Application feature chunks
          if (normalizedId.includes('/src/infrastructure/gpu-effects/')) {
            return 'gpu-effects'
          }
          if (
            normalizedId.includes('/src/features/media-library/services/media-library-service') ||
            normalizedId.includes('/src/features/media-library/services/file-access')
          ) {
            return 'media-library-service'
          }
          if (
            normalizedId.includes('/src/features/media-library/services/media-analysis-service') ||
            normalizedId.includes('/src/features/media-library/deps/analysis')
          ) {
            return 'media-analysis'
          }
          if (
            normalizedId.includes('/src/features/timeline/components/clip-filmstrip') ||
            normalizedId.includes('/src/features/timeline/components/clip-waveform') ||
            normalizedId.includes('/src/features/timeline/hooks/use-filmstrip') ||
            normalizedId.includes('/src/features/timeline/hooks/use-gif-frames') ||
            normalizedId.includes('/src/features/timeline/hooks/use-waveform') ||
            normalizedId.includes('/src/features/timeline/services/filmstrip-cache') ||
            normalizedId.includes('/src/features/timeline/services/filmstrip-storage') ||
            normalizedId.includes('/src/features/timeline/services/waveform-cache') ||
            normalizedId.includes('/src/features/timeline/services/waveform-opfs-storage') ||
            normalizedId.includes('/src/features/timeline/services/gif-frame-cache') ||
            normalizedId.includes('/src/features/timeline/utils/compound-clip-waveform')
          ) {
            return 'timeline-media-visuals'
          }
          if (
            normalizedId.includes('/src/features/timeline/components/keyframe-graph-panel') ||
            normalizedId.includes('/src/features/timeline/deps/keyframe-editors') ||
            normalizedId.includes('/src/features/keyframes/components/dopesheet-editor') ||
            normalizedId.includes('/src/features/keyframes/components/value-graph-editor')
          ) {
            return 'timeline-keyframe-graph'
          }
          if (
            normalizedId.includes('/src/features/timeline/components/bento-layout-dialog') ||
            normalizedId.includes('/src/features/timeline/components/reverse-conform-dialog') ||
            normalizedId.includes('/src/features/timeline/components/silence-removal-dialog') ||
            normalizedId.includes('/src/features/timeline/components/filler-removal-dialog')
          ) {
            return 'timeline-dialogs'
          }
          if (
            normalizedId.includes('/src/features/timeline/') ||
            normalizedId.includes('/src/features/media-library/')
          ) {
            if (normalizedId.includes('/components/')) {
              return 'feature-editing-ui'
            }
            return 'feature-editing-core'
          }
          if (normalizedId.includes('/src/features/effects/')) {
            return 'feature-effects'
          }
          // `src/runtime/composition-runtime/**` deliberately has no rule here.
          // A rule pinning it to `feature-editing-core` used to exist but matched
          // a path the code no longer lives at, so it was inert; the current
          // graph has no chunk cycle to break (feature-editing-core imports only
          // rolldown-runtime and app-shell), while re-pinning it would move ~130
          // modules into that 1.6MB chunk.

          // React must be in its own chunk, loaded first to ensure proper initialization
          // This prevents "Cannot set properties of undefined" errors with React 19.2 features
          if (normalizedId.includes('/node_modules/react-dom/')) {
            return 'react-vendor'
          }
          if (normalizedId.includes('/node_modules/react/')) {
            return 'react-vendor'
          }
          // Router framework — router-core/history are separate packages, so
          // they need their own matchers or they leak into app-shell.
          if (
            normalizedId.includes('/node_modules/@tanstack/react-router/') ||
            normalizedId.includes('/node_modules/@tanstack/router-core/') ||
            normalizedId.includes('/node_modules/@tanstack/history/')
          ) {
            return 'router-vendor'
          }
          if (normalizedId.includes('/node_modules/sonner/')) {
            return 'toast-vendor'
          }
          // State management
          if (normalizedId.includes('/node_modules/zustand/')) {
            return 'state-vendor'
          }
          // Media processing - loaded on demand
          if (normalizedId.includes('/node_modules/@mediabunny/ac3/')) {
            return 'media-ac3-decoder'
          }
          if (normalizedId.includes('/node_modules/@mediabunny/mp3-encoder/')) {
            return 'media-mp3-encoder'
          }
          if (normalizedId.includes('/node_modules/mediabunny/')) {
            return 'media-bunny-core'
          }
          if (normalizedId.includes('/node_modules/@mediabunny/')) {
            return 'media-processing'
          }
          // Audio/video processing helpers
          if (normalizedId.includes('/node_modules/gifuct-js/')) {
            return 'gif-processing'
          }
          // UI framework
          if (normalizedId.includes('/node_modules/@radix-ui/')) {
            return 'vendor-ui'
          }
          // Icons - keep lucide-react in separate chunk for better caching
          if (normalizedId.includes('/node_modules/lucide-react/')) {
            return 'vendor-icons'
          }
          // Animation - keep motion in its own chunk for better caching
          if (
            normalizedId.includes('/node_modules/motion/') ||
            normalizedId.includes('/node_modules/framer-motion/')
          ) {
            return 'vendor-motion'
          }
          return undefined
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: [
      'mediabunny',
      '@mediabunny/ac3',
      '@mediabunny/mp3-encoder',
      '@mediabunny/aac-encoder',
      '@huggingface/transformers',
    ],
    // Pre-bundle the React runtime and root provider together so dependency
    // optimizer refreshes cannot mix old/new dispatchers in a live dev session.
    // Lucide stays explicit to avoid analyzing its full icon graph on startup.
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      '@radix-ui/react-tooltip',
      '@tanstack/react-virtual',
      'lucide-react',
    ],
  },
})
