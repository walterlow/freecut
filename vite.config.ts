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
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Application feature chunks
          if (id.includes('/src/features/timeline/')) {
            return 'feature-timeline';
          }
          if (id.includes('/src/features/media-library/')) {
            return 'feature-media-library';
          }
          if (id.includes('/src/features/effects/')) {
            return 'feature-effects';
          }
          if (id.includes('/src/lib/composition-runtime/')) {
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
    exclude: ['mediabunny'],
    // Pre-bundle lucide-react for faster dev startup (avoids analyzing 1500+ icons on each reload)
    include: ['lucide-react'],
  },
})
