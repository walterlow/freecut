import { defineConfig, lazyPlugins } from 'vite-plus'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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
    ignorePatterns: toolIgnorePatterns,
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
    },
  },
  plugins: lazyPlugins(() => [react(), tailwindcss()]),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
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
      output: {
        manualChunks: (id) => {
          // Logger must be in its own chunk to avoid circular chunk TDZ errors.
          // Without this, Rollup places it in composition-runtime which has a
          // circular import with media-library, causing "Cannot access before
          // initialization" in production builds.
          if (id.endsWith('src/shared/logging/logger.ts')) {
            return 'core-logger'
          }

          // Timeline bridge modules that re-export UI must live with the UI
          // chunk; otherwise core ends up importing UI, which creates a
          // feature-editing-core <-> feature-editing-ui TDZ cycle at startup.
          if (
            id.includes('/src/features/timeline/contracts/editor.ts') ||
            id.includes('/src/features/timeline/index.ts')
          ) {
            return 'feature-editing-ui'
          }

          // Application feature chunks
          if (
            id.includes('/src/features/timeline/') ||
            id.includes('/src/features/media-library/')
          ) {
            if (id.includes('/components/')) {
              return 'feature-editing-ui'
            }
            return 'feature-editing-core'
          }
          if (id.includes('/src/features/effects/')) {
            return 'feature-effects'
          }
          // Composition-runtime shares deeply coupled deps with editing-core
          // (timeline stores, keyframes, export utils). Merging them into one
          // chunk eliminates the circular chunk dependency that causes TDZ
          // errors ("Cannot access before initialization") in production builds.
          if (id.includes('/src/features/composition-runtime/')) {
            return 'feature-editing-core'
          }

          // React must be in its own chunk, loaded first to ensure proper initialization
          // This prevents "Cannot set properties of undefined" errors with React 19.2 features
          if (id.includes('node_modules/react-dom')) {
            return 'react-vendor'
          }
          if (id.includes('node_modules/react/')) {
            return 'react-vendor'
          }
          // Router framework
          if (id.includes('@tanstack/react-router')) {
            return 'router-vendor'
          }
          // State management
          if (id.includes('/node_modules/zustand/') || id.includes('/node_modules/zundo/')) {
            return 'state-vendor'
          }
          // Media processing - loaded on demand
          if (id.includes('@mediabunny/ac3')) {
            return 'media-ac3-decoder'
          }
          if (id.includes('@mediabunny/mp3-encoder')) {
            return 'media-mp3-encoder'
          }
          if (id.includes('/node_modules/mediabunny/')) {
            return 'media-bunny-core'
          }
          if (id.includes('@mediabunny/')) {
            return 'media-processing'
          }
          // Audio/video processing helpers
          if (id.includes('/node_modules/gifuct-js/')) {
            return 'gif-processing'
          }
          // UI framework
          if (id.includes('@radix-ui/')) {
            return 'vendor-ui'
          }
          // Icons - keep lucide-react in separate chunk for better caching
          if (id.includes('lucide-react')) {
            return 'vendor-icons'
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
      '@huggingface/transformers',
    ],
    // Pre-bundle lucide-react for faster dev startup (avoids analyzing 1500+ icons on each reload)
    include: ['lucide-react'],
  },
})
