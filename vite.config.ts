import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
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
            return 'core-logger';
          }

          // Application feature chunks
          if (id.includes('/src/features/timeline/') || id.includes('/src/features/media-library/')) {
            // Split UI from editing domain/runtime modules to reduce initial chunk pressure.
            // Keep stores/services/utils/deps/contracts together to preserve execution order
            // for tightly-coupled timeline/media-library integration points.
            if (id.includes('/components/')) {
              return 'feature-editing-ui';
            }
            return 'feature-editing-core';
          }
          if (id.includes('/src/features/effects/')) {
            return 'feature-effects';
          }
          if (id.includes('/src/features/composition-runtime/')) {
            return 'feature-composition-runtime';
          }

          // React must be in its own chunk, loaded first to ensure proper initialization
          // This prevents "Cannot set properties of undefined" errors with React 19.2 features
          if (id.includes('node_modules/react-dom')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/react/')) {
            return 'react-vendor';
          }
          // Router framework
          if (id.includes('@tanstack/react-router')) {
            return 'router-vendor';
          }
          // State management
          if (id.includes('/node_modules/zustand/') || id.includes('/node_modules/zundo/')) {
            return 'state-vendor';
          }
          // Media processing - loaded on demand
          if (id.includes('@mediabunny/ac3')) {
            return 'media-ac3-decoder';
          }
          if (id.includes('@mediabunny/mp3-encoder')) {
            return 'media-mp3-encoder';
          }
          if (id.includes('/node_modules/mediabunny/')) {
            return 'media-bunny-core';
          }
          if (id.includes('@mediabunny/')) {
            return 'media-processing';
          }
          // Audio/video processing helpers
          if (id.includes('/node_modules/soundtouchjs/')) {
            return 'audio-processing';
          }
          if (id.includes('/node_modules/gifuct-js/')) {
            return 'gif-processing';
          }
          // UI framework
          if (id.includes('@radix-ui/')) {
            return 'vendor-ui';
          }
          // Icons - keep lucide-react in separate chunk for better caching
          if (id.includes('lucide-react')) {
            return 'vendor-icons';
          }
          return undefined;
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['mediabunny', '@mediabunny/ac3', '@mediabunny/mp3-encoder'],
    // Pre-bundle lucide-react for faster dev startup (avoids analyzing 1500+ icons on each reload)
    include: ['lucide-react'],
  },
})
