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
          // React must be in its own chunk, loaded first to ensure proper initialization
          // This prevents "Cannot set properties of undefined" errors with React 19.2 features
          if (id.includes('node_modules/react-dom')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/react/')) {
            return 'react-vendor';
          }
          // Remotion Player - loaded when preview is needed
          if (id.includes('@remotion/player') || id.includes('@remotion/media')) {
            return 'remotion-player';
          }
          // Remotion Renderer - only needed for export
          if (id.includes('@remotion/renderer')) {
            return 'remotion-renderer';
          }
          // Remotion core and utilities
          if (
            id.includes('node_modules/remotion') ||
            id.includes('@remotion/transitions') ||
            id.includes('@remotion/shapes') ||
            id.includes('@remotion/layout-utils') ||
            id.includes('@remotion/gif') ||
            id.includes('@remotion/google-fonts')
          ) {
            return 'remotion-core';
          }
          // Media processing - loaded on demand
          if (id.includes('mediabunny')) {
            return 'media-processing';
          }
          // UI framework
          if (id.includes('@radix-ui/')) {
            return 'vendor-ui';
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
  },
})
